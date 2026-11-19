"""Durable accepted-only checkpoints. Network operations belong to backup.js.

The short review lock protects queue metadata, never a Git hook or network wait.
Git commits use a private index while the real index is locked and preserved.
"""
import argparse
import base64
import copy
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

from source_review import Review, Conflict, digest, body
from review_checkpoint import source_text


def ledger_path(r):
    path = r.object_root.parent / 'automatic-backup.json'
    if path.is_symlink() or path.is_junction() or path.exists() and not path.is_file():
        raise Conflict('后台备份日志不是普通文件')
    return path


def ledger(r):
    path = ledger_path(r)
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if data.get('session') and data['session'] != r.state['session']:
        if data.get('job'):
            raise Conflict('上一批仍有未完成备份，请先核对其检查点')
        return {}
    return data


def status(r):
    data = ledger(r)
    return {'sha256': digest(r.raw), 'requested': r.state.get('auto_backup_requested'),
            'done': data.get('done'), 'job': data.get('job'), 'status': data.get('status', {}),
            'projection_error': r.state.get('auto_backup_projection_error')}


def prepare(r, data, parent):
    r.assert_ready()
    if r.state.get('auto_backup_projection_error'):
        raise Conflict('已接收正文已保存，但自动备份投影需核对：' + r.state['auto_backup_projection_error'])
    if data.get('job'):
        return
    requested = r.state.get('auto_backup_requested')
    if not requested or requested == data.get('done'):
        return
    base = data.get('done') or r.state['auto_backup_base']
    files = [name for name in r.state['rounds'][-1]['files']
             if source_text(r.contents(base, name)) != source_text(r.contents(requested, name))]
    data['job'] = {'source': requested, 'base': base, 'parent': parent, 'files': files,
                   'items': copy.deepcopy(r.state.get('auto_backup_items', {}))}
    data['status'] = {'status': 'queued', 'source': requested, 'message': 'Git 备份排队中；未决候选和批注保留'}


def update(r, data, spec):
    job = data.get('job')
    if job and spec.get('source') != job['source']:
        raise Conflict('后台检查点身份已变化，未标记完成')
    state = spec['status']
    if state not in ('running', 'local', 'done', 'failed'):
        raise Conflict('Unknown automatic backup status')
    data['status'] = {**data.get('status', {}), **spec}
    if job and spec.get('commit'):
        job['commit'] = spec['commit']
    if state == 'done':
        if not job or spec.get('commit') != job.get('commit'):
            raise Conflict('缺少对应本地成果提交，未标记远端完成')
        data['done'] = job['source']
        data.setdefault('published', {}).update(job['items'])
        # Keep only Git checkpoint metadata, never a second author-decision state.
        del data['job']


def local_commit(r):
    r.assert_ready()
    job = ledger(r).get('job')
    if not job:
        raise Conflict('没有准备好的自动备份检查点')
    git = lambda *args, data=None: r.git(*args, data=data)
    head = git('rev-parse', 'HEAD').decode().strip()
    marker = 'TeXScholar-Checkpoint: ' + job['source']
    names = job['files']
    attrs = git('check-attr', 'filter', 'working-tree-encoding', '--', *names).decode().splitlines() if names else []
    if any(not line.endswith((': unspecified', ': unset')) for line in attrs):
        raise Conflict('成果源码含自定义 Git 内容转换规则，未提交')
    expected = {}
    for name in names:
        tracked = git('show', job['parent'] + ':' + name)
        bom = b'\xef\xbb\xbf' if tracked.startswith(b'\xef\xbb\xbf') else b''
        base = bom + source_text(r.contents(job['base'], name)).encode('utf-8')
        actual = bom + source_text(body(tracked.decode('utf-8-sig'))).encode('utf-8')
        # Let Git apply its existing text/EOL rules. Filters and non-UTF-8
        # conversions were refused above; an unrelated author edit still differs.
        canonical = lambda raw: git('hash-object', '--path=' + name, '--stdin', data=raw).decode().strip()
        if canonical(base) != canonical(actual):
            raise Conflict('Git 基线与已归属源版本不一致：' + name + '；请先核对手动修改和既有提交')
        raw = bom + source_text(r.contents(job['source'], name)).encode('utf-8')
        oid = git('hash-object', '-w', '--path=' + name, '--stdin', data=raw).decode().strip()
        if oid != git('rev-parse', job['parent'] + ':' + name).decode().strip():
            expected[name] = oid

    def verify(commit):
        if git('rev-parse', commit + '^').decode().strip() != job['parent']:
            raise Conflict('自动备份提交父版本变化，未推送')
        changed = set(git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).decode().split('\0')) - {''}
        if changed != set(expected):
            raise Conflict('Git hook 改变了提交范围，未推送；请核对本地提交')
        for name, oid in expected.items():
            if git('rev-parse', commit + ':' + name).decode().strip() != oid:
                raise Conflict('Git 提交不是已接收投影：' + name)

    if head != job['parent']:
        if marker not in git('log', '-1', '--format=%B').decode().splitlines():
            raise Conflict('HEAD 含未归属此检查点的本地提交；请核对后重试，不会连带上传')
        verify(head)
        return {'commit': head, 'source': job['source'], 'reused': True}
    if not expected:
        return {'commit': head, 'source': job['source'], 'unchanged': True}
    gitdir = Path(git('rev-parse', '--absolute-git-dir').decode().strip())
    if gitdir.is_symlink() or gitdir.is_junction() or gitdir.resolve() != gitdir:
        raise Conflict('Git 元数据目录不是核实的普通目录')
    index = gitdir / 'index'
    if index.is_symlink() or index.is_junction() or not index.is_file():
        raise Conflict('Git index 不是现存普通文件')
    lock = gitdir / 'index.lock'
    original = index.read_bytes()
    # O_EXCL coordinates with ordinary Git writers. The private index lets Git
    # run the user's hooks without ever staging a working-paper projection.
    stream = lock.open('xb')
    identity = os.fstat(stream.fileno())
    committed = False
    try:
        if index.read_bytes() != original or git('diff', '--cached', '--name-only', '-z'):
            raise Conflict('暂存区已有或刚出现手动选择，后台备份已停止；暂存选择保留')
        private_index = r.object_root.parent / 'automatic-index'
        if private_index.is_symlink() or private_index.is_junction():
            raise Conflict('自动备份索引不能是链接')
        env = {**r.env, 'GIT_INDEX_FILE': str(private_index)}

        def isolated(*args):
            result = subprocess.run([r.git_exe, *args], cwd=r.repo, env=env, capture_output=True)
            if result.returncode:
                raise Conflict(result.stderr.decode('utf-8', errors='replace').strip() or 'Git commit failed')
            return result.stdout

        isolated('read-tree', head)
        for name, oid in expected.items():
            mode = git('ls-tree', head, '--', name).decode().split()[0]
            if mode not in ('100644', '100755'):
                raise Conflict('自动备份仅更新普通已归属源码：' + name)
            isolated('update-index', '--add', '--cacheinfo', mode, oid, name)
        if git('rev-parse', 'HEAD').decode().strip() != head:
            raise Conflict('提交前 HEAD 变化，未创建自动提交')
        isolated('commit', '-m', 'accepted(paper): 保存作者已接收成果\n\n' + marker +
                 '\n已接收编号：' + ', '.join(job['items']) + '\n未决候选、批注和运行状态保留本地。')
        commit = git('rev-parse', 'HEAD').decode().strip()
        committed = True
        # Synchronize only the formerly empty author index. Working files retain
        # runtime review state and unaccepted/manual content as unstaged changes.
        stream.write(private_index.read_bytes())
        stream.flush()
        os.fsync(stream.fileno())
        stream.close()
        if index.read_bytes() != original:
            raise Conflict('提交期间作者索引变化；保留 index.lock 供核对，未推送')
        os.replace(lock, index)
        verify(commit)
        return {'commit': commit, 'source': job['source']}
    finally:
        if not stream.closed:
            stream.close()
        if not committed and lock.exists():
            # Release only the lock created here, in its verified direct parent.
            prior = Path.cwd()
            try:
                os.chdir(gitdir)
                current = Path('./index.lock').lstat()
                if Path.cwd().resolve() != gitdir or not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
                    raise Conflict('Git 锁身份变化，停止释放，请核对 index.lock')
                Path('./index.lock').unlink()
            finally:
                os.chdir(prior)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--git', default='git')
    parser.add_argument('operation', choices=['status', 'prepare', 'local', 'update'])
    args = parser.parse_args()
    r = Review(args.project, args.state, args.git)
    if args.operation == 'local':
        result = local_commit(r)
    elif args.operation == 'status':
        result = status(r)
    else:
        spec = json.loads(sys.stdin.read())
        with r.writer_lock():
            r = Review(args.project, args.state, args.git)
            if args.operation == 'prepare':
                data = ledger(r)
                prepare(r, data, spec['parent'])
            else:
                data = ledger(r)
                update(r, data, spec)
            data['session'] = r.state['session']
            r.write(ledger_path(r), json.dumps(data, ensure_ascii=False).encode('utf-8'))
            result = status(r)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (Conflict, OSError, ValueError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
