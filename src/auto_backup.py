"""Durable saved-source and legacy checkpoints. Network operations belong to backup.js.

The short review lock protects queue metadata, never a Git hook or network wait.
Git commits use a private index while the real index is locked and preserved.
"""
import argparse
import base64
import copy
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import uuid
from datetime import datetime

from source_review import Review, Conflict, digest, body, writer_lock_at
from review_checkpoint import source_text


def saved_ledger(root, mutation=None):
    directory = root / '.codex-review'
    if directory.is_symlink() or directory.is_junction():
        raise Conflict('审核目录不能是链接。')
    path = directory / 'automatic-backup.json'
    if path.is_symlink() or path.is_junction() or path.exists() and not path.is_file():
        raise Conflict('后台备份日志不是普通文件。')
    if mutation is None:
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    with writer_lock_at(directory):
        data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        mutation(data)
        Review.write(path, json.dumps(data, ensure_ascii=False).encode('utf-8'))
        return data


def saved_proofs(previous, review, commit, ancestor):
    """Keep exact, remotely confirmed versions only along the verified history."""
    history = {}
    old = previous.get('review') or {}
    if ancestor and old.get('session') == review.get('session'):
        history = copy.deepcopy(old.get('history', {}))
        for id_, version in old.get('accepted', {}).items():
            history.setdefault(id_, {})[version] = {'commit':previous['commit'], 'sources':old.get('sources', {})}
    for id_, version in review.get('accepted', {}).items():
        history.setdefault(id_, {})[version] = {'commit':commit, 'sources':review.get('sources', {})}
    return {**review, 'history':history}


def saved_update(root, spec, git_exe='git'):
    def update(data):
        job = data.get('saved_job')
        if not job or job['token'] != spec['token']:
            raise Conflict('自动备份任务已变化。')
        if spec.get('done'):
            if job.get('commit') != spec.get('commit'):
                raise Conflict('自动备份提交身份不一致。')
            previous = data.get('saved_done') or {}
            review = job.get('review')
            if review or previous.get('review'):
                ancestor = False
                if previous.get('commit'):
                    env = {k:v for k,v in os.environ.items() if not k.upper().startswith('GIT_')}
                    result = subprocess.run([git_exe, 'merge-base', '--is-ancestor', previous['commit'], job['parent']], cwd=root, env=env, capture_output=True)
                    if result.returncode not in (0, 1):
                        raise Conflict(result.stderr.decode('utf-8', 'replace').strip() or '无法核对备份历史。')
                    ancestor = result.returncode == 0
                if review:
                    review = saved_proofs(previous, review, job['commit'], ancestor)
                elif ancestor:
                    old = previous['review']
                    review = saved_proofs(previous, {'session':old['session'], 'accepted':{}, 'sources':{}}, job['commit'], True)
            data['saved_done'] = {'commit': job['commit'], 'files': job['files'],
                                  **({'review': review} if review else {}),
                                  **({'review_error': job['review_error']} if job.get('review_error') else {})}
            del data['saved_job']
            if not data.get('saved_pending'):
                message = '已备份 ' + spec['commit'][:8]
                if job.get('review_error'):
                    message += '；审核发布凭据未记录：' + job['review_error']
                data['saved_status'] = {'status':'done', 'commit':spec['commit'], 'message':message}
        else:
            job['commit'] = spec['commit']
            if not data.get('saved_pending'):
                data['saved_status'] = {'status':'local', 'commit':spec['commit'], 'message':'本地备份已提交，远端待上传'}
    return saved_ledger(root, update)


def saved_event(root, spec):
    directory = root / '.codex-review'
    if spec['action'] == 'idle' and not directory.exists() and not directory.is_symlink() and not directory.is_junction():
        return {}
    def update(data):
        if spec['action'] == 'queued':
            data['saved_pending'] = spec['id']
            data['saved_status'] = {'status':'queued', 'message':'后台 Git 备份排队中'}
        elif spec['action'] == 'start':
            if data.get('saved_pending') == spec['id']:
                del data['saved_pending']
                data['saved_status'] = {'status':'running', 'message':'正在检查已保存源码'}
        elif spec['action'] in ('failed', 'idle'):
            if not data.get('saved_pending'):
                data['saved_status'] = {key:spec[key] for key in ('status', 'message', 'commit') if key in spec}
                if spec['action'] == 'idle' and (data.get('saved_done') or {}).get('review_error'):
                    data['saved_status']['message'] += '；审核发布凭据未记录：' + data['saved_done']['review_error']
        else:
            raise Conflict('未知自动备份状态。')
    return saved_ledger(root, update)


def saved_recover(root, git_exe):
    data = saved_ledger(root)
    job = data.get('saved_job')
    if not job:
        return {'job': None, 'legacy_job': data.get('job')}
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
    def git(*args):
        result = subprocess.run([git_exe, *args], cwd=root, env=env, capture_output=True)
        if result.returncode:
            raise Conflict(result.stderr.decode('utf-8', 'replace').strip() or 'Git 检查失败')
        return result.stdout
    head = git('rev-parse', 'HEAD').decode().strip()
    if head == job['parent'] and not job.get('commit'):
        return {'job':job, 'commit':None}
    if job.get('commit') and head != job['commit']:
        raise Conflict('本地 HEAD 不是待上传的备份提交；未上传其他提交。')
    if git('rev-parse', head + '^').decode().strip() != job['parent']:
        raise Conflict('待上传备份提交父版本不一致。')
    marker = 'TeXScholar-Saved-Checkpoint: ' + job['token']
    if marker not in git('log', '-1', '--format=%B', head).decode('utf-8').splitlines():
        raise Conflict('本地提交不属于待上传备份；未上传其他提交。')
    changed = set(git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', head).decode().split('\0')) - {''}
    if changed != set(job['files']):
        raise Conflict('待上传备份的文件范围不一致。')
    for name, expected in job['files'].items():
        rows = git('ls-tree', '-z', head, '--', name).split(b'\0')
        actual = next((row.split(b' ', 2)[2].split(b'\t', 1)[0].decode() for row in rows if row), None)
        if actual != expected:
            raise Conflict('待上传备份内容不一致：' + name)
    if not job.get('commit'):
        data = saved_update(root, {'token':job['token'], 'commit':head}, git_exe); job = data['saved_job']
    return {'job':job, 'commit':head}


def saved_sources(root, names, git_exe, overrides=None):
    """Capture saved paper bytes and remove only verified review runtime data."""
    from review_blocks import MARKER
    from review_excerpts import resolve
    originals = {}
    for name in names:
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise Conflict('备份文件路径无效：' + name)
        path = root / relative
        for component in [path, *path.parents]:
            if component == root:
                break
            if component.is_symlink() or component.is_junction():
                raise Conflict('备份不处理链接：' + name)
        if path.exists() and not path.is_file():
            raise Conflict('备份不处理特殊文件：' + name)
        originals[name] = path.read_bytes() if path.exists() else None
    owners = []
    for folder, directories, leaves in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in ('.git', '.codex-review', '.latex-build', 'clean_dir', 'node_modules', '.semantic-researcher-overleaf')
                          and not (Path(folder) / name).is_symlink() and not (Path(folder) / name).is_junction()]
        for leaf in leaves:
            path = Path(folder) / leaf
            if path.suffix.lower() != '.tex' or path.is_symlink() or path.is_junction():
                continue
            name = path.relative_to(root).as_posix()
            raw = originals.get(name)
            if raw is None:
                raw = path.read_bytes()
            if b'% CODEX-REVIEW-DATA ' in raw:
                owners.append(name)
                originals.setdefault(name, raw)
            elif re.search(rb'(?m)^\s*%\s*CODEX-REVIEW-DATA\b', raw):
                raise Conflict('旧审核状态标记无法识别，未上传：' + name)
    if len(owners) > 1:
        raise Conflict('发现多个旧审核状态；无法安全导出源码。')
    restored = {}
    if owners:
        try:
            review = Review(root, owners[0], git_exe)
            review.assert_ready()
            restored = review.defer_pending()
        except (Conflict, OSError, ValueError, KeyError) as error:
            raise Conflict('旧格式源码无法安全排除未接收候选：' + owners[0] + '；' + str(error)) from error
    files, tex = {}, {}
    for name in names:
        raw = (overrides or {}).get(name, originals[name])
        if raw is None or not name.lower().endswith('.tex'):
            files[name] = raw
            continue
        if raw != originals[name] and (name in restored or b'% CODEX-REVIEW-DATA ' in raw):
            raise Conflict('暂存的旧审核源码与工作文件不同，无法安全排除运行数据：' + name)
        text = restored.get(name, raw.decode('utf-8-sig'))
        if name in owners:
            text = body(text)
        tex[name] = source_text(text, sidecar=True)
    linked = False
    for name, text in tex.items():
        try:
            linked |= bool(resolve(text, lambda source: tex[source]))
        except ValueError as error:
            raise Conflict('备份不能省略或损坏摘录来源：' + name + '；' + str(error)) from error
    if linked and not any(Path(name).name == 'texscholar-excerpt.sty' and files[name] is not None for name in files):
        raise Conflict('备份缺少论文内的 texscholar-excerpt.sty；请先检查 Git 忽略规则。')
    for name, text in tex.items():
        raw = (overrides or {}).get(name, originals[name])
        if not linked:
            text = MARKER.sub('', text)
        files[name] = (b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8')
    return originals, files


def saved_commit(root, git_exe, spec, storage=None):
    """Commit captured saved files without consuming unrelated staged entries."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
    def git(*args, data=None, extra=None):
        result = subprocess.run([git_exe, *args], cwd=root, env={**env, **(extra or {})}, input=data, capture_output=True)
        if result.returncode:
            raise Conflict(result.stderr.decode('utf-8', 'replace').strip() or 'Git 命令失败')
        return result.stdout
    names = spec['files']
    if not isinstance(names, list) or not names or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        raise Conflict('必须提供明确且不重复的备份文件。')
    parent = spec['parent']
    if git('rev-parse', 'HEAD').decode().strip() != parent:
        raise Conflict('备份前 HEAD 已变化。')
    ledger_data = saved_ledger(root)
    if ledger_data.get('job'):
        raise Conflict('旧后台备份任务尚未完成，请先恢复该任务。')
    previous_job = ledger_data.get('saved_job')
    if previous_job and (previous_job.get('commit') or previous_job.get('parent') != parent):
        raise Conflict('已有本地备份任务待续传，不能创建新提交。')
    originals, files = saved_sources(root, names, git_exe)
    additions = spec.get('new_files', [])
    if not isinstance(additions, list) or any(not isinstance(name, str) for name in additions):
        raise Conflict('新增论文文件列表无效。')
    requested_new = set(additions)
    if not requested_new.issubset(names):
        raise Conflict('新增文件不属于本次备份范围。')
    staged_before = git('ls-files', '--stage', '-z')
    staged = {}
    for row in staged_before.split(b'\0'):
        if not row:
            continue
        metadata, raw_name = row.split(b'\t', 1)
        mode, oid, stage = metadata.decode().split(' ')
        name = raw_name.decode('utf-8')
        if name in names:
            if stage != '0':
                raise Conflict('暂存区存在未解决冲突：' + name)
            staged[name] = (mode, oid)
    overrides = {}
    for name in names:
        rows = git('ls-tree', '-z', parent, '--', name).split(b'\0')
        entry = next((row for row in rows if row), None)
        previous = entry.split(b' ', 2)[2].split(b'\t', 1)[0].decode() if entry else None
        current = None if originals[name] is None else git('hash-object', '--path=' + name, '--stdin', data=originals[name]).decode().strip()
        index = staged.get(name, (None, None))[1]
        if current == previous and index != previous:
            overrides[name] = git('show', ':' + name) if index else None
    if overrides:
        captured = originals
        originals, files = saved_sources(root, names, git_exe, overrides)
        if originals != captured:
            raise Conflict('备份期间项目文件发生变化；未创建提交。')
    if git('ls-files', '--stage', '-z') != staged_before:
        raise Conflict('暂存区在准备期间变化，未创建备份。')
    attrs = git('check-attr', 'filter', 'working-tree-encoding', '--', *names).decode().splitlines()
    if any(not line.endswith((': unspecified', ': unset')) for line in attrs):
        raise Conflict('备份范围含自定义 Git 内容转换规则；未提交。')
    expected, modes, blobs = {}, {}, {}
    for name, raw in files.items():
        entries = git('ls-tree', '-z', parent, '--', name).split(b'\0')
        entry = next((e for e in entries if e), None)
        if not entry and name not in requested_new:
            raise Conflict('自动备份只处理已跟踪或已登记的论文文件：' + name)
        mode = entry.split(b' ', 1)[0].decode() if entry else '100644'
        if mode not in ('100644', '100755'):
            raise Conflict('自动备份仅支持普通文件：' + name)
        modes[name] = mode
        oid = None if raw is None else git('hash-object', '--path=' + name, '--stdin', data=raw).decode().strip()
        blobs[name] = oid
        previous = entry.split(b' ', 2)[2].split(b'\t', 1)[0].decode() if entry else None
        if oid != previous:
            expected[name] = oid
    if expected and spec.get('confirm_review') is not None:
        raise Conflict('远端确认期间源码已变化；未创建提交或记录凭据。')
    def unchanged():
        for name, original in originals.items():
            path = root / name
            if (path.read_bytes() if path.exists() else None) != original:
                raise Conflict('备份期间源码发生变化：' + name)
    def capture_review():
        unchanged()
        if spec.get('owner'):
            try:
                r = Review(root, spec['owner'], git_exe)
                r.assert_ready()
                accepted = {}
                for id_, edit in r.state['edits'].items():
                    name = edit['file']
                    if edit['status'] != 'accepted' or not edit['versions'] or name not in files or files[name] is None or name in overrides:
                        continue
                    text = r.read(name)
                    if r.original[name] != originals[name]:
                        raise Conflict('备份期间源码发生变化：' + name)
                    try:
                        r.locate_edit(text, edit)
                    except Conflict:
                        from review_blocks import reconcile
                        try:
                            if r.sidecar:
                                anchor = edit['anchor']
                                row = r.block_row(text, name, edit['block_id'])
                                old = r.contents(anchor['block_snapshot'], 'block.tex')
                                current = text[row['start']:row['end']]
                                start, end = anchor['start'], anchor['end']
                            else:
                                old = r.contents(r.state['accepted'], name)
                                current = text
                                start, end = r.locate_edit(old, edit)
                            mapped = reconcile(old, current, start, end, [])
                            if mapped is None or mapped[2] != r.payload(edit)['after']:
                                continue
                        except (Conflict, ValueError, KeyError):
                            continue
                    accepted[id_] = edit['versions'][-1]
                return {'session':r.state['session'], 'accepted':accepted,
                        'accepted_snapshot':r.state['accepted'],
                        'sources':{name:{'sha256':digest(raw), 'blob':blobs[name]}
                                   for name, raw in originals.items() if name in blobs and raw is not None}}, None
            except (Conflict, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
                return None, str(error)
        return None, None

    if not expected:
        if previous_job:
            def clear_uncommitted(data):
                if data.get('saved_job') != previous_job:
                    raise Conflict('自动备份任务已变化。')
                del data['saved_job']
            saved_ledger(root, clear_uncommitted)
        review = None
        if spec.get('owner'):
            with writer_lock_at(root / '.codex-review'):
                review, _ = capture_review()
        old_done = ledger_data.get('saved_done') or {}
        old = old_done.get('review') or {}
        known = old.get('history', {}) if old.get('session') == (review or {}).get('session') else {}
        missing = {id_:version for id_,version in (review or {}).get('accepted', {}).items()
                   if version not in known.get(id_, {}) and not (old.get('session') == review['session'] and old.get('accepted', {}).get(id_) == version)}
        if spec.get('confirm_review') is not None:
            if review != spec['confirm_review'] or git('rev-parse', 'HEAD').decode().strip() != parent:
                raise Conflict('远端确认期间审核或源码已变化；未记录凭据。')
            def confirm(data):
                current, error = capture_review()
                if error or current != review or data.get('saved_job') or git('rev-parse', 'HEAD').decode().strip() != parent:
                    raise Conflict('远端确认期间审核或源码已变化；未记录凭据。')
                previous = data.get('saved_done') or {}
                ancestor = False
                if previous.get('commit'):
                    result = subprocess.run([git_exe, 'merge-base', '--is-ancestor', previous['commit'], parent], cwd=root, env=env, capture_output=True)
                    if result.returncode not in (0, 1):
                        raise Conflict(result.stderr.decode('utf-8', 'replace').strip() or '无法核对备份历史。')
                    ancestor = result.returncode == 0
                data['saved_done'] = {'commit':parent, 'files':{}, 'review':saved_proofs(previous, current, parent, ancestor)}
            saved_ledger(root, confirm)
            return {'unchanged':True, 'commit':parent, 'files':[], 'confirmed':True}
        return {'unchanged': True, 'commit': parent, 'files': [], **({'review_proof':review} if missing else {})}
    unchanged()
    selected = list(expected)
    index_before = git('ls-files', '--stage', '-z').split(b'\0')
    outside = sorted(row for row in index_before if row and row.split(b'\t', 1)[1].decode('utf-8') not in selected)
    stats = git('diff', '--numstat', parent, '--', *selected).decode('utf-8', 'replace').strip()
    diff = git('diff', '--no-ext-diff', '--unified=0', parent, '--', *selected).decode('utf-8', 'replace')
    trigger = spec.get('trigger', '保存')
    if trigger not in ('启动', '保存', '定时', '接收', '重试'):
        raise Conflict('未知自动备份触发来源。')
    stamp = datetime.now().astimezone().isoformat(timespec='seconds')
    token = uuid.uuid4().hex
    job = {'token':token, 'parent':parent, 'files':expected, 'trigger':trigger}
    def prepare(data):
        if data.get('job') or data.get('saved_job') != previous_job:
            raise Conflict('备份任务在准备期间发生变化。')
        review, error = capture_review()
        if review: job['review'] = review
        if error: job['review_error'] = error
        data['saved_job'] = job
    saved_ledger(root, prepare)
    def commit_message(statistics, patch):
        message = 'backup(paper): 自动备份 ' + ', '.join(selected[:3]) + (' 等' if len(selected) > 3 else '')
        message += '\n\n时间：' + stamp + '\n触发：' + trigger + '\n文件：\n' + '\n'.join('- ' + n for n in selected)
        message += '\n\n变更统计：\n' + (statistics or '见提交差异')
        locations = [line[1:] for line in patch.splitlines()
                     if re.match(r'^\+\s*\\(?:part|chapter|(?:sub)*section|label)\*?\{', line)]
        if locations:
            message += '\n\n变更中的章节与标签：\n' + '\n'.join(locations)
        return message + '\n\nTeXScholar-Saved-Checkpoint: ' + token
    message = commit_message(stats, diff)
    sanitized = bool(requested_new.intersection(selected)) or any(files[name] != originals[name] for name in selected)
    if sanitized:
        gitdir = Path(git('rev-parse', '--absolute-git-dir').decode().strip())
        if gitdir.is_symlink() or gitdir.is_junction() or gitdir.resolve() != gitdir:
            raise Conflict('Git 元数据目录不是核实的普通目录。')
        index, lock = gitdir / 'index', gitdir / 'index.lock'
        if index.is_symlink() or index.is_junction() or not index.is_file():
            raise Conflict('Git index 不是现存普通文件。')
        original_index = index.read_bytes()
        stream = lock.open('xb'); identity = os.fstat(stream.fileno()); committed = False
        try:
            stream.write(original_index); stream.flush(); os.fsync(stream.fileno()); stream.close()
            if index.read_bytes() != original_index or git('ls-files', '--stage', '-z') != staged_before:
                raise Conflict('暂存区已变化，停止自动备份。')
            private_dir = root / '.codex-review'
            if private_dir.is_symlink() or private_dir.is_junction():
                raise Conflict('审核目录不能是链接。')
            private_dir.mkdir(exist_ok=True)
            private = private_dir / 'automatic-index'
            if private.is_symlink() or private.is_junction():
                raise Conflict('自动备份索引不能是链接。')
            private_env = {'GIT_INDEX_FILE': str(private)}
            git('read-tree', parent, extra=private_env)
            for name in selected:
                if expected[name] is None:
                    git('update-index', '--force-remove', '--', name, extra=private_env)
                else:
                    oid = git('hash-object', '-w', '--path=' + name, '--stdin', data=files[name]).decode().strip()
                    if oid != expected[name]:
                        raise Conflict('备份内容在准备期间变化：' + name)
                    git('update-index', '--add', '--cacheinfo', modes[name], oid, name, extra=private_env)
            clean_stats = git('diff', '--cached', '--numstat', '--', *selected, extra=private_env).decode('utf-8', 'replace').strip()
            clean_diff = git('diff', '--cached', '--no-ext-diff', '--unified=0', '--', *selected, extra=private_env).decode('utf-8', 'replace')
            message = commit_message(clean_stats, clean_diff)
            unchanged()
            if git('rev-parse', 'HEAD').decode().strip() != parent:
                raise Conflict('提交前 HEAD 已变化。')
            git('commit', '-m', message, extra=private_env); committed = True
            # Reuse Git's own index update on the locked copy; only selected
            # entries change, preserving every unrelated staged entry.
            lock_env = {'GIT_INDEX_FILE': str(lock)}
            for name in selected:
                if expected[name] is None:
                    git('update-index', '--force-remove', '--', name, extra=lock_env)
                else:
                    git('update-index', '--add', '--cacheinfo', modes[name], expected[name], name, extra=lock_env)
            if index.read_bytes() != original_index:
                raise Conflict('提交期间暂存区变化；保留锁供核对，未推送。')
            os.replace(lock, index)
        finally:
            if not stream.closed:
                stream.close()
            if not committed and lock.exists():
                prior = Path.cwd()
                try:
                    os.chdir(gitdir); current = Path('./index.lock').lstat()
                    if Path.cwd().resolve() != gitdir or not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
                        raise Conflict('Git 锁身份变化，停止释放。')
                    Path('./index.lock').unlink()
                finally:
                    os.chdir(prior)
    else:
        unchanged()
        if git('ls-files', '--stage', '-z') != staged_before:
            raise Conflict('提交前暂存区已变化；未创建备份。')
        git('commit', '--only', '-m', message, '--', *selected)
    commit = git('rev-parse', 'HEAD').decode().strip()
    if git('rev-parse', 'HEAD^').decode().strip() != parent:
        raise Conflict('提交父版本已变化；未推送：' + commit)
    changed = set(git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).decode().split('\0')) - {''}
    if changed != set(selected):
        raise Conflict('Git hook 改变了提交范围；未推送：' + commit)
    for name, oid in expected.items():
        rows = git('ls-tree', '-z', commit, '--', name).split(b'\0')
        actual = next((e.split(b' ', 2)[2].split(b'\t', 1)[0].decode() for e in rows if e), None)
        if actual != oid:
            raise Conflict('Git 提交内容与已保存版本不同，未推送：' + name + '；提交 ' + commit)
    after = git('ls-files', '--stage', '-z').split(b'\0')
    if sorted(row for row in after if row and row.split(b'\t', 1)[1].decode('utf-8') not in selected) != outside:
        raise Conflict('范围外暂存内容发生变化，未推送；请核对提交 ' + commit)
    saved_update(root, {'token':token, 'commit':commit})
    return {'commit': commit, 'parent': parent, 'files': selected, 'token':token}


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
        if index.read_bytes() != original:
            raise Conflict('暂存区刚发生变化，后台备份已停止；暂存选择保留')
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
        # Preserve the author's original index and update only committed paths.
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())
        stream.close()
        lock_env = {**r.env, 'GIT_INDEX_FILE': str(lock)}
        for name, oid in expected.items():
            mode = git('ls-tree', head, '--', name).decode().split()[0]
            result = subprocess.run([r.git_exe, 'update-index', '--add', '--cacheinfo', mode, oid, name],
                                    cwd=r.repo, env=lock_env, capture_output=True)
            if result.returncode:
                raise Conflict(result.stderr.decode('utf-8', 'replace').strip() or '暂存区更新失败')
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
    parser.add_argument('--state')
    parser.add_argument('--git', default='git')
    parser.add_argument('--storage')
    parser.add_argument('operation', choices=['status', 'prepare', 'local', 'update', 'saved-local', 'saved-status', 'saved-update', 'saved-event'])
    args = parser.parse_args()
    if args.operation in ('saved-local', 'saved-status', 'saved-update', 'saved-event'):
        root = Path(args.project).resolve(strict=True)
        result = (saved_commit(root, args.git, json.load(sys.stdin), args.storage) if args.operation == 'saved-local' else
                  saved_recover(root, args.git) if args.operation == 'saved-status' else
                  saved_event(root, json.load(sys.stdin)) if args.operation == 'saved-event' else saved_update(root, json.load(sys.stdin), args.git))
        print(json.dumps(result, ensure_ascii=False))
        return
    if not args.state:
        raise Conflict('旧备份操作需要明确审核状态。')
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
