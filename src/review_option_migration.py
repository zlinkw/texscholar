"""Exact projections of inventoried legacy candidate metadata.

The immutable option remains authoritative.  The proof binds every removed
character to that option; it never treats a pending plan as an active rule.
"""
import hashlib
import json
import re


class CandidateMigrationError(ValueError):
    pass


_PLAN = re.compile(r'(?m)^% CODEX-PARAGRAPH-PLAN-BEGIN\r?\n(?:^%[^\n]*\n)*?^% CODEX-PARAGRAPH-PLAN-END\r?$(?:\n|$)')
_LINK = re.compile(r'(?m)^% CODEX-RESPONSE reviewer=(\S+) changes=([a-z0-9,]+)\r?\n% CODEX-QUESTION (\{[^\n]+\})\r?$(?:\n|$)')


def prepare(text):
    """Build a proof only for the supported complete legacy comment format."""
    if not isinstance(text, str):
        raise CandidateMigrationError('Candidate must be text')
    plans, links = list(_PLAN.finditer(text)), list(_LINK.finditer(text))
    if len(plans) != 1 or len(links) > 1:
        raise CandidateMigrationError('Legacy candidate metadata is incomplete or ambiguous')
    pieces = [{'start': p.start(), 'end': p.end(), 'kind': 'plan', 'text': p.group()} for p in plans]
    question, dependencies = None, []
    if links:
        link = links[0]
        try:
            question = json.loads(link.group(3))
        except json.JSONDecodeError as error:
            raise CandidateMigrationError('Legacy reviewer question is invalid') from error
        if not isinstance(question, dict) or question.get('id') != link.group(1):
            raise CandidateMigrationError('Legacy reviewer identity differs from its response')
        dependencies = link.group(2).split(',')
        pieces.append({'start': link.start(), 'end': link.end(), 'kind': 'link', 'text': link.group()})
    pieces.sort(key=lambda p: p['start'])
    if any(pieces[i - 1]['end'] > pieces[i]['start'] for i in range(1, len(pieces))):
        raise CandidateMigrationError('Legacy candidate metadata overlaps')
    projection = text
    for piece in reversed(pieces):
        projection = projection[:piece['start']] + projection[piece['end']:]
    if re.search(r'(?m)^\s*%\s*CODEX-', projection):
        raise CandidateMigrationError('Unknown legacy candidate metadata remains')
    return {'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'fragments': pieces,
            'question': question, 'dependencies': dependencies}


def project(text, proof):
    if proof != prepare(text):
        raise CandidateMigrationError('Legacy candidate or its migration proof has changed')
    for piece in reversed(proof['fragments']):
        text = text[:piece['start']] + text[piece['end']:]
    return text


def selection_to_original(text, proof, start, end):
    """Map an exact visible selection to immutable offsets, never across a gap."""
    visible = project(text, proof)
    if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(visible):
        raise CandidateMigrationError('Invalid projected selection')
    removed = 0
    for piece in proof['fragments']:
        point = piece['start'] - removed
        if start < point < end:
            raise CandidateMigrationError('Selection crosses removed legacy metadata')
        removed += piece['end'] - piece['start']
    def original_offset(offset, right):
        delta = 0
        for piece in proof['fragments']:
            point = piece['start'] - delta
            if offset > point or offset == point and right:
                delta += piece['end'] - piece['start']
        return offset + delta
    left = original_offset(start, True)
    right = left if start == end else original_offset(end, False)
    if text[left:right] != visible[start:end]:
        raise CandidateMigrationError('Selection does not map to one exact immutable span')
    return left, right


def selection_from_original(text, proof, start, end):
    """Return visible offsets only for one unchanged immutable span."""
    visible = project(text, proof)
    if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(text):
        raise CandidateMigrationError('Invalid immutable selection')
    for piece in proof['fragments']:
        if max(start, piece['start']) < min(end, piece['end']):
            raise CandidateMigrationError('Original selection includes legacy metadata')
        if start < piece['start'] and piece['end'] < end:
            raise CandidateMigrationError('Original selection crosses legacy metadata')
    def visible_offset(offset):
        delta = 0
        for piece in proof['fragments']:
            if piece['start'] < offset < piece['end']:
                raise CandidateMigrationError('Original selection falls inside legacy metadata')
            if piece['end'] <= offset:
                delta += piece['end'] - piece['start']
        return offset - delta
    left, right = visible_offset(start), visible_offset(end)
    if visible[left:right] != text[start:end]:
        raise CandidateMigrationError('Original selection has no exact visible span')
    return left, right


def selection_segments(text, proof, start, end):
    """Map a visible selection to its exact ordered immutable spans."""
    visible = project(text, proof)
    if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(visible):
        raise CandidateMigrationError('Invalid projected selection')
    if start == end:
        point, _ = selection_to_original(text, proof, start, end)
        return [{'start':point, 'end':point}]
    result, raw_start, visible_start = [], 0, 0
    for piece in [*proof['fragments'], {'start':len(text), 'end':len(text)}]:
        raw_end = piece['start']
        visible_end = visible_start + raw_end - raw_start
        a, b = max(start, visible_start), min(end, visible_end)
        if a < b:
            result.append({'start':raw_start + a - visible_start, 'end':raw_start + b - visible_start})
        raw_start, visible_start = piece['end'], visible_end
    if ''.join(text[item['start']:item['end']] for item in result) != visible[start:end]:
        raise CandidateMigrationError('Projected selection does not map to immutable spans')
    return result
