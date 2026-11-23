"""Local STDIO MCP adapter. UI and AI share Review's lock and transactions."""
from pathlib import Path
from contextlib import nullcontext
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
    'never overwrite formal prose before author acceptance. No global SKILL edits without explicit author approval of the specific proposal. '
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
FULFILLMENT = schema({'request': STRING, 'request_version': STRING, 'request_text': STRING,
    'option': {'type':'string', 'enum':['A','B','C']}, 'start': {'type':'integer'}, 'end': {'type':'integer'}, 'quote': STRING,
    'explanation': STRING, 'status': {'type':'string', 'enum':['attempted','partial','author','evidence']}},
    ['request','request_version','request_text','option','start','end','quote','explanation','status'])
EVIDENCE_SCOPES = {'type':'array', 'items':schema({'file':STRING, 'start':{'type':'integer'}, 'end':{'type':'integer'}}, ['file','start','end'])}
BACKGROUND_ENTRY = schema({'kind':{'type':'string','enum':['background','method','data','constraints','other']}, 'text':STRING,
    'evidence':{'type':'string','enum':['author','source','unconfirmed']}, 'source':STRING, 'scope':STRING}, ['kind','text','evidence','source'])
PERSONAL_ENTRY = schema({'category':{'type':'string','enum':['writing','response','review','other']}, 'text':STRING, 'enabled':{'type':'boolean'}}, ['category','text','enabled'])
READ = {**BASE, **RULES, 'ids': STRINGS, 'files': STRINGS, 'scopes': SCOPES, 'known_feedback': FEEDBACK_RECEIPTS, 'references': REFERENCES, 'evidence_scopes':EVIDENCE_SCOPES}
FACT_EVIDENCE = schema({'option':{'type':'string','enum':['A','B','C']}, 'change_index':{'type':'integer'},
    'kind':{'type':'string','enum':['number','citation','math','term']}, 'change_old':{'type':'array','items':{'type':'array'}},
    'change_new':{'type':'array','items':{'type':'array'}}, 'file':STRING, 'start':{'type':'integer'},
    'end':{'type':'integer'}, 'quote':STRING, 'source_revision':STRING},
    ['option','change_index','kind','change_old','change_new','file','start','end','quote','source_revision'])
SPEC = {'file': STRING, 'kind': {'type': 'string', 'enum': ['manuscript', 'response']},
        'block_id': STRING,
        'intent': schema({'goal': STRING, 'preserve': STRING}, ['goal', 'preserve']),
        'before': STRING, 'left': STRING, 'right': STRING, 'location': {**STRING, 'description': '默认中文的简短位置标题；仅保留必要符号、编号和专有名词英文。'}, 'location_zh': STRING,
        'options': {'type': 'array', 'items': OPTION, 'minItems': 1, 'maxItems': 3},
        'fewer_options_reason': STRING, 'questions': {'type': 'array', 'items': QUESTION}, 'question_refs': STRINGS,
        'deps': {'type': 'array', 'items': STRING}, 'discard_annotations': {'type': 'boolean'},
        'resolve_requests': {'type': 'array', 'items': STRING}, 'fulfillment': {'type':'array', 'items':FULFILLMENT},
        'protected_terms': {'type':'array', 'items':STRING, 'description':'Only exact terms the author explicitly requires to preserve.'},
        'fact_evidence': {'type':'array', 'items':FACT_EVIDENCE}}
TOOLS = [
    ('get_instructions', 'Read requested rule modules; pass known_rules from an earlier receipt to omit unchanged modules. Core is always required. Specific SKILL changes require author approval.', schema(RULES), True),
    ('read_context', 'FIRST: ids for revisions, scopes for exact source/cursor/section, files only for full files. Default all pending items with local context. Pass known_feedback only from an attachment still in context; unchanged prose/notes are reused, source and state are checked. references reads explicit label/citation/macro keys. Reuse rules receipt.', schema(READ, ['project']), True),
    ('read_feedback', 'Read missing feedback generations, grouped once per ID/version; every note retains its exact option/selection. Optional ids scope.', schema({**BASE, 'ids': STRINGS}, ['project', 'state']), True),
    ('read_paper_background', 'Read only this registered paper and exact review owner background; not an authorization or scientific verification.', schema(BASE, ['project','state']), True),
    ('write_paper_background', 'Replace this paper background only with the last read revision; record author/source/unconfirmed and never copy a paper, secrets or review state.', schema({**BASE, 'revision':{'type':'integer','minimum':0}, 'entries':{'type':'array','items':BACKGROUND_ENTRY}}, ['project','state','revision','entries']), False),
    ('read_file_roles', 'Read exact registered project file roles and structure before author-confirmed changes.', schema(BASE, ['project']), True),
    ('write_file_roles', 'Save only the complete author-confirmed file map, using the exact prior scan, owner file digest and revision; never infer author approval.', schema({**BASE, 'spec':{'type':'object'}}, ['project','spec']), False),
    ('read_personal_prompts', 'Read this VS Code profile’s personal cross-paper preferences; inherit general SKILL rules rather than copying them.', schema(BASE, ['project']), True),
    ('write_personal_prompts', 'Update this profile only when the author explicitly requests a cross-paper preference; pass exact profile_id and revision, preserve other entries.', schema({**BASE, 'profile_id':{'type':['string','null']}, 'revision':{'type':'integer','minimum':0}, 'entries':{'type':'array','items':PERSONAL_ENTRY}}, ['project','profile_id','revision','entries']), False),
    ('begin_review', 'Explicit new batch only, after protecting unbacked accepted results. Reuses an existing author-approved state header; never silently starts a batch.',
     schema({**WRITE, 'round': STRING, 'files': {'type': 'array', 'items': STRING}, 'submission': STRING}, ['project', 'state', 'expected_sha256', 'round', 'files']), False),
    ('prepare_block', 'Preview fixed block boundaries first. Apply only after explicit author confirmation using the returned block_id and unchanged source/state revisions.',
     schema({**WRITE, 'spec': schema({'file': STRING, 'kind': {'type': 'string', 'enum': ['paragraph', 'display', 'slot', 'question']},
         'start': {'type': 'integer'}, 'end': {'type': 'integer'}, 'source_revision': STRING, 'block_id': STRING,
         'questions': {'type': 'array', 'items': QUESTION}},
         ['file', 'kind', 'start', 'end', 'source_revision'])}, ['project', 'state', 'expected_sha256', 'spec']), False),
    ('reassociate_block', 'Preview explicit repair of missing markers or reassociation of a uniquely moved block. Apply only after author confirmation.',
     schema({**WRITE, 'apply':{'type':'boolean','default':False}, 'spec':schema({'block_id':STRING, 'file':STRING, 'source_revision':STRING, 'restore':{'type':'boolean'},
                                    'start':{'type':'integer'}, 'end':{'type':'integer'}}, ['block_id','file','source_revision'])},
            ['project','state','expected_sha256','spec']), False),
    ('migrate_state', 'Preview migration first. Apply only after explicit author confirmation of the exact returned preview; never migrate a paper automatically.',
     schema({**BASE, 'apply': {'type':'boolean', 'default':False}, 'approved': {'type':'object'}}, ['project','state']), False),
    ('recover_migration', 'Preview an interrupted migration and resume only after explicit author confirmation of that exact preview.',
     schema({**BASE, 'apply': {'type':'boolean', 'default':False}, 'approved': {'type':'object'}}, ['project','state']), False),
    ('sync_block', 'Preview reconciliation of an author-edited block. Apply only on explicit author request with the same source revision and candidate version; conflicts never replace source.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'source_revision': STRING},
            ['project', 'state', 'expected_sha256', 'id', 'version', 'source_revision']), False),
    ('propose_options', 'Validate and save ONE location with ranked A/B/C in one call. apply defaults true; no mandatory preview call. Chain returned sha256 for the next write. Formal prose unchanged.',
     schema({**WRITE, 'spec': schema(SPEC, ['file', 'kind', 'before', 'options'])}, ['project', 'state', 'expected_sha256', 'spec']), False),
    ('rework_options', 'Replace pending A/B/C under SAME ID/version. External-state reviews preserve notes unless explicitly discarded; older embedded-state reviews retain their existing default. resolve_requests supports selective handling. Failure preserves state. No acceptance. Chain returned sha256/version.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options'])}, ['project', 'state', 'expected_sha256', 'id', 'version', 'spec']), False),
    ('relocate_options', 'Repair exact pending location only. Preserve ID/version/options/notes/decisions. Inspect with read_context first; before must equal the immutable live excerpt.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'spec': schema({'before': STRING, 'left': STRING, 'right': STRING}, ['before'])}, ['project', 'state', 'expected_sha256', 'id', 'version', 'spec']), False),
    ('reject_options', 'Only on explicit author request: reject one pending item without replacing deferred source. No acceptance or scientific issue closure.',
     schema({**WRITE, 'id': STRING, 'version': STRING}, ['project', 'state', 'expected_sha256', 'id', 'version']), False),
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

def feedback_skill_protocol():
    text = (HERE / 'collaboration-guide.md').read_text(encoding='utf-8')
    return next(section for section in re.split(r'(?m)(?=^## )', text) if section.startswith('## 返修批注与 SKILL 诊断\n'))


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
    headings = {'writing': ['保存论文约定与局部上下文', '参考引导与整体逻辑', 'AI 的工具入口'],
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
            containers = [args['spec'], args] if isinstance(args.get('spec'), dict) else [args]
            questions = [q for links in containers for q in [*links.get('questions', []),
                *[args.get('question_pool', {})[ref] for ref in links.get('question_refs', []) if ref in args.get('question_pool', {})]]]
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
    if any(review.question_source(file) != raw for file, raw in review.question_original.items()):
        raise ToolConflict('Reviewer question changed during reading; reread the requested scope', 'context_changed', {'action': 'read_context', 'automatic_retry': False})


def feedback_packet(review, ids=None):
    review.assert_ready()
    groups = {}
    for id_ in (selected_ids(review, ids) if ids is not None else review.state['edits']):
        edit = review.state['edits'][id_]
        notes = edit.get('requests', [])
        if any(not n.get('id') or not n.get('version') for n in [*notes, *(edit.get('previous_feedback') or {}).get('requests', [])]):
            raise Conflict('旧批注身份不完整；请先核对，无法安全交接。')
        identities = {(n['id'], n['version']) for n in notes}
        notes = [*notes, *(n for n in (edit.get('previous_feedback') or {}).get('requests', []) if (n['id'], n['version']) not in identities)]
        for note in notes:
            if not (note.get('held', False) or note['status'] == 'open'):
                continue
            version = note['version']
            if version not in edit['versions']:
                raise Conflict('Feedback refers to a missing candidate generation; preserve it for reconciliation')
            key = (id_, version)
            if key not in groups:
                payload = json.loads(review.contents(version, 'span.json'))
                options = payload.get('options', [{'label': 'A', 'after': payload['after'], 'reason': '已有单方案'}])
                groups[key] = {'id': id_, 'file': edit['file'], 'version': version, 'current_version': edit['versions'][-1],
                    'original': review.contents(version, 'original.tex'),
                    'options': [review.option_view(edit,payload,version,option) for option in options], 'requests': []}
            groups[key]['requests'].append({**note, 'purpose': note.get('purpose', 'revision')})
            label = note.get('option')
            if label and edit.get('option_migration', {}).get(version, {}).get(label):
                payload = json.loads(review.contents(version, 'span.json'))
                groups[key].setdefault('immutable_candidates_for_notes', {})[label] = {
                    'text':review.option(payload, label)['after'],
                    'scope':'仅用于核对批注原版选区；其中旧机器注释不是当前正文或已批准规则。'}
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
    direct = value.get('questions', [])
    if not isinstance(direct, list):
        raise FieldConflict(field + 'questions', 'questions must be an array')
    if 'question_refs' not in value:
        return value
    refs = value['question_refs']
    if not isinstance(pool, dict) or not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in pool for ref in refs):
        raise FieldConflict(field + 'question_refs', 'Every question reference must name an entry in this request question_pool')
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
            a, b = review.locate_edit(read(edit['file']), edit, payload)
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
              **review.backup_packet(),
              'source_scope': ('Explicit files are complete; ids/scopes include surrounding paragraphs. Offsets refer to the actual source including retained comments.'
                               if review.sidecar else 'Explicit files are complete; ids/scopes include surrounding paragraphs. Offsets refer to source without the runtime state block.')}
    # Inspect rules without sending every unrelated comment to the model.
    for file in dict.fromkeys(([] if review.sidecar else [review.state_rel]) + [entry['file'] for entry in roles['structure']]):
        read(file)
    question_keys = {}
    for id_ in edits:
        if id_ not in included:
            continue
        edit = edits[id_]
        item = {key: value for key, value in edit.items() if key not in ('versions', 'requests', 'questions', 'previous_feedback', 'option_migration')}
        item.update(id=id_, requests=[{**note, 'purpose':note.get('purpose', 'revision')} for note in edit.get('requests', []) if note['status'] == 'open'])
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
        options = payload.get('options', [{'label': 'A', 'after': payload['after'], 'reason': '已有单方案'}])
        item.update(version=edit['versions'][-1], original=payload['before'],
                    options=[review.option_view(edit,payload,edit['versions'][-1],option) for option in options],
                    intent=payload.get('intent'), fulfillment=payload.get('fulfillment', []), protected_terms=payload.get('protected_terms', []),
                    fact_evidence=review.evidence_status(payload.get('fact_evidence', [])), fewer_options_reason=payload.get('fewer_options_reason', ''),
                    left=payload['left'], right=payload['right'])
        from review_facts import changes as fact_changes
        item['fact_changes'] = {o['label']:fact_changes(payload['before'], o['after'], payload.get('protected_terms', [])) for o in item['options']}
        receipt = review.feedback_receipt(id_)
        item['feedback_receipt'] = receipt
        if receipt in (known_feedback or []):
            for key in ('original', 'options', 'requests'):
                item.pop(key)
            item['feedback_reused'] = True
        text = read(edit['file'])
        try:
            start, end = review.locate_edit(text, edit, payload)
            item['source_match'] = True
            if review.sidecar:
                item['source_range'] = {'start': start, 'end': end, 'source_revision': review.source_digest(text)}
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
    if review.sidecar:
        from review_blocks import index
        result['source_revisions'] = {file: review.source_digest(text) for file, text in texts.items()}
        result['blocks'], result['block_conflicts'] = {}, {}
        for file, text in texts.items():
            try:
                rows = list(index(text).values())
                for row in rows:
                    registered = review.state.get('blocks', {}).get(row['id'])
                    if not registered:
                        continue
                    if registered.get('file') != file or registered.get('kind') != row['kind']:
                        raise Conflict('审核块文件或类型不一致：' + row['id'])
                    if 'questions' in registered:
                        row['questions'] = review.question_links(registered['questions'])
                    if 'response_dependencies' in registered:
                        deps = registered['response_dependencies']
                        if not isinstance(deps, list) or any(not isinstance(dep, str) or dep not in edits for dep in deps):
                            raise Conflict('回复依赖项无效：' + row['id'])
                        row['response_dependencies'] = deps
                result['blocks'][file] = rows
            except ValueError as error:
                result['block_conflicts'][file] = str(error)
    result['author_comments'] = comment_context(texts, spans, roles)
    verify_read(review)
    return result

class Server:
    def __init__(self, registrations, migration_record=None):
        self.registrations = Path(registrations)
        self.migration_record = migration_record

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
            expected = args['expected_plugin_version']
            if re.fullmatch(r'\d+\.\d+\.\d+', expected) and tuple(map(int, expected.split('.'))) < tuple(map(int, VERSION.split('.'))):
                raise ToolConflict(f'当前 MCP 为 {VERSION}，新于任务标注的 {expected}。请从插件重新加入本批批注或准备任务，核实当前插件版本后再调用；不要为旧附件反复重启，也不要自行降低版本要求。',
                                   'task_version_outdated', {'action': 'refresh_plugin_task', 'actual_version': VERSION,
                                                             'expected_version': expected, 'automatic_retry': False})
            raise ToolConflict(f'当前 MCP 服务版本为 {VERSION}，与插件任务版本不一致。请重启拥有这条连接的 Codex 客户端的 TeXScholar MCP；仅重启 VS Code 不会刷新桌面应用的连接。不要混用旧 MCP 与新版 CLI 或重复保存。',
                               'plugin_version_mismatch', {'action': 'restart_mcp', 'actual_version': VERSION,
                                                           'expected_version': args['expected_plugin_version'], 'server_pid': os.getpid(),
                                                           'parent_pid': os.getppid(), 'automatic_retry': False})
        if name == 'submit_options':
            return self.submit(args)
        root, git = self.project(args['project'])
        if name == 'read_file_roles':
            result = scan_roles(root, self.registrations.parent)
            result['file_sha256'] = {fact['file']:digest(relative_file(root, fact['file']).read_bytes()) for fact in result['structure']}
            if result['owner']:
                result['owner_sha256'] = digest(relative_file(root, result['owner']).read_bytes())
            else:
                result['owner_sha256'] = None
            return result
        if name == 'write_file_roles':
            from document_roles import save as save_roles
            if not isinstance(args.get('spec'), dict):
                raise Conflict('请先读取完整角色登记并提供作者确认的内容。')
            return save_roles(root, args['spec'], self.registrations.parent)
        if name in ('read_personal_prompts', 'write_personal_prompts'):
            from paper_background import read_personal, write_personal
            if name == 'read_personal_prompts':
                return {**read_personal(self.registrations.parent), 'plugin_version':VERSION}
            if 'profile_id' not in args:
                raise Conflict('请先读取并提供当前个人资料身份。')
            return {**write_personal(self.registrations.parent, args.get('profile_id'), args.get('revision'), args.get('entries')), 'plugin_version':VERSION}
        if name in ('read_paper_background', 'write_paper_background'):
            state = args.get('state')
            if not isinstance(state, str) or not state:
                raise Conflict('请明确选择当前论文的审核状态归属。')
            Review(root, state, git, initialize=state == '.codex-review/state.json' and not (root / state).exists())
            from paper_background import read, write
            if name == 'read_paper_background':
                return {**read(self.registrations.parent, root, state), 'plugin_version': VERSION}
            return {**write(self.registrations.parent, root, state, args.get('revision'), args.get('entries')), 'plugin_version': VERSION}
        if name in ('migrate_state', 'recover_migration'):
            from review_migration import preview as migration_preview, apply as migration_apply, recovery_preview, recover as migration_recover
            from source_review import writer_lock_at
            apply = args.get('apply') is True
            approved = args.get('approved')
            if apply and not isinstance(approved, dict):
                raise Conflict('请先预览并提供作者确认的完整迁移预览。')
            with writer_lock_at(root / '.codex-review') if apply else nullcontext():
                if name == 'migrate_state':
                    review = Review(root, args['state'], git)
                    result = migration_apply(review, approved) if apply else migration_preview(review)
                else:
                    owner = None if args['state'].replace('\\', '/') == '.codex-review/state.json' else args['state']
                    result = migration_recover(root, approved) if apply else recovery_preview(root, owner)
            return {**result, 'applied':True} if apply else {'preview':result, 'applied':False}
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
        roles = scan_roles(root, self.registrations.parent, self.migration_record) if name == 'read_context' else None
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
            sidecar = root / '.codex-review' / 'state.json'
            if sidecar.exists():
                try:
                    pending = json.loads(sidecar.read_bytes())
                except (json.JSONDecodeError, UnicodeDecodeError):
                    raise Conflict('外置状态损坏或迁移未完成；请显式预览迁移恢复。')
                if isinstance(pending, dict) and isinstance(pending.get('transaction'), dict) and pending['transaction'].get('kind') == 'migration':
                    raise ToolConflict('迁移事务未完成；请显式预览并恢复迁移。', 'interrupted_transaction',
                                       {'action':'preview_migration_recovery', 'project':str(root), 'state':'.codex-review/state.json'})
                if any(re.search(r'(?m)^% CODEX-REVIEW-DATA ', (root / owner).read_text(encoding='utf-8-sig')) for owner in owners):
                    raise Conflict('Both embedded and external review states are active; reconcile before reading')
                state = '.codex-review/state.json'
            elif not owners:
                context = initial_source_context(root, roles, args)
                context.update(Review(root, '.codex-review/state.json', git, initialize=True).backup_packet())
                from paper_background import read as read_background
                from paper_background import read_personal
                return {'initialized': False, 'plugin_version': VERSION, 'files': sources, 'file_roles': role_packet(roles), **rule_packet({**args, 'modules': [*args.get('modules', []), 'writing']}),
                        'paper_background': read_background(self.registrations.parent, root, '.codex-review/state.json'),
                        'personal_prompts': read_personal(self.registrations.parent),
                        'context': context,
                        **self.references(root, args),
                        'state': '.codex-review/state.json', 'sha256': digest(b''),
                        'next': 'Read actual author files. During authorized paper work use begin_review with this absent-state receipt. Do not initialize merely for tool installation.'}
            elif len(owners) != 1:
                raise Conflict('Reconcile multiple state owners; do not guess')
            else:
                state = owners[0]
        initialize = name == 'begin_review' and state == '.codex-review/state.json'
        review = Review(root, state, git, initialize=initialize)
        if review.interrupted:
            raise ToolConflict('Interrupted transaction: inspect status then explicitly recover', 'interrupted_transaction',
                               {'action': 'inspect_status_then_explicit_recover', 'project': str(root),
                                'state': state, 'automatic_retry': False})
        if name == 'read_context':
            result = ai_context(review, roles, args.get('ids'), args.get('files'), args.get('scopes'), args.get('known_feedback')) if review.state else {**review.status(), **initial_source_context(root, roles, args)}
            rules = args if review.state else {**args, 'modules': [*args.get('modules', []), 'writing']}
            references = self.references(root, args)
            verify_read(review)
            packet = {'owner': state, 'context': result, 'file_roles': role_packet(roles), **rule_packet(rules), 'plugin_version': VERSION, **references}
            from paper_background import read as read_background
            from paper_background import read_personal
            packet['paper_background'] = read_background(self.registrations.parent, root, state)
            packet['personal_prompts'] = read_personal(self.registrations.parent)
            if review.state and any(any(note.get('status') == 'open' for note in review.state['edits'][id_].get('requests', [])) for id_ in result.get('items', {})):
                packet['feedback_skill_protocol'] = feedback_skill_protocol()
            return packet
        if name == 'read_feedback':
            packet = feedback_packet(review, args.get('ids'))
            from paper_background import read as read_background
            from paper_background import read_personal
            return {**packet, **({'feedback_skill_protocol': feedback_skill_protocol()} if packet['items'] else {}),
                    'paper_background': read_background(self.registrations.parent, root, state), 'personal_prompts':read_personal(self.registrations.parent), 'plugin_version': VERSION}
        if name not in {'begin_review', 'prepare_block', 'reassociate_block', 'sync_block', 'propose_options', 'rework_options', 'link_questions', 'relocate_options', 'reject_options'}:
            raise Conflict('Unknown or unavailable AI tool; decisions remain author actions')
        for key in ['expected_sha256', *(['id', 'version'] if name in ('rework_options', 'link_questions', 'relocate_options', 'reject_options', 'sync_block') else []),
                    *(['source_revision'] if name == 'sync_block' else [])]:
            if not isinstance(args.get(key), str) or not args[key]:
                raise FieldConflict(key, 'Provide the current nonempty value for ' + key)
        if name in ('propose_options', 'rework_options'):
            if not isinstance(args.get('spec'), dict):
                raise FieldConflict('spec', 'spec must be a candidate object')
            if name == 'propose_options':
                for key in ('file', 'kind', 'before'):
                    if not isinstance(args['spec'].get(key), str):
                        raise FieldConflict('spec.' + key, 'Provide ' + key + ' as a string')
            spec = expand_questions(args['spec'], args.get('question_pool', {}), 'spec.')
            links = expand_questions({key: args[key] for key in ('questions', 'question_refs') if key in args},
                                     args.get('question_pool', {}), '')
            if 'questions' in links:
                spec = {**spec, 'questions': [*spec.get('questions', []), *links['questions']]}
            # Preview and locked persistence consume this same normalized spec.
            args = {**args, 'spec': spec}
        apply = args.get('apply', False if name == 'reassociate_block' else True)
        if type(apply) is not bool:
            raise Conflict('apply must be boolean')
        def mutate(r):
            if args['expected_sha256'] != digest(r.raw):
                raise ToolConflict('State changed; reread the affected scope before writing', 'state_changed',
                                   {'action': 'read_context', **({'ids': [args['id']]} if 'id' in args else {'files': [args['spec']['file']]} if 'spec' in args else {}), 'automatic_retry': False})
            if name in {'rework_options', 'link_questions', 'relocate_options', 'reject_options', 'sync_block'}:
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
            elif name == 'prepare_block':
                if apply and not args['spec'].get('block_id'):
                    raise Conflict('Apply requires the block ID from the preview')
                updated, result = r.prepare_block(args['spec'])
            elif name == 'reassociate_block':
                updated, result = r.reassociate_block(args['spec'])
            elif name == 'sync_block':
                updated, result = r.sync_block(args['id'], args['version'], args['source_revision'])
            elif name == 'relocate_options':
                updated, result = r.relocate(args['id'], args['version'], args['spec'])
            elif name == 'reject_options':
                updated, result = r.decide([], [args['id']], {args['id']: args['version']})
            elif name in {'propose_options', 'rework_options'}:
                spec = args['spec']
                if name == 'rework_options' and not r.sidecar and 'discard_annotations' not in spec and not spec.get('resolve_requests'):
                    spec = {**spec, 'discard_annotations': True}
                actual_roles = scan_roles(root, self.registrations.parent)
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
            unchanged = name in ('sync_block','reassociate_block') and not result['changed']
            if apply and not unchanged:
                r.persist(updated, args['expected_sha256'])
            receipt = {**result, 'applied': apply, 'plugin_version': VERSION,
                       'sha256': digest(r.state_bytes() if r.sidecar else r.encode(r.embedded())) if apply and not unchanged else digest(r.raw),
                       'next': 'Saved: use this sha256 for the next write; no full-context reread is required unless new input or a conflict occurs. Author acceptance remains separate.' if apply
                       else 'Preview only; nothing saved. Use the unchanged sha256 to apply if desired.'}
            if 'id' in result:
                receipt['questions'] = r.state['edits'][result['id']].get('questions', [])
                if apply:
                    receipt['version'] = r.state['edits'][result['id']]['versions'][-1]
            return receipt
        if apply:
            with review.writer_lock():
                return mutate(Review(root, state, git, initialize=initialize))
        return mutate(review)

    @staticmethod
    def references(root, args):
        from reference_context import read_references, read_evidence_scopes
        result = {}
        if 'references' in args:
            result['references'] = read_references(root, args['references'])
        if 'evidence_scopes' in args:
            result['evidence_scopes'] = read_evidence_scopes(root, args['evidence_scopes'])
        return result

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
