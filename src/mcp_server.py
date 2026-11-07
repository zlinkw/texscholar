"""Local STDIO MCP adapter. UI and AI share Review's lock and transactions."""
from pathlib import Path
import argparse
import json
import os
import re
import sys
from source_review import Review, Conflict, FieldConflict, OverlapConflict, PENDING, body, digest, locate
from document_roles import scan as scan_roles, relative_file
from ai_context import paragraph_context, source_scope, comment_context, SectionSelectionConflict

HERE = Path(__file__).resolve().parent
VERSION = json.loads((HERE.parent / 'package.json').read_text(encoding='utf-8'))['version']
INSTRUCTIONS = (
    'TeXScholar manages local LaTeX manuscript and reviewer-response drafting/revision. '
    'First call read_context; use author-confirmed file_roles, never guess filenames or overwrite templates. '
    'Submit ranked A/B/C together per source location; use submit_options for multiple locations, or propose_options/rework_options for one; '
    'never overwrite formal prose before author acceptance. No global SKILL edits. '
    'Read exact author notes, current versions and feedback; no guessed question links. '
    'Acceptance, Git checkpoint and scientific closure are separate; AI tools do not accept candidates. '
    'Scope reads with ids/scopes/files; request relevant rule modules and reuse rules_receipt as known_rules. Do not reread CLI help or run setup for ordinary revisions. '
    'Writes validate and save by default; chain returned sha256/version, rereading only on conflicts or new input. '
    'Use plugin tools, not retired single-candidate CLI interfaces. Unrelated code/Typst tasks are outside this server.'
)

def schema(properties, required=()):
    return {'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': False}

STRING = {'type': 'string'}
OPTION = schema({'label': {'type': 'string', 'enum': ['A', 'B', 'C']}, 'after': STRING,
                 'reason': {'type': 'string', 'description': 'Normally one sentence stating the actual tradeoff. Detailed explanation only when needed.'},
                 'summary': {'type': 'string', 'description': 'Optional short headline only when reason needs a longer explanation; do not repeat reason.'}}, ['label', 'after', 'reason'])
QUESTION = schema({k: STRING for k in ('id', 'file', 'quote')}, ['id', 'file', 'quote'])
BASE = {'project': STRING, 'state': STRING,
        'expected_plugin_version': {'type': 'string', 'description': 'Version from the current plugin task/feedback packet. A mismatch requires restarting Codex MCP, not CLI fallback.'}}
POOL = {'type': 'object', 'additionalProperties': QUESTION, 'description': 'Explicit shared question excerpts for this request only; references never auto-pair.'}
WRITE = {**BASE, 'expected_sha256': STRING, 'apply': {'type': 'boolean', 'default': True}, 'question_pool': POOL}
STRINGS = {'type': 'array', 'items': STRING}
RULE_MODULES = ['core', 'writing', 'abstract', 'introduction', 'method', 'experiments', 'figures', 'response', 'questions', 'backup', 'interface', 'roles']
MODULES = {'type': 'array', 'items': {'type': 'string', 'enum': RULE_MODULES}}
RULES = {'modules': MODULES, 'known_rules': schema({'version': STRING, 'modules': MODULES}, ['version', 'modules'])}
SCOPES = {'type': 'array', 'items': schema({'file': STRING, 'quote': STRING, 'section': STRING, 'left': STRING, 'right': STRING}, ['file'])}
FEEDBACK_RECEIPTS = {'type': 'array', 'items': schema({'id': STRING, 'version': STRING, 'fingerprint': STRING}, ['id', 'version', 'fingerprint'])}
REFERENCES = {'type': 'array', 'items': schema({'kind': {'type': 'string', 'enum': ['label', 'citation', 'macro']}, 'key': STRING, 'files': STRINGS}, ['kind', 'key', 'files'])}
READ = {**BASE, **RULES, 'ids': STRINGS, 'files': STRINGS, 'scopes': SCOPES, 'known_feedback': FEEDBACK_RECEIPTS, 'references': REFERENCES}
SPEC = {'file': STRING, 'kind': {'type': 'string', 'enum': ['manuscript', 'response']},
        'intent': schema({'goal': STRING, 'preserve': STRING}, ['goal', 'preserve']),
        'before': STRING, 'left': STRING, 'right': STRING, 'location': STRING,
        'options': {'type': 'array', 'items': OPTION, 'minItems': 1, 'maxItems': 3},
        'fewer_options_reason': STRING, 'questions': {'type': 'array', 'items': QUESTION}, 'question_refs': STRINGS,
        'deps': {'type': 'array', 'items': STRING}, 'discard_annotations': {'type': 'boolean'},
        'resolve_requests': {'type': 'array', 'items': STRING}}
TOOLS = [
    ('get_instructions', 'Read requested rule modules; pass known_rules from an earlier receipt to omit unchanged modules. Core is always required. No SKILL edits.', schema(RULES), True),
    ('read_context', 'FIRST: ids for revisions, scopes for exact source/cursor/section, files only for full files. Default all pending items with local context. Pass known_feedback only from an attachment still in context; unchanged prose/notes are reused, source and state are checked. references reads explicit label/citation/macro keys. Reuse rules receipt.', schema(READ, ['project']), True),
    ('read_feedback', 'Read missing feedback generations, grouped once per ID/version; every note retains its exact option/selection. Optional ids scope.', schema({**BASE, 'ids': STRINGS}, ['project', 'state']), True),
    ('begin_review', 'Explicit new batch only, after protecting unbacked accepted results. Reuses an existing author-approved state header; never silently starts a batch.',
     schema({**WRITE, 'round': STRING, 'files': {'type': 'array', 'items': STRING}, 'submission': STRING}, ['project', 'state', 'expected_sha256', 'round', 'files']), False),
    ('propose_options', 'Validate and save ONE location with ranked A/B/C in one call. apply defaults true; no mandatory preview call. Chain returned sha256 for the next write. Formal prose unchanged.',
     schema({**WRITE, 'spec': schema(SPEC, ['file', 'kind', 'before', 'options'])}, ['project', 'state', 'expected_sha256', 'spec']), False),
    ('rework_options', 'Replace pending A/B/C under SAME ID/version. On success old notes are discarded by default; failure preserves state. Explicit discard_annotations=false retains notes; resolve_requests supports selective handling. No acceptance. Chain returned sha256/version.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options'])}, ['project', 'state', 'expected_sha256', 'id', 'version', 'spec']), False),
    ('link_questions', 'Append/deduplicate exact verified original reviewer quotes or explicit question_pool references. Explicit replace only. No other changes; never auto-pair.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'questions': {'type': 'array', 'items': QUESTION}, 'question_refs': STRINGS, 'replace': {'type': 'boolean', 'default': False}},
            ['project', 'state', 'expected_sha256', 'id', 'version']), False),
    ('submit_options', 'Save explicit propose/rework/link_questions operations in order, chaining state receipts. Shared question_pool avoids repeating quotes; each operation names question_refs explicitly. Stops at first failure; earlier successes remain saved. Never replay successes. No acceptance.',
     schema({**BASE, 'question_pool': POOL, 'expected_sha256': STRING, 'operations': {'type': 'array', 'minItems': 1, 'items': schema({
         'operation': {'type': 'string', 'enum': ['propose_options', 'rework_options', 'link_questions']},
         'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options']),
         'questions': {'type': 'array', 'items': QUESTION}, 'question_refs': STRINGS, 'replace': {'type': 'boolean'}}, ['operation'])}},
         ['project', 'state', 'expected_sha256', 'operations']), False),
]

def rule_packet(args):
    if not isinstance(args.get('modules', []), list) or not isinstance(args.get('known_rules', {}), dict):
        raise Conflict('modules must be a list and known_rules must be a rule receipt')
    requested = list(dict.fromkeys(['core', *args.get('modules', [])]))
    known = args.get('known_rules', {})
    loaded = known.get('modules', []) if known.get('version') == VERSION else []
    if not isinstance(loaded, list):
        raise Conflict('known_rules.modules must be a list')
    if any(name not in RULE_MODULES for name in [*requested, *loaded]):
        raise Conflict('Unknown rule module; use the published module names')
    missing = [name for name in requested if name not in loaded]
    parts = []
    headings = {'writing': ['写入源码注释，而不是新增跟踪文件', '参考引导与整体逻辑', 'AI 的工具入口'],
                'abstract': ['摘要'], 'introduction': ['Introduction'], 'method': ['Method'],
                'experiments': ['Experiments'], 'figures': ['图表、讨论与结论'], 'response': ['回复信'], 'backup': ['每批成果']}
    for name in missing:
        if name in ('core', 'questions', 'roles', 'interface'):
            file = 'collaboration-guide.md' if name == 'core' else 'question-linking-guide.md'
            if name in ('roles', 'interface'):
                file = 'collaboration-guide.md'
            text = (HERE / file).read_text(encoding='utf-8')
            if name == 'questions':
                parts.append(text)
            else:
                sections = re.split(r'(?m)(?=^## )', text)
                titles = {'core': ['日常修改的最短完整流程', '候选生成'], 'roles': ['文件角色细节'], 'interface': ['界面与交付细节']}[name]
                parts.extend(section for i, section in enumerate(sections) if (name == 'core' and i == 0) or section.splitlines()[0].removeprefix('## ') in titles)
        else:
            text = (HERE / 'writing-guide.md').read_text(encoding='utf-8')
            sections = re.split(r'(?m)(?=^## )', text)
            parts.extend(section for section in sections if section.splitlines()[0].removeprefix('## ') in headings[name])
            if name == 'writing':
                parts.insert(0, sections[0])
    return {'protocol': '\n\n'.join(parts), 'rules_receipt': {'version': VERSION, 'modules': list(dict.fromkeys([*loaded, *requested]))},
            'available_modules': RULE_MODULES}


class ToolConflict(Conflict):
    def __init__(self, message, code, recovery):
        super().__init__(message)
        self.code, self.recovery = code, recovery


def error_detail(error, args):
    # Only classified boundaries prescribe recovery. Unknown failures retain their cause.
    if isinstance(error, SectionSelectionConflict):
        return {'code': 'section_selector_invalid', 'message': str(error), 'id': None,
                'recovery': {'action': 'correct_request', 'files': [error.file], 'requested_section': error.heading,
                             'available_sections': error.available, 'reread_required': False, 'automatic_retry': False}}
    if not isinstance(error, ToolConflict) and str(error) == 'Interrupted transaction: inspect status then explicitly recover':
        return {'code': 'interrupted_transaction', 'message': str(error), 'id': args.get('id'),
                'recovery': {'action': 'inspect_status_then_explicit_recover', 'project': args.get('project'),
                             'state': args.get('state'), 'automatic_retry': False}}
    if isinstance(error, FieldConflict):
        return {'code': 'invalid_field', 'message': str(error), 'id': args.get('id'), 'field': error.field,
                'recovery': {'action': 'correct_request', 'reread_required': False, 'automatic_retry': False}}
    if isinstance(error, OverlapConflict):
        return {'code': 'overlapping_candidate', 'message': str(error), 'id': args.get('id'),
                'existing': {'id': error.id, 'version': error.version, 'file': error.file},
                'recovery': {'action': 'read_context', 'ids': [error.id], 'automatic_retry': False}}
    if not isinstance(error, ToolConflict):
        if str(error).startswith('Exact anchored span is missing or ambiguous'):
            files = [args['spec']['file']] if 'spec' in args and 'file' in args['spec'] else [s['file'] for s in args.get('scopes', [])]
            scope = {'ids': [args['id']]} if 'id' in args else {'files': list(dict.fromkeys(files))}
            error = ToolConflict(str(error), 'source_changed', {'action': 'read_context', **scope, 'automatic_retry': False})
        elif str(error) == 'Reviewer question quote must match its actual source uniquely':
            links = args.get('spec', args)
            questions = [*links.get('questions', []), *[args.get('question_pool', {})[ref] for ref in links.get('question_refs', []) if ref in args.get('question_pool', {})]]
            error = ToolConflict(str(error), 'question_quote_invalid', {'action': 'read_exact_question_source',
                'files': list(dict.fromkeys(q['file'] for q in questions
                                           if isinstance(q, dict) and isinstance(q.get('file'), str))), 'automatic_retry': False})
    return {'code': error.code if isinstance(error, ToolConflict) else 'operation_failed',
            'message': str(error), 'id': args.get('id'),
            'recovery': error.recovery if isinstance(error, ToolConflict) else {'action': 'resolve_reported_cause', 'automatic_retry': False}}


def selected_ids(review, ids=None, files=None):
    for values in (ids, files):
        if values is not None and (not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values)):
            raise Conflict('ids and files must be arrays of nonempty strings')
    edits = review.state['edits']
    if ids is not None and any(id_ not in edits for id_ in ids):
        raise Conflict('Unknown review ID; do not guess or reuse another batch number')
    return list(dict.fromkeys(ids)) if ids is not None else [id_ for id_, edit in edits.items()
        if edit['status'] in PENDING and (files is None or edit['file'] in files)]


def verify_read(review):
    if review.state_path.read_bytes() != review.raw or any(review.path(file).read_bytes() != raw for file, raw in review.original.items()):
        raise ToolConflict('Source or state changed during reading; reread the requested scope', 'context_changed', {'action': 'read_context', 'automatic_retry': False})


def feedback_packet(review, ids=None):
    review.assert_ready()
    groups = {}
    for id_ in selected_ids(review, ids):
        edit = review.state['edits'][id_]
        if edit['status'] not in PENDING:
            continue
        for note in edit.get('requests', []):
            if note['status'] != 'open':
                continue
            version = note['version']
            if version not in edit['versions']:
                raise Conflict('Feedback refers to a missing candidate generation; preserve it for reconciliation')
            key = (id_, version)
            if key not in groups:
                payload = json.loads(review.contents(version, 'span.json'))
                groups[key] = {'id': id_, 'file': edit['file'], 'version': version, 'current_version': edit['versions'][-1],
                    'original': review.contents(version, 'original.tex'),
                    'options': payload.get('options', [{'label': 'A', 'after': payload['after'], 'reason': '已有单方案'}]), 'requests': []}
            groups[key]['requests'].append(note)
    verify_read(review)
    return {'items': list(groups.values()), 'sha256': digest(review.raw)}


def initial_source_context(root, roles, args):
    """Reading a selected new-paper passage never requires initializing review state."""
    if args.get('ids'):
        raise Conflict('No initialized batch; existing review IDs cannot be inferred')
    texts, originals, spans, selections = {}, {}, {}, []
    def read(file):
        if file not in texts:
            originals[file] = relative_file(root, file).read_bytes()
            texts[file] = body(originals[file].decode('utf-8-sig'))
        return texts[file]
    for spec in args.get('scopes', []):
        selected, surrounding = source_scope(read(spec['file']), spec)
        spans.setdefault(spec['file'], []).append(surrounding)
        selections.append({'file': spec['file'], 'start': selected[0], 'end': selected[1]})
    for file in args.get('files', []):
        spans[file] = [(0, len(read(file)))]
    for entry in roles['structure']:
        read(entry['file'])
    result = {'sources': {file: [{'start': a, 'end': b, 'text': texts[file][a:b]} for a, b in ranges] for file, ranges in spans.items()},
              'selections': selections, 'author_comments': comment_context(texts, spans, roles)}
    if any(relative_file(root, file).read_bytes() != raw for file, raw in originals.items()):
        raise ToolConflict('Source changed during reading', 'context_changed', {'action': 'read_context', 'automatic_retry': False})
    return result


def role_packet(roles):
    return {k: roles[k] for k in ('status', 'owner', 'files', 'roots')} if roles['status'] == 'confirmed' else roles


def expand_questions(value, pool, field):
    """Callers choose associations; the ordinary writer still verifies every quote."""
    if 'question_refs' not in value:
        return value
    refs = value['question_refs']
    if not isinstance(pool, dict) or not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in pool for ref in refs):
        raise FieldConflict(field + 'question_refs', 'Every question reference must name an entry in this request question_pool')
    direct = value.get('questions', [])
    if not isinstance(direct, list):
        raise FieldConflict(field + 'questions', 'questions must be an array')
    return {**{k: v for k, v in value.items() if k != 'question_refs'}, 'questions': [*direct, *[pool[ref] for ref in refs]]}


def ai_context(review, roles, ids=None, files=None, scopes=None, known_feedback=None):
    """AI projection: exact text/metadata, never display diffs or duplicate ledger history."""
    review.assert_ready()
    texts, spans, selections = {}, {}, []
    def read(file):
        if file not in texts:
            texts[file] = review.read(file)
        return texts[file]
    for spec in scopes or []:
        selected, surrounding = source_scope(read(spec['file']), spec)
        selections.append({'file': spec['file'], 'start': selected[0], 'end': selected[1]})
        spans.setdefault(spec['file'], []).append(surrounding)
    targets = selected_ids(review, ids if ids is not None else [] if scopes is not None and files is None else None, files)
    edits = review.state['edits']
    # A new selection must reveal existing overlapping candidates before AI proposes another.
    for id_, edit in edits.items():
        relevant = [s for s in selections if s['file'] == edit['file']]
        if edit['status'] not in PENDING or not relevant:
            continue
        payload = review.payload(edit)
        try:
            a, b = locate(read(edit['file']), review.live_excerpt(edit, payload), payload['left'], payload['right'])
            matches = any(max(a, s['start']) < min(b, s['end']) or (s['start'] == s['end'] and a <= s['start'] <= b)
                          or (a == b and s['start'] <= a <= s['end']) for s in relevant)
        except Conflict:
            matches = True  # Reveal unresolved source conflicts in the selected file, never hide them.
        if matches and id_ not in targets:
            targets.append(id_)
    included = set(targets)
    # Include dependents affected by target changes, then their transitive prerequisites.
    included.update(id_ for id_, edit in edits.items() if edit['status'] in PENDING and any(dep in targets for dep in edit.get('deps', [])))
    queue = list(included)
    for id_ in queue:
        for dep in edits[id_].get('deps', []):
            if dep not in edits:
                raise Conflict('Missing review dependency: ' + dep)
            if dep not in included:
                included.add(dep); queue.append(dep)
    result = {'sha256': digest(review.raw), 'session': review.state.get('session'), 'next': review.state['next'],
              'targets': targets, 'items': {}, 'sources': {}, 'questions': {}, 'selections': selections,
              'source_scope': 'Explicit files are complete; ids/scopes include surrounding paragraphs. Offsets refer to source without the runtime state block.'}
    # Inspect rules without sending every unrelated comment to the model.
    for file in dict.fromkeys([review.state_rel, *[entry['file'] for entry in roles['structure']]]):
        read(file)
    question_keys = {}
    for id_ in edits:
        if id_ not in included:
            continue
        edit = edits[id_]
        item = {key: value for key, value in edit.items() if key not in ('versions', 'requests', 'questions')}
        item.update(id=id_, requests=[note for note in edit.get('requests', []) if note['status'] == 'open'])
        item['question_refs'] = []
        for question in edit.get('questions', []):
            key = tuple(question[k] for k in ('id', 'file', 'quote'))
            if key not in question_keys:
                ref = 'q' + str(len(question_keys) + 1)
                question_keys[key] = ref
                result['questions'][ref] = question
            item['question_refs'].append(question_keys[key])
        result['items'][id_] = item
        if not edit['versions']:
            item['archived'] = True
            continue
        payload = review.payload(edit)
        item.update(version=edit['versions'][-1], original=payload['before'],
                    options=payload.get('options', [{'label': 'A', 'after': payload['after'], 'reason': '已有单方案'}]),
                    intent=payload.get('intent'), fewer_options_reason=payload.get('fewer_options_reason', ''),
                    left=payload['left'], right=payload['right'])
        receipt = review.feedback_receipt(id_)
        item['feedback_receipt'] = receipt
        if receipt in (known_feedback or []):
            for key in ('original', 'options', 'requests'):
                item.pop(key)
            item['feedback_reused'] = True
        text = read(edit['file'])
        try:
            start, end = locate(text, review.live_excerpt(edit, payload), payload['left'], payload['right'])
            item['source_match'] = True
        except Conflict as error:
            item.update(source_match=False, conflict=str(error))
            continue
        spans.setdefault(edit['file'], []).append(paragraph_context(text, start, end))
    full_files = files or []
    for file in full_files:
        text = read(file)
        spans[file] = [(0, len(text))]
    for file, ranges in spans.items():
        merged = []
        for start, end in sorted(ranges):
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
            else:
                merged.append((start, end))
        result['sources'][file] = [{'start': start, 'end': end, 'text': read(file)[start:end]} for start, end in merged]
    result['author_comments'] = comment_context(texts, spans, roles)
    verify_read(review)
    return result

class Server:
    def __init__(self, registrations):
        self.registrations = Path(registrations)

    def project(self, requested):
        root = Path(requested).resolve(strict=True)
        for file in self.registrations.glob('*.json'):
            if file.is_symlink() or file.is_junction() or not file.is_file():
                raise Conflict('MCP registration is not a regular file')
            record = json.loads(file.read_text(encoding='utf-8'))
            if any(Path(p).exists() and root == Path(p).resolve(strict=True) for p in record['roots']):
                return root, record.get('git', 'git')
        raise Conflict('Project is not registered by a trusted local TeXScholar workspace; open it in VS Code first')

    def call(self, name, args):
        if name == 'get_instructions':
            return {**rule_packet(args), 'version': VERSION}
        if args.get('expected_plugin_version', VERSION) != VERSION:
            raise ToolConflict(f'当前 MCP 服务版本为 {VERSION}，与插件任务版本不一致。请重启 Codex 的 TeXScholar MCP 后继续；不要混用旧 MCP 与新版 CLI 或重复保存。',
                               'plugin_version_mismatch', {'action': 'restart_mcp', 'actual_version': VERSION,
                                                           'expected_version': args['expected_plugin_version'], 'automatic_retry': False})
        if name == 'submit_options':
            return self.submit(args)
        root, git = self.project(args['project'])
        if name == 'read_context':
            receipts = args.get('known_feedback', [])
            if not isinstance(receipts, list) or any(not isinstance(r, dict) or set(r) != {'id', 'version', 'fingerprint'}
                or any(not isinstance(v, str) or not v for v in r.values()) for r in receipts):
                raise FieldConflict('known_feedback', 'Use the exact known_feedback receipts from an attachment already available in this conversation')
            for key in ('ids', 'files'):
                if key in args and (not isinstance(args[key], list) or any(not isinstance(v, str) or not v for v in args[key])):
                    raise Conflict('ids and files must be arrays of nonempty strings')
            if 'scopes' in args:
                if not isinstance(args['scopes'], list) or any(not isinstance(s, dict) or not isinstance(s.get('file'), str)
                    or not s['file'] or any(not isinstance(s[k], str) for k in ('quote', 'section', 'left', 'right') if k in s)
                    for s in args['scopes']):
                    raise Conflict('scopes must be an array of file and string selectors')
        roles = scan_roles(root) if name == 'read_context' else None
        state = args.get('state')
        if name == 'read_context' and not state:
            owners, sources = [], []
            for directory, folders, files in os.walk(root, followlinks=False):
                folders[:] = [f for f in folders if f not in {'.git', '.codex-review', '.latex-build', 'node_modules', 'clean_dir'} and not Path(directory, f).is_symlink() and not Path(directory, f).is_junction()]
                for file in files:
                    path = Path(directory, file)
                    if path.suffix.lower() != '.tex' or path.is_symlink() or path.is_junction():
                        continue
                    text = path.read_text(encoding='utf-8-sig')
                    sources.append(path.relative_to(root).as_posix())
                    if '% CODEX-REVIEW-STATE-BEGIN' in text and '% CODEX-REVIEW-STATE-END' in text:
                        owners.append(path.relative_to(root).as_posix())
            if not owners:
                return {'initialized': False, 'plugin_version': VERSION, 'files': sources, 'file_roles': role_packet(roles), **rule_packet({**args, 'modules': [*args.get('modules', []), 'writing']}),
                        'context': initial_source_context(root, roles, args),
                        **self.references(root, args),
                        'next': 'Read actual author files. During authorized paper work establish one comment-only state header, then begin_review. Do not initialize merely for tool installation.'}
            if len(owners) != 1:
                raise Conflict('Reconcile multiple state owners; do not guess')
            state = owners[0]
        review = Review(root, state, git)
        if review.interrupted:
            raise ToolConflict('Interrupted transaction: inspect status then explicitly recover', 'interrupted_transaction',
                               {'action': 'inspect_status_then_explicit_recover', 'project': str(root),
                                'state': state, 'automatic_retry': False})
        if name == 'read_context':
            result = ai_context(review, roles, args.get('ids'), args.get('files'), args.get('scopes'), args.get('known_feedback')) if review.state else {**review.status(), **initial_source_context(root, roles, args)}
            rules = args if review.state else {**args, 'modules': [*args.get('modules', []), 'writing']}
            references = self.references(root, args)
            verify_read(review)
            return {'owner': state, 'context': result, 'file_roles': role_packet(roles), **rule_packet(rules), 'plugin_version': VERSION, **references}
        if name == 'read_feedback':
            return {**feedback_packet(review, args.get('ids')), 'plugin_version': VERSION}
        if name not in {'begin_review', 'propose_options', 'rework_options', 'link_questions'}:
            raise Conflict('Unknown or unavailable AI tool; decisions remain author actions')
        for key in ['expected_sha256', *(['id', 'version'] if name in ('rework_options', 'link_questions') else [])]:
            if not isinstance(args.get(key), str) or not args[key]:
                raise FieldConflict(key, 'Provide the current nonempty value for ' + key)
        if name in ('propose_options', 'rework_options'):
            if not isinstance(args.get('spec'), dict):
                raise FieldConflict('spec', 'spec must be a candidate object')
            if name == 'propose_options':
                for key in ('file', 'kind', 'before'):
                    if not isinstance(args['spec'].get(key), str):
                        raise FieldConflict('spec.' + key, 'Provide ' + key + ' as a string')
        apply = args.get('apply', True)
        if type(apply) is not bool:
            raise Conflict('apply must be boolean')
        def mutate(r):
            if args['expected_sha256'] != digest(r.raw):
                raise ToolConflict('State changed; reread the affected scope before writing', 'state_changed',
                                   {'action': 'read_context', **({'ids': [args['id']]} if 'id' in args else {'files': [args['spec']['file']]} if 'spec' in args else {}), 'automatic_retry': False})
            if name in {'rework_options', 'link_questions'}:
                edit = r.state['edits'].get(args['id']) if r.state else None
                if not edit:
                    raise ToolConflict('Review ID no longer exists in this batch', 'review_item_missing', {'action': 'read_context', 'automatic_retry': False})
                if not edit['versions'] or args['version'] != edit['versions'][-1]:
                    raise ToolConflict('Displayed candidate is stale; reread the current item', 'candidate_changed',
                                       {'action': 'read_context', 'ids': [args['id']], 'automatic_retry': False})
            if not apply:
                r.snapshot = lambda files, label: '0' * 40
            if name == 'begin_review':
                updated, result = r.begin(args['round'], args['files'], args.get('submission'))
            elif name in {'propose_options', 'rework_options'}:
                spec = expand_questions(args['spec'], args.get('question_pool', {}), 'spec.')
                if name == 'rework_options' and 'discard_annotations' not in spec and not spec.get('resolve_requests'):
                    spec = {**spec, 'discard_annotations': True}
                actual_roles = scan_roles(root)
                if actual_roles['status'] != 'confirmed':
                    raise ToolConflict('请先在 VS Code 执行“识别／确认论文文件角色”；文件映射未确认或结构已变化，不能猜测正文与回复信。',
                                       'roles_unconfirmed', {'action': 'confirm_file_roles_in_vscode', 'automatic_retry': False})
                file = spec['file'] if name == 'propose_options' else r.state['edits'][args['id']]['file']
                kind = spec['kind'] if name == 'propose_options' else r.state['edits'][args['id']]['kind']
                entry = next((item for item in actual_roles['files'] if item['file'] == file), None)
                allowed = {'manuscript', 'chapter'} if kind == 'manuscript' else {'response'}
                if not entry or not allowed.intersection(entry['roles']) or 'template' in entry['roles']:
                    raise Conflict('候选类型与已确认文件角色不符，或目标是参考模板；请由作者确认用途，不自动改写参考资料。')
                updated, result = r.propose_options(spec, args['id'] if name == 'rework_options' else None, args.get('version'))
            else:
                if type(args.get('replace', False)) is not bool:
                    raise Conflict('replace must be boolean')
                links = expand_questions(args, args.get('question_pool', {}), '')
                if 'questions' not in links:
                    raise FieldConflict('questions', 'Provide questions or explicit question_refs; use [] for an explicitly empty set')
                updated, result = r.update_questions(args['id'], args['version'], links['questions'], args.get('replace', False))
            if apply:
                r.persist(updated, args['expected_sha256'])
            receipt = {**result, 'applied': apply, 'plugin_version': VERSION,
                       'sha256': digest(r.encode(r.embedded())) if apply else digest(r.raw),
                       'next': 'Saved: use this sha256 for the next write; no full-context reread is required unless new input or a conflict occurs. Author acceptance remains separate.' if apply
                       else 'Preview only; nothing saved. Use the unchanged sha256 to apply if desired.'}
            if apply and 'id' in result:
                receipt['version'] = r.state['edits'][result['id']]['versions'][-1]
            return receipt
        if apply:
            with review.writer_lock():
                return mutate(Review(root, state, git))
        return mutate(review)

    @staticmethod
    def references(root, args):
        if 'references' not in args:
            return {}
        from reference_context import read_references
        return {'references': read_references(root, args['references'])}

    def submit(self, args):
        operations = args['operations']
        if not isinstance(operations, list) or not operations:
            raise Conflict('operations must be a nonempty list')
        results, sha = [], args['expected_sha256']
        for index, operation in enumerate(operations):
            current = {**{key: args[key] for key in BASE if key in args}, 'expected_sha256': sha, 'question_pool': args.get('question_pool', {})}
            try:
                if not isinstance(operation, dict) or operation.get('operation') not in {'propose_options', 'rework_options', 'link_questions'}:
                    raise FieldConflict('operation', 'Batch supports explicit propose_options / rework_options / link_questions')
                current.update({key: operation[key] for key in ('id', 'version', 'spec', 'questions', 'question_refs', 'replace') if key in operation})
                result = self.call(operation['operation'], current)
            except (Conflict, OSError, ValueError, KeyError, TypeError) as error:
                return {'complete': False, 'results': results, 'failed_index': index,
                        'not_attempted_indices': list(range(index + 1, len(operations))), 'sha256': sha,
                        'plugin_version': VERSION, 'error': error_detail(error, current),
                        'next': 'Earlier results remain saved. Do not replay them. Follow error.recovery; correct request fields without rereading, or reread changed context when required.'}
            results.append({'index': index, **result})
            sha = result['sha256']
        return {'complete': True, 'results': results, 'sha256': sha, 'plugin_version': VERSION,
                'next': 'All listed operations saved. Author acceptance remains separate; no reread or compilation required.'}

    def message(self, request):
        if 'id' not in request:
            return None
        id_ = request['id']
        method = request['method']
        if method == 'initialize':
            requested = request.get('params', {}).get('protocolVersion')
            return {'jsonrpc': '2.0', 'id': id_, 'result': {'protocolVersion': requested if requested in {'2024-11-05', '2025-03-26', '2025-06-18'} else '2025-03-26',
                    'serverInfo': {'name': 'texscholar', 'version': VERSION}, 'capabilities': {'tools': {}}, 'instructions': INSTRUCTIONS}}
        if method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': [{'name': n, 'description': d, 'inputSchema': s, 'annotations': {'readOnlyHint': read, 'destructiveHint': not read, 'openWorldHint': False}} for n, d, s, read in TOOLS]}
        elif method == 'tools/call':
            params = request['params']
            try:
                value = self.call(params['name'], params.get('arguments', {}))
                result = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}], 'structuredContent': value,
                          'isError': params['name'] == 'submit_options' and not value['complete']}
            except (Conflict, OSError, ValueError, KeyError, TypeError) as error:
                value = error_detail(error, params.get('arguments', {}))
                result = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}], 'structuredContent': value, 'isError': True}
        else:
            return {'jsonrpc': '2.0', 'id': id_, 'error': {'code': -32601, 'message': 'Method not found'}}
        return {'jsonrpc': '2.0', 'id': id_, 'result': result}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registrations', required=True)
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    server = Server(args.registrations)
    for line in sys.stdin:
        try:
            # The VS Code extension observes actual serving processes, not a probe
            # process or the configured launcher path. This is event-driven.
            try:
                from mcp_runtime import report
                report(args.registrations, VERSION, __file__)
            except (OSError, ValueError) as error:
                print('TeXScholar MCP version report failed: ' + str(error), file=sys.stderr, flush=True)
            reply = server.message(json.loads(line))
        except (ValueError, KeyError, TypeError) as error:
            reply = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': str(error)}}
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
