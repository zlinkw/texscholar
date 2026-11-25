"""In-process host fixture for backend tests; real editor tests are separate."""
import base64
import json
from pathlib import Path
from review_host_client import HostError


class FakeHostSession:
    def __init__(self, root):
        self.root = Path(root)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def check(self):
        pass

    @staticmethod
    def write(path, raw):
        path.write_bytes(raw)

    def object(self, commit):
        value = json.loads((self.root / '.codex-review' / 'objects' / f'{commit}.json').read_bytes())
        return {key: base64.b64decode(data, validate=True) for key, data in value['files'].items()}

    def apply_legacy(self, commit):
        plan = json.loads(self.object(commit)['host-plan'])
        return self.apply_roles(plan)

    def apply_roles(self, plan):
        decode = lambda value: base64.b64decode(value, validate=True)
        owner = self.root / plan['owner']
        files = [(self.root / item['file'], decode(item['before']), decode(item['after'])) for item in plan['files']]
        checks = [(self.root / item['file'], decode(item['before'])) for item in plan['checks']]
        if owner.read_bytes() != decode(plan['owner_before']) or any(path.read_bytes() != before for path, before, _ in files) or any(path.read_bytes() != before for path, before in checks):
            raise HostError('fixture source changed')
        if plan['owner_intent'] is not None:
            self.write(owner, decode(plan['owner_intent']))
        for path, before, after in files:
            if before != after:
                self.write(path, after)
        self.write(owner, decode(plan['owner_after']))
        return {'owner': plan['owner']}

    def apply(self, state_sha, commit, final_raw, recover=False):
        from source_review import digest
        state_path = self.root / '.codex-review' / 'state.json'
        state_raw = state_path.read_bytes()
        if digest(state_raw) != state_sha:
            raise HostError('fixture state changed')
        state, obj = json.loads(state_raw), self.object(commit)
        files = []
        for index, rel in enumerate(state['transaction']['files']):
            path = self.root / rel
            before, after = obj[f'{index}-old'], obj[f'{index}-new']
            actual = path.read_bytes()
            if actual != before and not (recover and actual == after):
                raise HostError('author/concurrent edits')
            files.append((path, actual, after))
        for index, rel in enumerate(state['transaction'].get('checks', [])):
            if (self.root / rel).read_bytes() != obj[f'check-{index}']:
                raise HostError('fixture check changed')
        resources = []
        for index, rel in enumerate(state['transaction'].get('created', [])):
            path, after = self.root / rel, obj[f'resource-{index}-new']
            if Path(rel).name != 'texscholar-excerpt.sty' or '..' in Path(rel).parts or path.is_symlink():
                raise HostError('fixture resource path')
            if path.exists() and not (recover and path.is_file() and path.read_bytes() == after):
                raise HostError('fixture resource changed')
            resources.append((path, after))
        for path, after in resources:
            if not path.exists():
                with path.open('xb') as stream:
                    stream.write(after)
        for path, actual, after in files:
            if actual != after:
                self.write(path, after)
        self.write(state_path, final_raw)
        return {'sha256':digest(final_raw)}
