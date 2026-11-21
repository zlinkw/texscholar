#!/usr/bin/env python3
"""Original-source author review. Immutable local snapshots, one embedded state, no index writes.

All mutators preview by default; apply requires the exact SHA256 of the state file.
This is an author-decision ledger and conservative scoped patcher, not a merge tool.
"""
import argparse
import base64
import copy
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager, nullcontext

BEGIN = "% CODEX-REVIEW-STATE-BEGIN"
END = "% CODEX-REVIEW-STATE-END"
DATA = "% CODEX-REVIEW-DATA "
PENDING = {"pending", "rework"}


class Conflict(ValueError):
    pass


class SyncConflict(Conflict):
    """An individual saved item needs author reconciliation."""


class FieldConflict(Conflict):
    def __init__(self, field, message):
        super().__init__(message)
        self.field = field


class OverlapConflict(Conflict):
    def __init__(self, id_, version, file):
        super().__init__(f'Overlapping unresolved edits: existing ID {id_}; rework that item if appropriate, never auto-merge or accept')
        self.id, self.version, self.file = id_, version, file


@contextmanager
def writer_lock_at(parent):
    """Share the existing project writer lock with metadata-only configuration."""
    if parent.is_symlink() or parent.is_junction():
        raise Conflict('审核锁目录不能是链接。')
    parent.mkdir(exist_ok=True)
    lock = parent / 'writer.lock'
    if lock.is_symlink() or lock.is_junction():
        raise Conflict('审核锁文件不能是链接。')
    with lock.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            acquire = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            release = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            acquire = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            release = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        stream.seek(0)
        try:
            acquire()
        except OSError as error:
            raise Conflict('另一个审核写入或缓存清理正在进行；未覆盖数据，请待其结束后重试。') from error
        try:
            yield
        finally:
            stream.seek(0)
            release()


def store_file_snapshot(object_root, files):
    """Write one immutable local review object shared by source transactions."""
    for component in (object_root, object_root.parent):
        if component.is_symlink() or component.is_junction():
            raise Conflict('Review object storage cannot be a link')
    raw = json.dumps({'files': {name: base64.b64encode(data).decode('ascii') for name, data in sorted(files.items())}},
                     ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    oid = digest(raw)
    object_root.mkdir(parents=True, exist_ok=True)
    target = object_root / (oid + '.json')
    if target.exists():
        if target.is_symlink() or target.is_junction() or target.read_bytes() != raw:
            raise Conflict('Immutable review object does not match its identity')
    else:
        with target.open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    return oid


def digest(data):
    return hashlib.sha256(data).hexdigest()


def letters(n):
    result = ""
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(97 + r) + result
    return result


def word_changes(before, after):
    """Word/punctuation-level spans; equal tokens are never included in markup."""
    pattern = r"\\[A-Za-z@]+|[^\W_]+|_+|\s+|."
    a, b = re.findall(pattern, before, re.S), re.findall(pattern, after, re.S)
    offsets_a, offsets_b = [0], [0]
    for token in a:
        offsets_a.append(offsets_a[-1] + len(token))
    for token in b:
        offsets_b.append(offsets_b[-1] + len(token))
    return [{"kind": tag, "old_start": offsets_a[i], "old_end": offsets_a[j],
             "new_start": offsets_b[k], "new_end": offsets_b[l]}
            for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
            if tag != "equal"]


def change_scope(before, after, changes):
    """Display-only counts using the PDF's TeX-aware boundaries; never a size gate."""
    from review_pdf import _unit_spans
    counts = {}
    try:
        for side, text in (('old', before), ('new', after)):
            units = _unit_spans(text)
            for kind, name in (('prose', 'sentences'), ('environment', 'environments')):
                counts[side + '_' + name] = sum(
                    1 for unit in units if unit['kind'] == kind and unit['text'].strip() and any(
                        max(unit['start'], change[side + '_start']) < min(unit['end'], change[side + '_end'])
                        and before[change['old_start']:change['old_end']].strip() != after[change['new_start']:change['new_end']].strip()
                        for change in changes))
    except ValueError as error:
        return {'error': str(error)}
    return counts


def validate_review_unit(text):
    """A new decision cannot combine separate paragraphs or prose and TeX displays."""
    lines = []
    for line in text.splitlines():
        for pos, char in enumerate(line):
            if char != '%':
                continue
            slashes, previous = 0, pos - 1
            while previous >= 0 and line[previous] == '\\':
                slashes += 1
                previous -= 1
            if slashes % 2 == 0:
                line = line[:pos]
                break
        lines.append(line)
    visible = '\n'.join(lines).strip()
    if not visible:
        return
    stack, whole_environment = [], False
    tokens = list(re.finditer(r'\\(begin|end)\{([^{}]+)\}', visible))
    if tokens and tokens[0].start() == 0 and tokens[0][1] == 'begin':
        for token in tokens:
            if token[1] == 'begin':
                stack.append(token[2])
            elif not stack or stack.pop() != token[2]:
                break
            if not stack:
                whole_environment = token.end() == len(visible) and tokens[0][2] in {
                    'equation', 'equation*', 'align', 'align*', 'aligned', 'gather', 'gather*', 'gathered',
                    'multline', 'multline*', 'displaymath', 'math', 'split', 'array',
                    'figure', 'figure*', 'table', 'table*', 'tabular', 'tabular*', 'tabularx',
                    'algorithm', 'algorithm*', 'tikzpicture', 'picture'}
                break
    whole_display = ((visible.startswith(r'\[') and visible.endswith(r'\]') and visible.count(r'\[') == 1)
                     or (visible.startswith('$$') and visible.endswith('$$') and visible.count('$$') == 2))
    if whole_environment or whole_display:
        return
    if re.search(r'\n[ \t]*\n', visible) or re.search(r'\\(?:begin|end)\{|\\par\b|\\\[|\\\]|\$\$', visible):
        raise Conflict('修订范围过大：请按相邻修改位置分组，最多一个自然段；公式、图注、表注或其他独立格式必须单独编号，不能与前后正文打包。原文和已发编号未改变。')


def split_state(text):
    starts = list(re.finditer(r"(?m)^" + re.escape(BEGIN) + r"(?=\r?$)", text))
    ends = list(re.finditer(r"(?m)^" + re.escape(END) + r"(?=\r?$)", text))
    if len(starts) != 1 or len(ends) != 1 or ends[0].start() < starts[0].start():
        raise Conflict("Exactly one existing canonical CODEX-REVIEW-STATE block is required")
    a = starts[0].start()
    b = ends[0].end()
    # Include the line break after the block; keep all other bytes/lines intact.
    if text[b:b + 2] == "\r\n":
        b += 2
    elif text[b:b + 1] == "\n":
        b += 1
    return text[:a], text[a:b], text[b:]


def body(text):
    if BEGIN in text or END in text:
        a, _, b = split_state(text)
        return a + b
    return text


def locate(text, needle, left="", right=""):
    """Exact text plus contextual anchors, never a saved line number or fuzzy overwrite."""
    hits = []
    start = 0
    while start <= len(text):
        i = text.find(needle, start) if needle else start
        if i < 0:
            break
        left_ok = bool(left) and text[:i].endswith(left)
        right_ok = bool(right) and text[i + len(needle):].startswith(right)
        if ((left_ok or right_ok) if needle else ((not left or left_ok) and (not right or right_ok))):
            hits.append((int(left_ok) + int(right_ok), i))
        elif needle and not left and not right:
            hits.append((0, i))
        start = i + max(1, len(needle))
    if hits:
        score = max(h[0] for h in hits)
        hits = [i for s, i in hits if s == score]
    if len(hits) != 1:
        raise Conflict(f"Exact anchored span is missing or ambiguous ({len(hits)} matches); preserve source and reconcile")
    return hits[0], hits[0] + len(needle)


class Review:
    def __init__(self, repo, state, git="git", storage=None, initialize=False):
        started = time.perf_counter()
        self.repo = Path(repo).resolve(strict=True)
        self.git_exe = git
        self.env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        self.env.update({"GIT_AUTHOR_NAME": "Codex local review", "GIT_AUTHOR_EMAIL": "review@localhost",
                         "GIT_COMMITTER_NAME": "Codex local review", "GIT_COMMITTER_EMAIL": "review@localhost",
                         "GIT_OPTIONAL_LOCKS": "0"})
        self.sidecar = str(state).replace('\\', '/') == '.codex-review/state.json'
        external_state = self.repo / '.codex-review' / 'state.json'
        if not self.sidecar and external_state.exists():
            try:
                pending = json.loads(external_state.read_bytes())
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise Conflict('外置状态损坏或迁移未完成；请预览迁移恢复，不能初始化旧状态。')
            if isinstance(pending, dict) and isinstance(pending.get('transaction'), dict) and pending['transaction'].get('kind') == 'migration':
                raise Conflict('迁移事务未完成；请显式预览并恢复迁移。')
            old_owner = self.path(state)
            if re.search(r'(?m)^% CODEX-REVIEW-DATA ', old_owner.read_text(encoding='utf-8-sig')):
                raise Conflict('外置审核状态已存在且正文仍有活跃状态；请先核对双状态。')
            self.sidecar = True
        if self.sidecar:
            self.state_path = self.repo / '.codex-review' / 'state.json'
            for component in (self.state_path.parent, self.state_path):
                if component.is_symlink() or component.is_junction():
                    raise Conflict('Review state cannot be a link')
            if not self.state_path.is_file() and not (initialize and not self.state_path.exists()):
                raise Conflict('Review state is missing; use explicit initialization or migration')
        else:
            self.state_path = self.path(state)
        self.state_rel = self.state_path.relative_to(self.repo).as_posix()
        self.new_sidecar = self.sidecar and not self.state_path.exists()
        self.raw = b'' if self.new_sidecar else self.state_path.read_bytes()
        self.text = self.raw.decode("utf-8-sig")
        self.bom = self.raw.startswith(b"\xef\xbb\xbf")
        self.eol = "\r\n" if "\r\n" in self.text else "\n"
        if self.new_sidecar:
            self.state = None
            next_ids = [1, 1]
        elif self.sidecar:
            self.state = json.loads(self.text)
            if not isinstance(self.state, dict) or self.state.get('schema') != 3:
                raise Conflict('Unsupported review-state schema')
            next_ids = self.state.get('next')
            if not isinstance(next_ids, list) or len(next_ids) != 2 or any(type(n) is not int or n < 1 for n in next_ids):
                raise Conflict('Invalid next-ID counter')
        else:
            _, block, _ = split_state(self.text)
            counters = re.findall(r"CODEX-REVIEW-NEXT manuscript=([1-9][0-9]*) response=([a-z]+)", block)
            if len(counters) != 1:
                raise Conflict("Exactly one reconciled next-ID counter is required")
            n, alpha = counters[0]
            alpha_value = 0
            for char in alpha:
                alpha_value = alpha_value * 26 + ord(char) - 96
            next_ids = [int(n), alpha_value]
            rows = [line[len(DATA):] for line in block.splitlines() if line.startswith(DATA)]
            if len(rows) > 1:
                raise Conflict("Duplicate machine state")
            self.state = json.loads(rows[0]) if rows else None
        if self.state and self.state.get("schema") not in ((3,) if self.sidecar else (1, 2)):
            raise Conflict("Unsupported review-state schema")
        if self.sidecar and self.state and not self.state.get('transaction'):
            rounds = self.state.get('rounds', [])
            registered = set(rounds[-1].get('files', [])) if rounds else set()
            if self.state.get('legacy_owner'):
                registered.add(self.state['legacy_owner'])
            for file in registered:
                try:
                    source = self.path(file).read_text(encoding='utf-8-sig')
                except FileNotFoundError:
                    continue
                if re.search(r'(?m)^% CODEX-REVIEW-DATA ', source):
                    raise Conflict('外置审核状态与正文内活跃状态同时存在；请先核对双状态。')
        self.storage = storage or ("git" if self.state and self.state["schema"] == 1 else "files")
        if self.storage not in ("git", "files"):
            raise Conflict("Unknown review object storage")
        if self.storage == "git":
            root = Path(self.git("rev-parse", "--show-toplevel").decode().strip()).resolve()
            if root != self.repo:
                raise Conflict("Use the verified legacy repository root")
        self.object_root = self.repo / ".codex-review" / "objects"
        for component in [self.object_root, self.object_root.parent]:
            if component.is_symlink() or component.is_junction():
                raise Conflict("Review object storage cannot be a link")
        if self.state:
            if "next" in self.state and self.state["next"] != next_ids:
                raise Conflict("Counter disagrees with stored state; reconcile before allocation")
            self.state["next"] = next_ids
        if self.state and any(not re.fullmatch(r"[1-9][0-9]*|[a-z]+", k) for k in self.state.get("edits", {})):
            raise Conflict("Invalid edit ID in state")
        if self.state:
            for id_ in self.state["edits"]:
                if id_.isdigit():
                    issued, unused = int(id_), next_ids[0]
                else:
                    issued = 0
                    for char in id_:
                        issued = issued * 26 + ord(char) - 96
                    unused = next_ids[1]
                if issued >= unused:
                    raise Conflict("Counter would reuse an issued ID")
        if self.state and self.state.get('transaction') and not isinstance(self.state['transaction'], dict):
            raise Conflict('审核事务状态无效；请保留文件并核对。')
        if self.state and self.state.get("transaction"):
            # Only explicit recover/status may continue; mutators check this again.
            self.interrupted = True
        else:
            self.interrupted = False
        self.original = {}
        self.question_original = {}
        self._objects = {}
        self._read_cache = None
        self._raw_sources = {}
        self._source_digests = {}
        self._block_indexes = {}
        if self.state:
            backup = self.backup_status()
            for id_, version in backup.get('published', {}).items():
                edit = self.state['edits'].get(id_)
                if edit and edit['status'] == 'accepted' and edit['versions'] and edit['versions'][-1] == version:
                    edit['published_version'] = version
        self.timings = {'state_read_parse_s': time.perf_counter() - started,
                        'source_read_s': 0.0, 'object_read_s': 0.0, 'locate_s': 0.0, 'diff_scope_s': 0.0}

    def backup_status(self):
        path = self.object_root.parent / 'automatic-backup.json'
        if path.is_symlink() or path.is_junction() or path.exists() and not path.is_file():
            raise Conflict('后台备份日志不是普通文件')
        data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        session = self.state.get('session') if self.state else None
        if data.get('session') == session:
            return data
        return {key:data[key] for key in ('saved_status', 'saved_job', 'saved_done', 'saved_pending') if key in data}

    def backup_packet(self):
        data = self.backup_status()
        saved = data.get('saved_status')
        if not saved and data.get('saved_job'):
            job = data['saved_job']
            saved = {'status':'local' if job.get('commit') else 'queued',
                     'message':'本地备份已提交，远端待上传' if job.get('commit') else '后台 Git 备份排队中',
                     **({'commit':job['commit']} if job.get('commit') else {})}
        elif not saved and data.get('saved_done'):
            commit = data['saved_done']['commit']
            saved = {'status':'done', 'commit':commit, 'message':'已备份 ' + commit[:8]}
        return {'auto_backup': saved or data.get('status', {}), 'auto_backup_job': data.get('job'),
                'auto_backup_done': data.get('done'), 'saved_backup_job': data.get('saved_job'),
                'saved_backup_done': data.get('saved_done')}

    def writer_lock(self):
        return writer_lock_at(self.object_root.parent)

    def git(self, *args, data=None):
        # Per-invocation Windows long-path support; do not mutate user/repository config.
        p = subprocess.run([self.git_exe, "-c", "core.longpaths=true", "-C", str(self.repo), *args], input=data,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        if p.returncode:
            raise Conflict(p.stderr.decode("utf-8", "replace").strip())
        return p.stdout

    def path(self, name):
        p = Path(name)
        if p.is_absolute() or ".." in p.parts or any(c in str(name) for c in "\x00\n\r"):
            raise Conflict("Use a repository-relative .tex path without traversal")
        p = self.repo / p
        cur = p
        while cur != self.repo:
            if cur.is_symlink() or (hasattr(cur, "is_junction") and cur.is_junction()):
                raise Conflict("Symlink/junction targets are not supported")
            cur = cur.parent
        p = p.resolve(strict=True)
        if not p.is_relative_to(self.repo) or ".git" in p.relative_to(self.repo).parts:
            raise Conflict("Path escapes source root")
        if not p.is_file() or p.suffix.lower() != ".tex":
            raise Conflict("Existing regular .tex files only")
        return p

    def read(self, rel):
        if self._read_cache is not None and rel in self._read_cache:
            return self._read_cache[rel]
        started = time.perf_counter()
        p = self.path(rel)
        raw = p.read_bytes()
        self.original.setdefault(rel, raw)
        self._raw_sources[rel] = raw.decode("utf-8-sig")
        text = self._raw_sources[rel] if self.sidecar else body(self._raw_sources[rel])
        if self._read_cache is not None:
            self._read_cache[rel] = text
        self.timings['source_read_s'] += time.perf_counter() - started
        return text

    def source_digest(self, text):
        if text not in self._source_digests:
            self._source_digests[text] = digest(text.encode('utf-8'))
        return self._source_digests[text]

    def locate_edit(self, text, edit, item=None):
        started = time.perf_counter()
        try:
            return self._locate_edit(text, edit, item)
        finally:
            self.timings['locate_s'] += time.perf_counter() - started

    def block_row(self, text, file, block_id):
        from review_blocks import index, index_target
        def indexed(name, source):
            cached = self._block_indexes.get(name)
            if cached is None or cached[0] != source:
                cached = (source, index(source))
                self._block_indexes[name] = cached
            return cached[1]
        try:
            try:
                row = indexed(file, text)[block_id]
            except ValueError:
                row = index_target(text, block_id)
            for other in self.state['rounds'][-1]['files']:
                if other == file:
                    continue
                source = self.read(other)
                if block_id in source:
                    try:
                        duplicate = block_id in indexed(other, source)
                    except ValueError:
                        duplicate = any(block_id in line for line in source.splitlines() if line.startswith('% TS-BLOCK-'))
                    if duplicate:
                        raise Conflict('审核块 ID 在多个文件中重复：' + block_id)
            return row
        except Conflict:
            raise
        except (ValueError, KeyError) as error:
            raise Conflict('审核块标记缺失、重复或错配：' + str(block_id)) from error

    def _locate_edit(self, text, edit, item=None):
        item = item if item is not None else self.payload(edit)
        if self.sidecar:
            block_id = edit.get('block_id')
            block = self.state.get('blocks', {}).get(block_id)
            if not block:
                raise Conflict('审核项没有已登记的固定块；请明确修复，不会猜测位置。')
            row = self.block_row(text, edit['file'], block_id)
            if block['file'] != edit['file'] or row['kind'] != block['kind']:
                raise Conflict('审核块文件或类型不一致：' + block_id)
            anchor = edit.get('anchor', {})
            if anchor.get('conflict'):
                raise Conflict(anchor['conflict'])
            old_block = self.contents(anchor['block_snapshot'], 'block.tex')
            current = text[row['start']:row['end']]
            if current != old_block:
                raise Conflict('正文已修改；请核对重叠内容并人工调整：' + block_id)
            a, b = row['start'] + anchor['start'], row['start'] + anchor['end']
            if text[a:b] != self.live_excerpt(edit, item):
                raise Conflict('审核块中的候选范围与原文不一致：' + block_id)
            return a, b
        anchor = edit.get('anchor')
        needle = self.live_excerpt(edit, item)
        if anchor and anchor['version'] == edit['versions'][-1]:
            if anchor.get('conflict'):
                raise Conflict(anchor['conflict'])
            if anchor['source'] == self.source_digest(text):
                a, b = anchor['start'], anchor['end']
                if text[a:b] != needle:
                    raise Conflict('Recorded location disagrees with immutable candidate')
                return a, b
            context = self.anchor_context(edit, item)
            return locate(text, needle, context['left'], context['right'])
        return locate(text, needle, item['left'], item['right'])

    def anchor_context(self, edit, fallback):
        anchor = edit.get('anchor')
        if anchor and anchor.get('context'):
            return {side: self.contents(anchor['context'], side + '.txt') for side in ('left', 'right')}
        return fallback

    def bind(self, edit, text, a, b, left_size=120, right_size=120):
        if self.sidecar:
            row = self.block_row(text, edit['file'], edit['block_id'])
            if not row['start'] <= a <= b <= row['end']:
                raise Conflict('候选范围超出固定审核块。')
            snapshot = self.snapshot({'block.tex': text[row['start']:row['end']].encode('utf-8')}, 'verified review block')
            edit['anchor'] = {'version': edit['versions'][-1], 'block_snapshot': snapshot,
                              'start': a-row['start'], 'end': b-row['start']}
            return
        context = self.snapshot({'left.txt': text[max(0, a-left_size):a].encode('utf-8'),
                                 'right.txt': text[b:b+right_size].encode('utf-8')}, 'verified location context')
        edit['anchor'] = {'version': edit['versions'][-1], 'source': self.source_digest(text),
                          'start': a, 'end': b, 'context': context}

    def prepare_block(self, spec):
        self.assert_ready()
        if not self.sidecar:
            raise Conflict('固定块需先显式迁移到外置状态。')
        from review_blocks import prepare, index
        rel = spec['file']
        if rel not in self.state['rounds'][-1]['files']:
            raise Conflict('文件不在当前审核范围。')
        text = self.read(rel)
        if spec.get('source_revision') != self.source_digest(text):
            raise Conflict('正文已变化；请重新预览标记。')
        if type(spec.get('start')) is not int or type(spec.get('end')) is not int:
            raise Conflict('审核块边界必须是整数。')
        if spec['kind'] not in ('slot', 'question'):
            validate_review_unit(text[spec['start']:spec['end']])
        try:
            updated, row = prepare(text, spec['start'], spec['end'], spec['kind'], spec.get('block_id'))
        except ValueError as error:
            raise Conflict(str(error)) from error
        for file in self.state['rounds'][-1]['files']:
            if file != rel and row['id'] in index(self.read(file)):
                raise Conflict('审核块 ID 已在其他文件使用。')
        registration = {'file': rel, 'kind': row['kind']}
        if 'questions' in spec:
            registration['questions'] = self.question_links(spec['questions'])
        self.state.setdefault('blocks', {})[row['id']] = registration
        # Mark the accepted projection only when it is exactly the same source;
        # otherwise a later acceptance reports a projection conflict rather than
        # importing unrelated author edits or guessing a matching paragraph.
        projection = self.state.get('auto_backup_projection', self.state['accepted'])
        if not self.state.get('auto_backup_projection_error') and self.contents(projection, rel) == text:
            files = {file: (updated if file == rel else self.contents(projection, file)).encode('utf-8')
                     for file in self.state['rounds'][-1]['files']}
            self.state['auto_backup_projection'] = self.snapshot(files, 'accepted projection block marker')
        return {rel: updated}, {'block_id': row['id'], 'file': rel, 'kind': row['kind'],
                                'start': spec['start'], 'end': spec['end'], 'source_revision': spec['source_revision'],
                                'before': text[spec['start']:spec['end']],
                                'marked': updated[row['marker_start']:row['marker_end']]}

    def save_block_source(self, id_, version, spec):
        self.assert_ready()
        if not self.sidecar:
            raise Conflict('编辑当前原文需要固定块模式。')
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING or edit['versions'][-1] != version:
            raise Conflict('审核项已变化；请重新打开。')
        block_id = edit['block_id']
        if spec.get('block_id') != block_id or not isinstance(spec.get('text'), str):
            raise Conflict('必须提供当前块身份和作者填写的原文。')
        text = self.read(edit['file'])
        if spec.get('source_revision') != self.source_digest(text):
            raise Conflict('正文已变化；请重新读取后编辑。')
        row = self.block_row(text, edit['file'], block_id)
        if '% TS-BLOCK-' in text[row['start']:row['end']]:
            raise Conflict('此容器含子审核块；请分别编辑子块，不能覆盖其标记。')
        replacement = spec['text']
        if '\r\n' in text:
            replacement = replacement.replace('\r\n', '\n').replace('\n', '\r\n')
        if '% TS-BLOCK-' in replacement or replacement and not replacement.endswith('\n'):
            raise Conflict('原文不能包含审核标记，且必须保留标记前的换行。')
        if row['kind'] not in ('slot', 'question'):
            validate_review_unit(replacement)
        if text[row['start']:row['end']] == replacement:
            return {}, {'id': id_, 'block_id': block_id, 'changed': False}
        return {edit['file']: text[:row['start']] + replacement + text[row['end']:]}, {
            'id': id_, 'block_id': block_id, 'changed': True, 'accepted': False}

    def reassociate_block(self, spec):
        """Explicitly repair a missing pair or rebind a uniquely moved block."""
        self.assert_ready()
        if not self.sidecar:
            raise Conflict('重新关联需要外置审核状态。')
        from review_blocks import index, prepare
        block_id, rel = spec.get('block_id'), spec.get('file')
        block = self.state.get('blocks', {}).get(block_id)
        if not block or rel not in self.state['rounds'][-1]['files']:
            raise Conflict('审核块或目标文件未登记。')
        texts = {name:self.read(name) for name in self.state['rounds'][-1]['files']}
        if spec.get('source_revision') != self.source_digest(texts[rel]):
            raise Conflict('目标文件已变化；请重新预览。')
        try:
            rows = [(name, index(text).get(block_id)) for name, text in texts.items()]
        except ValueError as error:
            raise Conflict('审核标记不完整或错配，请先核对标记：' + str(error)) from error
        hits = [(name,row) for name,row in rows if row is not None]
        updated = {}
        if spec.get('restore') is True:
            if hits:
                raise Conflict('该块标记仍存在，不能重复建立。')
            start, end = spec.get('start'), spec.get('end')
            if type(start) is not int or type(end) is not int:
                raise Conflict('恢复标记需要明确的完整行边界。')
            if block['kind'] not in ('slot', 'question'):
                validate_review_unit(texts[rel][start:end])
            try:
                updated[rel], row = prepare(texts[rel],start,end,block['kind'],block_id)
            except ValueError as error:
                raise Conflict(str(error)) from error
        else:
            if len(hits) != 1 or hits[0][0] != rel:
                raise Conflict('目标文件中没有唯一的完整块标记；不能猜测位置。')
            row = hits[0][1]
            if row['kind'] != block['kind']:
                raise Conflict('目标块类型与登记不一致。')
        previous = block['file']
        affected = [id_ for id_, edit in self.state['edits'].items() if edit.get('block_id') == block_id and edit['status'] in PENDING]
        block['file'] = rel
        for id_ in affected:
            self.state['edits'][id_]['file'] = rel
        return updated, {'block_id':block_id, 'file':rel, 'previous_file':previous, 'ids':affected,
                         'restored':bool(updated), 'changed':bool(updated) or previous != rel,
                         'marked':updated.get(rel, '')[row['marker_start']:row['marker_end']] if updated else ''}

    def sync_block(self, id_, version, source_revision):
        self.assert_ready()
        if not self.sidecar:
            raise Conflict('同步需要固定块模式。')
        from review_blocks import reconcile
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING or edit['versions'][-1] != version:
            raise Conflict('审核项已变化；请重新打开。')
        text = self.read(edit['file'])
        if self.source_digest(text) != source_revision:
            raise Conflict('正文已变化；请重新预览同步。')
        try:
            row = self.block_row(text, edit['file'], edit['block_id'])
        except Conflict as error:
            raise SyncConflict(str(error)) from error
        anchor = edit['anchor']
        if anchor.get('conflict'):
            raise SyncConflict(anchor['conflict'])
        old_block = self.contents(anchor['block_snapshot'], 'block.tex')
        current = text[row['start']:row['end']]
        item = self.payload(edit)
        options = copy.deepcopy(item.get('options', [{'label': 'A', 'after': item['after'], 'reason': '已有单方案'}]))
        try:
            result = reconcile(old_block, current, anchor['start'], anchor['end'], options)
        except ValueError as error:
            raise SyncConflict(str(error)) from error
        if result is None:
            return {}, {'id': id_, 'version': version, 'changed': False}
        start, end, before, options = result
        updated = {**item, 'before': before, 'after': options[0]['after'], 'options': options,
                   'left': text[max(0, row['start'] + start - 120):row['start'] + start],
                   'right': text[row['start'] + end:row['start'] + end + 120]}
        updated.pop('fulfillment', None)
        new_version = self.snapshot({'original.tex': before.encode('utf-8'), 'candidate.tex': options[0]['after'].encode('utf-8'),
                                     'span.json': json.dumps(updated, ensure_ascii=False).encode('utf-8')}, 'synchronized review item ' + id_)
        edit['versions'].append(new_version)
        self.bind(edit, text, row['start'] + start, row['start'] + end)
        self.mark_original_stale(edit, before, version, item['before'])
        return {}, {'id': id_, 'version': new_version, 'previous_version': version, 'changed': True,
                    'before': before, 'options': options, 'source_revision': source_revision}

    def mark_original_stale(self, edit, before, previous_version, previous_before):
        from review_blocks import changes
        for note in edit.get('requests', []):
            if note.get('side') != 'original':
                continue
            a, b = note['start'], note['end']
            note_before = previous_before if note['version'] == previous_version else json.loads(self.contents(note['version'], 'span.json'))['before']
            edits = changes(note_before, before)
            if any((x < b and y > a) or (x == y and a < x < b) for x, y, _ in edits):
                note['source_stale'] = True
                continue
            shift = sum(len(value) - (y - x) for x, y, value in edits if y <= a)
            if before[a + shift:b + shift] != note['quote']:
                note['source_stale'] = True

    def sync_saved(self, sources):
        """Reconcile pending items in saved files, retaining independent conflicts."""
        self.assert_ready()
        if not self.sidecar:
            raise Conflict('自动同步需要固定块模式。')
        if not isinstance(sources, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in sources.items()):
            raise Conflict('自动同步需要文件及其已保存版本。')
        for rel, revision in sources.items():
            if self.source_digest(self.read(rel)) != revision:
                raise Conflict('正文已再次变化；未保存自动同步结果。')
        results, conflicts = [], []
        for id_, edit in self.state['edits'].items():
            if edit['status'] not in PENDING or edit.get('file') not in sources:
                continue
            original = copy.deepcopy(edit)
            try:
                _, result = self.sync_block(id_, edit['versions'][-1], sources[edit['file']])
                if result['changed']:
                    results.append(result)
            except SyncConflict as error:
                self.state['edits'][id_] = original
                conflicts.append({'id': id_, 'message': str(error)})
        return {}, {'changed': bool(results), 'items': results, 'conflicts': conflicts}

    def relocate(self, id_, version, spec):
        self.assert_ready()
        if self.sidecar:
            raise Conflict('固定块模式不能按文字重新定位；请修复或重新关联块标记。')
        if not isinstance(spec, dict) or not isinstance(spec.get('before'), str) or any(not isinstance(spec.get(k, ''), str) for k in ('left', 'right')):
            raise FieldConflict('spec', 'Relocation needs exact before/left/right strings')
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING or edit['versions'][-1] != version:
            raise Conflict('Displayed candidate is stale or already decided')
        text, item = self.read(edit['file']), self.payload(edit)
        if spec.get('before') != self.live_excerpt(edit, item):
            raise Conflict('Relocation must preserve the exact original candidate text')
        a, b = locate(text, spec['before'], spec.get('left', ''), spec.get('right', ''))
        self.bind(edit, text, a, b, max(120, len(spec.get('left', ''))), max(120, len(spec.get('right', ''))))
        return {}, {'id': id_, 'version': version, 'relocated': True}

    def blob(self, raw):
        return self.git("hash-object", "-w", "--stdin", data=raw).decode().strip()

    def snapshot(self, files, label):
        """Immutable local snapshot; legacy storage uses scoped Git plumbing without HEAD/index writes."""
        if self.storage == "files":
            return self.snapshot_files(files)
        tree = {}
        for name, raw in sorted(files.items()):
            node = tree
            parts = Path(name).as_posix().split("/")
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = self.blob(raw)

        def make(node):
            entries = []
            for name, value in sorted(node.items()):
                oid = make(value) if isinstance(value, dict) else value
                mode, typ = ("040000", "tree") if isinstance(value, dict) else ("100644", "blob")
                entries.append(f"{mode} {typ} {oid}\t{name}".encode("utf-8") + b"\0")
            return self.git("mktree", "-z", data=b"".join(entries)).decode().strip()

        oid = self.git("commit-tree", make(tree), "-m", label).decode().strip()
        ref = f"refs/codex-review/{self.state['session'][:8]}/{uuid.uuid4().hex[:12]}"
        self.git("update-ref", ref, oid, "0" * len(oid))
        return oid

    def snapshot_files(self, files):
        return store_file_snapshot(self.object_root, files)

    def contents(self, commit, rel):
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
            raise Conflict("Invalid immutable object identity")
        return self.object_bytes(commit, rel).decode("utf-8")

    def object_bytes(self, commit, rel):
        if self.storage == "git":
            return self.git("show", f"{commit}:{rel}")
        if not re.fullmatch(r"[a-f0-9]{64}", commit):
            raise Conflict("Invalid local snapshot identity; legacy Git records require migration")
        if commit not in self._objects:
            started = time.perf_counter()
            raw = (self.object_root / (commit + ".json")).read_bytes()
            if digest(raw) != commit:
                raise Conflict("Local review snapshot integrity check failed")
            self._objects[commit] = json.loads(raw)['files']
            self.timings['object_read_s'] += time.perf_counter() - started
        return base64.b64decode(self._objects[commit][rel], validate=True)

    def migrate_storage(self, defer_pending=False):
        """One-time conversion of legacy objects; preserve IDs, notes and source."""
        self.assert_ready()
        if self.storage != "git":
            updated = self.defer_pending() if defer_pending else {}
            return updated, {"migrated": bool(updated), "storage": "files"}
        refs = {self.state["accepted"]}
        if self.state.get('auto_backup_projection'):
            refs.add(self.state['auto_backup_projection'])
        if self.state.get("submission"):
            refs.add(self.state["submission"])
        for rnd in self.state["rounds"]:
            refs.update([rnd["baseline"], rnd["accepted_start"]])
        for edit in self.state["edits"].values():
            refs.update(edit["versions"])
        converted = {}
        for old in refs:
            files = {}
            for row in self.git("ls-tree", "-rz", old).split(b"\0"):
                if not row:
                    continue
                meta, name = row.split(b"\t", 1)
                if meta.split()[1] != b"blob":
                    raise Conflict("Legacy review snapshot contains a non-file object")
                files[name.decode("utf-8")] = self.git("show", old + ":" + name.decode("utf-8"))
            self.storage = "files"
            converted[old] = self.snapshot(files, "migrated legacy snapshot")
            self.storage = "git"
        ref_fields = {"accepted", "baseline", "accepted_start", "submission", "version", "addressed_version", "auto_backup_projection"}
        def replace(value, field=None):
            if isinstance(value, dict):
                return {k: replace(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [converted.get(v, v) if field == "versions" else replace(v) for v in value]
            return converted.get(value, value) if field in ref_fields else value
        self.state = replace(self.state)
        self.state["schema"] = 2
        self.storage = "files"
        updated = self.defer_pending() if defer_pending else {}
        return updated, {"migrated": True, "storage": "files", "objects": len(converted), "source_changed": bool(updated)}

    def defer_pending(self):
        updated = {}
        for edit in self.state["edits"].values():
            if edit["status"] not in PENDING or edit.get("deferred", False):
                continue
            text = updated.get(edit["file"], self.read(edit["file"]))
            item = self.payload(edit)
            start, end = locate(text, item["after"], item["left"], item["right"])
            updated[edit["file"]] = text[:start] + item["before"] + text[end:]
            edit["deferred"] = True
        return updated

    def payload(self, edit):
        item = json.loads(self.contents(edit["versions"][-1], "span.json"))
        if edit.get('accepted_option'):
            item['after'] = self.option(item, edit['accepted_option'])['after']
        return item

    @staticmethod
    def option(item, label):
        options = item.get('options', [{'label': 'A', 'after': item['after'], 'reason': '已有单方案'}])
        for option in options:
            if option['label'] == label:
                return option
        raise Conflict('Unknown candidate option: ' + str(label))

    @staticmethod
    def validate_options(spec, required=False):
        if 'options' not in spec:
            if required:
                raise FieldConflict('spec.options', 'Provide ranked options A/B/C in one request')
            return None
        options = spec['options']
        if not isinstance(options, list) or not 1 <= len(options) <= 3:
            raise FieldConflict('spec.options', 'Provide one to three ranked options')
        if len(options) < 3 and not str(spec.get('fewer_options_reason', '')).strip():
            raise FieldConflict('spec.fewer_options_reason', 'Fewer than three options requires fewer_options_reason; do not invent filler variants')
        for i, option in enumerate(options):
            prefix = f'spec.options[{i}]'
            if not isinstance(option, dict):
                raise FieldConflict(prefix, 'Each ranked option must be an object')
            if option.get('label') != 'ABC'[i]:
                raise FieldConflict(prefix + '.label', 'Each ranked option needs sequential label A/B/C')
            if not isinstance(option.get('after'), str):
                raise FieldConflict(prefix + '.after', 'Candidate after must be complete LaTeX text')
            if not isinstance(option.get('reason'), str) or not option['reason'].strip():
                raise FieldConflict(prefix + '.reason', 'Each ranked option needs a nonempty reason')
            if 'summary' in option and (not isinstance(option['summary'], str) or not option['summary'].strip()):
                raise FieldConflict(prefix + '.summary', 'Option summary must describe the actual tradeoff in nonempty text')
        if 'intent' in spec:
            intent = spec['intent']
            if not isinstance(intent, dict) or set(intent) != {'goal', 'preserve'} or any(
                    not isinstance(intent[k], str) or not intent[k].strip() for k in ('goal', 'preserve')):
                raise FieldConflict('spec.intent', 'Revision intent needs nonempty goal and preserve text')
        if len({o['after'] for o in options}) != len(options):
            raise FieldConflict('spec.options', 'Options must contain distinct text, not duplicate candidates')
        return copy.deepcopy(options)

    def propose_options(self, spec, id_=None, version=None):
        self.validate_options(spec, required=True)
        if id_:
            edit = self.state['edits'].get(id_)
            if not edit or edit['versions'][-1] != version:
                raise Conflict('Displayed candidate is stale; reread before replacing options')
        spec = {**spec, 'deferred': True}
        return self.propose(spec, id_)

    @staticmethod
    def live_excerpt(edit, item):
        if edit['status'] == 'accepted':
            return item['after']
        return item["before"] if edit.get("deferred", False) else item["after"]

    def assert_ready(self):
        if not self.state or not self.state.get("rounds"):
            raise Conflict("Begin a review round first")
        if self.interrupted:
            if self.state['transaction'].get('kind') == 'migration':
                raise Conflict('迁移事务未完成；请显式预览并恢复迁移。')
            raise Conflict("Interrupted transaction: inspect status then explicitly recover")

    def begin(self, name, files, submission=None):
        if self.interrupted:
            raise Conflict("Recover the existing transaction first")
        if self.state is None:
            if self.sidecar:
                n, value = 1, 1
                for directory, folders, names in os.walk(self.repo, followlinks=False):
                    folders[:] = [f for f in folders if f not in {'.git', '.codex-review', '.latex-build', 'node_modules', 'clean_dir'}
                                  and not (Path(directory) / f).is_symlink() and not (Path(directory) / f).is_junction()]
                    for filename in names:
                        path = Path(directory) / filename
                        if path.suffix.lower() == '.tex' and not path.is_symlink() and not path.is_junction():
                            if DATA in path.read_text(encoding='utf-8-sig'):
                                raise Conflict('Existing embedded review state requires explicit migration')
            else:
                _, block, _ = split_state(self.text)
                counters = re.findall(r"CODEX-REVIEW-NEXT manuscript=(\d+) response=([a-z]+)", block)
                if len(counters) != 1:
                    raise Conflict("Supply/reconcile the one actual next-ID counter before initialization")
                n, s = counters[0]
                value = 0
                for c in s:
                    value = value * 26 + ord(c) - 96
            self.state = {"schema": 3 if self.sidecar else 2 if self.storage == "files" else 1, "session": uuid.uuid4().hex, "next": [int(n), value],
                          "rounds": [], "edits": {}, "submission": None}
        if self.storage == 'files':
            saved_done = self.backup_status().get('saved_done') or {}
            saved = saved_done.get('review') or {}
            if (saved.get('accepted') or saved.get('history')) and saved.get('session') == self.state['session'] and saved_done.get('commit'):
                for ref in ('HEAD', 'origin/master'):
                    check = subprocess.run([self.git_exe, '-C', str(self.repo), 'merge-base', '--is-ancestor', saved_done['commit'], ref],
                                           env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    if check.returncode == 1:
                        saved = {}
                        break
                    if check.returncode:
                        raise Conflict('无法核对已备份成果的 Git 历史：' + check.stderr.decode('utf-8', 'replace').strip())
            published = saved.get('accepted', {}) if saved.get('session') == self.state['session'] else {}
            if self.state.get('pending_backup') or any(
                    e['status'] == 'accepted' and e['versions'] and e.get('published_version') != e['versions'][-1]
                    and published.get(id_) != e['versions'][-1]
                    and not (saved.get('session') == self.state['session'] and e['versions'][-1] in saved.get('history', {}).get(id_, {}))
                    for id_, e in self.state['edits'].items()):
                raise Conflict('请先完成已接收成果的提交与推送，再开始新批次；未清除任何旧记录。')
            if any(e['status'] in PENDING and not e.get('deferred', False) for e in self.state['edits'].values()):
                raise Conflict('旧式候选仍在正文中，请先核对并转换为候选与正文分离的审核方式。')
        elif name in [r["name"] for r in self.state["rounds"]]:
            raise Conflict("Round names must not be reused")
        if not self.sidecar and self.state_rel not in files:
            raise Conflict("Include the canonical state owner in the round's file scope")
        if self.storage != 'files' and any(e["file"] not in files for e in self.state["edits"].values() if e["status"] in PENDING):
            raise Conflict("Carry every unresolved file into the next round")
        current = {p: self.read(p) for p in sorted(set(files))}
        if any(BEGIN in self.original[p].decode("utf-8-sig") for p in current if not self.sidecar and p != self.state_rel):
            raise Conflict("A second review-state owner exists; reconcile pointers first")
        if any(re.search(r"\\codex(?:replace|add|delete)\s*\{", t) for t in current.values()):
            raise Conflict("Unresolved legacy colored marks: migration requires an explicit preservation plan")
        if submission:
            if self.storage == "files":
                if not re.fullmatch(r"[a-f0-9]{64}", submission) or not (self.object_root / (submission + ".json")).is_file():
                    raise Conflict("Submitted identity must be an existing local snapshot; migrate legacy Git records first")
                oid = submission
            else:
                oid = self.git("rev-parse", "--verify", f"{submission}^{{commit}}").decode().strip()
            if self.state["submission"] and self.state["submission"] != oid:
                raise Conflict("Do not silently change the submitted baseline")
            self.state["submission"] = oid
        accepted = current.copy()
        for e in self.state["edits"].values():
            if e["status"] in PENDING and not e.get("deferred", False):
                item = self.payload(e)
                a, b = locate(accepted[e["file"]], item["after"], item["left"], item["right"])
                accepted[e["file"]] = accepted[e["file"]][:a] + item["before"] + accepted[e["file"]][b:]
        base = self.snapshot({p: t.encode("utf-8") for p, t in current.items()}, "review round baseline " + name)
        acc = self.snapshot({p: t.encode("utf-8") for p, t in accepted.items()}, "accepted projection at round start " + name)
        if self.storage == 'files':
            # Explicit begin replaces disposable pending work, not accepted prose.
            # Fixed-size batch identity keeps an old button/version from targeting
            # an identical candidate reissued as 1/a in a later batch.
            self.state.update(session=uuid.uuid4().hex, next=[1, 1], edits={}, rounds=[])
        self.state["rounds"].append({"name": name, "baseline": base, "accepted_start": acc, "ids": [], "files": sorted(current)})
        self.state["accepted"] = acc
        return {}, {"round": name, "baseline": base, "accepted": acc}

    def question_source(self, name):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise Conflict('Reviewer question source must be inside this paper project')
        target = self.repo / relative
        for component in [target, *target.parents]:
            if component == self.repo:
                break
            if component.is_symlink() or component.is_junction():
                raise Conflict('Reviewer question source cannot be a link')
        if not target.resolve(strict=True).is_relative_to(self.repo) or not target.is_file():
            raise Conflict('Reviewer question source is not a regular project file')
        if target.suffix.lower() not in ('.tex', '.txt', '.md'):
            raise Conflict('Exact reviewer-question links currently require a UTF-8 .tex, .txt or .md source')
        return target.read_bytes()

    def question_links(self, questions):
        if not isinstance(questions, list):
            raise Conflict('questions must be a list of verified original reviewer excerpts')
        normalized = []
        for question in questions:
            if not isinstance(question, dict) or not all(isinstance(question.get(k), str) and question[k].strip() for k in ('id', 'file', 'quote')):
                raise Conflict('Each reviewer question needs id, file and exact quote')
            raw = self.question_source(question['file'])
            previous = self.question_original.setdefault(question['file'], raw)
            if previous != raw:
                raise Conflict('Concurrent reviewer-question source modification')
            # Embedded state and generated linkage comments are not original
            # reviewer prose and can repeat the stored quote verbatim.
            source = body(raw.decode('utf-8-sig'))
            source = re.sub(r'(?m)^[ \t]*%[ \t]*CODEX-QUESTION[^\r\n]*', '', source)
            start = source.find(question['quote'])
            if start < 0 or source.find(question['quote'], start + 1) >= 0:
                raise Conflict('Reviewer question quote must match its actual source uniquely')
            entry = {k: question[k] for k in ('id', 'file', 'quote')}
            if entry not in normalized:
                normalized.append(entry)
        return normalized

    def update_questions(self, id_, version, questions, replace=False):
        self.assert_ready()
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING:
            raise Conflict('Question metadata requires an existing unresolved candidate ID')
        if version != edit['versions'][-1]:
            raise Conflict('Displayed candidate is stale; reread the latest version before linking questions')
        data = self.inspect(id_, version)
        if not data['source_match']:
            raise Conflict(data['conflict'])
        incoming = self.question_links(questions)
        combined = incoming if replace else self.question_links(edit.get('questions', [])) + incoming
        merged = []
        for question in combined:
            if question not in merged:
                merged.append(question)
        edit['questions'] = merged
        return {}, {'id': id_, 'version': version, 'mode': 'replace' if replace else 'append', 'questions': merged}

    def manual_rebase(self, id_, version, spec):
        self.assert_ready()
        if not isinstance(spec, dict):
            raise Conflict('人工更新需要准确的块、选区和候选方案。')
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING or edit['versions'][-1] != version:
            raise Conflict('审核项已变化；请重新打开。')
        old = self.payload(edit)
        original_options = old.get('options', [{'label': 'A', 'after': old['after'], 'reason': '已有单方案'}])
        values = spec.get('options')
        if not isinstance(values, list) or len(values) != len(original_options) or any(
                not isinstance(value, dict) or value.get('label') != old_option['label'] or not isinstance(value.get('after'), str)
                for value, old_option in zip(values, original_options)):
            raise Conflict('必须提交当前全部候选方案。')
        options = copy.deepcopy(original_options)
        for option, value in zip(options, values):
            if option['after'].replace('\r\n', '\n') != value['after'].replace('\r\n', '\n'):
                option['after'] = value['after']
                option['manually_edited'] = True
        revised = {'options': options, 'fewer_options_reason': old.get('fewer_options_reason') or '人工更新已有候选'}
        if 'intent' in old:
            revised['intent'] = old['intent']
        return self.propose(revised, id_, manual_anchor=spec)

    def propose(self, spec, rework=None, manual_anchor=None):
        self.assert_ready()
        discard_annotations = spec.get('discard_annotations', False)
        if type(discard_annotations) is not bool or (discard_annotations and not rework):
            raise Conflict('discard_annotations is a boolean option for rework only')
        if discard_annotations and spec.get('resolve_requests'):
            raise Conflict('Choose annotation discard or individual request resolution, not both')
        questions = self.question_links(spec['questions']) if 'questions' in spec else None
        edits = self.state["edits"]
        if rework:
            if rework not in edits or edits[rework]["status"] not in PENDING:
                raise Conflict("Only unresolved IDs can be reworked; accepted text needs a new ID")
            edit = edits[rework]
            old = self.payload(edit)
            rel = edit["file"]
            before, left, right = self.live_excerpt(edit, old), old["left"], old["right"]
            original = old["before"]
            deferred = edit.get("deferred", False)
        else:
            rel = spec["file"]
            if rel not in self.state["rounds"][-1]["files"]:
                raise Conflict("File is outside the registered round")
            if spec.get("kind") not in ("manuscript", "response"):
                raise Conflict("kind must be manuscript or response")
            before, left, right = spec["before"], spec.get("left", ""), spec.get("right", "")
            original = before
            deferred = spec.get("deferred", self.storage == "files")
            if type(deferred) is not bool:
                raise Conflict("deferred must be a boolean")
            if self.storage == 'files' and not deferred:
                raise Conflict("新候选必须 deferred=true；接收后才替换正文。旧记录仍可读取。")
        text = self.read(rel)
        if manual_anchor is not None:
            if not self.sidecar or not rework or not deferred or manual_anchor.get('block_id') != edit.get('block_id'):
                raise Conflict('人工更新需要当前待审项的固定块。')
            if manual_anchor.get('source_revision') != self.source_digest(text):
                raise Conflict('正文已变化；请重新选择范围。')
            row = self.block_row(text, rel, edit['block_id'])
            start, end = manual_anchor.get('start'), manual_anchor.get('end')
            current = text[row['start']:row['end']]
            normalized = current.replace('\r\n', '\n')
            if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(normalized) or normalized[start:end] != manual_anchor.get('quote'):
                raise Conflict('选区与当前审核块不一致；请重新选择。')
            offsets = [0]
            pos = 0
            while pos < len(current):
                pos += 2 if current[pos:pos + 2] == '\r\n' else 1
                offsets.append(pos)
            a, b = row['start'] + offsets[start], row['start'] + offsets[end]
            before = original = text[a:b]
            if '% TS-BLOCK-' in before:
                raise Conflict('选区不能跨越固定审核块标记。')
            left, right = text[max(0, a - 120):a], text[b:b + 120]
        elif rework and any(k in spec for k in ('before', 'left', 'right')):
            if spec.get('before', before) != before:
                raise Conflict('Rework relocation cannot change original text')
            left, right = spec.get('left', left), spec.get('right', right)
            a, b = self.locate_edit(text, edit, old) if self.sidecar else locate(text, before, left, right)
        elif rework:
            a, b = self.locate_edit(text, edit, old)
            anchor = self.anchor_context(edit, old)
            left, right = anchor['left'], anchor['right']
        elif self.sidecar:
            block_id = spec.get('block_id')
            block = self.state.get('blocks', {}).get(block_id)
            if not block or block['file'] != rel:
                raise Conflict('必须指定该文件已登记的固定审核块。')
            row = self.block_row(text, rel, block_id)
            if row['kind'] != block['kind']:
                raise Conflict('审核块类型已变化：' + block_id)
            a, b = locate(text[row['start']:row['end']], before, left, right)
            a, b = a + row['start'], b + row['start']
        else:
            a, b = locate(text, before, left, right)
        from document_roles import block_span, BEGIN as ROLE_BEGIN, END as ROLE_END
        protected = block_span(text)
        if protected and (a < protected[1] and b > protected[0] or a == b and protected[0] <= a < protected[1]):
            raise Conflict('文件角色登记是项目配置，不是正文候选；请通过文件角色确认入口更新。')
        options = self.validate_options(spec)
        after = options[0]['after'] if options else spec["after"]
        if self.sidecar and '\r\n' in text:
            def source_eol(value):
                return value.replace('\r\n', '\n').replace('\n', '\r\n')
            after = source_eol(after)
            if options:
                for option in options:
                    option['after'] = source_eol(option['after'])
                if len({option['after'] for option in options}) != len(options):
                    raise FieldConflict('spec.options', 'Options become identical with the source line endings')
        if any('% TS-BLOCK-' in value for value in [before, original, after, *[o['after'] for o in options or []]]):
            raise Conflict('候选范围和内容不能包含固定审核块标记。')
        if any(marker in value for value in [before, after, *[o['after'] for o in options or []]] for marker in (ROLE_BEGIN, ROLE_END)):
            raise Conflict('不能把文件角色登记混入正文候选。')
        if (not options and (before == after or (rework and old["after"] == after))) or (options and all(o['after'] == original for o in options)):
            raise Conflict("No content change")
        if rework and options and options == old.get('options') and manual_anchor is None:
            raise Conflict('No content change')
        if self.storage == 'files' and (not rework or edit.get('scope_policy') == 'single-unit'):
            validate_review_unit(original)
            if options:
                for i, option in enumerate(options):
                    try:
                        validate_review_unit(option['after'])
                    except Conflict as error:
                        raise FieldConflict(f'spec.options[{i}].after', str(error)) from error
            else:
                validate_review_unit(after)
        # Refuse overlap with another unresolved edit, including insertion boundaries.
        for id_, other in edits.items():
            if id_ == rework or other["file"] != rel or other["status"] not in PENDING:
                continue
            obj = self.payload(other)
            try:
                x, y = self.locate_edit(text, other, obj)
            except Conflict:
                if self.sidecar:
                    target_block = edit.get('block_id') if rework else spec.get('block_id')
                    if other.get('block_id') != target_block:
                        try:
                            other_row = self.block_row(text, rel, other.get('block_id'))
                            target_row = self.block_row(text, rel, target_block)
                            if other_row['end'] <= target_row['start'] or target_row['end'] <= other_row['start']:
                                continue
                        except Conflict:
                            pass
                    raise Conflict('相关审核块存在失配候选或位置不明；请先核对该候选。')
                # Consider all exact possible spans of the broken item. It cannot
                # block a disjoint new target merely because it shares the file.
                needle = self.live_excerpt(other, obj)
                possible = []
                if needle:
                    at = text.find(needle)
                    while at >= 0:
                        possible.append((at, at + len(needle)))
                        at = text.find(needle, at + 1)
                else:
                    context = self.anchor_context(other, obj)
                    for side in ('left', 'right'):
                        value = context[side]
                        if not value:
                            continue
                        at = text.find(value)
                        while at >= 0:
                            point = at + len(value) if side == 'left' else at
                            possible.append((point, point))
                            at = text.find(value, at + 1)
                    if not context['left'] and not context['right']:
                        possible.append((a, b))
                if not any(max(a, x) < min(b, y) or a == b and x <= a <= y or x == y and a <= x <= b
                           for x, y in possible):
                    continue
                raise OverlapConflict(id_, other['versions'][-1], rel)
            if max(a, x) < min(b, y) or (a == b and x < a < y) or (x == y and a < x < b):
                raise OverlapConflict(id_, other['versions'][-1], rel)
        deps = spec.get("deps", edit.get("deps", []) if rework else [])
        if any(d not in edits or d == rework for d in deps):
            raise Conflict("Dependencies must refer to other existing IDs")
        # A revision of an existing item may not introduce a dependency cycle.
        def reaches(id_, target, seen):
            if id_ == target:
                return True
            if id_ in seen:
                return False
            seen.add(id_)
            return any(reaches(d, target, seen) for d in edits[id_].get("deps", []))
        if rework and any(reaches(d, rework, set()) for d in deps):
            raise Conflict("Dependency cycle")
        id_ = rework
        if not id_:
            which = 0 if spec["kind"] == "manuscript" else 1
            id_ = str(self.state["next"][0]) if which == 0 else letters(self.state["next"][1])
            if id_ in edits:
                raise Conflict("ID counter collides with issued history")
            self.state["next"][which] += 1
            edit = {"file": rel, "kind": spec["kind"], "status": "pending", "versions": [], "deps": []}
            if self.sidecar:
                edit['block_id'] = block_id
            if self.storage == 'files':
                edit['scope_policy'] = 'single-unit'
            if deferred:
                edit["deferred"] = True
            edits[id_] = edit
        item = {"before": original, "after": after, "left": text[max(0, a - max(120,len(left))):a], "right": text[b:b + max(120,len(right))]}
        if options:
            item['options'] = options
            item['fewer_options_reason'] = spec.get('fewer_options_reason', '')
        if 'intent' in spec:
            item['intent'] = copy.deepcopy(spec['intent'])
        if 'fulfillment' in spec:
            if not rework or not isinstance(spec['fulfillment'], list):
                raise FieldConflict('spec.fulfillment', 'Fulfillment applies to existing review requests only')
            requests = {r['id']: r for r in edit.get('requests', []) if r['status'] == 'open'}
            choices = {o['label']: o['after'] for o in options or []}
            mappings = []
            for mapping in spec['fulfillment']:
                if not isinstance(mapping, dict) or set(mapping) != {'request','request_version','request_text','option','start','end','quote','explanation','status'}:
                    raise FieldConflict('spec.fulfillment', 'Each mapping needs the exact request, option, range and explanation')
                if any(not isinstance(mapping[k], str) for k in ('request','request_version','request_text','option','quote','explanation','status')):
                    raise FieldConflict('spec.fulfillment', 'Mapping identity and explanation must be text')
                request = requests.get(mapping['request'])
                candidate = choices.get(mapping['option'])
                a_, b_ = mapping['start'], mapping['end']
                if not request or request['version'] != mapping['request_version'] or request['text'] != mapping['request_text']:
                    raise FieldConflict('spec.fulfillment', 'Request identity or text has changed')
                if candidate is None or type(a_) is not int or type(b_) is not int or not 0 <= a_ < b_ <= len(candidate) or candidate[a_:b_] != mapping['quote']:
                    raise FieldConflict('spec.fulfillment', 'Range must match the complete selected option')
                if mapping['status'] not in ('attempted','partial','author','evidence') or not isinstance(mapping['explanation'], str) or not mapping['explanation'].strip():
                    raise FieldConflict('spec.fulfillment', 'Mapping needs a valid status and explanation')
                mappings.append(copy.deepcopy(mapping))
            item['fulfillment'] = mappings
        if self.storage == 'files':
            item['batch'] = self.state['session']
        if manual_anchor is not None:
            item['manual_revision'] = uuid.uuid4().hex
        commit = self.snapshot({"original.tex": original.encode("utf-8"), "candidate.tex": after.encode("utf-8"),
                                "span.json": json.dumps(item, ensure_ascii=False).encode("utf-8")}, "review item " + id_)
        if rework:
            notes = [r for r in edit.get('requests', []) if r['status'] in ('open', 'addressed-pending-review')]
            if notes:
                # One read-only comparison round, separate from actionable notes.
                # No new notes means the last requirements remain useful to compare.
                edit['previous_feedback'] = {'version': edit['versions'][-1], 'requests': copy.deepcopy(notes)}
        edit["versions"].append(commit)
        if deferred:
            self.bind(edit, text, a, b, len(item['left']), len(item['right']))
        edit.update({"deps": deps, "location": spec.get("location", edit.get("location", ""))})
        if 'location_zh' in spec:
            if not isinstance(spec['location_zh'], str):
                raise Conflict('location_zh must be a string')
            edit['location_zh'] = spec['location_zh']
        elif 'location' in spec:
            edit.pop('location_zh', None)
        if questions is not None:
            edit['questions'] = questions
        if rework:
            edit["status"] = "rework"
            if manual_anchor is not None and original != old['before']:
                self.mark_original_stale(edit, original, edit['versions'][-2], old['before'])
            if discard_annotations:
                edit.pop('requests', None)
            resolved = spec.get("resolve_requests", [])
            available = {r["id"] for r in edit.get("requests", []) if r["status"] == "open"}
            if not set(resolved) <= available:
                raise Conflict("Unknown or already closed feedback request")
            for request in edit.get("requests", []):
                if request["id"] in resolved:
                    request["status"] = "addressed-pending-review"
                    request["addressed_version"] = commit
            self.stale({id_})
        if id_ not in self.state["rounds"][-1]["ids"]:
            self.state["rounds"][-1]["ids"].append(id_)
        return ({} if deferred else {rel: text[:a] + after + text[b:]}), {"id": id_, "status": edit["status"]}

    def stale(self, changed):
        seen = set(changed)
        while True:
            more = {k for k, e in self.state["edits"].items() if set(e.get("deps", [])) & seen} - seen
            if not more:
                break
            for k in more:
                self.state["edits"][k]["freshness"] = "needs-recheck"
            seen |= more

    def projection_span(self, text, item):
        """Use exact original text or the immutable candidate's two source boundaries."""
        try:
            return locate(text, item['before'], item['left'], item['right'])
        except Conflict:
            if not item['before'].strip():
                raise
        left, right = item['left'], item['right']
        a, b = text.find(left) if left else -1, text.find(right) if right else -1
        bounded = (a >= 0 and b >= a + len(left)
                   and text.find(left, a + 1) < 0 and text.find(right, b + 1) < 0)
        if bounded:
            if item.get('batch') != self.state['session']:
                raise Conflict('候选缺少当前批次的不可变来源关系；不推断投影范围。')
            return a + len(left), b
        # Retain exact-content projection when only the surrounding manual edits
        # differ. A changed original needs both boundaries; never align by similarity.
        return locate(text, item['before'])

    def decide(self, accept, reject, expected_versions=None, option=None):
        previous = self.state
        previous_cache = self._read_cache
        self._read_cache = {}
        self.state = copy.deepcopy(previous)
        try:
            return self._decide(accept, reject, expected_versions, option)
        except Exception:
            # Restore the in-memory ledger too; no partial decisions on failure.
            self.state = previous
            raise
        finally:
            self._read_cache = previous_cache

    def _decide(self, accept, reject, expected_versions=None, option=None):
        self.assert_ready()
        ids = accept + reject
        if not ids or len(set(ids)) != len(ids):
            raise Conflict("Specify distinct exact IDs")
        if self.sidecar and (expected_versions is None or any(not expected_versions.get(id_) for id_ in ids)):
            raise Conflict('固定块审核必须提供每项准确版本。')
        updated, accepted, decisions, operations, conflicts = {}, {}, {}, {}, []
        sources, spans = {}, {}
        inline_files = {e['file'] for e in self.state['edits'].values()
                        if e['status'] in PENDING and not e.get('deferred', False)}
        # All decisions are checked against the same source/state version.
        for id_ in ids:
            try:
                edit = copy.deepcopy(self.state['edits'].get(id_))
                if not edit or edit['status'] not in PENDING:
                    raise Conflict('ID is missing or already decided')
                if expected_versions is not None and expected_versions.get(id_) != edit['versions'][-1]:
                    raise Conflict('Displayed candidate is stale; reopen the latest version before deciding')
                rel = edit['file']
                if rel not in sources:
                    sources[rel] = self.read(rel)
                text, item = sources[rel], self.payload(edit)
                if id_ in accept or not edit.get('deferred', False):
                    try:
                        a, b = self.locate_edit(text, edit, item)
                    except Conflict as error:
                        raise Conflict(f'当前正文失配：审核项 {id_}，文件 {rel}；{error}') from error
                    label = option.get(id_) if isinstance(option, dict) else option
                    if id_ in accept:
                        if item.get('options') and label is None:
                            raise Conflict('Choose an explicit option A/B/C before accepting')
                        if label is not None:
                            item['after'] = self.option(item, label)['after']
                            edit['accepted_option'] = label
                    replacement = item['after'] if id_ in accept else item['before']
                    if id_ in accept and ('% TS-BLOCK-' in replacement or '% TS-BLOCK-' in text[a:b]):
                        raise Conflict('候选包含固定审核块标记；未接收。')
                    if edit.get('deferred', False) or id_ in reject:
                        operations.setdefault(rel, []).append((a, b, replacement, id_))
                    spans[id_] = (a, b)
                edit['status'] = 'accepted' if id_ in accept else 'rejected'
                for request in edit.get('requests', []):
                    if request['status'] in ('open', 'addressed-pending-review'):
                        request['status'] = 'closed-by-author-acceptance' if id_ in accept else 'closed-by-author-rejection'
                decisions[id_] = edit
            except Conflict as error:
                conflicts.append({'id': id_, 'error': str(error)})
        for rel, ops in operations.items():
            for i, (a, b, _, id_) in enumerate(ops):
                for x, y, _, other in ops[i+1:]:
                    if max(a, x) < min(b, y) or a == b and x < a < y or x == y and a < x < b:
                        conflicts.append({'id': id_, 'other': other, 'error': 'Overlapping selected edits'})
        if conflicts:
            raise Conflict('Batch preflight failed; no decisions saved: ' + json.dumps(conflicts, ensure_ascii=False))
        # Locate remaining items before applying any edits, then transform exact
        # offsets through the verified patch. Same-point insertions follow request order.
        remaining = {}
        for id_, edit in self.state['edits'].items():
            rel = edit['file']
            if id_ in decisions or edit['status'] not in PENDING or rel not in operations:
                continue
            try:
                remaining[id_] = self.locate_edit(sources[rel], edit)
            except Conflict:
                pass
        for rel, ops in operations.items():
            text = sources[rel]
            # Reverse the complete stable order, including ties, so the first
            # explicitly listed insertion remains first in the resulting source.
            for a, b, replacement, _ in reversed(sorted(ops, key=lambda op: (op[0], op[1]))):
                text = text[:a] + replacement + text[b:]
            updated[rel] = text
            shift = 0
            for a, b, replacement, id_ in sorted(ops, key=lambda op: (op[0], op[1])):
                if id_ in accept:
                    context = self.anchor_context(decisions[id_], self.payload(decisions[id_]))
                    self.bind(decisions[id_], text, a + shift, a + shift + len(replacement),
                              max(120, len(context['left'])), max(120, len(context['right'])))
                shift += len(replacement) - (b-a)
        for id_ in accept:
            edit, item = decisions[id_], self.payload(decisions[id_])
            rel = edit['file']
            if self.storage == 'files' and rel not in inline_files:
                accepted[rel] = updated.get(rel, sources[rel])
            else:
                base = accepted.get(rel, self.contents(self.state['accepted'], rel))
                try:
                    x, y = self.projection_span(base, item)
                except Conflict as error:
                    raise Conflict(f'已接收投影失配：审核项 {id_}，文件 {rel}；{error}') from error
                accepted[rel] = base[:x] + item['after'] + base[y:]
        for id_, (a, b) in remaining.items():
            edit = self.state['edits'][id_]
            ops = operations[edit['file']]
            if any(max(a, x) < min(b, y) or a == b and x < a < y or x == y and a < x < b for x, y, _, _ in ops):
                edit['anchor'] = {'version': edit['versions'][-1], 'conflict': 'Source changed across this pending location; relocate explicitly'}
                continue
            start_shift = sum(len(value)-(y-x) for x,y,value,_ in ops if y <= a)
            end_shift = sum(len(value)-(y-x) for x,y,value,_ in ops if y <= b and (x < b or a == b))
            old = self.anchor_context(edit, self.payload(edit))
            self.bind(edit, updated[edit['file']], a+start_shift, b+end_shift,
                      max(120,len(old.get('left',''))), max(120,len(old.get('right',''))))
        if accept and self.storage == 'files':
            projection = self.state.get('auto_backup_projection', self.state['accepted'])
            self.state.setdefault('auto_backup_base', projection)
            projected, projection_ops = {}, {}
            try:
                if self.state.get('auto_backup_projection_error'):
                    raise Conflict(self.state['auto_backup_projection_error'])
                for id_ in accept:
                    edit, item = decisions[id_], self.payload(decisions[id_])
                    rel = edit['file']
                    base = self.contents(projection, rel)
                    # Fixed-block records must never be projected by finding matching
                    # prose in another block of an older snapshot.
                    a, b = self.locate_edit(base, self.state['edits'][id_], item)
                    projection_ops.setdefault(rel, []).append((a, b, item['after']))
                for rel, ops in projection_ops.items():
                    base = self.contents(projection, rel)
                    for a, b, value in reversed(sorted(ops, key=lambda op: (op[0], op[1]))):
                        base = base[:a] + value + base[b:]
                    projected[rel] = base
                all_files = {p: (projected[p] if p in projected else self.contents(projection, p)).encode('utf-8')
                             for p in self.state['rounds'][-1]['files']}
                self.state['auto_backup_projection'] = self.snapshot(all_files, 'automatic accepted projection')
                self.state['auto_backup_requested'] = self.state['auto_backup_projection']
                self.state.setdefault('auto_backup_items', {}).update({i: decisions[i]['versions'][-1] for i in accept})
                self.state.pop('auto_backup_projection_error', None)
            except Conflict as error:
                self.state['auto_backup_projection_error'] = str(error)
        if accepted:
            files = {p: (accepted[p] if p in accepted else self.contents(self.state['accepted'], p)).encode('utf-8')
                     for p in self.state['rounds'][-1]['files']}
            self.state['accepted'] = self.snapshot(files, 'explicit author acceptance ' + ','.join(accept))
        self.state['edits'].update(decisions)
        if reject:
            self.stale(set(reject))
        return updated, {'accepted': accept, 'rejected': reject,
                         'accepted_source': self.state['accepted'] if accept else None}

    def inspect(self, id_, version=None, source=False, reuse_diff=False):
        self.assert_ready()
        edit = self.state["edits"][id_]
        if not edit['versions'] and edit.get('checkpoint'):
            return {'id': id_, 'edit': copy.deepcopy(edit), 'sha256': digest(self.raw),
                    'archived': True, 'checkpoint': edit['checkpoint'],
                    'message': '已完结候选已精简；此处仅保留依赖身份，成功成果请查看 Git 提交。'}
        version = version or edit["versions"][-1]
        if version not in edit["versions"]:
            raise Conflict("Version does not belong to the selected review item")
        result = {"id": id_, "edit": copy.deepcopy(edit), "version": version, "sha256": digest(self.raw),
                  "original": self.contents(version, "original.tex"), "candidate": self.contents(version, "candidate.tex")}
        shown = json.loads(self.contents(version, 'span.json'))
        started = time.perf_counter()
        options = shown.get('options', [{'label': 'A', 'after': result['candidate'], 'reason': '已有单方案；可由 AI 重新生成三方案'}])
        result['options'] = [dict(o) if reuse_diff else {**o, 'changes': word_changes(result['original'], o['after'])} for o in options]
        result['fewer_options_reason'] = shown.get('fewer_options_reason', '')
        result['intent'] = shown.get('intent')
        result['fulfillment'] = shown.get('fulfillment', [])
        if reuse_diff:
            result['diff_reused'] = True
        else:
            for option in result['options']:
                option['scope'] = change_scope(result['original'], option['after'], option['changes'])
        self.timings['diff_scope_s'] += time.perf_counter() - started
        if edit.get('accepted_option'):
            result['candidate'] = self.option(shown, edit['accepted_option'])['after']
        obj = self.payload(edit)
        if self.sidecar:
            text = self.read(edit['file'])
            try:
                block_id = edit.get('block_id')
                if not block_id:
                    raise Conflict('审核项没有已登记的固定块；请明确修复，不会猜测位置。')
                row = self.block_row(text, edit['file'], block_id)
                result['block'] = {**row, 'text': text[row['start']:row['end']], 'source_revision': self.source_digest(text)}
            except Conflict as error:
                result['block_conflict'] = str(error)
        try:
            self.locate_edit(self.read(edit["file"]), edit, obj)
            result["source_match"] = True
        except Conflict as exc:
            result.update({"source_match": False, "conflict": str(exc)})
        if source and result["source_match"]:
            raw = self._raw_sources[edit['file']]
            start, end = self.locate_edit(raw if self.sidecar else body(raw), edit, obj)
            if not self.sidecar and BEGIN in raw:
                prefix, block, _ = split_state(raw)
                if start >= len(prefix):
                    start, end = start + len(block), end + len(block)
            result["source"] = {"text": raw, "start": start, "end": end,
                                "side": "original" if edit.get("deferred", False) else "candidate"}
            if not reuse_diff:
                result["changes"] = word_changes(result["original"], result["candidate"])
        return result

    def feedback(self, spec):
        """An author's anchored annotation/request; no prose rewrite or AI invocation."""
        self.assert_ready()
        id_ = spec["id"]
        edit = self.state["edits"][id_]
        if edit["status"] not in PENDING:
            raise Conflict("Feedback requires an unresolved review item")
        if spec["version"] != edit["versions"][-1]:
            raise Conflict("Annotation targets an old candidate; reopen and select again")
        side = spec["side"]
        if side not in ("original", "candidate"):
            raise Conflict("Annotation side must be original or candidate")
        option = spec.get('option')
        payload = self.payload(edit)
        if side == 'candidate' and payload.get('options') and option is None:
            raise Conflict('Candidate annotations must name their exact option')
        selected = self.option(payload, option)['after'] if side == 'candidate' and option else self.contents(spec["version"], side + ".tex")
        start, end = spec["start"], spec["end"]
        if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(selected):
            raise Conflict("Invalid Unicode code-point selection offsets")
        if selected[start:end] != spec["quote"]:
            raise Conflict("Selection does not match the immutable excerpt")
        context = spec.get('display_context')
        if context is not None:
            if not isinstance(context, dict) or context.get('kind') not in ('question', 'translation'):
                raise Conflict('Invalid annotation display context')
            source_side = context.get('source_side')
            if source_side == 'question':
                question = context.get('question')
                if question not in edit.get('questions', []):
                    raise Conflict('Annotation reviewer question is no longer linked')
                self.question_links([question])
                source = question['quote']
            elif source_side in ('original', 'candidate') and source_side == side:
                source = selected
            else:
                raise Conflict('Invalid annotation source context')
            if context.get('source') != source:
                raise Conflict('Annotation context source changed')
            display = context.get('text')
            a, b = context.get('start'), context.get('end')
            if not isinstance(display, str) or type(a) is not int or type(b) is not int or not 0 <= a < b <= len(display):
                raise Conflict('Invalid display selection offsets')
            if display[a:b] != context.get('quote'):
                raise Conflict('Display selection does not match its snapshot')
            if context['kind'] == 'question' and (source_side != 'question' or display != source):
                raise Conflict('Question annotation must select the exact reviewer excerpt')
            if context['kind'] == 'translation' and (not isinstance(context.get('provider'), str) or not context['provider'].strip()):
                raise Conflict('Translation annotation requires its provider')
        text = spec["text"]
        if not isinstance(text, str) or not text.strip():
            raise Conflict("A nonempty revision request is required")
        # Validate live source too: notes must not silently target a manually changed proposal.
        obj = self.payload(edit)
        self.locate_edit(self.read(edit["file"]), edit, obj)
        if spec.get('request_id'):
            matches = [r for r in edit.get('requests', []) if r['id'] == spec['request_id']]
            if len(matches) != 1:
                raise Conflict('Feedback request no longer exists')
            request = matches[0]
            if request['status'] != 'open' or request['version'] != spec['version']:
                raise Conflict('Only open feedback on the current candidate can be edited')
            if request['text'] != spec.get('previous_text'):
                raise Conflict('Feedback changed concurrently; reread before editing')
            if any(request.get(key) != spec.get(key) for key in ('side', 'start', 'end', 'quote', 'option', 'display_context')):
                raise Conflict('Editing feedback must preserve its exact selection')
            request['text'] = text.strip()
            return {}, {'id': id_, 'request': request, 'rewritten': False}
        request = {"id": uuid.uuid4().hex[:12], "text": text.strip(), "status": "open", "side": side,
                   "version": spec["version"], "start": start, "end": end, "quote": spec["quote"]}
        if option:
            self.option(payload, option)
            request['option'] = option
        if context is not None:
            request['display_context'] = context
        edit.setdefault("requests", []).append(request)
        edit["status"] = "rework"
        return {}, {"id": id_, "request": request, "rewritten": False}

    def embedded(self, content=None):
        a, block, b = split_state(self.text)
        lines = [l for l in block.splitlines() if not l.startswith(DATA) and "CODEX-REVIEW-NEXT " not in l]
        at = lines.index(END)
        mechanical = {k: v for k, v in self.state.items() if k != "next"}
        lines[at:at] = [f"% CODEX-REVIEW-NEXT manuscript={self.state['next'][0]} response={letters(self.state['next'][1])}",
                        DATA + json.dumps(mechanical, ensure_ascii=False, separators=(",", ":"))]
        block = self.eol.join(lines) + self.eol
        if content is None:
            return a + block + b
        # The state block's original insertion point is before the document body.
        if not content.startswith(a):
            raise Conflict("A source edit crosses the state header insertion point")
        return content[:len(a)] + block + content[len(a):]

    def persist(self, updated, expect):
        if expect != digest(self.raw):
            raise Conflict("Stale/missing --expect state-file SHA256")
        if self.sidecar:
            return self.persist_sidecar(updated)
        targets = {}
        for rel, text in updated.items():
            if rel == self.state_rel:
                continue
            raw = self.original[rel]
            targets[rel] = (b"\xef\xbb\xbf" if raw.startswith(b"\xef\xbb\xbf") else b"") + text.encode("utf-8")
        if self.state_path.read_bytes() != self.raw or any(self.path(p).read_bytes() != raw for p, raw in self.original.items()):
            raise Conflict("Concurrent source/state modification; no source writes")
        if any(self.question_source(p) != raw for p, raw in self.question_original.items()):
            raise Conflict('Concurrent reviewer-question source modification; no source writes')
        from review_host_client import HostError, HostSession
        try:
            with HostSession(self.repo) as host:
                intent_raw = None
                if updated:
                    intent_files = {}
                    for i, (rel, raw) in enumerate(targets.items()):
                        intent_files[f"{i}-old"] = self.original[rel]
                        intent_files[f"{i}-new"] = raw
                    if updated.get(self.state_rel) is not None:
                        intent_files["owner-old"] = body(self.text).encode("utf-8")
                        intent_files["owner-new"] = updated[self.state_rel].encode("utf-8")
                    intent = self.snapshot(intent_files or {"empty": b""}, "review transaction recovery")
                    self.state["transaction"] = {"commit": intent, "files": list(targets), "owner": self.state_rel in updated}
                    intent_raw = self.encode(self.embedded())
                    self.state.pop('transaction')
                final_raw = self.encode(self.embedded(updated.get(self.state_rel)))
                owner_and_targets = {os.path.normcase(str(self.state_path))} | {os.path.normcase(str(self.path(rel))) for rel in targets}
                checks = {}
                for rel, raw in list(self.original.items()) + list(self.question_original.items()):
                    identity = os.path.normcase(str(self.repo / rel))
                    if identity not in owner_and_targets:
                        if identity in checks and checks[identity][1] != raw:
                            raise Conflict('Concurrent reviewer-question source modification')
                        checks[identity] = (rel, raw)
                encode = lambda raw: base64.b64encode(raw).decode('ascii')
                plan = {'kind': 'legacy-review', 'owner': self.state_rel, 'owner_before': encode(self.raw),
                        'owner_intent': encode(intent_raw) if intent_raw is not None else None, 'owner_after': encode(final_raw),
                        'files': [{'file': rel, 'before': encode(self.original[rel]), 'after': encode(raw)} for rel, raw in targets.items()],
                        'checks': [{'file': rel, 'before': encode(raw)} for rel, raw in checks.values()]}
                plan_id = self.snapshot_files({'host-plan': json.dumps(plan, ensure_ascii=False, separators=(',', ':')).encode('utf-8')})
                if self.state_path.read_bytes() != self.raw or any(self.path(p).read_bytes() != raw for p, raw in self.original.items()):
                    raise Conflict('Concurrent source/state modification; no source writes')
                if any(self.question_source(p) != raw for p, raw in self.question_original.items()):
                    raise Conflict('Concurrent reviewer-question source modification; no source writes')
                host.check()
                host.apply_legacy(plan_id)
        except (HostError, OSError) as error:
            raise Conflict(f'旧审核宿主事务失败；请核对是否存在待恢复意图：{error}') from error

    def state_bytes(self):
        return json.dumps(self.state, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    def persist_sidecar(self, updated):
        targets = {}
        for rel, text in updated.items():
            raw = self.original[rel]
            targets[rel] = (b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8')
        if (self.state_path.exists() if self.new_sidecar else self.state_path.read_bytes() != self.raw) or any(self.path(p).read_bytes() != raw for p, raw in self.original.items()):
            raise Conflict('Concurrent source/state modification; no source writes')
        if any(self.question_source(p) != raw for p, raw in self.question_original.items()):
            raise Conflict('Concurrent reviewer-question source modification; no source writes')
        if not targets:
            self.write(self.state_path, self.state_bytes())
            return
        from review_host_client import HostError, HostSession
        try:
            with HostSession(self.repo) as host:
                intent_files = {}
                for i, (rel, raw) in enumerate(targets.items()):
                    intent_files[f'{i}-old'] = self.original[rel]
                    intent_files[f'{i}-new'] = raw
                target_paths = {os.path.normcase(str(self.path(rel))) for rel in targets}
                checks = {}
                for rel, raw in list(self.original.items()) + list(self.question_original.items()):
                    identity = os.path.normcase(str(self.repo / rel))
                    if identity not in target_paths:
                        if identity in checks and checks[identity][1] != raw:
                            raise Conflict('Concurrent reviewer-question source modification')
                        checks[identity] = (rel, raw)
                for i, (_, raw) in enumerate(checks.values()):
                    intent_files[f'check-{i}'] = raw
                intent = self.snapshot(intent_files, 'review transaction recovery')
                final_raw = self.state_bytes()
                self.state['transaction'] = {'commit': intent, 'files': list(targets),
                                             'checks': [rel for rel, _ in checks.values()], 'owner': False}
                intent_raw = self.state_bytes()
                if (self.state_path.exists() if self.new_sidecar else self.state_path.read_bytes() != self.raw) or any(self.path(p).read_bytes() != raw for p, raw in self.original.items()):
                    raise Conflict('Concurrent source/state modification; no source writes')
                if any(self.question_source(p) != raw for p, raw in self.question_original.items()):
                    raise Conflict('Concurrent reviewer-question source modification; no source writes')
                host.check()
                self.write(self.state_path, intent_raw)
                host.apply(digest(intent_raw), intent, final_raw)
                self.state.pop('transaction')
        except (HostError, OSError) as error:
            raise Conflict(f'审核宿主事务失败；请核对是否存在待恢复意图：{error}') from error

    def recover(self, expect):
        if not self.interrupted or expect != digest(self.raw):
            raise Conflict("No transaction or stale state SHA256")
        tr = self.state["transaction"]
        if tr.get('kind') == 'migration':
            raise Conflict('请先预览迁移恢复，并通过 recover-migration 显式确认。')
        if self.sidecar:
            from review_host_client import HostError, HostSession
            final = dict(self.state)
            final.pop('transaction')
            final_raw = json.dumps(final, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            try:
                with HostSession(self.repo) as host:
                    host.apply(digest(self.raw), tr['commit'], final_raw, recover=True)
            except (HostError, OSError) as error:
                raise Conflict(f'审核宿主恢复失败；事务保留待核对：{error}') from error
            self.state = final
            return {'recovered': True}
        planned = []
        for i, rel in enumerate(tr["files"]):
            old = self.object_bytes(tr['commit'], f"{i}-old")
            new = self.object_bytes(tr['commit'], f"{i}-new")
            actual = self.path(rel).read_bytes()
            if actual not in (old, new):
                raise Conflict("Recovery found author/concurrent edits; preserve all files and reconcile manually")
            planned.append((self.path(rel), actual, new))
        content = None
        if tr["owner"]:
            old = self.contents(tr["commit"], "owner-old")
            content = self.contents(tr["commit"], "owner-new")
            if body(self.text) not in (old, content):
                raise Conflict("State-owner source changed during transaction")
        from review_host_client import HostError, HostSession
        self.state.pop('transaction')
        final_raw = self.encode(self.embedded(content))
        encode = lambda raw: base64.b64encode(raw).decode('ascii')
        plan = {'kind': 'legacy-recovery', 'owner': self.state_rel, 'owner_before': encode(self.raw),
                'owner_intent': None, 'owner_after': encode(final_raw),
                'files': [{'file': rel, 'before': encode(actual), 'after': encode(new)}
                          for rel, (_, actual, new) in zip(tr['files'], planned)], 'checks': []}
        try:
            with HostSession(self.repo) as host:
                plan_id = self.snapshot_files({'host-plan': json.dumps(plan, ensure_ascii=False, separators=(',', ':')).encode('utf-8')})
                if self.state_path.read_bytes() != self.raw or any(path.read_bytes() != actual for path, actual, _ in planned):
                    raise Conflict('Concurrent recovery edit; transaction retained')
                host.check()
                host.apply_legacy(plan_id)
        except (HostError, OSError) as error:
            raise Conflict(f'旧审核宿主恢复失败；事务保留待核对：{error}') from error
        return {"recovered": True}

    def encode(self, text):
        return (b"\xef\xbb\xbf" if self.bom else b"") + text.encode("utf-8")

    @staticmethod
    def write(path, raw):
        # Same-directory atomic replacement; retain any interrupted temporary artifact.
        temp = path.with_name(path.name + ".codex-write-" + uuid.uuid4().hex)
        with temp.open("xb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)

    def status(self):
        if not self.state:
            return {"initialized": False, "sha256": digest(self.raw), **self.backup_packet()}
        result = copy.deepcopy(self.state)
        result["sha256"] = digest(self.raw)
        if self.interrupted:
            result['interrupted'] = True
            result['transaction_state'] = 'incomplete; decisions are provisional until explicit recovery'
            return result
        result.update(self.backup_packet())
        for id_, edit in result["edits"].items():
            if edit["status"] in PENDING:
                try:
                    obj = self.payload(edit)
                    self.locate_edit(self.read(edit["file"]), edit, obj)
                    edit["source_match"] = True
                except Conflict as exc:
                    edit["source_match"] = False
                    edit["conflict"] = str(exc)
        return result

    def cards(self, reuse=None):
        """One read-only UI packet; shared source text occurs once per file."""
        self.assert_ready()
        self._read_cache = {}
        result = copy.deepcopy(self.state)
        result.update(sha256=digest(self.raw), cards={}, sources={}, **self.backup_packet())
        for id_, edit in result['edits'].items():
            if edit['status'] not in PENDING:
                continue
            reuse_diff = bool(reuse and reuse.get(id_) == edit['versions'][-1])
            data = self.inspect(id_, source=True, reuse_diff=True) if reuse_diff else self.inspect(id_, source=True)
            edit['source_match'] = data['source_match']
            if not data['source_match']:
                edit['conflict'] = data['conflict']
                data['source'] = {'start': 0, 'end': 0, 'side': 'original', 'text': self.original[edit['file']].decode('utf-8-sig')}
                if not data.get('diff_reused'):
                    data['changes'] = word_changes(data['original'], data['candidate'])
            text = data['source'].pop('text')
            file = edit['file']
            if file in result['sources'] and result['sources'][file] != text:
                raise Conflict('审核卡片读取期间原文发生变化，请重新打开；未修改正文或决定。')
            result['sources'][file] = text
            result['cards'][id_] = data
        if any(self.path(rel).read_bytes() != raw for rel, raw in self.original.items()):
            raise Conflict('审核卡片读取期间原文发生变化，请重新打开；未修改正文或决定。')
        self._read_cache = None
        return result

    def feedback_context(self, ids=None):
        """Read exact immutable old/new text for each open note generation."""
        self.assert_ready()
        if ids is not None:
            if not ids or len(set(ids)) != len(ids):
                raise Conflict('Select distinct review items for feedback')
            for id_ in ids:
                if id_ not in self.state['edits'] or self.state['edits'][id_]['status'] not in PENDING:
                    raise Conflict('Selected review item is no longer pending')
        selected = set(ids) if ids is not None else None
        groups = {}
        for id_, edit in self.state['edits'].items():
            if selected is not None and id_ not in selected:
                continue
            if edit['status'] not in PENDING:
                continue
            for note in edit.get('requests', []):
                if note['status'] != 'open':
                    continue
                version = note['version']
                if version not in edit['versions']:
                    raise Conflict('Feedback refers to a missing candidate generation; preserve it for reconciliation')
                option = note.get('option')
                key = (id_, version, option)
                if key not in groups:
                    groups[key] = {'id': id_, 'file': edit['file'], 'version': version,
                                   'current_version': edit['versions'][-1],
                                   'original': self.contents(version, 'original.tex'),
                                   'candidate': self.option(json.loads(self.contents(version, 'span.json')), option or 'A')['after'],
                                   'option': option, 'requests': []}
                    groups[key]['options'] = json.loads(self.contents(version, 'span.json')).get('options')
                groups[key]['requests'].append(copy.deepcopy(note))
        if self.state_path.read_bytes() != self.raw:
            raise Conflict('Concurrent review modification while reading feedback context')
        current_ids = {id_ for id_, edit in self.state['edits'].items() if (selected is None or id_ in selected) and edit['status'] in PENDING
                       and any(n['status'] == 'open' for n in edit.get('requests', []))
                       and all(n['version'] == edit['versions'][-1] for n in edit.get('requests', []) if n['status'] == 'open')}
        return {'items': list(groups.values()), 'sha256': digest(self.raw), 'session': self.state.get('session'),
                'current_versions': {id_: self.state['edits'][id_]['versions'][-1] for id_ in ids} if ids is not None else {},
                'known_feedback': [self.feedback_receipt(id_) for id_ in sorted(current_ids)]}

    def feedback_receipt(self, id_):
        """Reuse only the full prose/notes actually included in a current feedback attachment."""
        edit = self.state['edits'][id_]
        payload = self.payload(edit)
        content = {'session': self.state.get('session'), 'id': id_, 'version': edit['versions'][-1],
                   'original': payload['before'], 'options': payload.get('options'),
                   'requests': [n for n in edit.get('requests', []) if n['status'] == 'open']}
        return {'id': id_, 'version': edit['versions'][-1],
                'fingerprint': digest(json.dumps(content, ensure_ascii=False, sort_keys=True).encode('utf-8'))}

    def view(self, id_, code=None):
        self.assert_ready()
        if code:
            raise Conflict('旧独立差异窗口已停用，请使用原文件中的审核卡片与逐项接收按钮。')
        edit = self.state["edits"][id_]
        if not edit['versions'] and edit.get('checkpoint'):
            return self.inspect(id_)
        obj = self.payload(edit)
        folder = self.repo / ".codex-review" / "views" / self.state["session"] / (id_ + "-" + uuid.uuid4().hex)
        folder.mkdir(parents=True, exist_ok=False)
        # Only the selected edit's excerpts; never a second full manuscript or state table.
        old, new = folder / (id_ + "-original.tex"), folder / (id_ + f"-candidate-v{len(edit['versions'])}.tex")
        old.write_bytes(obj["before"].encode("utf-8"))
        new.write_bytes(obj["after"].encode("utf-8"))
        old.chmod(0o444)
        new.chmod(0o444)
        result = {"id": id_, "original": str(old), "candidate": str(new), "file": edit["file"],
                  "status": edit["status"], "generation": len(edit["versions"]), "source_match": self.status()["edits"][id_].get("source_match")}
        # Retired old-window launch; retain commented until the next confirmed cleanup.
        # if code:
        #     subprocess.run([code, "--reuse-window", "--diff", str(old), str(new)], check=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", "--repo", dest="repo", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--git", default="git")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("begin")
    p.add_argument("--round", required=True)
    p.add_argument("--files", nargs="+", required=True)
    p.add_argument("--submission")
    sub.add_parser('prepare-block', help='Preview or explicitly apply a fixed block around safe line boundaries; JSON on stdin')
    sub.add_parser('reassociate-block', help='Preview or explicitly repair/reassociate a fixed block; JSON on stdin')
    p = sub.add_parser('save-block-source', help='Explicit author save of current block text; JSON on stdin')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    p = sub.add_parser('sync-block', help='Preview or explicitly synchronize non-overlapping changes; JSON on stdin')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    sub.add_parser('sync-saved', help='Reconcile pending fixed-block items against saved files; JSON on stdin')
    p = sub.add_parser('manual-rebase', help='Explicitly bind existing options to the author-selected current block range')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    sub.add_parser('collaboration-contract', help='Read the current plugin-owned AI contract; no SKILL edits')
    sub.add_parser('propose-options', help='Ranked options A/B/C in one UTF-8 JSON spec')
    p = sub.add_parser('rework-options', help='Replace an unresolved group with ranked A/B/C options')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    p = sub.add_parser('edit-option', help='Save a manually edited option, preserving other alternatives')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    p.add_argument('--option', required=True, choices=list('ABC'))
    p = sub.add_parser('link-questions', help='Update only verified questions metadata; UTF-8 JSON {questions:[...]} on stdin')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    p.add_argument('--replace', action='store_true', help='Explicitly replace all existing associations; otherwise append/deduplicate')
    p = sub.add_parser("decide")
    p.add_argument("--accept", nargs="*", default=[])
    p.add_argument("--reject", nargs="*", default=[])
    p.add_argument("--version", help="Displayed immutable version, for a single-item GUI decision")
    p.add_argument('--option', choices=list('ABC'), help='Explicit candidate option to accept')
    p.add_argument('--return-cards', action='store_true', help='Return a fresh post-commit card packet; optional immutable versions in JSON stdin')
    p = sub.add_parser('decide-batch', help='UTF-8 JSON {items:[{id,version,option}]} in explicit insertion order')
    p.add_argument('--return-cards', action='store_true', help='Return a fresh post-commit card packet')
    p = sub.add_parser('relocate', help='Repair only the exact location; preserve candidate versions and annotations')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    sub.add_parser("status")
    p = sub.add_parser("cards", help="Read pending UI cards with shared live-source text; no PDF or writes")
    p.add_argument('--reuse-diffs', action='store_true', help='Read immutable item versions from JSON stdin and omit their unchanged diffs')
    p = sub.add_parser('feedback-context', help='Read open notes with their exact original/candidate generation; no writes')
    p.add_argument('--id', dest='ids', action='append')
    sub.add_parser("feedback", help="UTF-8 JSON anchored author annotation on stdin")
    p = sub.add_parser("inspect")
    p.add_argument("--id", required=True)
    p.add_argument("--version")
    p.add_argument("--source", action="store_true", help="Include live-file offsets and word-level changes for inline cards")
    sub.add_parser("recover")
    sub.add_parser('migrate-state', help='Preview or explicitly apply external state migration; approved preview JSON on stdin')
    sub.add_parser('recover-migration', help='Preview or explicitly resume interrupted migration; approved preview JSON on stdin')
    p = sub.add_parser("migrate", help="Convert legacy Git review objects into independent local snapshots")
    p.add_argument("--defer-pending", action="store_true", help="Restore pending originals, retaining candidate versions and IDs")
    p = sub.add_parser("show")
    p.add_argument("--id", required=True)
    p.add_argument("--code", help="Retired window-launch option; use original-file review cards")
    args = parser.parse_args()
    if args.command in ('migrate-state', 'recover-migration'):
        from review_migration import preview as migration_preview, apply as migration_apply, recovery_preview, recover as migration_recover
        root = Path(args.repo).resolve(strict=True)
        approved = json.load(sys.stdin) if args.apply else None
        with writer_lock_at(root / '.codex-review') if args.apply else nullcontext():
            if args.command == 'migrate-state':
                review = Review(root, args.state, args.git)
                result = migration_apply(review, approved) if args.apply else migration_preview(review)
            else:
                owner = None if args.state.replace('\\', '/') == '.codex-review/state.json' else args.state
                result = migration_recover(root, approved) if args.apply else recovery_preview(root, owner)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    initialize = args.command == 'begin' and args.state.replace('\\', '/') == '.codex-review/state.json'
    r = Review(args.repo, args.state, args.git, initialize=initialize)
    with r.writer_lock() if args.apply else nullcontext():
        if args.apply:
            r = Review(args.repo, args.state, args.git, initialize=initialize)
        started = time.perf_counter()
        result = dispatch(r, args)
        if args.command != 'status':
            result['timings'] = {**r.timings, **result.get('timings', {}), 'operation_s': time.perf_counter() - started}
    print(json.dumps(result, ensure_ascii=False, indent=2))


def dispatch(r, args):
    if args.command == 'collaboration-contract':
        result = {'protocol': 'ranked-options-v1', 'guide': str(Path(__file__).with_name('collaboration-guide.md')),
                  'rules': Path(__file__).with_name('collaboration-guide.md').read_text(encoding='utf-8')}
    elif args.command == "status":
        result = r.status()
    elif args.command == "cards":
        result = r.cards(json.loads(sys.stdin.read()) if args.reuse_diffs else None)
    elif args.command == 'feedback-context':
        result = r.feedback_context(args.ids)
    elif args.command == "inspect":
        result = r.inspect(args.id, args.version, args.source)
    elif args.command == "show":
        result = r.view(args.id, args.code)
    elif args.command == "recover":
        result = r.recover(args.expect) if args.apply else {"preview": r.state.get("transaction")}
    else:
        # Preview validates using the same object-building code, but writes no Git/source files.
        if args.apply and args.expect != digest(r.raw):
            raise Conflict("Stale/missing --expect state-file SHA256")
        if not args.apply:
            r.snapshot = lambda files, label: "0" * 40
        if args.command == "begin":
            updated, result = r.begin(args.round, args.files, args.submission)
        elif args.command == 'prepare-block':
            spec = json.loads(sys.stdin.read())
            if args.apply and not spec.get('block_id'):
                raise Conflict('Apply requires the block ID from the preview')
            updated, result = r.prepare_block(spec)
        elif args.command == 'reassociate-block':
            updated, result = r.reassociate_block(json.loads(sys.stdin.read()))
        elif args.command == 'save-block-source':
            updated, result = r.save_block_source(args.id, args.version, json.loads(sys.stdin.read()))
        elif args.command == 'sync-block':
            updated, result = r.sync_block(args.id, args.version, json.loads(sys.stdin.read())['source_revision'])
        elif args.command == 'sync-saved':
            updated, result = r.sync_saved(json.loads(sys.stdin.read())['sources'])
        elif args.command == 'manual-rebase':
            updated, result = r.manual_rebase(args.id, args.version, json.loads(sys.stdin.read()))
        elif args.command == "migrate":
            updated, result = r.migrate_storage(args.defer_pending)
        elif args.command in ('propose-options', 'rework-options', 'edit-option'):
            spec = json.loads(sys.stdin.read())
            if args.command in ('rework-options', 'edit-option'):
                edit = r.state['edits'].get(args.id)
                if not edit or edit['versions'][-1] != args.version:
                    raise Conflict('Displayed candidate is stale; reread before replacing options')
            if args.command == 'edit-option':
                old = r.payload(edit)
                options = copy.deepcopy(old.get('options', [{'label': 'A', 'after': old['after'], 'reason': '已有单方案'}]))
                selected = next((o for o in options if o['label'] == args.option), None)
                if selected is None or not isinstance(spec.get('after'), str):
                    raise Conflict('Manual edit needs an existing option and after text')
                selected['after'] = spec['after']
                selected['manually_edited'] = True
                spec = {'options': options, 'fewer_options_reason': (old.get('fewer_options_reason') or '手动编辑已有候选，不自动生成备选') if len(options) < 3 else ''}
                if 'intent' in old:
                    spec['intent'] = old['intent']
            if args.command in ('propose-options', 'rework-options'):
                r.validate_options(spec, required=True)
            if args.command == 'propose-options':
                spec.setdefault("deferred", True)
                if spec['deferred'] is False:
                    raise Conflict("新候选必须 deferred=true；接收后才替换正文。旧记录仍可读取。")
            updated, result = r.propose(spec, args.id) if args.command == 'edit-option' else r.propose_options(spec, getattr(args, 'id', None), getattr(args, 'version', None))
        elif args.command == "feedback":
            updated, result = r.feedback(json.loads(sys.stdin.read()))
        elif args.command == 'link-questions':
            spec = json.loads(sys.stdin.read())
            updated, result = r.update_questions(args.id, args.version, spec['questions'], replace=args.replace)
        elif args.command == 'relocate':
            updated, result = r.relocate(args.id, args.version, json.loads(sys.stdin.read()))
        elif args.command == 'decide-batch':
            spec = json.loads(sys.stdin.read())
            items = spec['items']
            if not isinstance(items, list) or not items or any(not isinstance(i, dict) or
                    not all(isinstance(i.get(k), str) and i[k] for k in ('id', 'version', 'option')) for i in items):
                raise Conflict('Provide nonempty items with exact id/version/option')
            updated, result = r.decide([i['id'] for i in items], [],
                                      {i['id']: i['version'] for i in items}, {i['id']: i['option'] for i in items})
        else:
            ids = args.accept + args.reject
            if args.version and len(ids) != 1:
                raise Conflict("--version requires exactly one decision ID")
            if args.option and len(args.accept) != 1:
                raise Conflict('--option requires exactly one accepted ID')
            spec = json.loads(sys.stdin.read()) if args.return_cards else {}
            updated, result = r.decide(args.accept, args.reject, {ids[0]: args.version} if args.version else None, args.option)
        if args.apply and not (args.command in ('save-block-source', 'sync-block', 'sync-saved', 'reassociate-block') and not result['changed']):
            started = time.perf_counter()
            r.persist(updated, args.expect)
            result['timings'] = {'persistence_s': time.perf_counter() - started}
            if args.command in ('feedback', 'rework-options', 'edit-option', 'manual-rebase'):
                result['card'] = r.inspect(result['id'], source=True)
                result['owner_text'] = (r.state_bytes() if r.sidecar else r.encode(r.embedded())).decode('utf-8-sig')
            if args.command in ('decide', 'decide-batch') and args.return_cards:
                try:
                    current = Review(r.repo, r.state_rel, r.git_exe)
                    result['cards_packet'] = current.cards(spec.get('reuse', {}))
                except (Conflict, OSError, ValueError, KeyError) as error:
                    result['cards_error'] = str(error)
        result.update({"applied": args.apply, "expected_sha256": digest(r.raw)})
    return result


if __name__ == "__main__":
    try:
        main()
    except (Conflict, KeyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
