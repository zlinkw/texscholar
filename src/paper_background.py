"""Local paper background, bound to a registered project and review owner."""
from pathlib import Path
from contextlib import closing
import json
import hashlib
import os
import sqlite3
import uuid

KINDS = {'background', 'method', 'data', 'constraints', 'other'}
EVIDENCE = {'author', 'source', 'unconfirmed'}


def candidate_entry_digest(entry):
    """Bind an approval to the exact paper entry seen at acceptance."""
    return hashlib.sha256(json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()


def identity(root, owner):
    root = Path(root).resolve(strict=True)
    if not isinstance(owner, str) or not owner or '\\' in owner:
        raise ValueError('Provide the exact project-relative review owner')
    candidate = (root / owner).resolve()
    if candidate == root or not candidate.is_relative_to(root):
        raise ValueError('Review owner must remain inside the project')
    return os.path.normcase(str(root)), candidate.relative_to(root).as_posix()


def connect(storage):
    storage = Path(storage)
    storage.mkdir(parents=True, exist_ok=True)
    if storage.is_symlink() or storage.is_junction() or not storage.is_dir():
        raise ValueError('Background storage is not a regular directory')
    database = storage / 'paper-background.sqlite3'
    if database.is_symlink() or database.is_junction() or database.exists() and not database.is_file():
        raise ValueError('Background database is not a regular file')
    db = sqlite3.connect(database)
    db.execute('PRAGMA journal_mode=PERSIST')
    db.execute('CREATE TABLE IF NOT EXISTS papers (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, entries TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS aliases (root TEXT NOT NULL, owner TEXT NOT NULL, paper_id INTEGER NOT NULL REFERENCES papers(id), PRIMARY KEY(root, owner))')
    db.execute('CREATE TABLE IF NOT EXISTS personal (slot INTEGER PRIMARY KEY CHECK(slot=1), profile_id TEXT NOT NULL, revision INTEGER NOT NULL, entries TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS paper_roles (paper_id INTEGER PRIMARY KEY REFERENCES papers(id), revision INTEGER NOT NULL, record TEXT NOT NULL)')
    return db


def _paper_for_root(db, project):
    rows = db.execute('SELECT DISTINCT paper_id FROM aliases WHERE root=?', (project,)).fetchall()
    if len(rows) > 1:
        raise ValueError('当前项目关联了多份论文资料，请先核对身份；未选择角色登记。')
    return rows[0][0] if rows else None


def read_roles(storage, root):
    project = os.path.normcase(str(Path(root).resolve(strict=True)))
    database = Path(storage) / 'paper-background.sqlite3'
    if not database.exists() and not database.is_symlink():
        return {'revision': 0, 'record': None}
    if database.is_symlink() or database.is_junction() or not database.is_file():
        raise ValueError('Background database is not a regular file')
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        paper = _paper_for_root(db, project)
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_roles'").fetchone():
            return {'revision': 0, 'record': None}
        row = db.execute('SELECT revision,record FROM paper_roles WHERE paper_id=?', (paper,)).fetchone() if paper else None
    return {'revision': row[0] if row else 0, 'record': json.loads(row[1]) if row else None}


def write_roles(storage, root, review_owner, revision, record):
    project, owner = identity(root, review_owner)
    if type(revision) is not int or revision < 0 or not isinstance(record, dict) or set(record) != {'owner', 'files', 'structure'}:
        raise ValueError('请提供当前角色版本与完整角色登记。')
    if not isinstance(record['owner'], str) or not record['owner'] or not isinstance(record['files'], list) or not isinstance(record['structure'], list):
        raise ValueError('角色登记缺少拥有文件或结构。')
    with closing(connect(storage)) as db:
        with db:
            db.execute('BEGIN IMMEDIATE')
            paper = _paper_for_root(db, project)
            if paper is None:
                paper = db.execute('INSERT INTO papers(revision,entries) VALUES(0,?)', ('[]',)).lastrowid
                db.execute('INSERT INTO aliases(root,owner,paper_id) VALUES(?,?,?)', (project, owner, paper))
            elif not db.execute('SELECT 1 FROM aliases WHERE root=? AND owner=? AND paper_id=?', (project, owner, paper)).fetchone():
                raise ValueError('该项目已有论文资料，但审核归属未明确关联；请先核对并显式关联。')
            row = db.execute('SELECT revision,record FROM paper_roles WHERE paper_id=?', (paper,)).fetchone()
            if (row[0] if row else 0) != revision:
                raise ValueError('文件角色已变化，请重新读取后确认；未覆盖。')
            if row and json.loads(row[1])['owner'] != record['owner']:
                raise ValueError('已有角色登记保留原拥有文件；不能自动搬迁。')
            db.execute('INSERT INTO paper_roles(paper_id,revision,record) VALUES(?,?,?) ON CONFLICT(paper_id) DO UPDATE SET revision=excluded.revision,record=excluded.record',
                       (paper, revision + 1, json.dumps(record, ensure_ascii=False)))
    return read_roles(storage, root)


def read(storage, root, owner):
    project, owner = identity(root, owner)
    database = Path(storage) / 'paper-background.sqlite3'
    if not database.exists() and not database.is_symlink():
        row = None
    else:
        with closing(connect(storage)) as db:
            row = db.execute('SELECT p.revision, p.entries FROM papers p JOIN aliases a ON a.paper_id=p.id WHERE a.root=? AND a.owner=?', (project, owner)).fetchone()
            if row is None and _paper_for_root(db, project) is not None:
                raise ValueError('该项目已有论文资料，但审核归属未明确关联；请先核对并显式关联。')
    entries = json.loads(row[1]) if row else []
    result = {'project': project, 'state': owner, 'revision': row[0] if row else 0, 'entries': entries,
              'scope': '本论文资料中作者明确约定按其适用范围执行；背景与待确认事实仅供参考，均不单独构成操作授权。'}
    state_path = Path(root) / owner
    if owner == '.codex-review/state.json' and any(path.is_symlink() or path.is_junction() for path in (state_path.parent, state_path)):
        raise ValueError('审核状态不能通过链接读取。')
    if owner == '.codex-review/state.json' and state_path.is_file():
        raw = state_path.read_bytes()
        state = json.loads(raw)
        approvals = state.get('approved_migration_rules', {})
        if approvals:
            if state.get('transaction'):
                raise ValueError('审核事务尚未完成，不能判断已接收候选的规则状态。')
            if not isinstance(approvals, dict):
                raise ValueError('候选规则确认记录无效。')
            confirmed = []
            for source, approval in approvals.items():
                if not isinstance(approval, dict) or approval.get('source') != source:
                    raise ValueError('候选规则确认身份无效。')
                matches = [entry for entry in entries if entry.get('source') == source]
                confirmed.append({**approval, 'available':len(matches) == 1 and candidate_entry_digest(matches[0]) == approval.get('entry_digest')})
            if state_path.read_bytes() != raw:
                raise ValueError('审核状态读取期间发生变化；请重新读取。')
            with closing(connect(storage)) as db:
                current = db.execute('SELECT p.revision, p.entries FROM papers p JOIN aliases a ON a.paper_id=p.id WHERE a.root=? AND a.owner=?', (project, owner)).fetchone()
            if current != row:
                raise ValueError('论文资料读取期间发生变化；请重新读取。')
            result['accepted_candidate_rules'] = confirmed
    return result


def write(storage, root, owner, revision, entries):
    project, owner = identity(root, owner)
    if type(revision) is not int or revision < 0 or not isinstance(entries, list):
        raise ValueError('Provide current background revision and entries')
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) not in ({'kind', 'text', 'evidence', 'source'}, {'kind', 'text', 'evidence', 'source', 'scope'}) or entry['kind'] not in KINDS or entry['evidence'] not in EVIDENCE or not isinstance(entry['text'], str) or not entry['text'].strip() or not isinstance(entry['source'], str) or ('scope' in entry and not isinstance(entry['scope'], str)):
            raise ValueError('Each entry needs kind, text, evidence and source')
        if entry['evidence'] == 'source' and not entry['source'].strip():
            raise ValueError('A sourced entry requires its source location')
    with closing(connect(storage)) as db:
        with db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT p.id,p.revision FROM papers p JOIN aliases a ON a.paper_id=p.id WHERE a.root=? AND a.owner=?', (project, owner)).fetchone()
            if (row[1] if row else 0) != revision:
                raise ValueError('论文背景已变化，请重新读取后再保存；未覆盖。')
            if row:
                db.execute('UPDATE papers SET revision=?,entries=? WHERE id=?', (revision + 1, json.dumps(entries, ensure_ascii=False), row[0]))
            else:
                if _paper_for_root(db, project) is not None:
                    raise ValueError('该项目已有论文资料，但审核归属未明确关联；请先核对并显式关联。')
                paper = db.execute('INSERT INTO papers(revision,entries) VALUES(?,?)', (revision + 1, json.dumps(entries, ensure_ascii=False))).lastrowid
                db.execute('INSERT INTO aliases(root,owner,paper_id) VALUES(?,?,?)', (project, owner, paper))
    return read(storage, root, owner)


def aliases(storage):
    if not (Path(storage) / 'paper-background.sqlite3').exists():
        return []
    with closing(connect(storage)) as db:
        return [{'project':root, 'state':owner, 'revision':revision} for root, owner, revision in db.execute(
            'SELECT a.root,a.owner,p.revision FROM aliases a JOIN papers p ON p.id=a.paper_id ORDER BY a.root,a.owner')]


def read_personal(storage):
    if not (Path(storage) / 'paper-background.sqlite3').exists():
        row = None
    else:
        with closing(connect(storage)) as db:
            row = db.execute('SELECT profile_id,revision,entries FROM personal WHERE slot=1').fetchone()
    return {'profile_id':row[0] if row else None, 'revision':row[1] if row else 0, 'entries':json.loads(row[2]) if row else [],
            'scope':'当前用户跨论文的个性化增量，不能放宽事实和安全边界，不是操作授权。'}


def write_personal(storage, profile_id, revision, entries):
    if type(revision) is not int or revision < 0 or not isinstance(entries, list):
        raise ValueError('Provide the current profile revision and entries')
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'category','text','enabled'} or entry['category'] not in {'writing','response','review','other'} or not isinstance(entry['text'],str) or not entry['text'].strip() or type(entry['enabled']) is not bool:
            raise ValueError('Each personal entry needs category, text and enabled')
    with closing(connect(storage)) as db:
        with db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT profile_id,revision FROM personal WHERE slot=1').fetchone()
            if (row[0] if row else None) != profile_id or (row[1] if row else 0) != revision:
                raise ValueError('个人提示词已变化，请重新读取后再保存；未覆盖。')
            profile_id = row[0] if row else uuid.uuid4().hex
            db.execute('INSERT INTO personal(slot,profile_id,revision,entries) VALUES(1,?,?,?) ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,entries=excluded.entries',
                       (profile_id,revision+1,json.dumps(entries,ensure_ascii=False)))
    return read_personal(storage)


def link(storage, root, owner, source, revision):
    project, owner = identity(root, owner)
    if not isinstance(source, dict) or set(source) != {'project','state'} or type(revision) is not int:
        raise ValueError('请选择明确的原论文和版本')
    with closing(connect(storage)) as db:
        with db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM aliases WHERE root=? AND owner=?', (project,owner)).fetchone():
                raise ValueError('当前论文已有背景；未覆盖。')
            row = db.execute('SELECT p.id,p.revision FROM papers p JOIN aliases a ON a.paper_id=p.id WHERE a.root=? AND a.owner=?', (source['project'],source['state'])).fetchone()
            if not row or row[1] != revision:
                raise ValueError('原论文背景已变化，请重新选择。')
            existing = _paper_for_root(db, project)
            if existing is not None and existing != row[0]:
                raise ValueError('当前项目已关联其他论文资料；未覆盖或合并。')
            db.execute('INSERT INTO aliases(root,owner,paper_id) VALUES(?,?,?)', (project,owner,row[0]))
    return read(storage,root,owner)


if __name__ == '__main__':
    import argparse
    import sys
    from mcp_server import Server
    parser = argparse.ArgumentParser()
    parser.add_argument('--registrations', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('action', choices=['read', 'write', 'list', 'link', 'read-personal', 'write-personal'])
    args = parser.parse_args()
    try:
        server = Server(args.registrations)
        if args.action in ('read-personal','write-personal'):
            server.project(args.project)
            result = read_personal(server.registrations.parent) if args.action == 'read-personal' else write_personal(server.registrations.parent, **json.load(sys.stdin))
            print(json.dumps(result,ensure_ascii=False))
            sys.exit(0)
        root, _ = server.project(args.project)
        from document_roles import scan
        state = scan(root, server.registrations.parent)['review_owner']
        if state is None:
            raise ValueError('审核状态归属不唯一，请先核对。')
        base = {'project':args.project, 'state':state}
        if args.action == 'read':
            project, _ = identity(args.project, state)
            current_aliases = [item for item in aliases(server.registrations.parent) if item['project'] == project]
            if current_aliases and not any(item['state'] == state for item in current_aliases):
                result = {'project':project, 'state':state, 'unlinked':True, 'revision':0, 'entries':[]}
            else:
                result = server.call('read_paper_background', base)
            result['personal_prompts'] = read_personal(server.registrations.parent)
        elif args.action == 'list':
            result = {'state':state, 'choices':aliases(server.registrations.parent)}
        elif args.action == 'link':
            spec = json.load(sys.stdin)
            if spec['state'] != state:
                raise ValueError('论文状态归属已变化，未关联背景。')
            result = link(server.registrations.parent, args.project, state, spec['source'], spec['revision'])
        else:
            spec = json.load(sys.stdin)
            if spec['state'] != state:
                raise ValueError('论文状态归属已变化，未保存背景。')
            result = server.call('write_paper_background', {**base, 'revision':spec['revision'], 'entries':spec['entries']})
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
