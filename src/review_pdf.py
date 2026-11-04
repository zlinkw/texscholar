"""Read-only PDF snapshot of pending inline revisions, including uncommitted text."""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher

from source_review import Review, PENDING, body, locate, digest

ASSETS = {'.tex', '.bib', '.cls', '.sty', '.bst', '.bbx', '.cbx', '.cfg', '.def', '.fd',
          '.map', '.enc', '.tfm', '.otf', '.ttf', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg', '.ps'}
EXCLUDED = {'.git', '.codex-review', '.latex-build', 'clean_dir', 'node_modules'}

PREVIEW_MACROS = r'''
\usepackage{float}
\makeatletter
\newenvironment{codexreviewold}{%
  \begingroup
  \def\CRrestore{}\def\CRpage{page}%
  \def\@elt##1{\def\CRname{##1}\ifx\CRname\CRpage\else
    \edef\CRrestore{\unexpanded\expandafter{\CRrestore}\noexpand\setcounter{##1}{\number\csname c@##1\endcsname}}\fi}%
  \cl@@ckpt
  \let\label\@gobble
  \def\addcontentsline##1##2##3{}%
  \def\hyper@anchorstart##1{}\def\hyper@anchorend{}%
  \renewcommand{\DIFadd}[1]{{\color{red}\ifmmode ##1\else\sout{##1}\fi}}%
  \renewcommand{\DIFaddFL}[1]{\DIFadd{##1}}%
}{\par\CRrestore\endgroup}
\makeatother
\AtBeginDocument{\renewcommand{\DIFadd}[1]{{\color{blue}#1}}\renewcommand{\DIFaddFL}[1]{\DIFadd{#1}}}
'''

PREVIEW_LEGEND = r'''
\par\smallskip\noindent{\footnotesize
\textbf{Legend:} {\color{red}\sout{old}} = removed/replaced;
{\color{blue}new} = added/rewritten; same = unchanged.
Math may use color without a strike.
Original $\to$ Proposed; Addition only = no corresponding original text.\par}
\smallskip
'''


def with_legend(text):
    # Standard title commands must run before the visible legend (not inside
    # their title material). Ignore commented-out commands when locating one.
    title = re.search(r'(?m)^[ \t]*\\maketitle[ \t]*(?:%[^\r\n]*)?(?:\r?\n|$)', text)
    position = title.end() if title else 0
    return text[:position] + PREVIEW_LEGEND + text[position:]


def command(args, cwd, log):
    env = {k: v for k, v in os.environ.items() if k.upper() not in
           {'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'}}
    env.update(LC_ALL='C', LC_CTYPE='C', LANG='C')
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True)
    log.with_suffix('.stdout.log').write_bytes(result.stdout)
    log.with_suffix('.stderr.log').write_bytes(result.stderr)
    if result.returncode:
        output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
        first_error = next((line.strip() for line in output.splitlines() if line.startswith('! ') or ': LaTeX Error:' in line), '')
        detail = f' {first_error}' if first_error else ''
        raise ValueError(f'审核 PDF 工具失败，退出码 {result.returncode}。{detail}\n完整日志：{log.with_suffix(".stdout.log")}；{log.with_suffix(".stderr.log")}')
    return result.stdout


def paragraph_span(text, start, end):
    """Comparison context only; presentation pairs are independently selected later."""
    begin = text.find(r'\begin{document}')
    stop = text.rfind(r'\end{document}')
    lower = begin + len(r'\begin{document}') if begin >= 0 else 0
    upper = stop if stop >= 0 else len(text)
    if not lower <= start <= end <= upper:
        raise ValueError('该项涉及导言区，原文卡片仍可审核；完整 PDF 的上下对照目前用于正文内容。')
    blanks = list(re.finditer(r'\r?\n[ \t]*\r?\n', text))
    a = max([lower] + [m.end() for m in blanks if lower <= m.end() <= start])
    b = min([upper] + [m.start() for m in blanks if end <= m.start() <= upper])
    # Keep surrounding section headings once when the heading itself is unchanged.
    first = a
    for match in re.finditer(r'(?m)^[ \t]*\\(?:section|subsection|subsubsection|paragraph|subparagraph)\*?[^\n]*\n', text[first:start]):
        a = first + match.end()
    # Blank lines inside an environment do not make a stand-alone TeX fragment.
    stack, pairs = [], []
    for match in re.finditer(r'\\(begin|end)\{([^{}]+)\}', text[lower:upper]):
        position = lower + match.start()
        if match[1] == 'begin':
            stack.append((match[2], position))
        elif stack and stack[-1][0] == match[2]:
            name, first = stack.pop()
            pairs.append((name, first, lower + match.end()))
    for name, first, last in sorted(pairs, key=lambda p: p[2] - p[1]):
        if name in {'document', 'letter'}:
            continue
        if first < a < last or first < b < last:
            a, b = min(a, first), max(b, last)
    return a, b


def delta_fragment(before, after, preamble, source_dir, out, name, latexdiff):
    old, new = source_dir / (name + '-old.tex'), source_dir / (name + '-new.tex')
    for target, text in [(old, before), (new, after)]:
        target.write_text(preamble + '\\begin{document}\n' + text + '\n\\end{document}\n', encoding='utf-8', newline='')
    # Figures already appear in their original/proposed units; only prose needs word markup.
    delta = command([latexdiff, '--encoding=utf8', '--no-del', '--math-markup=3', '--graphics-markup=0', '--config', 'MINWORDSBLOCK=0', str(old), str(new)],
                    source_dir, out / name).decode('utf-8')
    header, marker, rest = delta.partition(r'\begin{document}')
    content, closing, _ = rest.rpartition(r'\end{document}')
    if not marker or not closing:
        raise ValueError('差异工具没有返回完整的 LaTeX 文档，已保留日志。')
    return header, content


def _command(text, position):
    match = re.match(r'\\(?:[A-Za-z@]+\*?|.)', text[position:])
    token = match[0] if match else '\\'
    end = position + len(token)
    if token in (r'\verb', r'\verb*') and end < len(text):
        stop = text.find(text[end], end + 1)
        if stop >= 0:
            end = stop + 1
    return token, end


def _environment_end(text, position):
    """Find one balanced environment, ignoring escaped commands and comments."""
    opening = re.match(r'\\begin\{([^{}]+)\}', text[position:])
    stack = [opening[1]]
    cursor = position + opening.end()
    if opening[1] in {'verbatim', 'verbatim*', 'lstlisting', 'minted'}:
        closing = r'\end{' + opening[1] + '}'
        stop = text.find(closing, cursor)
        if stop < 0:
            raise ValueError('审核 PDF 的比较片段中有未闭合环境：' + opening[1])
        return stop + len(closing)
    while cursor < len(text):
        if text[cursor] == '%':
            newline = text.find('\n', cursor)
            cursor = len(text) if newline < 0 else newline + 1
        elif text[cursor] == '\\':
            boundary = re.match(r'\\(begin|end)\{([^{}]+)\}', text[cursor:])
            if boundary:
                if boundary[1] == 'begin':
                    stack.append(boundary[2])
                elif not stack or stack.pop() != boundary[2]:
                    raise ValueError('审核 PDF 的比较片段中有不匹配环境。')
                cursor += boundary.end()
                if not stack:
                    return cursor
            else:
                _, cursor = _command(text, cursor)
        else:
            cursor += 1
    raise ValueError('审核 PDF 的比较片段中有未闭合环境：' + opening[1])


def sentences(text):
    """Presentation units: prose sentences and adjacent, balanced TeX environments."""
    result, start, depth, math, i = [], 0, 0, None, 0
    while i < len(text):
        char = text[i]
        if char == '%':
            newline = text.find('\n', i)
            i = len(text) if newline < 0 else newline + 1
            continue
        protected_end = None
        if depth == 0 and not math:
            if re.match(r'\\begin\{[^{}]+\}', text[i:]):
                protected_end = _environment_end(text, i)
            elif text.startswith(r'\[', i):
                stop = text.find(r'\]', i + 2)
                if stop < 0:
                    raise ValueError('审核 PDF 的比较片段中有未闭合的显示数学。')
                protected_end = stop + 2
            elif text.startswith('$$', i):
                stop = text.find('$$', i + 2)
                if stop < 0:
                    raise ValueError('审核 PDF 的比较片段中有未闭合的显示数学。')
                protected_end = stop + 2
        if protected_end is not None:
            if start < i:
                result.append(text[start:i])
            end = protected_end
            while end < len(text) and text[end].isspace():
                end += 1
            result.append(text[i:end])
            start, i = end, end
            continue
        if char == '\\':
            token, i = _command(text, i)
            if token in (r'\(', r'\['):
                math = token
            elif token in (r'\)', r'\]'):
                math = None
            continue
        if char == '$':
            token = '$$' if text[i:i + 2] == '$$' else '$'
            math = None if math == token else token
            i += len(token)
            continue
        if not math:
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            if depth == 0 and char in '.!?' and (i + 1 == len(text) or text[i + 1].isspace()):
                prefix = text[start:i + 1]
                abbreviation = re.search(r'(?:\b(?:e\.g|i\.e|et\s+al|Fig|Figs|Eq|Eqs|Sec|Secs|Dr|Mr|Ms|Prof|vs|etc)|\b[A-Z])\.$', prefix, re.I)
                if char != '.' or not abbreviation:
                    end = i + 1
                    while end < len(text) and text[end].isspace():
                        end += 1
                    result.append(text[start:end])
                    start, i = end, end
                    continue
        i += 1
    if start < len(text):
        result.append(text[start:])
    return result


def _unit_spans(text):
    units, offset = [], 0
    for part in sentences(text):
        kind = 'environment' if re.match(r'\\begin\{|\\\[|\$\$', part.lstrip()) else 'prose'
        units.append({'text': part, 'start': offset, 'end': offset + len(part), 'kind': kind})
        offset += len(part)
    return units


def _pair_units(old, new):
    if old and new and len(old) != len(new) and all(unit['kind'] == 'prose' for unit in old + new):
        # A split/merged sentence stays a valid prose pair, never swallowing a display.
        yield old, new
        return
    alignment = SequenceMatcher(None, [u['kind'] for u in old], [u['kind'] for u in new], autojunk=False)
    for kind, a, b, c, d in alignment.get_opcodes():
        if kind == 'equal':
            yield from (([x], [y]) for x, y in zip(old[a:b], new[c:d]))
        else:
            yield from (([x], []) for x in old[a:b])
            yield from (([], [y]) for y in new[c:d])


def _unit_changes(before, after):
    old, new = _unit_spans(before), _unit_spans(after)
    diff = SequenceMatcher(None, [u['text'].strip() for u in old], [u['text'].strip() for u in new], autojunk=False)
    for kind, a, b, c, d in diff.get_opcodes():
        pairs = [(old[a:b], new[c:d])] if kind == 'equal' else _pair_units(old[a:b], new[c:d])
        for first, second in pairs:
            yield {'kind': kind, 'before': ''.join(u['text'] for u in first), 'after': ''.join(u['text'] for u in second),
                   'old_span': (first[0]['start'], first[-1]['end']) if first else None,
                   'new_span': (second[0]['start'], second[-1]['end']) if second else None}


def sentence_changes(before, after):
    for unit in _unit_changes(before, after):
        yield unit['kind'], unit['before'], unit['after']


def review_units(before, edits, offset=0):
    """Anchor each comparison to original content, never align a whole changed paragraph."""
    originals = [(u['start'] + len(u['text']) - len(u['text'].lstrip()),
                  u['end'] - len(u['text']) + len(u['text'].rstrip()))
                 for u in _unit_spans(before) if u['text'].strip()]
    windows = []
    for edit in sorted(edits, key=lambda e: e['start']):
        start, end = edit['start'] - offset, edit['end'] - offset
        touched = [(a, b) for a, b in originals
                   if max(a, start) < min(b, end) or start == end and a < start < b]
        a, b = (touched[0][0], touched[-1][1]) if touched else (start, end)
        # Include the registered span even if it intentionally carries boundary whitespace.
        a, b = min(a, start), max(b, end)
        if windows and (a < windows[-1]['end'] or a == b == windows[-1]['start'] == windows[-1]['end']):
            previous = windows[-1]
            ids = list(dict.fromkeys([e['id'] for e in previous['edits']] + [edit['id']]))
            if len(ids) > 1:
                raise ValueError('同一原文审核单元涉及多个待审编号：' + '、'.join(ids)
                                 + '。请在论文会话中统一为一次修改，再分别关联审稿意见；未合并候选或修改决定。')
            previous['end'] = max(previous['end'], b)
            previous['edits'].append(edit)
        else:
            windows.append({'start': a, 'end': b, 'edits': [edit]})
    cursor = 0
    for window in windows:
        a, b = window['start'], window['end']
        if cursor < a:
            text = before[cursor:a]
            yield {'kind': 'equal', 'before': text, 'after': text, 'ids': []}
        old, new = before[a:b], before[a:b]
        for edit in sorted(window['edits'], key=lambda e: e['start'], reverse=True):
            start, end = edit['start'] - offset - a, edit['end'] - offset - a
            new = new[:start] + edit['item']['after'] + new[end:]
        for unit in _unit_changes(old, new):
            unit['ids'] = [] if unit['kind'] == 'equal' else [window['edits'][0]['id']]
            unit['addition_only'] = not unit['before'].strip() and bool(unit['after'].strip())
            unit['deletion_only'] = bool(unit['before'].strip()) and not unit['after'].strip()
            yield unit
        cursor = b
    if cursor < len(before):
        text = before[cursor:]
        yield {'kind': 'equal', 'before': text, 'after': text, 'ids': []}


def source_graph(root, files):
    """Resolve ordinary literal include paths before diffing independent document roots."""
    included, pending = set(), [root]
    while pending:
        rel = pending.pop()
        if rel in included:
            continue
        included.add(rel)
        text = body(files[rel].decode('utf-8-sig'))
        text = re.sub(r'(?m)(?<!\\)%[^\n]*', '', text)
        for match in re.finditer(r'\\(?:input|include|subfile)\s*\{([^{}]+)\}', text):
            name = Path(match[1])
            if not name.suffix:
                name = name.with_suffix('.tex')
            choices = [rel.parent / name, root.parent / name]
            pending.extend(p for p in choices if p in files and p not in included)
    return included


def preview(repo, state, document, id_, version, git, latexdiff, latexmk):
    review = Review(repo, state, git)
    data = review.inspect(id_, version, source=True)
    if version != data['edit']['versions'][-1] or not data['source_match'] or data['edit']['status'] not in PENDING:
        raise ValueError('候选或原文已经变化，请刷新原文卡片。')
    document = review.path(str(Path(document).resolve(strict=True).relative_to(review.repo)))
    relative = document.relative_to(review.repo)
    files = {}
    for folder, directories, leaves in os.walk(review.repo, followlinks=False):
        directories[:] = [name for name in directories if name not in EXCLUDED]
        for name in leaves:
            source = Path(folder) / name
            if source.suffix.lower() not in ASSETS:
                continue
            if source.is_symlink() or source.is_junction() or not source.resolve(strict=True).is_relative_to(review.repo):
                raise ValueError('差异快照不复制链接或越界路径：' + str(source))
            files[source.relative_to(review.repo)] = source.read_bytes()
    if relative not in files:
        raise ValueError('主文档没有进入源码快照，请检查文件类型与路径。')
    parent = document.parent / '.latex-build' / 'review-diff'
    parent.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix=id_ + '-', dir=parent))
    source_dir = out / 'source'
    for rel, raw in files.items():
        destination = source_dir / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body(raw.decode('utf-8-sig')).encode('utf-8') if rel.suffix.lower() == '.tex' else raw)
    main_text = body(files[relative].decode('utf-8-sig'))
    preamble, marker, _ = main_text.partition(r'\begin{document}')
    if not marker:
        raise ValueError('所选文件不是可编译主文档。')
    scope = source_graph(relative, files)
    if Path(data['edit']['file']) not in scope:
        raise ValueError('所选主文档没有通过普通 input/include/subfile 包含该修改文件；请选择实际主文档。动态宏包含需先核对项目结构。')
    grouped, shown = {}, []
    for id__, edit in review.state['edits'].items():
        rel = Path(edit['file'])
        if edit['status'] not in PENDING or rel not in scope:
            continue
        text = body(files[rel].decode('utf-8-sig'))
        item = review.payload(edit)
        start, end = locate(text, review.live_excerpt(edit, item), item['left'], item['right'])
        grouped.setdefault(rel, []).append({'id': id__, 'start': start, 'end': end, 'item': item, 'deferred': edit.get('deferred', False)})
    header = None
    for rel, edits in grouped.items():
        live = body(files[rel].decode('utf-8-sig'))
        original = live
        for edit in sorted(edits, key=lambda e: e['start'], reverse=True):
            if not edit['deferred']:
                original = original[:edit['start']] + edit['item']['before'] + original[edit['end']:]
        for edit in edits:
            edit['live_start'] = edit['start']
        for edit in edits:
            edit['start'] = edit['live_start'] + sum(len(other['item']['before']) - len(other['item']['after']) for other in edits
                                 if not other['deferred'] and other['live_start'] < edit['live_start'])
            edit['end'] = edit['start'] + len(edit['item']['before'])
        blocks = []
        for edit in sorted(edits, key=lambda e: e['start']):
            a, b = paragraph_span(original, edit['start'], edit['end'])
            if blocks and a <= blocks[-1]['end']:
                blocks[-1]['end'] = max(blocks[-1]['end'], b); blocks[-1]['edits'].append(edit)
            else:
                blocks.append({'start': a, 'end': b, 'edits': [edit]})
        reviewed = original
        for block in reversed(blocks):
            a, b = block['start'], block['end']
            chunks = []
            for n, unit in enumerate(review_units(original[a:b], block['edits'], a)):
                old_sentence, new_sentence = unit['before'], unit['after']
                if unit['kind'] == 'equal':
                    chunks.append(new_sentence)
                    continue
                label = ','.join(unit['ids'])
                name = 'block-' + str(len(shown)) + '-' + str(n)
                header, proposed = delta_fragment(old_sentence, new_sentence, preamble, source_dir / relative.parent, out, name + '-new', latexdiff)
                _, old_marked = delta_fragment(new_sentence, old_sentence, preamble, source_dir / relative.parent, out, name + '-old', latexdiff)
                if unit['addition_only']:
                    old_marked = r'\emph{Addition only; no corresponding original text.}'
                if unit['deletion_only']:
                    proposed = r'\emph{Sentence/item deleted. Remaining context continues below.}'
                # Keep changed floats next to their counterpart in this derived PDF.
                float_pattern = r'\\begin\{(figure|table)\}(?:\[[^\]]*\])?'
                proposed = re.sub(float_pattern, lambda m: '\\begin{' + m[1] + '}[H]', proposed)
                old_marked = re.sub(float_pattern, lambda m: '\\begin{' + m[1] + '}[H]', old_marked)
                chunks.append('\n\n\\par\\smallskip\\noindent\\textbf{[' + label + '] Original}\\par\n\\begin{codexreviewold}\n'
                              + old_marked + '\n\\end{codexreviewold}\n\\par\\smallskip\\noindent\\textbf{[' + label
                              + '] Proposed}\\par\n' + proposed + '\n\\par\\smallskip\n\n')
                shown.extend(unit['ids'])
            display = ''.join(chunks)
            reviewed = reviewed[:a] + display + reviewed[b:]
        (source_dir / rel).write_text(reviewed, encoding='utf-8', newline='')
    if header is None:
        raise ValueError('没有可预览的待审正文修改。')
    reviewed_main = (source_dir / relative).read_bytes().decode('utf-8')
    reviewed_body = reviewed_main.partition(r'\begin{document}')[2]
    derived = source_dir / relative.parent / '__codex_inline_review__.tex'
    derived.write_text('\\PassOptionsToPackage{normalem}{ulem}\n' + header + PREVIEW_MACROS + '\\begin{document}' + with_legend(reviewed_body), encoding='utf-8', newline='')
    pdf_dir = out / 'pdf'; pdf_dir.mkdir()
    command([latexmk, '-pdf', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-jobname=review',
             '-outdir=' + str(pdf_dir), str(derived)], derived.parent, out / 'compile')
    pdf = pdf_dir / 'review.pdf'
    if not pdf.is_file():
        raise ValueError('编译没有生成完整审核 PDF。')
    # A chosen root must actually include the selected target; a reply is not part of the manuscript PDF.
    recorder = (pdf_dir / 'review.fls').read_text(encoding='utf-8', errors='replace')
    included = {relative}
    for row in recorder.splitlines():
        if row.startswith('INPUT '):
            p = Path(row[6:])
            p = p if p.is_absolute() else derived.parent / p
            p = p.resolve()
            if p.is_relative_to(source_dir):
                included.add(p.relative_to(source_dir))
    if Path(data['edit']['file']) not in included:
        raise ValueError('所选主文档没有包含该修改所在文件；请选择实际所属的手稿或回复信主文档。')
    shown = [id__ for id__ in dict.fromkeys(shown) if Path(review.state['edits'][id__]['file']) in included]
    if review.state_path.read_bytes() != review.raw or any((review.repo / rel).read_bytes() != raw for rel, raw in files.items()):
        raise ValueError('编译期间源码或批注发生变化；生成的快照已保留，请刷新后重新预览。')
    # Keep the viewer on one stable artifact. Failed builds never replace the
    # last successful PDF; snapshots/logs still belong to their own generation.
    current = parent / 'current'
    for component in (parent.parent, parent, current):
        if component.is_symlink() or component.is_junction():
            raise ValueError('审核 PDF 输出目录不能是链接。')
    current.mkdir(exist_ok=True)
    if not current.resolve(strict=True).is_relative_to(review.repo):
        raise ValueError('审核 PDF 输出越出论文目录。')
    visible = current / (document.stem + '-review.pdf')
    if visible.is_symlink() or visible.is_junction() or (visible.exists() and not visible.is_file()):
        raise ValueError('审核 PDF 目标不是普通文件。')
    with tempfile.NamedTemporaryFile(prefix=document.stem + '-', suffix='.pdf.tmp', dir=current, delete=False) as stream:
        pdf_raw = pdf.read_bytes()
        stream.write(pdf_raw)
        temporary_pdf = Path(stream.name)
    pdf = visible
    navigation = visible.with_suffix('.json')
    if navigation.is_symlink() or navigation.is_junction():
        raise ValueError('审核 PDF 导航元数据不能是链接。')
    targets = {}
    for rel in included:
        # The recorder also lists binary figures and fonts; only TeX sources
        # can contain the review markers inserted above.
        if rel.suffix.lower() != '.tex':
            continue
        tex = derived if rel == relative else source_dir / rel
        if not tex.is_file():
            continue
        content = tex.read_bytes().decode('utf-8')
        for id__ in shown:
            marker = r'\textbf{[' + id__ + '] Original}'
            position = content.find(marker)
            if position >= 0 and id__ not in targets:
                targets[id__] = {'file': str(tex), 'line': content.count('\n', 0, position) + 1}
    nav = {'pdf': str(pdf), 'pdf_digest': digest(pdf_raw), 'compiled_pdf': str(pdf_dir / 'review.pdf'), 'targets': targets,
           'versions': {id__: review.state['edits'][id__]['versions'][-1] for id__ in shown}}
    with tempfile.NamedTemporaryFile(prefix=document.stem + '-', suffix='.json.tmp', dir=current, delete=False) as stream:
        stream.write(json.dumps(nav, ensure_ascii=False).encode('utf-8'))
        temporary = Path(stream.name)
    os.replace(temporary, navigation)
    os.replace(temporary_pdf, visible)
    result = {'pdf': str(pdf), 'navigation': str(navigation), 'output': str(out), 'id': id_, 'version': version, 'kind': 'full-paper-sentence-review', 'shown_ids': shown}
    (out / 'comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['repo', 'state', 'document', 'id', 'version', 'git', 'latexdiff', 'latexmk']:
        parser.add_argument('--' + name, required=True)
    args = vars(parser.parse_args())
    args['id_'] = args.pop('id')
    try:
        print(json.dumps(preview(**args), ensure_ascii=False))
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
