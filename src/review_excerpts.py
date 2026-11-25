"""Resolve explicit source-block excerpts from the current paper sources."""
import re
from pathlib import PurePosixPath

from review_blocks import MARKER, index

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
REFERENCE = re.compile(r'\\TSExcerpt\s*\{([^{}\r\n]+)\}\s*\{(' + UUID + r')\}')
VERBATIM = {'verbatim', 'verbatim*', 'lstlisting', 'minted'}


def safe_source(name):
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or path.as_posix() != name or path.suffix != '.tex'
            or any(part in ('', '.', '..') or part.endswith((' ', '.')) or ':' in part for part in path.parts)
            or any(ord(ch) < 32 or ch in '\\{}%#^~' for ch in name)):
        raise ValueError('摘录来源路径无效：' + name)
    return name


def references(text):
    """Find executable references, excluding comments and verbatim text."""
    rows, pos = [], 0
    while pos < len(text):
        if text[pos] == '%':
            end = text.find('\n', pos)
            pos = len(text) if end < 0 else end + 1
        elif text[pos] == '\\':
            match = re.match(r'\\(begin)\{([^{}]+)\}', text[pos:])
            if match and match[2] in VERBATIM:
                end = text.find(r'\end{' + match[2] + '}', pos + match.end())
                if end < 0:
                    raise ValueError('摘录所在源码的 verbatim 环境未闭合。')
                pos = end + len(r'\end{' + match[2] + '}')
                continue
            verb = re.match(r'\\verb\*?([^A-Za-z\s])', text[pos:])
            if verb:
                end = text.find(verb[1], pos + verb.end())
                if end < 0 or '\n' in text[pos:end]:
                    raise ValueError('摘录所在源码的 verb 未闭合。')
                pos = end + 1
                continue
            command = re.match(r'\\(?:[A-Za-z@]+|.)', text[pos:])
            if command and command.group() == r'\TSExcerpt':
                ref = REFERENCE.match(text, pos)
                if not ref:
                    raise ValueError('摘录引用格式损坏，位置：' + str(pos))
                rows.append({'start': pos, 'end': ref.end(), 'file': safe_source(ref[1]), 'block_id': ref[2],
                             'reference': ref.group()})
                pos = ref.end()
            else:
                pos += len(command.group()) if command else 1
        else:
            pos += 1
    return rows


def resolve(text, read):
    """Resolve each reference using one caller-owned source snapshot."""
    result = []
    for ref in references(text):
        try:
            source = read(ref['file'])
            block = index(source)[ref['block_id']]
            content = MARKER.sub('', source[block['start']:block['end']])
            if references(content):
                raise ValueError('正文块不能嵌套动态摘录。')
        except (KeyError, ValueError, OSError) as error:
            raise ValueError('摘录来源无效 ' + ref['file'] + ' #' + ref['block_id'] + '：' + str(error)) from error
        result.append({**ref, 'content': content, 'kind': block['kind']})
    return result
