"""Isolated MCP transport, source integrity and owned-config checks."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from mcp_server import Server, TOOLS
from mcp_config import configure, check
import native_review_test as fixtures
from source_review import digest
from document_roles import scan as scan_roles, save as save_roles

class MCP(unittest.TestCase):
    def setUp(self):
        fixtures.NativeReview.setUp(self)
        data = scan_roles(self.root)
        save_roles(self.root, {'owner': 'main.tex', 'previous_owner': None, 'previous_files': [],
            'owner_sha256': digest((self.root / 'main.tex').read_bytes()), 'structure': data['structure'], 'files': [
                {'file': 'main.tex', 'roles': ['manuscript'], 'root': 'main.tex'},
                {'file': 'reply.tex', 'roles': ['response', 'review'], 'root': 'reply.tex'}]})
    apply = fixtures.NativeReview.apply
    review = fixtures.NativeReview.review

    def server(self):
        directory = self.root / 'registrations'; directory.mkdir(exist_ok=True)
        (directory / 'closed-workspace.json').write_text(json.dumps({'roots': [str(self.root / 'already-removed-project')]}), encoding='utf-8')
        (directory / 'fixture.json').write_text(json.dumps({'roots': [str(self.root)]}), encoding='utf-8')
        return Server(directory)

    def test_first_message_instructions_ranked_write_feedback_and_stale_failures(self):
        server = self.server()
        init = server.message({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26'}})['result']
        self.assertIn('A/B/C', init['instructions'])
        self.assertIn('No global SKILL', init['instructions'][:512])
        self.assertNotIn('accept', [tool[0] for tool in TOOLS])
        context = server.call('read_context', {'project': str(self.root)})
        self.assertEqual(context['owner'], 'reply.tex')
        self.assertIn('propose-options', context['protocol'])
        source = (self.root / 'main.tex').read_bytes()
        args = {'project': str(self.root), 'state': 'reply.tex', 'expected_sha256': context['context']['sha256'], 'spec': {
            'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': [
                {'label': label, 'after': 'The model is ' + word + '.', 'reason': label} for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]}}
        self.assertFalse(server.call('propose_options', {**args, 'apply': False})['applied'])
        self.assertEqual(self.review().state['edits'], {})
        result = server.call('propose_options', args)
        self.assertTrue(result['applied'])
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        data = self.review().inspect(result['id'])
        self.assertEqual(len(data['options']), 3)
        stale = server.message({'id': 2, 'method': 'tools/call', 'params': {'name': 'propose_options', 'arguments': args}})
        self.assertTrue(stale['result']['isError'])
        self.assertIn('State changed', stale['result']['content'][0]['text'])
        self.apply('feedback', {'id': '1', 'version': data['version'], 'side': 'candidate', 'option': 'B', 'start': 13, 'end': 20, 'quote': 'compact', 'text': '改得更明确。'})
        notes = server.call('read_feedback', {'project': str(self.root), 'state': 'reply.tex'})['items']
        self.assertEqual(notes[0]['option'], 'B')
        args.update(id='1', version=data['version'], expected_sha256=digest(self.review().raw))
        args['spec']['options'][1]['after'] = 'The model is compact in this setting.'
        args['spec']['discard_annotations'] = True
        server.call('rework_options', args)
        self.assertFalse(self.review().inspect('1')['edit'].get('requests'))
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        bad = server.message({'id': 3, 'method': 'tools/call', 'params': {'name': 'read_context', 'arguments': {'project': str(self.root.parent)}}})
        self.assertTrue(bad['result']['isError'])

    def test_stdio_catalog_and_notifications_and_retired_cli_are_real_processes(self):
        registrations = self.server().registrations
        messages = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26'}},
                    {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'read_context', 'arguments': {'project': str(self.root)}}}]
        result = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('mcp_server.py')), '--registrations', str(registrations)],
                                input=''.join(json.dumps(m) + '\n' for m in messages).encode('utf-8'), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        replies = [json.loads(row) for row in result.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [1, 2, 3])
        self.assertEqual(len(replies[1]['result']['tools']), len(TOOLS))
        self.assertFalse(replies[2]['result']['isError'])
        for command in ('propose', 'rework'):
            retired = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')), '--project', str(self.root), '--state', 'reply.tex', command], capture_output=True)
            self.assertNotEqual(retired.returncode, 0)
            self.assertIn('invalid choice', retired.stderr.decode('utf-8'))

    def test_config_changes_only_owned_mcp_keeps_skill_preferences_and_disabled_state(self):
        home = self.root / 'codex-home'; home.mkdir()
        path = home / 'config.toml'
        original = 'model = "author-choice"\n[skills]\ncustom = true\n[mcp_servers.other]\ncommand = "keep-me"\n'
        path.write_text(original, encoding='utf-8')
        launcher = self.root / '插件 空格' / 'launch.py'
        result = configure(home, launcher, sys.executable)
        self.assertFalse(result['connected']); self.assertEqual(path.read_text(encoding='utf-8'), original)
        self.assertTrue(configure(home, launcher, sys.executable, True)['connected'])
        parsed = tomllib.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(parsed['skills'], {'custom': True})
        self.assertEqual(parsed['mcp_servers']['other']['command'], 'keep-me')
        self.assertFalse(configure(home, launcher, sys.executable)['changed'])
        before_check = path.read_bytes()
        self.assertTrue(check(home, launcher, sys.executable)['connected'])
        self.assertEqual(path.read_bytes(), before_check)
        self.assertFalse(check(home / 'absent', launcher, sys.executable)['connected'])
        self.assertFalse((home / 'absent').exists())
        path.write_text(path.read_text(encoding='utf-8').replace('enabled = true', 'enabled = false\ntool_timeout_sec = 90'), encoding='utf-8')
        self.assertFalse(configure(home, launcher, sys.executable)['connected'])
        configure(home, launcher, sys.executable, True)
        self.assertEqual(tomllib.loads(path.read_text(encoding='utf-8'))['mcp_servers']['texscholar']['tool_timeout_sec'], 90)
        path.write_text('[mcp_servers.texscholar]\ncommand = "author-command"\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'unmanaged'):
            configure(home, launcher, sys.executable, True)
        self.assertIn('author-command', path.read_text(encoding='utf-8'))

    def test_roles_are_shared_with_ai_and_ambiguous_or_wrong_kind_writes_stop(self):
        server = self.server()
        context = server.call('read_context', {'project': str(self.root)})
        self.assertEqual(context['file_roles']['status'], 'confirmed')
        self.assertEqual(context['file_roles']['owner'], 'main.tex')
        spec = {'file': 'main.tex', 'kind': 'response', 'before': 'The model is strong and fast.', 'options': [
            {'label': label, 'after': 'The model is ' + word + '.', 'reason': label} for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]}
        args = {'project': str(self.root), 'state': 'reply.tex', 'expected_sha256': digest(self.review().raw), 'spec': spec}
        original, state = (self.root / 'main.tex').read_bytes(), self.review().raw
        with self.assertRaisesRegex(ValueError, '文件角色不符'):
            server.call('propose_options', args)
        (self.root / 'new.tex').write_text('New chapter.', encoding='utf-8')
        self.assertEqual(server.call('read_context', {'project': str(self.root)})['file_roles']['status'], 'changed')
        spec['kind'] = 'manuscript'
        with self.assertRaisesRegex(ValueError, '未确认或结构已变化'):
            server.call('propose_options', args)
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)
        self.assertEqual(self.review().raw, state)
