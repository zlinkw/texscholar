"""Stable, explicit TeX review block boundaries."""
import re
import uuid
from difflib import SequenceMatcher

MARKER = re.compile(r'(?m)^% TS-BLOCK-(BEGIN|END) id=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?: kind=(paragraph|display|slot|question))?\r?$(?:\n|$)')


def index(text):
    """Return complete unique blocks; malformed or copied boundaries are conflicts."""
    blocks, stack = {}, []
    markers = list(MARKER.finditer(text))
    lines = list(re.finditer(r'(?m)^% TS-BLOCK-(?:BEGIN|END)\b[^\r\n]*', text))
    if len(lines) != len(markers):
        raise ValueError('审核块标记格式损坏；请修复标记，未修改正文。')
    for marker in markers:
        action, block_id, kind = marker.groups()
        if action == 'BEGIN':
            if not kind or block_id in blocks or any(row['id'] == block_id for row in stack):
                raise ValueError('审核块标记重复或缺少类型：' + block_id)
            stack.append({'id': block_id, 'kind': kind, 'start': marker.end(), 'marker_start': marker.start(),
                          'parent': stack[-1]['id'] if stack else None})
        else:
            if kind or not stack or stack[-1]['id'] != block_id:
                raise ValueError('审核块标记缺失或错配：' + block_id)
            row = stack.pop()
            row.update(end=marker.start(), marker_end=marker.end())
            blocks[block_id] = row
    if stack:
        raise ValueError('审核块结束标记缺失：' + stack[-1]['id'])
    return blocks


def index_target(text, block_id):
    """Locate one complete block when an unrelated marker is damaged."""
    lines = list(re.finditer(r'(?m)^% TS-BLOCK-(?:BEGIN|END)\b[^\r\n]*', text))
    mentions = [line for line in lines if block_id in line.group()]
    markers = [marker for marker in MARKER.finditer(text) if marker.group(2) == block_id]
    if len(mentions) != 2 or len(markers) != 2 or markers[0].group(1) != 'BEGIN' or markers[1].group(1) != 'END':
        raise ValueError('目标审核块标记缺失、重复或损坏：' + block_id)
    start, end = markers[0].start(), markers[1].end()
    row = index(text[start:end])[block_id]
    return {**row, **{key:row[key] + start for key in ('start', 'end', 'marker_start', 'marker_end')}}


def safe_boundaries(text):
    """Independent lines outside TeX groups, math and verbatim environments."""
    boundaries, depth, math, env, pos = set(), 0, None, [], 0
    verbatim = {'verbatim', 'verbatim*', 'lstlisting', 'minted'}
    math_env = {'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'flalign', 'flalign*',
                'gather', 'gather*', 'multline', 'multline*', 'displaymath', 'math', 'aligned', 'split'}
    while pos < len(text):
        if (pos == 0 or text[pos - 1] == '\n') and depth == 0 and not math and not any(e in verbatim or e in math_env for e in env):
            boundaries.add(pos)
        if env and env[-1] in verbatim:
            close = r'\end{' + env[-1] + '}'
            if text.startswith(close, pos):
                pos += len(close); env.pop()
            else:
                pos += 1
            continue
        ch = text[pos]
        if ch == '%':
            end = text.find('\n', pos)
            pos = len(text) if end < 0 else end + 1
        elif ch == '\\':
            match = re.match(r'\\(begin|end)\{([^{}]+)\}', text[pos:])
            verb = re.match(r'\\verb\*?([^A-Za-z\s])', text[pos:])
            if verb:
                end = text.find(verb[1], pos + verb.end())
                if end < 0 or '\n' in text[pos:end]:
                    raise ValueError('LaTeX verb 未闭合；无法安全插入审核标记。')
                pos = end + 1
            elif match:
                action, name = match.groups()
                if action == 'begin':
                    env.append(name)
                elif not env or env.pop() != name:
                    raise ValueError('LaTeX 环境不匹配；无法安全插入审核标记。')
                pos += match.end()
            elif text.startswith(r'\[', pos) or text.startswith(r'\(', pos):
                if math:
                    raise ValueError('数学边界不匹配；无法安全插入审核标记。')
                math = text[pos:pos + 2]; pos += 2
            elif text.startswith(r'\]', pos) or text.startswith(r'\)', pos):
                if math != {r'\]': r'\[', r'\)': r'\('}[text[pos:pos + 2]]:
                    raise ValueError('数学边界不匹配；无法安全插入审核标记。')
                math = None; pos += 2
            else:
                token = re.match(r'\\(?:[A-Za-z@]+\*?|.)', text[pos:])
                pos += len(token.group()) if token else 1
        elif ch == '$':
            token = '$$' if text.startswith('$$', pos) else '$'
            if math and math != token:
                raise ValueError('数学边界不匹配；无法安全插入审核标记。')
            math = None if math else token; pos += len(token)
        else:
            if not math:
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth < 0: raise ValueError('LaTeX 分组不匹配；无法安全插入审核标记。')
            pos += 1
    if depth or math or env:
        raise ValueError('LaTeX 结构未闭合；无法安全插入审核标记。')
    if not text or text.endswith('\n'):
        boundaries.add(len(text))
    return boundaries


def prepare(text, start, end, kind, block_id=None):
    """Preview a pair around exact complete lines; callers apply under source CAS."""
    if kind not in {'paragraph', 'display', 'slot', 'question'} or type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(text):
        raise ValueError('审核块范围或类型无效。')
    if kind != 'slot' and start == end:
        raise ValueError('只有插入槽可以为空。')
    before = index(text)
    valid = safe_boundaries(text)
    if start not in valid or end not in valid:
        raise ValueError('标记只能插在安全的独立行边界。')
    block_id = block_id or str(uuid.uuid4())
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', block_id):
        raise ValueError('审核块 ID 格式无效。')
    if block_id in before:
        raise ValueError('审核块 ID 已存在。')
    eol = '\r\n' if '\r\n' in text else '\n'
    begin = f'% TS-BLOCK-BEGIN id={block_id} kind={kind}' + eol
    finish = f'% TS-BLOCK-END id={block_id}' + eol
    updated = text[:start] + begin + text[start:end] + finish + text[end:]
    prepared = index(updated)
    if any(row['parent'] and prepared[row['parent']]['kind'] != 'question' for row in prepared.values()):
        raise ValueError('只有审稿问题容器可以包含子审核块。')
    row = prepared[block_id]
    return updated, row


def changes(before, after):
    if before == after:
        return []
    def unique(text, part):
        at = text.find(part)
        return at >= 0 and text.find(part, at + 1) < 0
    anchors = [(a, b, c, d) for tag, a, b, c, d in SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
               if tag == 'equal' and unique(before, before[a:b]) and unique(after, after[c:d])]
    result, old_at, new_at = [], 0, 0
    for a, b, c, d in [*anchors, (len(before), len(before), len(after), len(after))]:
        if before[old_at:a] != after[new_at:c]:
            result.append((old_at, a, after[new_at:c]))
        old_at, new_at = b, d
    return result


def reconcile(before, current, start, end, options):
    """Conservatively replay non-overlapping option changes over an author edit."""
    author = changes(before, current)
    if not author:
        return None
    def overlaps(a, b, x, y):
        if a == b or x == y:
            return (x <= a <= y) if a == b else (a <= x <= b)
        return max(a, x) < min(b, y)
    def mapped(pos):
        shift = 0
        for a, b, value in author:
            if a < pos < b or a == b == pos:
                raise ValueError('原文边界已变化；请人工核对。')
            if b <= pos:
                shift += len(value) - (b-a)
        return pos + shift
    new_start, new_end = mapped(start), mapped(end)
    new_before = current[new_start:new_end]
    result = []
    for option in options:
        patch = changes(before[start:end], option['after'])
        operations = []
        for a, b, value in patch:
            a += start; b += start
            if any(overlaps(a, b, x, y) for x, y, _ in author):
                raise ValueError('作者修改与候选重叠；旧候选保留，请人工核对。')
            operations.append((mapped(a) - new_start, mapped(b) - new_start, value))
        revised = new_before
        for a, b, value in reversed(operations):
            revised = revised[:a] + value + revised[b:]
        result.append({**option, 'after': revised})
    return new_start, new_end, new_before, result
