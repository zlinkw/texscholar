"""Local STDIO MCP adapter. UI and AI share Review's lock and transactions."""
from pathlib import Path
import argparse
import json
import os
import sys
from source_review import Review, Conflict, body, digest
from document_roles import scan as scan_roles

HERE = Path(__file__).resolve().parent
INSTRUCTIONS = (
    'TeXScholar manages local LaTeX manuscript and reviewer-response drafting/revision. '
    'First call read_context; use author-confirmed file_roles, never guess filenames or overwrite templates. '
    'Submit ranked A/B/C together for one source location via propose_options or rework_options; '
    'never overwrite formal prose before author acceptance. No global SKILL edits. '
    'Read exact author notes, current versions and feedback; no guessed question links. '
    'Acceptance, Git checkpoint and scientific closure are separate; AI tools do not accept candidates. '
    'Use plugin tools, not retired single-candidate CLI interfaces. Unrelated code/Typst tasks are outside this server.'
)

def schema(properties, required=()):
    return {'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': False}

STRING = {'type': 'string'}
OPTION = schema({'label': {'type': 'string', 'enum': ['A', 'B', 'C']}, 'after': STRING, 'reason': STRING}, ['label', 'after', 'reason'])
QUESTION = schema({k: STRING for k in ('id', 'file', 'quote')}, ['id', 'file', 'quote'])
BASE = {'project': STRING, 'state': STRING}
WRITE = {**BASE, 'expected_sha256': STRING, 'apply': {'type': 'boolean', 'default': True}}
SPEC = {'file': STRING, 'kind': {'type': 'string', 'enum': ['manuscript', 'response']},
        'before': STRING, 'left': STRING, 'right': STRING, 'location': STRING,
        'options': {'type': 'array', 'items': OPTION, 'minItems': 1, 'maxItems': 3},
        'fewer_options_reason': STRING, 'questions': {'type': 'array', 'items': QUESTION},
        'deps': {'type': 'array', 'items': STRING}, 'discard_annotations': {'type': 'boolean'},
        'resolve_requests': {'type': 'array', 'items': STRING}}
TOOLS = [
    ('get_instructions', 'Read current plugin-owned rules. No SKILL installation/modification.', schema({}), True),
    ('read_context', 'FIRST for paper/reply work: discover the unique state, exact source, author notes, pending A/B/C and current versions. Read-only.', schema(BASE, ['project']), True),
    ('read_feedback', 'Read pending feedback with exact original, all alternatives, option/version and selected words. Never guess locators.', schema(BASE, BASE), True),
    ('begin_review', 'Explicit new batch only, after protecting unbacked accepted results. Reuses an existing author-approved state header; never silently starts a batch.',
     schema({**WRITE, 'round': STRING, 'files': {'type': 'array', 'items': STRING}, 'submission': STRING}, ['project', 'state', 'expected_sha256', 'round', 'files']), False),
    ('propose_options', 'Save ONE location with ranked A/B/C in one call, not three overlapping IDs. Three genuinely different alternatives; fewer requires an explicit reason. Formal prose unchanged.',
     schema({**WRITE, 'spec': schema(SPEC, ['file', 'kind', 'before', 'options'])}, ['project', 'state', 'expected_sha256', 'spec']), False),
    ('rework_options', 'Replace pending alternatives under SAME ID after reading feedback. Supply exact current version and A/B/C together. No automatic acceptance; optional explicit discard_annotations.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'spec': schema(SPEC, ['options'])}, ['project', 'state', 'expected_sha256', 'id', 'version', 'spec']), False),
    ('link_questions', 'Append/deduplicate exact verified original reviewer quotes. Explicit replace only. No wording/version/notes/decision changes; never auto-pair.',
     schema({**WRITE, 'id': STRING, 'version': STRING, 'questions': {'type': 'array', 'items': QUESTION}, 'replace': {'type': 'boolean', 'default': False}},
            ['project', 'state', 'expected_sha256', 'id', 'version', 'questions']), False),
]

def protocol():
    return '\n\n'.join((HERE / name).read_text(encoding='utf-8') for name in ('collaboration-guide.md', 'writing-guide.md', 'question-linking-guide.md'))

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
            return {'protocol': protocol(), 'version': json.loads((HERE.parent / 'package.json').read_text(encoding='utf-8'))['version']}
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
                return {'initialized': False, 'files': sources, 'file_roles': roles, 'protocol': protocol(),
                        'next': 'Read actual author files. During authorized paper work establish one comment-only state header, then begin_review. Do not initialize merely for tool installation.'}
            if len(owners) != 1:
                raise Conflict('Reconcile multiple state owners; do not guess')
            state = owners[0]
        review = Review(root, state, git)
        if name == 'read_context':
            result = review.cards() if review.state else review.status()
            if 'sources' in result:
                result['sources'] = {file: body(text) for file, text in result['sources'].items()}
            return {'owner': state, 'context': result, 'file_roles': roles, 'protocol': protocol()}
        if name == 'read_feedback':
            return review.feedback_context()
        if name not in {'begin_review', 'propose_options', 'rework_options', 'link_questions'}:
            raise Conflict('Unknown or unavailable AI tool; decisions remain author actions')
        apply = args.get('apply', True)
        if type(apply) is not bool:
            raise Conflict('apply must be boolean')
        def mutate(r):
            if args['expected_sha256'] != digest(r.raw):
                raise Conflict('State changed; reread context before writing')
            if not apply:
                r.snapshot = lambda files, label: '0' * 40
            if name == 'begin_review':
                updated, result = r.begin(args['round'], args['files'], args.get('submission'))
            elif name in {'propose_options', 'rework_options'}:
                spec = args['spec']
                actual_roles = scan_roles(root)
                if actual_roles['status'] != 'confirmed':
                    raise Conflict('请先在 VS Code 执行“识别／确认论文文件角色”；文件映射未确认或结构已变化，不能猜测正文与回复信。')
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
            return {**result, 'applied': apply, 'next': 'Refresh/read context. Author chooses a proposal; no acceptance or scientific closure performed.'}
        if apply:
            with review.writer_lock():
                return mutate(Review(root, state, git))
        return mutate(review)

    def message(self, request):
        if 'id' not in request:
            return None
        id_ = request['id']
        method = request['method']
        if method == 'initialize':
            requested = request.get('params', {}).get('protocolVersion')
            return {'jsonrpc': '2.0', 'id': id_, 'result': {'protocolVersion': requested if requested in {'2024-11-05', '2025-03-26', '2025-06-18'} else '2025-03-26',
                    'serverInfo': {'name': 'texscholar', 'version': '0.9.12'}, 'capabilities': {'tools': {}}, 'instructions': INSTRUCTIONS}}
        if method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': [{'name': n, 'description': d, 'inputSchema': s, 'annotations': {'readOnlyHint': read, 'destructiveHint': not read, 'openWorldHint': False}} for n, d, s, read in TOOLS]}
        elif method == 'tools/call':
            params = request['params']
            try:
                value = self.call(params['name'], params.get('arguments', {}))
                result = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}], 'structuredContent': value, 'isError': False}
            except (Conflict, OSError, ValueError, KeyError, TypeError) as error:
                result = {'content': [{'type': 'text', 'text': str(error)}], 'isError': True}
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
