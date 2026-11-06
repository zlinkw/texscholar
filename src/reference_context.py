"""Read explicit local TeX labels/macros and BibTeX keys, without compiling or guessing."""
from pathlib import PurePosixPath
import re
from source_review import Conflict, FieldConflict, body
from ai_context import paragraph_context
from review_pdf import _command, _environment_end


def source_path(root, name):
    if not isinstance(name, str) or not name or any(c in name for c in '\\\x00\r\n:'):
        raise FieldConflict('references.files', 'Use project-relative UTF-8 source paths with /')
    rel = PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts or str(rel) != name or rel.suffix.lower() not in {'.tex', '.bib', '.sty', '.cls'}:
        raise FieldConflict('references.files', 'Only project-local .tex/.bib/.sty/.cls sources are supported')
    if any(p in {'.git', '.codex-review', '.latex-build', 'node_modules', 'clean_dir'} for p in rel.parts):
        raise FieldConflict('references.files', 'Generated or runtime directories are not reference sources')
    target = root / name
    for p in [target, *target.parents]:
        if p == root:
            break
        if p.is_symlink() or p.is_junction():
            raise Conflict('Reference source must not be a symlink or junction: ' + name)
    if not target.is_file() or not target.resolve().is_relative_to(root):
        raise Conflict('Reference source is missing or outside the project: ' + name)
    return target


def group_end(text, start, opening='{', closing='}', comments=True):
    if start >= len(text) or text[start] != opening:
        raise Conflict('Expected a literal balanced argument in reference source')
    depth, braces, quote, at = 1, 0, False, start + 1
    while at < len(text):
        char = text[at]
        if char == '\\':
            _, at = _command(text, at)
            continue
        if char == '%' and not quote and comments:
            end = text.find('\n', at)
            at = len(text) if end < 0 else end + 1
            continue
        if opening != '{':
            if char == '{': braces += 1
            elif char == '}': braces -= 1
            elif opening == '(' and char == '"' and braces == 0: quote = not quote
        if not quote and braces == 0:
            if char == opening: depth += 1
            elif char == closing:
                depth -= 1
                if depth == 0: return at + 1
        at += 1
    raise Conflict('Unclosed reference argument; source was not changed')


def commands(text):
    at = 0
    while at < len(text):
        if text[at] == '%':
            end = text.find('\n', at)
            at = len(text) if end < 0 else end + 1
        elif text[at] == '\\':
            if re.match(r'\\begin\{(?:verbatim\*?|lstlisting|minted)\}', text[at:]):
                at = _environment_end(text, at)
                continue
            token, end = _command(text, at)
            if token not in (r'\verb', r'\verb*'):
                yield token.rstrip('*'), at, end
            at = end
        else:
            at += 1


def skip_space(text, at):
    while at < len(text):
        if text[at].isspace(): at += 1
        elif text[at] == '%':
            end = text.find('\n', at)
            at = len(text) if end < 0 else end + 1
        else: break
    return at


def tex_hits(text, kind, key):
    for token, start, end in commands(text):
        at = skip_space(text, end)
        if kind == 'label' and token == r'\label' and at < len(text) and text[at] == '{':
            stop = group_end(text, at)
            if text[at + 1:stop - 1] == key:
                a, b = paragraph_context(text, start, stop)
                yield a, b, start, stop
        elif kind == 'macro' and token in {r'\newcommand', r'\renewcommand', r'\providecommand', r'\DeclareRobustCommand',
                r'\def', r'\gdef', r'\edef', r'\xdef', r'\NewDocumentCommand', r'\RenewDocumentCommand', r'\ProvideDocumentCommand', r'\DeclareDocumentCommand'}:
            if at < len(text) and text[at] == '{':
                stop = group_end(text, at)
                name, at = text[at + 1:stop - 1].strip(), stop
            else:
                name, at = _command(text, at)
            if name != key: continue
            at = skip_space(text, at)
            if token.endswith('def'):
                while at < len(text) and text[at] != '{': at += 1
            else:
                while at < len(text) and text[at] == '[':
                    at = skip_space(text, group_end(text, at, '[', ']'))
                if token.endswith('DocumentCommand'):
                    at = skip_space(text, group_end(text, at))
            stop = group_end(text, at)
            yield start, stop, start, stop


def bib_hits(text, key):
    at = 0
    while at < len(text):
        if text[at] == '%':
            end = text.find('\n', at)
            at = len(text) if end < 0 else end + 1
            continue
        match = re.match(r'@([A-Za-z]+)\s*([({])', text[at:])
        if not match:
            at += 1
            continue
        start = at
        opening = match[2]
        argument = at + match.end() - 1
        end = group_end(text, argument, opening, ')' if opening == '(' else '}', comments=False)
        entry_key = re.match(r'\s*([^\s,{}()]+)\s*,', text[argument + 1:end - 1])
        if match[1].lower() not in {'comment', 'string', 'preamble'} and entry_key and entry_key[1] == key:
            yield start, end, start, end
        at = end


def read_references(root, requests):
    if not isinstance(requests, list):
        raise FieldConflict('references', 'references must be an array of explicit kind/key/files requests')
    sources, originals, paths, results = {}, {}, {}, []
    for index, request in enumerate(requests):
        if not isinstance(request, dict) or request.get('kind') not in {'label', 'citation', 'macro'} or not isinstance(request.get('key'), str) or not request['key'].strip():
            raise FieldConflict(f'references[{index}]', 'Specify label, citation or macro and an exact key')
        files = request.get('files')
        if not isinstance(files, list) or not files or any(not isinstance(f, str) for f in files):
            raise FieldConflict(f'references[{index}].files', 'Name the source files explicitly; no whole-project search or guessed source')
        kind, key, matches = request['kind'], request['key'], []
        if kind == 'macro' and not re.fullmatch(r'\\[A-Za-z@]+', key):
            raise FieldConflict(f'references[{index}].key', 'Use an exact macro name such as \\methodname')
        for file in dict.fromkeys(files):
            if file not in sources:
                path = source_path(root, file)
                paths[file] = path
                originals[file] = path.read_bytes()
                sources[file] = body(originals[file].decode('utf-8-sig')) if path.suffix.lower() != '.bib' else originals[file].decode('utf-8-sig')
            text = sources[file]
            if kind == 'citation' and paths[file].suffix.lower() != '.bib':
                raise FieldConflict(f'references[{index}].files', 'Citation keys require explicit .bib sources')
            if kind != 'citation' and paths[file].suffix.lower() == '.bib':
                raise FieldConflict(f'references[{index}].files', 'Labels and macros require TeX source files')
            hits = bib_hits(text, key) if kind == 'citation' else tex_hits(text, kind, key)
            for a, b, start, end in hits:
                matches.append({'file': file, 'start': a, 'end': b, 'text': text[a:b], 'match_start': start, 'match_end': end})
        results.append({'kind': kind, 'key': key, 'status': 'found' if len(matches) == 1 else 'missing' if not matches else 'ambiguous',
                        'matches': matches, 'scope': 'Literal source definitions only; no TeX expansion, citation verification or automatic association.'})
    if any(paths[file].read_bytes() != raw for file, raw in originals.items()):
        raise Conflict('Reference source changed during reading; reread the explicit references')
    return results
