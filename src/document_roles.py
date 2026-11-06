"""Discover TeX structure and share an author-confirmed, comment-only file map."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import re
import sys
import uuid

BEGIN = '% CODEX-FILE-ROLES-BEGIN'
END = '% CODEX-FILE-ROLES-END'
ROLES = {'manuscript', 'chapter', 'response', 'review', 'template', 'other'}
EXCLUDE = {'.git', '.codex-review', '.latex-build', 'node_modules', 'clean_dir'}


class RoleError(ValueError):
    pass


def relative_file(root, name):
    if not isinstance(name, str) or not name or '\\' in name or '\x00' in name or '\n' in name or '\r' in name:
        raise RoleError('文件角色路径须为项目内、使用 / 的相对 .tex 路径。')
    rel = PurePosixPath(name)
    if rel.is_absolute() or ':' in name or '..' in rel.parts or str(rel) != name or rel.suffix.lower() != '.tex':
        raise RoleError('文件角色路径不能越出项目或指向非 .tex 文件。')
    target = root / name
    for part in [target, *target.parents]:
        if part == root:
            break
        if part.is_symlink() or part.is_junction():
            raise RoleError('文件角色目标或其父目录不能是链接：' + name)
    if not target.is_file() or not target.resolve().is_relative_to(root):
        raise RoleError('文件角色目标不存在或不在项目内：' + name)
    return target


def block_span(text):
    starts = list(re.finditer(r'^' + re.escape(BEGIN) + r'\r?$', text, re.M))
    ends = list(re.finditer(r'^' + re.escape(END) + r'\r?$(?:\n)?', text, re.M))
    if not starts and not ends:
        return None
    if len(starts) != 1 or len(ends) != 1 or ends[0].start() < starts[0].end():
        raise RoleError('文件角色注释块不完整或重复，请先核对，不会覆盖。')
    a, b = starts[0].start(), ends[0].end()
    if any(line.strip() and not line.lstrip().startswith('%') for line in text[:a].splitlines()):
        raise RoleError('文件角色登记必须位于文件顶部注释区。')
    if any(not line.startswith('%') for line in text[a:b].splitlines()):
        raise RoleError('文件角色块只能包含 LaTeX 注释。')
    return a, b


def parse_block(text):
    span = block_span(text)
    if not span:
        return None
    lines = text[span[0]:span[1]].splitlines()[1:-1]
    value = json.loads('\n'.join(line[1:].lstrip() for line in lines))
    if not isinstance(value, dict) or value.get('schema') != 1 or not isinstance(value.get('files'), list) or not isinstance(value.get('structure'), list):
        raise RoleError('文件角色登记格式或版本无效。')
    for fact in value['structure']:
        if not isinstance(fact, dict) or set(fact) != {'file', 'documentclass', 'includes', 'tex_root', 'unresolved'} or not isinstance(fact['file'], str) or any(
            not isinstance(fact[key], list) or any(not isinstance(item, str) for item in fact[key]) for key in ('documentclass', 'includes', 'tex_root', 'unresolved')):
            raise RoleError('文件角色结构快照无效，请核对顶部登记。')
    return value


def without_block(text):
    span = block_span(text)
    return text[:span[0]] + text[span[1]:] if span else text


def replace_block(text, block):
    span = block_span(text)
    if span:
        return text[:span[0]] + block + text[span[1]:]
    prefix = re.match(r'(?:(?:%\s*!(?:TeX|BIB)\b[^\r\n]*|%&[^\r\n]*)\r?\n)*', text, re.I)[0]
    return prefix + block + text[len(prefix):]


def plain_tex(text):
    # Skip comments and literal verbatim regions before recognizing TeX commands.
    text = re.sub(r'\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}', '', text)
    text = re.sub(r'\\verb\*?([^\w\s])[^\n]*?\1', '', text)
    return '\n'.join(
        re.split(r'(?<!\\)(?:\\\\)*%', line, maxsplit=1)[0] for line in text.splitlines())


def structure(root, rel, text, names):
    plain = plain_tex(text)
    classes = re.findall(r'\\documentclass\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}', plain)
    magic = re.search(r'^\s*%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$', text, re.I | re.M)
    refs = re.findall(r'\\(?:input|include|subfile)\s*(?:\{([^{}]+)\}|([^\s{}%]+))', plain)
    imports = re.findall(r'\\(?:subimport|import)\s*\{([^{}]*)\}\s*\{([^{}]+)\}', plain)
    refs = [a or b for a, b in refs] + [a + b for a, b in imports]
    included, unresolved = set(), set()
    def targets(name):
        if re.search(r'[\\#$]', name):
            return []
        name = name.strip()
        if not PurePosixPath(name).suffix:
            name += '.tex'
        choices = [(root / rel).parent / name, root / name]
        return sorted({p.resolve().relative_to(root).as_posix() for p in choices
                       if p.resolve().is_relative_to(root) and p.resolve().relative_to(root).as_posix() in names})
    for name in refs:
        matches = targets(name)
        included.update(matches)
        if len(matches) != 1:
            unresolved.add(name)
    roots = targets(magic[1]) if magic else []
    return {'file': rel, 'documentclass': classes, 'includes': sorted(included),
            'tex_root': roots, 'unresolved': sorted(unresolved | ({'!TeX root: ' + magic[1]} if magic and len(roots) != 1 else set()))}


def infer(text, rel, fact, parents):
    plain = plain_tex(text)
    reasons = []
    response = bool(re.search(r'\\(?:response|Qmixed)\b|(?:we\s+)?thank(?:s)?\s+(?:the\s+)?reviewer|thank\s+you\s+for\s+(?:the\s+)?(?:comment|suggestion)|response\s+to\s+(?:the\s+)?reviewers|回复审稿', plain, re.I)
                    or re.search(r'^\s*%\s*CODEX-RESPONSE\b', text, re.M))
    review = bool(re.search(r'reviewer\s*(?:#?\s*\d|comments)|审稿(?:意见|人)|major\s+comments|minor\s+comments', plain, re.I)
                  or re.search(r'^\s*%\s*CODEX-QUESTION\b', text, re.M))
    template = bool(re.search(r'(?:template|example|sample|模板)', rel, re.I))
    if template:
        roles = ['template']; reasons.append('文件名有模板／示例线索，需确认是否只是参考资料')
    elif response:
        roles = ['response'] + (['review'] if review else []); reasons.append('内容含回复审稿人的结构或措辞')
    elif review:
        roles = ['review']; reasons.append('内容含原始审稿意见标记')
    elif fact['documentclass']:
        roles = ['manuscript']; reasons.append('存在有效 documentclass，可作为独立编译入口')
    elif parents:
        roles = ['chapter']; reasons.append('由其他 TeX 文档 input／include 引用')
    elif re.search(r'\\(?:section|chapter|subsection)\b', plain):
        roles = ['chapter']; reasons.append('包含章节结构，但未找到唯一编译入口')
    else:
        roles = ['other']; reasons.append('缺少可靠用途线索，请选择角色')
    possible = fact['tex_root'] or ([rel] if fact['documentclass'] else parents)
    return {'file': rel, 'roles': roles, 'root': possible[0] if len(possible) == 1 else None,
            'root_choices': possible, 'reason': '；'.join(reasons)}


def scan(project):
    root = Path(project).resolve(strict=True)
    texts, owners = {}, []
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(f for f in folders if f not in EXCLUDE and not Path(directory, f).is_symlink() and not Path(directory, f).is_junction())
        for name in sorted(files):
            file = Path(directory, name)
            if file.suffix.lower() != '.tex' or file.is_symlink() or file.is_junction():
                continue
            rel = file.relative_to(root).as_posix()
            text = file.read_text(encoding='utf-8-sig')
            texts[rel] = text
            value = parse_block(text)
            if value is not None:
                owners.append((rel, value))
    if len(owners) > 1:
        raise RoleError('项目存在多份文件角色登记，请保留一个明确拥有文件后再确认。')
    facts = [structure(root, rel, text, texts) for rel, text in texts.items()]
    by_file = {f['file']: f for f in facts}
    roots = [f['file'] for f in facts if f['documentclass']]
    def contains(entry, file, seen=None):
        seen = set() if seen is None else seen
        if entry == file:
            return True
        if entry in seen:
            return False
        seen.add(entry)
        return any(contains(child, file, seen) for child in by_file[entry]['includes'])
    suggested = [infer(text, rel, by_file[rel], [r for r in roots if contains(r, rel)]) for rel, text in texts.items()]
    owner, saved = owners[0] if owners else (None, None)
    expected = saved.get('structure') if saved else None
    changed = expected != facts
    entries = saved['files'] if saved else []
    validate_entries(entries, by_file, allow_missing=changed)
    return {'status': 'changed' if saved and changed else 'confirmed' if saved else 'unconfirmed',
            'owner': owner, 'files': entries, 'structure': facts, 'suggested': suggested,
            'roots': roots, 'changes': [f for f in sorted(set(by_file) | {f['file'] for f in expected or []})
                                      if next((x for x in expected or [] if x['file'] == f), None) != by_file.get(f)]}


def validate_entries(entries, facts, allow_missing=False):
    if not isinstance(entries, list):
        raise RoleError('文件角色登记必须是数组。')
    seen = set()
    for item in entries:
        if not isinstance(item, dict) or set(item) != {'file', 'roles', 'root'}:
            raise RoleError('每项需要 file、roles、root。')
        name, roles, entry = item['file'], item['roles'], item['root']
        if not isinstance(name, str) or name in seen or not isinstance(roles, list) or not roles or any(not isinstance(r, str) or r not in ROLES for r in roles) or len(set(roles)) != len(roles) or entry is not None and not isinstance(entry, str):
            raise RoleError('文件角色有重复文件或无效角色。')
        seen.add(name)
        if allow_missing:
            continue
        if name not in facts or entry is not None and (entry not in facts or not facts[entry]['documentclass']):
            raise RoleError('登记文件或所选编译入口不存在／不可独立编译：' + name)
    if not allow_missing and seen != set(facts):
        raise RoleError('请逐项确认当前项目的全部 TeX 文件。')


def save(project, spec):
    # Same lock as review candidates/checkpoints; no review state is initialized.
    from source_review import writer_lock_at
    root = Path(project).resolve(strict=True)
    with writer_lock_at(root / '.codex-review'):
        current = scan(root)
        if current['structure'] != spec['structure'] or current['owner'] != spec.get('previous_owner') or current['files'] != spec['previous_files']:
            raise RoleError('确认期间文件或编译关系变化，请重新读取后确认；未写入。')
        owner = spec['owner']
        if current['owner'] and current['owner'] != owner:
            raise RoleError('已有登记保留原拥有文件；请勿自动另建第二份。')
        path = relative_file(root, owner)
        facts = {f['file']: f for f in current['structure']}
        entries = spec['files']
        validate_entries(entries, facts)
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != spec['owner_sha256']:
            raise RoleError('拥有文件已改变，请重新确认；未覆盖手动编辑。')
        text = raw.decode('utf-8-sig')
        eol = '\r\n' if '\r\n' in text else '\n'
        rows = ['{', '  "schema": 1,', '  "files": [',
                *['    ' + json.dumps(entry, ensure_ascii=False) + (',' if i < len(entries) - 1 else '') for i, entry in enumerate(entries)],
                '  ],', '  "structure": [',
                *['    ' + json.dumps(fact, ensure_ascii=False) + (',' if i < len(current['structure']) - 1 else '') for i, fact in enumerate(current['structure'])], '  ]', '}']
        block = eol.join([BEGIN, *['% ' + row for row in rows], END]) + eol
        result = replace_block(text, block)
        if not path.stat().st_mode & 0o200:
            raise RoleError('拥有文件只读，未写入。')
        updated = (b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + result.encode('utf-8')
        temporary = path.with_name(path.name + '.roles-write-' + uuid.uuid4().hex)
        with temporary.open('xb') as stream:
            stream.write(updated)
        if path.read_bytes() != raw:
            raise RoleError('写入期间源文件改变，已停止覆盖；临时文件保留：' + str(temporary))
        os.replace(temporary, path)
        return {'owner': owner, 'saved': True, 'files': entries}


def selected_root(project, file):
    result = scan(project)
    if result['status'] != 'confirmed':
        return {'status': result['status'], 'root': None}
    entry = next((f for f in result['files'] if f['file'] == file), None)
    return {'status': 'confirmed', 'root': entry['root'] if entry else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('operation', choices=['scan', 'save', 'root'])
    parser.add_argument('--file')
    args = parser.parse_args()
    result = save(args.project, json.load(sys.stdin)) if args.operation == 'save' else selected_root(args.project, args.file) if args.operation == 'root' else scan(args.project)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
