"""Local STDIO MCP adapter. UI and AI share Review's lock and transactions."""
from pathlib import Path
import argparse
import json
import os
import re
import sys
from source_review import Review, Conflict, PENDING, body, digest, locate
from document_roles import scan as scan_roles

HERE = Path(__file__).resolve().parent
VERSION = json.loads((HERE.parent / 'package.json').read_text(encoding='utf-8'))['version']
INSTRUCTIONS = (
    'TeXScholar manages local LaTeX manuscript and reviewer-response drafting/revision. '
    'First call read_context; use author-confirmed file_roles, never guess filenames or overwrite templates. '
    'Submit ranked A/B/C together per source location; use submit_options for multiple locations, or propose_options/rework_options for one; '
    'never overwrite formal prose before author acceptance. No global SKILL edits. '
    'Read exact author notes, current versions and feedback; no guessed question links. '
    'Acceptance, Git checkpoint and scientific closure are separate; AI tools do not accept candidates. '
    'Scope reads with ids/files; request relevant rule modules and reuse rules_receipt as known_rules. Do not reread CLI help or run setup for ordinary revisions. '
    'Writes validate and save by default; chain returned sha256/version, rereading only on conflicts or new input. '
    'Use plugin tools, not retired single-candidate CLI interfaces. Unrelated code/Typst tasks are outside this server.'
)

def schema(properties, required=()):
    return {'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': False}

STRING = {'type': 'string'}
OPTION = schema({'label': {'type': 'string', 'enum': ['A', 'B', 'C']}, 'after': STRING, 'reason': STRING,
                 'summary': {'type': 'string', 'description': 'One concise sentence naming the actual tradeoff versus the other options; not a quality score.'}}, ['label', 'after', 'reason'])
QUESTION = schema({k: STRING for k in ('id', 'file', 'quote')}, ['id', 'file', 'quote'])
BASE = {'project': STRING, 'state': STRING,
        'expected_plugin_version': {'type': 'string', 'description': 'Version from the current plugin task/feedback packet. A mismatch requires restarting Codex MCP, not CLI fallback.'}}
WRITE = {**BASE, 'expected_sha256': STRING, 'apply': {'type': 'boolean', 'default': True}}
STRINGS = {'type': 'array', 'items': STRING}
RULE_MODULES = ['core', 'writing', 'abstract', 'introduction', 'method', 'experiments', 'figures', 'response', 'questions', 'backup']
MODULES = {'type': 'array', 'items': {'type': 'string', 'enum': RULE_MODULES}}
RULES = {'modules': MODULES, 'known_rules': schema({'version': STRING, 'modules': MODULES}, ['version', 'modules'])}
READ = {**BASE, **RULES, 'ids': STRINGS, 'files': STRINGS}
SPEC = {'file': STRING, 'kind': {'type': 'string', 'enum': ['manuscript', 'response']},
        'intent': schema({'goal': STRING, 'preserve': STRING}, ['goal', 'preserve']),
        'before': STRING, 'left': STRING, 'right': STRING, 'location': STRING,
        'options': {'type': 'array', 'items': OPTION, 'minItems': 1, 'maxItems': 3},
        'fewer_options_reason': STRING, 'questions': {'type': 'array', 'items': QUESTION},
        'deps': {'type': 'array', 'items': STRING}, 'discard_annotations': {'type': 'boolean'},
        'resolve_requests': {'type': 'array', 'items': STRING}}
TOOLS = [
    ('get_instructions', 'Read requested rule modules; pass known_rules from an earlier receipt to omit unchanged modules. Core is always required. No SKILL edits.', schema(RULES), True),
    ('read_context', 'FIRST: exact source, author comments, current A/B/C, notes and dependencies. Use ids for specific revisions or files for full source of named files; omit both for all pending work. Reuse rules receipt.', schema(READ, ['project']), True),
    ('read_feedback', 'Read missing feedback generations, grouped once per ID/version; every note retains its exact option/selection. Optional ids scope.', schema({**BASE, 'ids': STRINGS}, ['project', 'state']), True),
    ('begin_review', 'Explicit new batch only, after protecting unbacked accepted results. Reuses an existing author-approved state header; never silently starts a batch.',
     schema({**WRITE, 'round': STRING, 'files': {'type': 'array', 'items': STRING}, 'submission': STRING}, ['project', 'state', 'expected_sha256', 'round', 'files']), False),
    ('propose_options', 'Validate and save ONE location with ranked A/B/C in one call. apply defaults true; no mandatory preview call. Chain returned sha256 for the next write. Formal prose unchanged.',
     schema({**WRITE, 'spec': schema(SPEC, ['file', 'kind', 'before', 'options'])}, ['project', 'state', 'expected_sha256', 'spec']), False),
    ('rework_options', 'Validate and replace pending alternatives under SAME ID using current feedback/version and A/B/C together. apply defaults true; chain returned sha256/version. No acceptance; optional discard_annotations.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options'])}, ['project', 'state', 'expected_sha256', 'id', 'version', 'spec']), False),
    ('link_questions', 'Append/deduplicate exact verified original reviewer quotes. Explicit replace only. No wording/version/notes/decision changes; never auto-pair.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'questions': {'type': 'array', 'items': QUESTION}, 'replace': {'type': 'boolean', 'default': False}},
            ['project', 'state', 'expected_sha256', 'id', 'version', 'questions']), False),
    ('submit_options', 'Save multiple explicit propose/rework operations in order, chaining state receipts internally. Stops at first failure; earlier successes remain saved. Never replay successful entries. No acceptance.',
     schema({**BASE, 'expected_sha256': STRING, 'operations': {'type': 'array', 'minItems': 1, 'items': schema({
         'operation': {'type': 'string', 'enum': ['propose_options', 'rework_options']},
         'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options'])}, ['operation', 'spec'])}},
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
        if name in ('core', 'questions'):
            file = 'collaboration-guide.md' if name == 'core' else 'question-linking-guide.md'
            parts.append((HERE / file).read_text(encoding='utf-8'))
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
    if not isinstance(error, ToolConflict):
        if str(error).startswith('Exact anchored span is missing or ambiguous'):
            scope = {'ids': [args['id']]} if 'id' in args else {'files': [args['spec']['file']]}
            error = ToolConflict(str(error), 'source_changed', {'action': 'read_context', **scope, 'automatic_retry': False})
        elif str(error) == 'Reviewer question quote must match its actual source uniquely':
            error = ToolConflict(str(error), 'question_quote_invalid', {'action': 'read_exact_question_source',
                'files': list(dict.fromkeys(q['file'] for q in args.get('questions', args.get('spec', {}).get('questions', []))
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


def ai_context(review, roles, ids=None, files=None):
    """AI projection: exact text/metadata, never display diffs or duplicate ledger history."""
    review.assert_ready()
    targets = selected_ids(review, ids, files)
    edits = review.state['edits']
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
              'targets': targets, 'items': {}, 'sources': {}, 'author_comments': {}, 'source_scope': 'full files' if ids is None else 'target paragraphs and adjacent paragraphs; request files for full source'}
    texts = {}
    def read(file):
        if file not in texts:
            texts[file] = review.read(file)
        return texts[file]
    # Preserve all author comments (including global rules and local plans), excluding runtime DATA.
    for file in dict.fromkeys([review.state_rel, *[entry['file'] for entry in roles['structure']]]):
        text = read(file)
        result['author_comments'][file] = [match.group() for match in re.finditer(r'(?m)(?:^[ \t]*%[^\n]*(?:\n|$))+', text)]
    spans = {}
    for id_ in edits:
        if id_ not in included:
            continue
        edit = edits[id_]
        item = {key: value for key, value in edit.items() if key not in ('versions', 'requests')}
        item.update(id=id_, requests=[note for note in edit.get('requests', []) if note['status'] == 'open'])
        result['items'][id_] = item
        if not edit['versions']:
            item['archived'] = True
            continue
        payload = review.payload(edit)
        item.update(version=edit['versions'][-1], original=payload['before'],
                    options=payload.get('options', [{'label': 'A', 'after': payload['after'], 'reason': '已有单方案'}]),
                    intent=payload.get('intent'), fewer_options_reason=payload.get('fewer_options_reason', ''),
                    left=payload['left'], right=payload['right'])
        text = read(edit['file'])
        try:
            start, end = locate(text, review.live_excerpt(edit, payload), payload['left'], payload['right'])
            item['source_match'] = True
        except Conflict as error:
            item.update(source_match=False, conflict=str(error))
            continue
        # Read-only context boundaries; never used as a replacement/splitting operation.
        gaps = list(re.finditer(r'\r?\n[ \t]*\r?\n', text))
        left = [gap.end() for gap in gaps if gap.end() <= start]
        right = [gap.start() for gap in gaps if gap.start() >= end]
        spans.setdefault(edit['file'], []).append((left[-2] if len(left) > 1 else 0, right[1] if len(right) > 1 else len(text)))
    full_files = files if files is not None else (list(dict.fromkeys(edits[id_]['file'] for id_ in included)) if ids is None else [])
    if ids is None and files is None and not targets:
        full_files = review.state['rounds'][-1]['files']
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
                               'plugin_version_mismatch', {'action': 'restart_mcp', 'automatic_retry': False})
        if name == 'submit_options':
            return self.submit(args)
        root, git = self.project(args['project'])
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
                return {'initialized': False, 'plugin_version': VERSION, 'files': sources, 'file_roles': roles, **rule_packet({**args, 'modules': [*args.get('modules', []), 'writing']}),
                        'next': 'Read actual author files. During authorized paper work establish one comment-only state header, then begin_review. Do not initialize merely for tool installation.'}
            if len(owners) != 1:
                raise Conflict('Reconcile multiple state owners; do not guess')
            state = owners[0]
        review = Review(root, state, git)
        if name == 'read_context':
            result = ai_context(review, roles, args.get('ids'), args.get('files')) if review.state else review.status()
            rules = args if review.state else {**args, 'modules': [*args.get('modules', []), 'writing']}
            return {'owner': state, 'context': result, 'file_roles': roles, **rule_packet(rules), 'plugin_version': VERSION}
        if name == 'read_feedback':
            return {**feedback_packet(review, args.get('ids')), 'plugin_version': VERSION}
        if name not in {'begin_review', 'propose_options', 'rework_options', 'link_questions'}:
            raise Conflict('Unknown or unavailable AI tool; decisions remain author actions')
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
                spec = args['spec']
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
                updated, result = r.update_questions(args['id'], args['version'], args['questions'], args.get('replace', False))
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

    def submit(self, args):
        operations = args['operations']
        if not isinstance(operations, list) or not operations:
            raise Conflict('operations must be a nonempty list')
        results, sha = [], args['expected_sha256']
        for index, operation in enumerate(operations):
            current = {**{key: args[key] for key in BASE if key in args}, 'expected_sha256': sha}
            try:
                if not isinstance(operation, dict) or operation.get('operation') not in {'propose_options', 'rework_options'}:
                    raise Conflict('Batch supports only explicit propose_options / rework_options')
                current.update({key: operation[key] for key in ('id', 'version', 'spec') if key in operation})
                result = self.call(operation['operation'], current)
            except (Conflict, OSError, ValueError, KeyError, TypeError) as error:
                return {'complete': False, 'results': results, 'failed_index': index,
                        'not_attempted_indices': list(range(index + 1, len(operations))), 'sha256': sha,
                        'plugin_version': VERSION, 'error': error_detail(error, current),
                        'next': 'Earlier results remain saved. Do not replay them. Resolve the failed item and reread its scope before submitting remaining operations.'}
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
            reply = server.message(json.loads(line))
        except (ValueError, KeyError, TypeError) as error:
            reply = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': str(error)}}
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
