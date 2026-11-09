"""Accepted-source Git checkpoint payload and post-push live-state compaction.

Git transport is owned by backup.js. Cleanup deletes only verified unreachable local objects after a successful checkpoint.
"""
import argparse
import base64
import copy
import json
import re
import sys
import os
import stat
from pathlib import Path
from contextlib import nullcontext
from datetime import datetime, timezone

from source_review import Review, Conflict, PENDING, body, digest, letters


def source_text(text):
    # Stable writing/logic comments stay; runtime review pointers/markers do not.
    return ''.join(line for line in text.splitlines(keepends=True)
                   if not re.match(r'^%\s*CODEX-REVIEW(?:-|\s|:|$)', line))


def plan(r):
    r.assert_ready()
    if r.storage != 'files':
        raise Conflict('先核对旧存储转换；成果提交只处理当前本地审核状态。')
    if r.state.get('pending_backup'):
        return {'sha256': digest(r.raw), 'resume': copy.deepcopy(r.state['pending_backup'])}
    if any(e['status'] in PENDING and not e.get('deferred', False) for e in r.state['edits'].values()):
        raise Conflict('仍有旧式候选写在正文中，不能将其当作已接收成果提交。')
    accepted = {id_: e['versions'][-1] for id_, e in r.state['edits'].items()
                if e['status'] == 'accepted' and e['versions'] and e.get('published_version') != e['versions'][-1]}
    outside = [r.state['edits'][id_]['file'] for id_ in accepted
               if r.state['edits'][id_]['file'] not in r.state['rounds'][-1]['files']]
    if outside:
        raise Conflict('仍有已接收文件不在当前轮投影范围；请核对并将其纳入本轮后再备份：' + ', '.join(sorted(set(outside))))
    sources, manual = {}, []
    for name in r.state['rounds'][-1]['files']:
        current = r.read(name)
        approved = r.contents(r.state['accepted'], name)
        if source_text(current) != source_text(approved):
            manual.append(name)
        # Pending options live outside the source. The author's explicit backup
        # includes direct edits, without accepting any of those options or notes.
        text = source_text(current)
        if name == r.state_rel:
            # A clone can start a new local review without missing private objects.
            text = ('% CODEX-REVIEW-STATE-BEGIN\n'
                    '% CODEX-REVIEW-SOURCE-ONLY: accepted-content\n'
                    f"% CODEX-REVIEW-NEXT manuscript={r.state['next'][0]} response={letters(r.state['next'][1])}\n"
                    '% CODEX-REVIEW-STATE-END\n' + text)
        raw = r.original[name]
        payload = (b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8')
        sources[name] = {'content': base64.b64encode(payload).decode('ascii'), 'working_sha256': digest(raw)}
    if not accepted and not manual:
        return {'sha256': digest(r.raw), 'accepted': {}, 'manual_files': [], 'sources': {}, 'checkpoint': r.state.get('checkpoint')}
    closed = {id_: {'status': e['status'], 'version': e['versions'][-1]}
              for id_, e in r.state['edits'].items()
              if e['status'] in {'accepted', 'rejected'} and e['versions'] and e['file'] in sources}
    return {'sha256': digest(r.raw), 'accepted': accepted, 'manual_files': manual, 'closed': closed, 'sources': sources}


def record(r, spec):
    data = plan(r)
    if data.get('resume') or not (data['accepted'] or data['manual_files']):
        raise Conflict('没有可记录的新成果提交，或应先完成已有提交的推送。')
    commit = spec['commit']
    if r.git('rev-parse', 'HEAD').decode().strip() != commit:
        raise Conflict('本地 HEAD 与成果提交不一致；不精简历史。')
    if set(spec['files']) != set(data['sources']):
        raise Conflict('成果提交的源码范围与已接收投影不一致。')
    for name, source in data['sources'].items():
        if r.git('show', commit + ':' + name) != base64.b64decode(source['content'], validate=True):
            raise Conflict('Git 中的内容并非核对过的已接收成果：' + name)
        if r.git('rev-parse', commit + ':' + name).decode().strip() != spec['files'][name]:
            raise Conflict('成果文件的 Git 对象已变化：' + name)
    # The verified local source commit is the author's checkpoint for manual
    # edits too. Later acceptance starts from it; push failure retains this
    # local checkpoint and never permits compaction or cache cleanup.
    r.state['accepted'] = r.snapshot({name: body(base64.b64decode(source['content'], validate=True).decode('utf-8-sig')).encode('utf-8')
                                    for name, source in data['sources'].items()}, 'author source checkpoint ' + commit)
    r.state['pending_backup'] = {'commit': commit, 'accepted': data['accepted'], 'manual_files': data['manual_files'], 'closed': data['closed'],
                                 'files': spec['files'], 'purpose': spec['purpose']}
    return {}, {'recorded': commit}


def compact(r):
    r.assert_ready()
    saved = r.state.get('pending_backup')
    if not saved:
        raise Conflict('没有已记录的成果提交；不能精简审核历史。')
    commit = saved['commit']
    if any(r.git('rev-parse', ref).decode().strip() != commit for ref in ('HEAD', 'origin/master')):
        raise Conflict('成果提交尚未与 origin/master 一致；不精简历史。')
    for name, oid in saved['files'].items():
        if r.git('rev-parse', commit + ':' + name).decode().strip() != oid:
            raise Conflict('成果提交内容不一致；不精简历史。')
    edits = r.state['edits']
    eligible = {id_ for id_, e in edits.items() if not e['versions'] and e.get('checkpoint')
                and e.get('freshness') != 'needs-recheck'}
    for id_, old in saved['closed'].items():
        edit = edits.get(id_)
        if (edit and edit['status'] == old['status'] and edit['versions'] and edit['versions'][-1] == old['version']
                and edit.get('freshness') != 'needs-recheck'
                and not any(q['status'] in {'open', 'addressed-pending-review'} for q in edit.get('requests', []))):
            eligible.add(id_)
    needed = set(edits) - eligible
    queue = list(needed)
    while queue:
        for dependency in edits[queue.pop()].get('deps', []):
            if dependency not in needed:
                needed.add(dependency)
                queue.append(dependency)
    removed, minimal = [], []
    for id_ in eligible:
        if id_ not in needed:
            del edits[id_]
            removed.append(id_)
        else:
            # Keep dependency identity, not old candidate text or closed annotations.
            edits[id_]['versions'] = []
            edits[id_].pop('requests', None)
            edits[id_].pop('previous_feedback', None)
            edits[id_].setdefault('checkpoint', commit)
            minimal.append(id_)
    for id_, version in saved['accepted'].items():
        if id_ in edits and edits[id_]['versions'] and edits[id_]['versions'][-1] == version:
            edits[id_]['published_version'] = version
            edits[id_]['checkpoint'] = commit
    active = r.state['rounds'][-1]
    active['ids'] = [id_ for id_ in active['ids'] if id_ in edits]
    r.state['rounds'] = [active]
    r.state['checkpoint'] = {'commit': commit}
    del r.state['pending_backup']
    return {}, {'checkpoint': commit, 'removed_ids': sorted(removed), 'dependency_ids': sorted(minimal),
                'pending_ids': [id_ for id_, e in edits.items() if e['status'] in PENDING]}


def referenced_objects(r):
    """Local objects required by the current authoritative state."""
    used = {r.state['accepted']}
    if r.state.get('submission'):
        used.add(r.state['submission'])
    for rnd in r.state['rounds']:
        used.update((rnd['baseline'], rnd['accepted_start']))
    for edit in r.state['edits'].values():
        used.update(edit['versions'])
        for note in edit.get('requests', []):
            used.add(note['version'])
            if note.get('addressed_version'):
                used.add(note['addressed_version'])
    if r.state.get('transaction'):
        used.add(r.state['transaction']['commit'])
    # Scientific issue metadata can also hold local object identities outside core fields.
    def references(value):
        if isinstance(value, dict):
            for item in value.values():
                references(item)
        elif isinstance(value, list):
            for item in value:
                references(item)
        elif isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) and (r.object_root / (value + '.json')).exists():
            used.add(value)
    references(r.state)
    return used


def unused_objects(r):
    """Exact cleanup candidates only. No move, deletion or new persistent tracker."""
    used = referenced_objects(r)
    return [str(p) for p in sorted(r.object_root.iterdir())
            if p.suffix == '.json' and re.fullmatch(r'[a-f0-9]{64}', p.stem) and p.stem not in used
            and p.is_file() and not p.is_symlink() and not p.is_junction()]


class CleanupFailure(Conflict):
    def __init__(self, message, deleted):
        super().__init__(message)
        self.deleted = deleted


def cleanup(r, apply=False):
    """Preflight the complete exact file batch; never delete a directory or active object."""
    deleted = []
    try:
        r.assert_ready()
        checkpoint = r.state.get('checkpoint')
        if r.storage != 'files' or not checkpoint or r.state.get('pending_backup'):
            raise Conflict('没有可核对的成功推送记录；不清理缓存。')
        if any(r.git('rev-parse', ref).decode().strip() != checkpoint['commit'] for ref in ('HEAD', 'origin/master')):
            raise Conflict('HEAD、origin/master 与成功检查点不一致；不清理缓存。')
        parent = r.object_root.resolve(strict=True)
        if not parent.is_relative_to(r.repo) or parent == r.repo:
            raise Conflict('审核缓存目录不在论文安全根内。')
        def checked(path):
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or path.is_symlink() or path.is_junction() or info.st_nlink != 1
                    or path.resolve(strict=True) != parent / path.name):
                raise Conflict('缓存目标类型、归属或路径异常：' + str(path))
            raw = path.read_bytes()
            fingerprint = digest(raw)
            if fingerprint != path.stem:
                raise Conflict('缓存对象内容与身份不一致：' + str(path))
            data = json.loads(raw)
            if not isinstance(data, dict) or set(data) != {'files'} or not isinstance(data['files'], dict):
                raise Conflict('不是本工具生成的审核对象：' + str(path))
            for content in data['files'].values():
                if not isinstance(content, str):
                    raise Conflict('审核对象格式异常：' + str(path))
                base64.b64decode(content, validate=True)
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, fingerprint
        used = referenced_objects(r)
        for oid in used:
            if not re.fullmatch(r'[a-f0-9]{64}', oid):
                raise Conflict('必要缓存引用格式异常；不清理。')
            checked(parent / (oid + '.json'))
        tracked = set(r.git('ls-files', '-z', '--', '.codex-review/objects').decode('utf-8').split('\0'))
        records = []
        for value in unused_objects(r):
            path = Path(value)
            rel = path.relative_to(r.repo).as_posix()
            if rel in tracked:
                raise Conflict('待清理缓存已进入 Git 索引，未删除：' + str(path))
            records.append({'path': path, 'type': 'file', 'parent': parent, 'root': r.repo,
                            'reason': 'successful checkpoint; no authoritative live-state reference',
                            'discovered': datetime.now(timezone.utc).isoformat(), 'identity': checked(path)})
        if not apply:
            return {'cleanup_candidates': [str(row['path']) for row in records], 'deleted_objects': [], 'files_deleted': False}
        previous = Path.cwd()
        try:
            for row in records:
                path = row['path']
                if r.state_path.read_bytes() != r.raw:
                    raise Conflict('审核状态在清理期间变化；已停止后续删除。')
                if path.stem in referenced_objects(r) or checked(path) != row['identity']:
                    raise Conflict('缓存引用或身份变化；已停止：' + str(path))
                if r.git('ls-files', '-z', '--', path.relative_to(r.repo).as_posix()):
                    raise Conflict('缓存刚被加入 Git 索引；已停止：' + str(path))
                os.chdir(row['parent'])
                if Path.cwd().resolve(strict=True) != row['parent']:
                    raise Conflict('PARENT_CD_FAILED')
                leaf = Path('./' + path.name)
                if checked(leaf) != row['identity'] or r.state_path.read_bytes() != r.raw:
                    raise Conflict('删除前的缓存或状态核对失败：' + str(path))
                leaf.unlink()
                deleted.append(str(path))
                if os.path.lexists(leaf):
                    raise Conflict('删除后目标仍存在；已停止：' + str(path))
        finally:
            os.chdir(previous)
        return {'deleted_objects': deleted, 'files_deleted': bool(deleted), 'cleanup_complete': True}
    except (Conflict, OSError, ValueError) as error:
        raise CleanupFailure(str(error), deleted) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--git', default='git')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expect')
    parser.add_argument('operation', choices=['plan', 'record', 'compact', 'cleanup'])
    args = parser.parse_args()
    r = Review(args.project, args.state, args.git)
    with r.writer_lock() if args.apply else nullcontext():
        if args.apply:
            r = Review(args.project, args.state, args.git)
        result = dispatch(r, args)
    print(json.dumps(result, ensure_ascii=False))


def dispatch(r, args):
    if args.operation == 'plan':
        result = plan(r)
    else:
        if args.apply and args.expect != digest(r.raw):
            raise Conflict('Stale/missing --expect state-file SHA256')
        if args.operation == 'cleanup':
            result = cleanup(r, args.apply)
            result.update({'sha256': digest(r.raw), 'applied': args.apply})
            return result
        updated, result = record(r, json.loads(sys.stdin.read())) if args.operation == 'record' else compact(r)
        if args.apply:
            r.persist(updated, args.expect)
            r = Review(args.project, args.state, args.git)
        result['sha256'] = digest(r.raw)
        result['applied'] = args.apply
        if args.operation == 'compact':
            result['unused_objects'] = unused_objects(r)
            result['files_deleted'] = False
    return result


if __name__ == '__main__':
    try:
        main()
    except CleanupFailure as error:
        print(json.dumps({'error': str(error), 'deleted_objects': error.deleted, 'cleanup_complete': False}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
    except (Conflict, KeyError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
