"""Local, display-only changes that merit an author's evidence check."""
import difflib
import re

COMMENT = re.compile(r'(?<!\\)%[^\r\n]*')
CITATION = re.compile(r'\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\])*\{([^{}]*)\}')
MATH = re.compile(r'(?<!\\)\$\$(.*?)(?<!\\)\$\$|(?<!\\)\$(?!\$)(.*?)(?<!\\)\$|\\\((.*?)\\\)|\\\[(.*?)\\\]|\\begin\{(?:equation|align|gather|multline)\*?\}(.*?)\\end\{(?:equation|align|gather|multline)\*?\}', re.S)
NUMBER = re.compile(r'(?<![\w\\])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?')
MATH_TOKEN = re.compile(r'\\[A-Za-z]+|[A-Za-z]+|[^\W\d_]+|[+\-=<>*/^_]|\d+(?:\.\d+)?', re.UNICODE)
FORMAT = {'\\left', '\\right', '\\displaystyle', '\\textstyle', '\\mathrm', '\\mathbf', '\\mathit', '\\mathsf', '\\mathcal'}


def tokens(text):
    """Keep original code-point offsets while excluding comments and TeX layout."""
    masked = list(text)
    def mask(start, end):
        masked[start:end] = ' ' * (end - start)
    for match in COMMENT.finditer(text):
        mask(*match.span())
    clean = ''.join(masked)
    citations = []
    for match in CITATION.finditer(clean):
        for key in re.finditer(r'[^,\s]+', match.group(1)):
            start = match.start(1) + key.start()
            citations.append((key.group(), start, start + len(key.group())))
        mask(*match.span())
    clean = ''.join(masked)
    math = []
    for match in MATH.finditer(clean):
        group = next(i for i in range(1, 6) if match.group(i) is not None)
        for token in MATH_TOKEN.finditer(match.group(group)):
            value = token.group()
            if value in FORMAT:
                continue
            start = match.start(group) + token.start()
            math.append((value, start, start + len(value)))
    numbers = [(m.group(), m.start(), m.end()) for m in NUMBER.finditer(clean)]
    return {'number': numbers, 'citation': citations, 'math': math}


def changes(before, after, terms=()):
    old, new = tokens(before), tokens(after)
    result = []
    for kind in ('number', 'citation', 'math'):
        left, right = old[kind], new[kind]
        for tag, a, b, c, d in difflib.SequenceMatcher(None, [x[0] for x in left], [x[0] for x in right], autojunk=False).get_opcodes():
            if tag != 'equal':
                result.append({'kind': kind, 'old': left[a:b], 'new': right[c:d], 'evidence': 'unsupported'})
    for term in terms:
        if term in before and term not in after:
            at = before.index(term)
            result.append({'kind': 'term', 'old': [(term, at, at + len(term))], 'new': [], 'evidence': 'unsupported'})
    return result
