"""Read-only source scopes and comment roles for AI; never editing boundaries."""
import re
from source_review import Conflict, locate
from review_pdf import _command, _environment_end, heading_end


class SectionSelectionConflict(Conflict):
    def __init__(self, heading, available):
        super().__init__('Section selector is missing, ambiguous or inactive; choose an exact active heading from available_sections')
        self.heading, self.available, self.file = heading, available, None


def paragraph_context(text, start, end):
    gaps = list(re.finditer(r'\r?\n[ \t]*\r?\n', text))
    left = [gap.end() for gap in gaps if gap.end() <= start]
    right = [gap.start() for gap in gaps if gap.start() >= end]
    return left[-2] if len(left) > 1 else 0, right[1] if len(right) > 1 else len(text)


def section_span(text, heading, left='', right=''):
    """Exact literal heading command; nested titles, comments and verbatim are preserved."""
    levels = {name: i for i, name in enumerate(('part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'))}
    headings, depth, cursor = [], 0, 0
    while cursor < len(text):
        char = text[cursor]
        if char == '%':
            end = text.find('\n', cursor)
            cursor = len(text) if end < 0 else end + 1
            continue
        if char == '\\':
            literal = re.match(r'\\begin\{(verbatim\*?|lstlisting|minted)\}', text[cursor:])
            if literal:
                cursor = _environment_end(text, cursor)
                continue
            token, end = _command(text, cursor)
            name = token[1:].rstrip('*')
            if depth == 0 and name in levels:
                headings.append((cursor, levels[name]))
            cursor = end
            continue
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        cursor += 1
    available = [{'section': text[at:heading_end(text, at)], 'start': at} for at, _ in headings]
    try:
        start, selected_end = locate(text, heading, left, right)
    except Conflict as error:
        raise SectionSelectionConflict(heading, available) from error
    match = re.fullmatch(r'\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[\s\S]*?\]\s*)?\{[\s\S]*\}', heading)
    if not match or start not in {at for at, _ in headings}:
        raise SectionSelectionConflict(heading, available)
    if heading_end(heading, 0) != len(heading):
        raise Conflict('section must contain exactly one complete heading command')
    level = next(level for at, level in headings if at == start)
    end = next((at for at, other in headings if at >= selected_end and other <= level), len(text))
    return start, end


def source_scope(text, spec):
    if ('quote' in spec) == ('section' in spec):
        raise Conflict('Each scope needs exactly one quote or section selector')
    if 'section' in spec:
        try:
            start, end = section_span(text, spec['section'], spec.get('left', ''), spec.get('right', ''))
        except SectionSelectionConflict as error:
            error.file = spec['file']
            raise
        return (start, end), paragraph_context(text, start, end)
    start, end = locate(text, spec['quote'], spec.get('left', ''), spec.get('right', ''))
    return (start, end), paragraph_context(text, start, end)


def comment_blocks(text):
    """Keep unknown comments intact; separate adjacent named blocks from their neighbours."""
    lines = list(re.finditer(r'[^\n]*(?:\n|$)', text))
    start, name = None, None
    for line in lines:
        value = line.group()
        if not value:
            continue
        comment = value.lstrip().startswith('%')
        marker = re.match(r'\s*%\s*(CODEX-[A-Z-]+?)-(BEGIN|END)\b', value)
        if marker and marker[2] == 'BEGIN':
            if start is not None:
                yield start, line.start(), text[start:line.start()]
            start, name = line.start(), marker[1]
        elif comment:
            if start is None:
                start = line.start()
            if marker and marker[2] == 'END' and marker[1] == name:
                yield start, line.end(), text[start:line.end()]
                start, name = None, None
        elif start is not None:
            yield start, line.start(), text[start:line.start()]
            start, name = None, None
    if start is not None:
        yield start, len(text), text[start:]


def comment_context(texts, spans, roles):
    categories = {'global': {}, 'local': {}, 'reference': {}, 'omitted_local': {}}
    templates = {entry['file'] for entry in roles['files'] if 'template' in entry['roles']}
    for file, text in texts.items():
        ranges = spans.get(file, [])
        blocks = list(comment_blocks(text))
        # Loose preamble notes remain author rules; chapter files use their initial comments.
        initial = re.match(r'(?:[ \t]*%[^\n]*(?:\n|$)|\s)*', text).end()
        document = re.search(r'(?m)^[ \t]*\\begin\{document\}', text)
        header_end = document.start() if document else initial
        for start, end, value in blocks:
            if re.search(r'^\s*%\s*CODEX-(?:FILE-ROLES|REVIEW-STATE)-BEGIN\b', value):
                continue
            relevant = any(start < b and end > a for a, b in ranges)
            if file in templates:
                category = 'reference' if relevant else None
            elif start < header_end or re.search(r'^\s*%\s*CODEX-(?:RULES|WRITING-PROFILE)\b', value, re.M):
                category = 'global'
            else:
                category = 'local' if relevant else None
            if category:
                categories[category].setdefault(file, []).append({'start': start, 'end': end, 'text': value})
            else:
                categories['omitted_local'][file] = categories['omitted_local'].get(file, 0) + 1
    return categories
