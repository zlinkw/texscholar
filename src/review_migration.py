"""Read-only planning for explicit migration of embedded review records."""
import base64
import copy
import json
import os
from pathlib import Path
import re
import uuid

from source_review import Conflict, PENDING, split_state, digest, locate
from review_blocks import safe_boundaries
from review_pdf import paragraph_span


def preview(review):
    review.assert_ready()
    if review.sidecar or not review.state:
        raise Conflict('迁移预览需要现有内嵌审核状态。')
    files = review.state['rounds'][-1]['files']
    texts = {name: review.read(name) for name in files}
    boundaries, failures = {}, {}
    for name, text in texts.items():
        try:
            boundaries[name] = safe_boundaries(text)
        except ValueError as error:
            failures[name] = str(error)
    ranges, conflicts = {}, []
    for id_, edit in review.state['edits'].items():
        if edit['status'] not in PENDING:
            continue
        name = edit['file']
        try:
            if name not in texts:
                raise Conflict('文件不在当前审核范围；保留原审核项供人工核对。')
            if name in failures:
                raise Conflict(failures[name])
            text = texts[name]
            item = review.payload(edit)
            start, end = review.locate_edit(text, edit, item)
            anchor = review.anchor_context(edit, item)
            if locate(text, review.live_excerpt(edit, item), anchor['left'], anchor['right']) != (start, end):
                raise Conflict('旧候选位置与唯一可核对的位置不一致。')
            if start == end:
                if start not in boundaries[name]:
                    raise Conflict('插入位置不是安全的独立行边界。')
                a = b = start
                kind = 'slot'
            else:
                a, b = paragraph_span(text, start, end)
                line_end = text.find('\n', a)
                a = line_end + 1 if line_end >= 0 and not text[a:line_end].strip() else text.rfind('\n', 0, a) + 1
                if b and b < len(text) and text[b - 1] != '\n':
                    after = text.find('\n', b)
                    b = len(text) if after < 0 else after + 1
                if a not in boundaries[name] or b not in boundaries[name]:
                    raise Conflict('段落边界不能安全插入标记。')
                kind = 'paragraph'
            key = (name, a, b, kind)
            ranges.setdefault(key, []).append({'id': id_, 'start': start, 'end': end,
                                               'questions': edit.get('questions', [])})
        except (Conflict, ValueError, OSError) as error:
            conflicts.append({'id': id_, 'file': name, 'reason': str(error)})
    invalid = set()
    keys = list(ranges)
    for i, (name, a, b, _) in enumerate(keys):
        for other in keys[i + 1:]:
            file, x, y, _ = other
            if name == file and (max(a, x) < min(b, y) or a == b and x < a < y or x == y and a < x < b):
                invalid.update((keys[i], other))
    blocks = []
    prefix, header, _ = split_state(review.text)
    for key, edits in ranges.items():
        name, a, b, kind = key
        if name == review.state_rel and a < len(prefix) < b:
            conflicts.extend({'id': edit['id'], 'file': name, 'reason': '拟标记范围跨越原审核状态头，请人工核对。'} for edit in edits)
            continue
        if key in invalid:
            conflicts.extend({'id': edit['id'], 'file': name, 'reason': '现有候选的拟标记范围交叠，请人工核对。'} for edit in edits)
            continue
        shift_a = len(header) if name == review.state_rel and a >= len(prefix) else 0
        shift_b = len(header) if name == review.state_rel and b >= len(prefix) else 0
        blocks.append({'block_id': str(uuid.uuid4()), 'file': name, 'kind': kind, 'start': a, 'end': b,
                       'source_start': a + shift_a, 'source_end': b + shift_b, 'text': texts[name][a:b], 'edits': edits})
    return {'session': review.state['session'], 'schema': review.state['schema'], 'owner': review.state_rel,
            'state_sha256': digest(review.raw),
            'source_revisions': {name: review.source_digest(text) for name, text in texts.items()},
            'blocks': blocks, 'conflicts': conflicts,
            'actions': {'state': '.codex-review/state.json', 'owner_data': 'remove active DATA after pending state is durable',
                        'owner_notice': 'retain a read-only migration notice', 'markers': len(blocks),
                        'preserve': ['rounds', 'ids', 'versions', 'notes', 'decisions', 'counters', 'dependencies']},
            'counts': {'rounds': len(review.state['rounds']), 'edits': len(review.state['edits']),
                       'versions': sum(len(edit['versions']) for edit in review.state['edits'].values()),
                       'notes': sum(len(edit.get('requests', [])) for edit in review.state['edits'].values())}}


def prepare(review, approved):
    """Prepare exact immutable migration targets after the preview is confirmed."""
    from review_blocks import prepare as mark, index
    if (review.repo / '.codex-review' / 'state.json').exists():
        raise Conflict('外置审核状态已存在，不能覆盖或重复迁移。')
    current = preview(review)
    for key in ('session', 'schema', 'owner', 'state_sha256', 'source_revisions', 'conflicts', 'counts', 'actions'):
        if approved.get(key) != current[key]:
            raise Conflict('迁移预览或源文件已变化，请重新预览。')
    if current['conflicts']:
        raise Conflict('迁移预览存在未解决冲突；请先核对所有冲突，未迁移任何审核项。')
    def comparable(blocks):
        return sorted(({key: value for key, value in row.items() if key != 'block_id'} for row in blocks),
                      key=lambda row: (row['file'], row['start'], row['end'], row['kind']))
    blocks = approved.get('blocks')
    if not isinstance(blocks, list) or comparable(blocks) != comparable(current['blocks']):
        raise Conflict('迁移标记范围与已核对的预览不一致。')
    ids = []
    for block in blocks:
        try:
            value = uuid.UUID(block['block_id'])
        except (ValueError, KeyError, TypeError) as error:
            raise Conflict('迁移块身份无效。') from error
        if value.version != 4 or str(value) != block['block_id']:
            raise Conflict('迁移块身份必须是规范的随机 UUID。')
        ids.append(str(value))
    if len(ids) != len(set(ids)):
        raise Conflict('迁移块身份重复。')
    old_state, old_storage = copy.deepcopy(review.state), review.storage
    try:
        if review.storage == 'git':
            review.migrate_storage()
        texts = {name: review.read(name) for name in review.state['rounds'][-1]['files']}
        marked = dict(texts)
        for block in sorted(blocks, key=lambda row: (row['file'], row['start']), reverse=True):
            try:
                marked[block['file']], _ = mark(marked[block['file']], block['start'], block['end'], block['kind'], block['block_id'])
            except ValueError as error:
                raise Conflict(f"迁移块 {block['block_id']} 无法安全标记：{error}") from error
        seen = set()
        for name, text in marked.items():
            for id_ in index(text):
                if id_ in seen:
                    raise Conflict(f'迁移块身份在多个文件中重复：{id_}。')
                seen.add(id_)
        review.state['schema'] = 3
        review.state['legacy_owner'] = review.state_rel
        review.state['blocks'] = {}
        for block in blocks:
            rel, id_ = block['file'], block['block_id']
            row = index(marked[rel])[id_]
            review.state['blocks'][id_] = {'file': rel, 'kind': block['kind']}
            snapshot = review.snapshot_files({'block.tex': marked[rel][row['start']:row['end']].encode('utf-8')})
            for item in block['edits']:
                edit = review.state['edits'][item['id']]
                edit['block_id'] = id_
                edit['anchor'] = {'version': edit['versions'][-1], 'block_snapshot': snapshot,
                                  'start': item['start'] - block['start'], 'end': item['end'] - block['start']}
        prefix, header, _ = split_state(review.text)
        lines = [line for line in header.splitlines(keepends=True) if not line.startswith('% CODEX-REVIEW-DATA ')]
        notice = '% CODEX-REVIEW-MIGRATED state=.codex-review/state.json' + review.eol
        at = next(i for i, line in enumerate(lines) if line.rstrip('\r\n') == '% CODEX-REVIEW-STATE-END')
        lines.insert(at, notice)
        owner_body = marked.get(review.state_rel, prefix + split_state(review.text)[2])
        if not owner_body.startswith(prefix):
            raise Conflict('迁移 owner 的标记越过状态头。')
        owner_final = prefix + ''.join(lines) + owner_body[len(prefix):]
        marked[review.state_rel] = owner_final
        projection = review.state.get('auto_backup_projection', review.state['accepted'])
        if not review.state.get('auto_backup_projection_error') and all(review.contents(projection, name) == text for name, text in texts.items()):
            review.state['auto_backup_projection'] = review.snapshot_files({name: marked[name].encode('utf-8') for name in texts})
        target_state = copy.deepcopy(review.state)
        encoded = {}
        for name, text in marked.items():
            original = review.raw if name == review.state_rel else review.original[name]
            encoded[name] = (b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8')
        return {'state': target_state, 'state_raw': json.dumps(target_state, ensure_ascii=False, separators=(',', ':')).encode('utf-8'),
                'sources': encoded, 'conflicts': current['conflicts'], 'preview': approved}
    finally:
        review.state, review.storage = old_state, old_storage


def transaction(review, approved):
    """Create immutable recovery data; source and authority remain unchanged."""
    result = prepare(review, approved)
    names = sorted(name for name in result['sources'] if name != review.state_rel)
    data = {'owner-old': review.raw, 'owner-new': result['sources'][review.state_rel],
            'state-final': result['state_raw']}
    for i, name in enumerate(names):
        data[f'{i}-old'] = review.original[name]
        data[f'{i}-new'] = result['sources'][name]
    meta = {'kind': 'legacy-migration', 'owner': review.state_rel, 'files': names}
    data['migration.json'] = json.dumps(meta, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    commit = review.snapshot_files(data)
    tr = {'kind': 'migration', 'commit': commit, 'files': names, 'owner': review.state_rel}
    original = review.state
    try:
        review.state = copy.deepcopy(original)
        review.state['transaction'] = tr
        owner_intent = review.encode(review.embedded())
    finally:
        review.state = original
    pending = copy.deepcopy(result['state'])
    pending['transaction'] = tr
    pending_raw = json.dumps(pending, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encode = lambda raw: base64.b64encode(raw).decode('ascii')
    plan = {'kind': 'legacy-migration', 'commit': commit, 'owner': review.state_rel,
            'owner_before': encode(review.raw), 'owner_intent': encode(owner_intent),
            'owner_after': encode(result['sources'][review.state_rel]),
            'state_pending': encode(pending_raw), 'state_final': encode(result['state_raw']),
            'files': [{'file': name, 'before': encode(data[f'{i}-old']), 'after': encode(data[f'{i}-new'])}
                      for i, name in enumerate(names)]}
    plan_id = review.snapshot_files({'migration-plan': json.dumps(plan, ensure_ascii=False, separators=(',', ':')).encode('utf-8')})
    return {'commit': commit, 'plan': plan_id, 'preview': approved}


def apply(review, approved):
    """Apply an explicitly confirmed preview under the caller's writer lock."""
    from review_host_client import HostError, HostSession
    if approved.get('conflicts') or preview(review)['conflicts']:
        raise Conflict('迁移预览存在未解决冲突；请先核对所有冲突，未迁移任何审核项。')
    try:
        with HostSession(review.repo) as host:
            staged = transaction(review, approved)
            if review.state_path.read_bytes() != review.raw or any(review.path(name).read_bytes() != raw for name, raw in review.original.items()):
                raise Conflict('迁移预览后的源码或状态已变化；未开始迁移。')
            if (review.repo / '.codex-review' / 'state.json').exists():
                raise Conflict('外置审核状态已存在，不能覆盖。')
            host.check()
            host.apply_migration(staged['plan'])
    except (HostError, OSError) as error:
        raise Conflict(f'迁移未完成；请保留现场并显式恢复：{error}') from error
    return {'complete': True, 'state': '.codex-review/state.json', 'owner': review.state_rel,
            'counts': approved['counts'], 'conflicts': approved['conflicts']}


def _read_object(root, commit):
    if not re.fullmatch(r'[a-f0-9]{64}', commit or ''):
        raise Conflict('迁移恢复对象身份无效。')
    path = root / '.codex-review' / 'objects' / (commit + '.json')
    for component in (path, path.parent, path.parent.parent):
        if component.is_symlink() or component.is_junction():
            raise Conflict('迁移恢复对象不能经过链接。')
    raw = path.read_bytes()
    if digest(raw) != commit:
        raise Conflict('迁移恢复对象完整性不匹配。')
    obj = json.loads(raw)['files']
    return {name: base64.b64decode(value, validate=True) for name, value in obj.items()}


def _file(root, relative):
    name = Path(relative)
    if name.is_absolute() or '..' in name.parts or not name.parts or name.suffix.lower() != '.tex':
        raise Conflict('迁移恢复文件路径无效。')
    target = root / name
    for component in (target, *target.parents):
        if component == root:
            break
        if component.is_symlink() or component.is_junction():
            raise Conflict('迁移恢复文件不能经过链接。')
    if not target.resolve(strict=True).is_relative_to(root) or not target.is_file():
        raise Conflict('迁移恢复文件不在当前项目。')
    return target


def _embedded_state(raw):
    text = raw.decode('utf-8-sig')
    _, header, _ = split_state(text)
    rows = [line[len('% CODEX-REVIEW-DATA '):] for line in header.splitlines() if line.startswith('% CODEX-REVIEW-DATA ')]
    if len(rows) != 1:
        raise Conflict('迁移前的旧状态无效。')
    return json.loads(rows[0])


def recovery_preview(repo, owner=None):
    """Locate a durable migration intent without changing the project."""
    root = Path(repo).resolve(strict=True)
    state_path = root / '.codex-review' / 'state.json'
    if any(path.is_symlink() or path.is_junction() for path in (state_path, state_path.parent)):
        raise Conflict('迁移状态不能是链接。')
    state_raw = state_path.read_bytes() if state_path.is_file() else None
    tr = None
    if state_raw:
        try:
            state = json.loads(state_raw)
            candidate = state.get('transaction') if isinstance(state, dict) else None
            if isinstance(candidate, dict) and candidate.get('kind') == 'migration':
                tr = candidate
        except (ValueError, UnicodeDecodeError):
            pass
    candidates = []
    if tr is None:
        if owner:
            candidates = [_file(root, owner)]
        else:
            for directory, folders, names in os.walk(root, followlinks=False):
                folders[:] = [name for name in folders if name not in {'.git','.codex-review','.latex-build','node_modules','clean_dir'}
                              and not (Path(directory) / name).is_symlink() and not (Path(directory) / name).is_junction()]
                candidates.extend(Path(directory) / name for name in names if name.lower().endswith('.tex'))
        found = []
        for candidate in candidates:
            try:
                value = _embedded_state(_file(root, candidate.relative_to(root).as_posix()).read_bytes()).get('transaction')
                if isinstance(value, dict) and value.get('kind') == 'migration':
                    found.append(value)
            except (Conflict, UnicodeDecodeError, ValueError):
                continue
        if len(found) != 1:
            raise Conflict('未找到唯一的迁移恢复意图；请核对状态和旧 owner。')
        tr = found[0]
    saved = _read_object(root, tr.get('commit'))
    meta = json.loads(saved['migration.json'])
    if meta != {'kind':'legacy-migration', 'owner':tr.get('owner'), 'files':tr.get('files')}:
        raise Conflict('迁移恢复对象与状态不一致。')
    owner_path = _file(root, meta['owner'])
    source_raw = {meta['owner']: owner_path.read_bytes()}
    for name in meta['files']:
        source_raw[name] = _file(root, name).read_bytes()
    info = {'commit':tr['commit'], 'owner':meta['owner'], 'files':meta['files'],
            'state_revision':digest(state_raw) if state_raw is not None else None,
            'source_revisions':{name:digest(raw) for name, raw in source_raw.items()}}
    _, wrapper = _recovery_plan(root, info)
    plan = json.loads(base64.b64decode(json.loads(wrapper)['files']['migration-plan'], validate=True))
    decode = lambda value: base64.b64decode(value, validate=True)
    owner_actual = source_raw[meta['owner']]
    owner_phase = next((name for name, value in [('old',plan['owner_before']),('intent',plan['owner_intent']),('migrated',plan['owner_after'])]
                        if owner_actual == decode(value)), 'conflict')
    phases = {meta['owner']:owner_phase}
    for item in plan['files']:
        actual = source_raw[item['file']]
        phases[item['file']] = 'marked' if actual == decode(item['after']) else 'old' if actual == decode(item['before']) else 'conflict'
    pending, final = decode(plan['state_pending']), decode(plan['state_final'])
    state_phase = ('absent' if state_raw is None else 'pending' if state_raw == pending else 'final' if state_raw == final
                   else 'partial' if len(state_raw) < len(pending) and pending.startswith(state_raw) else 'conflict')
    info['phases'] = phases
    info['state_phase'] = state_phase
    info['conflicts'] = [name for name, phase in phases.items() if phase == 'conflict'] + (['.codex-review/state.json'] if state_phase == 'conflict' else [])
    return info


def _recovery_plan(root, info):
    saved = _read_object(root, info['commit'])
    tr = {'kind':'migration', 'commit':info['commit'], 'files':info['files'], 'owner':info['owner']}
    owner_old, owner_new = saved['owner-old'], saved['owner-new']
    old_text = owner_old.decode('utf-8-sig')
    prefix, header, suffix = split_state(old_text)
    old_state = _embedded_state(owner_old)
    old_state.pop('next', None)
    old_state['transaction'] = tr
    counter = re.findall(r'CODEX-REVIEW-NEXT manuscript=([1-9][0-9]*) response=([a-z]+)', header)
    if len(counter) != 1:
        raise Conflict('旧审核计数器无法恢复。')
    eol = '\r\n' if '\r\n' in old_text else '\n'
    lines = [line for line in header.splitlines() if not line.startswith('% CODEX-REVIEW-DATA ') and 'CODEX-REVIEW-NEXT ' not in line]
    at = lines.index('% CODEX-REVIEW-STATE-END')
    lines[at:at] = [f'% CODEX-REVIEW-NEXT manuscript={counter[0][0]} response={counter[0][1]}',
                    '% CODEX-REVIEW-DATA ' + json.dumps(old_state, ensure_ascii=False, separators=(',', ':'))]
    owner_intent = (b'\xef\xbb\xbf' if owner_old.startswith(b'\xef\xbb\xbf') else b'') + (prefix + eol.join(lines) + eol + suffix).encode('utf-8')
    final = saved['state-final']
    pending = json.loads(final); pending['transaction'] = tr
    pending_raw = json.dumps(pending, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encode = lambda raw: base64.b64encode(raw).decode('ascii')
    plan = {'kind':'legacy-migration', 'commit':info['commit'], 'owner':info['owner'],
            'owner_before':encode(owner_old), 'owner_intent':encode(owner_intent), 'owner_after':encode(owner_new),
            'state_pending':encode(pending_raw), 'state_final':encode(final),
            'files':[{'file':name, 'before':encode(saved[f'{i}-old']), 'after':encode(saved[f'{i}-new'])}
                     for i, name in enumerate(info['files'])]}
    payload = json.dumps(plan, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    raw = json.dumps({'files':{'migration-plan':encode(payload)}}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return digest(raw), raw


def recover(repo, approved):
    """Resume an explicitly previewed migration under the caller's writer lock."""
    from review_host_client import HostError, HostSession
    root = Path(repo).resolve(strict=True)
    current = recovery_preview(root, approved.get('owner'))
    if current != approved:
        raise Conflict('迁移恢复预览已过期；未更改文件。')
    if current['conflicts']:
        raise Conflict('迁移恢复存在作者修改或状态冲突：' + ', '.join(current['conflicts']))
    plan_id, raw = _recovery_plan(root, current)
    try:
        with HostSession(root) as host:
            target = root / '.codex-review' / 'objects' / (plan_id + '.json')
            if target.exists():
                if target.read_bytes() != raw:
                    raise Conflict('迁移计划对象内容不匹配。')
            else:
                with target.open('xb') as stream:
                    stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            if recovery_preview(root, current['owner']) != current:
                raise Conflict('迁移恢复期间源码或状态已变化。')
            host.check()
            host.apply_migration(plan_id, recover=True)
    except (HostError, OSError) as error:
        raise Conflict(f'迁移恢复未完成；请保留现场：{error}') from error
    return {'complete':True, 'state':'.codex-review/state.json', 'owner':current['owner']}
