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
from unittest.mock import patch

class MCP(unittest.TestCase):
    def test_exact_scopes_reveal_overlap_and_return_actionable_conflict(self):
        options = [{'label': k, 'after': 'Alternative ' + k + '.', 'reason': '取舍 ' + k} for k in 'ABC']
        id_ = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options})['id']
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        before = self.review().raw
        for scope in [{'quote': 'strong'}, {'quote': '', 'left': 'The model is ', 'right': 'strong and fast.'}]:
            data = server.call('read_context', {**base, 'scopes': [{'file': 'main.tex', **scope}]})['context']
            self.assertEqual(data['targets'], [id_])
            self.assertEqual(data['items'][id_]['options'], options)
            self.assertEqual(data['selections'][0]['file'], 'main.tex')
        args = {**base, 'expected_sha256': digest(before), 'spec': {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options}}
        failure = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'propose_options', 'arguments': args}})['result']
        self.assertTrue(failure['isError'])
        detail = failure['structuredContent']
        self.assertEqual(detail['code'], 'overlapping_candidate')
        self.assertEqual(detail['existing'], {'id': id_, 'version': self.review().state['edits'][id_]['versions'][-1], 'file': 'main.tex'})
        self.assertEqual(detail['recovery']['ids'], [id_])
        self.assertEqual(self.review().raw, before)
        for scopes in ['main.tex', [{'file': 'main.tex', 'quote': 3}], [{'file': 'main.tex'}],
                       [{'file': 'main.tex', 'quote': 'x', 'section': 'y'}], [{'file': '../escape.tex', 'quote': ''}]]:
            with self.assertRaises(ValueError):
                server.call('read_context', {**base, 'scopes': scopes})

    def test_section_reader_preserves_exact_tex_and_comment_authority(self):
        from ai_context import section_span, comment_context
        text = ('% CODEX-RULES-BEGIN\r\n% 保留所有数值\r\n% CODEX-RULES-END\r\n'
                '\\documentclass{article}\r\n% header requirement\r\n\\begin{document}\r\n'
                '% \\section{Ignored}\r\n\\newcommand{\\titleexample}{\\section{Not active}}\r\n'
                '\\begin{verbatim}\r\n\\section{Not active either}\r\n\\end{verbatim}\r\n'
                '\\section[Short]{Method with \\textbf{details}}\r\n% local requirement\r\nExact $x$ and 1.5.\r\n'
                '\\subsection{Child}\r\nChild text.\r\n\\section{Results}\r\n% unrelated experiment note\r\nEnd.')
        heading = r'\section[Short]{Method with \textbf{details}}'
        a, b = section_span(text, heading)
        self.assertEqual(text[a:b], text[text.index(heading):text.index(r'\section{Results}')])
        self.assertIn(r'\subsection{Child}', text[a:b])
        for heading in [r'\section{Ignored}', r'\section{Not active}', r'\section{Not active either}',
                        text[a:text.index(r'\section{Results}') + len(r'\section{Results}')]]:
            with self.assertRaises(ValueError): section_span(text, heading)
        duplicate = '\\section{Same}\nOne.\n\\section{Same}\nTwo.'
        with self.assertRaises(ValueError): section_span(duplicate, r'\section{Same}')
        a2, _ = section_span(duplicate, r'\section{Same}', right='\nTwo.')
        self.assertEqual(a2, duplicate.rindex(r'\section{Same}'))
        template = '% CODEX-RULES-BEGIN\n% Template example, not author requirements\n% CODEX-RULES-END\nExample.'
        categories = comment_context({'main.tex': text, 'template.tex': template},
            {'main.tex': [(a, b)], 'template.tex': [(0, len(template))]},
            {'files': [{'file': 'main.tex', 'roles': ['manuscript']}, {'file': 'template.tex', 'roles': ['template']}]})
        self.assertIn('保留所有数值', str(categories['global']))
        self.assertIn('header requirement', str(categories['global']))
        self.assertIn('local requirement', str(categories['local']))
        self.assertNotIn('unrelated experiment note', str(categories['local']))
        self.assertGreater(categories['omitted_local']['main.tex'], 0)
        self.assertNotIn('template.tex', categories['global'])
        self.assertIn('Template example', str(categories['reference']))

    def test_questions_are_pooled_exactly_without_changing_ui_or_state(self):
        question = {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}
        options = [{'label': k, 'after': 'Alternative ' + k + '.', 'reason': '具体取舍 ' + k} for k in 'ABC']
        ids = []
        for original in ['Unchanged context before.', 'The model is strong and fast.']:
            ids.append(self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
                'before': original, 'options': options, 'questions': [question]})['id'])
        raw = self.review().raw
        ui = self.review().cards()
        data = self.server().call('read_context', {'project': str(self.root), 'ids': ids})['context']
        self.assertEqual(data['questions'], {'q1': question})
        for id_ in ids:
            self.assertEqual(data['items'][id_]['question_refs'], ['q1'])
            self.assertEqual(self.review().state['edits'][id_]['questions'], [question])
        self.assertEqual(self.review().raw, raw)
        self.assertEqual(self.review().cards(), ui)
        other = {'id': 'R1-Q1', 'file': 'main.tex', 'quote': 'Unchanged context after.'}
        self.apply('update_questions', ids[1], self.review().state['edits'][ids[1]]['versions'][-1], [other])
        data = self.server().call('read_context', {'project': str(self.root), 'ids': ids})['context']
        self.assertEqual(data['questions'], {'q1': question, 'q2': other})
        self.assertEqual(data['items'][ids[1]]['question_refs'], ['q1', 'q2'])

    def test_new_paper_selection_can_be_read_without_review_initialization(self):
        root = self.root / 'new-paper'; root.mkdir()
        source = '% Author requirement\n\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nNew text.\n\\end{document}\n'
        (root / 'draft.tex').write_text(source, encoding='utf-8')
        server = self.server()
        (self.root / 'registrations' / 'new.json').write_text(json.dumps({'roots': [str(root)]}), encoding='utf-8')
        args = {'project': str(root), 'scopes': [{'file': 'draft.tex', 'section': r'\section{Intro}'}]}
        result = server.call('read_context', args)
        self.assertFalse(result['initialized'])
        span = result['context']['selections'][0]
        disk = (root / 'draft.tex').read_bytes().decode('utf-8')
        self.assertTrue(disk[span['start']:span['end']].startswith(r'\section{Intro}'))
        self.assertIn('Author requirement', str(result['context']['author_comments']['global']))
        self.assertEqual((root / 'draft.tex').read_text(encoding='utf-8'), source)
        self.assertEqual([p.name for p in root.iterdir()], ['draft.tex'])

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

    def test_write_results_chain_without_context_rereads_and_keep_conflict_guards(self):
        VERSION = json.loads((Path(__file__).parent.parent / 'package.json').read_text(encoding='utf-8'))['version']
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        source = (self.root / 'main.tex').read_bytes()
        context = server.call('read_context', {**base, 'expected_plugin_version': VERSION})
        self.assertEqual(context['plugin_version'], VERSION)
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        args = {**base, 'expected_sha256': context['context']['sha256'], 'spec': {
            'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options}}
        with patch('mcp_server.Review.cards', side_effect=AssertionError('Writes must not require a full context')):
            preview = server.call('propose_options', {**args, 'apply': False})
            self.assertEqual(preview['sha256'], args['expected_sha256'])
            self.assertNotIn('version', preview, 'dry-run placeholder is not a saved candidate version')
            first = server.call('propose_options', args)
            self.assertEqual(first['sha256'], digest(self.review().raw))
            self.assertEqual(first['version'], self.review().state['edits']['1']['versions'][-1])
            revised = [{**o, 'after': o['after'].replace('.', ' under this condition.')} for o in options]
            rework = {**base, 'id': first['id'], 'version': first['version'],
                      'expected_sha256': first['sha256'], 'spec': {'options': revised}}
            second = server.call('rework_options', rework)
            self.assertEqual(second['sha256'], digest(self.review().raw))
            self.assertEqual(second['plugin_version'], VERSION)
            self.assertNotEqual(second['version'], first['version'])
            with self.assertRaisesRegex(ValueError, 'State changed'):
                server.call('rework_options', rework)
            rework['expected_sha256'] = second['sha256']
            with self.assertRaisesRegex(ValueError, 'stale'):
                server.call('rework_options', rework)
        state = self.review().raw
        with self.assertRaisesRegex(ValueError, '重启 Codex'):
            server.call('propose_options', {**args, 'expected_plugin_version': 'old-fixture'})
        self.assertEqual(self.review().raw, state)
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        linked = server.call('link_questions', {**base, 'id': second['id'], 'version': second['version'],
            'expected_sha256': second['sha256'], 'questions': []})
        self.assertEqual(linked['version'], second['version'])
        self.assertEqual(linked['sha256'], digest(self.review().raw))
        with patch('mcp_server.VERSION', 'running-fixture'):
            self.assertEqual(server.call('get_instructions', {})['version'], 'running-fixture')

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
            'intent': {'goal': '限定模型描述', 'preserve': '保留已知事实'},
            'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': [
                {'label': label, 'after': 'The model is ' + word + '.', 'reason': label, 'summary': '突出 ' + word} for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]}}
        self.assertFalse(server.call('propose_options', {**args, 'apply': False})['applied'])
        self.assertEqual(self.review().state['edits'], {})
        result = server.call('propose_options', args)
        self.assertTrue(result['applied'])
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        data = self.review().inspect(result['id'])
        self.assertEqual(len(data['options']), 3)
        self.assertEqual(data['intent'], args['spec']['intent'])
        self.assertEqual(data['options'][0]['summary'], '突出 reliable')
        stale = server.message({'id': 2, 'method': 'tools/call', 'params': {'name': 'propose_options', 'arguments': args}})
        self.assertTrue(stale['result']['isError'])
        self.assertIn('State changed', stale['result']['content'][0]['text'])
        self.apply('feedback', {'id': '1', 'version': data['version'], 'side': 'candidate', 'option': 'B', 'start': 13, 'end': 20, 'quote': 'compact', 'text': '改得更明确。'})
        notes = server.call('read_feedback', {'project': str(self.root), 'state': 'reply.tex'})['items']
        self.assertEqual(notes[0]['requests'][0]['option'], 'B')
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

    def test_scoped_ai_context_preserves_rules_sources_dependencies_and_notes_without_ui_data(self):
        main = self.root / 'main.tex'
        main.write_text(main.read_text(encoding='utf-8').replace('Unchanged context before.',
            '% CODEX-RULES: 保留实验数值\nUnchanged context before.').replace('The model is strong',
            '% CODEX-PARAGRAPH-PLAN: 解释边界\nThe model is strong'), encoding='utf-8')
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        first = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options, 'questions': [
                {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}]})['id']
        second = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'Unchanged context after.', 'options': options})['id']
        reply = self.apply('propose_options', {'file': 'reply.tex', 'kind': 'response',
            'before': 'Thank you.', 'options': options, 'deps': [first]})['id']
        version = self.review().state['edits'][first]['versions'][-1]
        self.apply('feedback', {'id': first, 'version': version, 'side': 'candidate', 'option': 'B',
            'start': 0, 'end': 0, 'quote': '', 'text': '保留这个限定。'})
        before = {f: (self.root / f).read_bytes() for f in ['main.tex', 'reply.tex']}
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        with patch('source_review.word_changes', side_effect=AssertionError('No UI diff in AI reads')), patch('source_review.change_scope', side_effect=AssertionError('No UI counts')):
            context = server.call('read_context', {**base, 'ids': [first]})['context']
            self.assertEqual(context['targets'], [first])
            self.assertEqual(set(context['items']), {first, reply})
            self.assertNotIn(second, context['items'])
            item = context['items'][first]
            self.assertEqual(item['options'], options)
            self.assertEqual(item['requests'][0]['text'], '保留这个限定。')
            self.assertEqual(context['questions'][item['question_refs'][0]]['quote'], 'Thank you.')
            self.assertNotIn('versions', item)
            self.assertNotIn('cards', context)
            self.assertIn('保留实验数值', '\n'.join(b['text'] for b in context['author_comments']['global']['main.tex']))
            self.assertIn('解释边界', '\n'.join(b['text'] for b in context['author_comments']['local']['main.tex']))
            for file, spans in context['sources'].items():
                text = self.review().read(file)
                for span in spans:
                    self.assertEqual(span['text'], text[span['start']:span['end']])
            self.assertNotIn('CODEX-REVIEW-DATA', json.dumps(context))
            full = server.call('read_context', {**base, 'files': ['main.tex']})['context']
            self.assertEqual(full['sources']['main.tex'][0]['text'], self.review().read('main.tex'))
        self.assertEqual(before, {f: (self.root / f).read_bytes() for f in before})
        with self.assertRaisesRegex(ValueError, 'Unknown review ID'):
            server.call('read_context', {**base, 'ids': ['missing']})
        with self.assertRaisesRegex(ValueError, 'arrays'):
            server.call('read_context', {**base, 'ids': first})
        with self.assertRaises(ValueError):
            server.call('read_context', {**base, 'files': ['../escape.tex']})

    def test_rules_are_loaded_by_module_and_acknowledgement_not_server_session(self):
        server = self.server()
        first = server.call('get_instructions', {})
        self.assertIn('三方案', first['protocol'])
        self.assertNotIn('## Experiments', first['protocol'])
        expanded = server.call('get_instructions', {'modules': ['experiments'], 'known_rules': first['rules_receipt']})
        self.assertIn('## Experiments', expanded['protocol'])
        self.assertNotIn('## 候选生成', expanded['protocol'])
        self.assertEqual(server.call('get_instructions', {'modules': ['experiments'], 'known_rules': expanded['rules_receipt']})['protocol'], '')
        upgraded = server.call('get_instructions', {'modules': ['response'], 'known_rules': {'version': 'old', 'modules': ['core', 'response']}})
        self.assertIn('## 回复信', upgraded['protocol'])
        self.assertIn('## 候选生成', upgraded['protocol'])
        fresh = server.call('get_instructions', {})
        self.assertEqual(fresh, first, 'another caller never inherits a hidden already-read flag')
        writing = server.call('get_instructions', {'modules': ['writing', 'questions']})
        self.assertIn('CODEX-PARAGRAPH-PLAN', writing['protocol'])
        self.assertNotIn('先读取工具帮助', writing['protocol'])

    def test_scoped_context_keeps_crlf_boundaries_and_detects_source_changes_during_read(self):
        main = self.root / 'main.tex'
        text = main.read_text(encoding='utf-8').replace('The model is strong and fast.',
            'Extra earlier paragraph.\n\nThe model is strong and fast.\n\nExtra later paragraph.')
        main.write_bytes(text.replace('\n', '\r\n').encode('utf-8'))
        id_ = self.propose_fixture()
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex', 'ids': [id_]}
        data = server.call('read_context', base)['context']
        span = data['sources']['main.tex'][0]
        self.assertEqual(span['text'], 'Extra earlier paragraph.\r\n\r\nThe model is strong and fast.\r\n\r\nExtra later paragraph.')
        read = __import__('source_review').Review.read
        changed = False
        def race(review, file):
            nonlocal changed
            value = read(review, file)
            if file == 'main.tex' and not changed:
                changed = True
                main.write_bytes(main.read_bytes() + b'% concurrent author note\r\n')
            return value
        with patch('mcp_server.Review.read', race):
            failure = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'read_context', 'arguments': base}})['result']
        self.assertTrue(failure['isError'])
        self.assertEqual(failure['structuredContent']['code'], 'context_changed')

    def propose_fixture(self):
        return self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
            'options': [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                        for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]})['id']

    def test_question_failure_has_specific_recovery_and_never_changes_state(self):
        id_ = self.propose_fixture()
        server = self.server()
        raw = self.review().raw
        args = {'project': str(self.root), 'state': 'reply.tex', 'id': id_,
                'version': self.review().state['edits'][id_]['versions'][-1], 'expected_sha256': digest(raw),
                'questions': [{'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Not a real quote.'}]}
        result = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'link_questions', 'arguments': args}})['result']
        self.assertTrue(result['isError'])
        self.assertEqual(result['structuredContent']['code'], 'question_quote_invalid')
        self.assertEqual(result['structuredContent']['recovery']['files'], ['reply.tex'])
        self.assertEqual(self.review().raw, raw)

    def test_feedback_groups_option_notes_once_per_generation_and_scopes_ids(self):
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        id_ = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options})['id']
        version = self.review().state['edits'][id_]['versions'][-1]
        for option in 'AB':
            self.apply('feedback', {'id': id_, 'version': version, 'side': 'candidate', 'option': option,
                'start': 0, 'end': 3, 'quote': 'The', 'text': '要求 ' + option})
        self.apply('propose_options', {'options': [{**o, 'after': o['after'].replace('.', ' here.')} for o in options]}, id_, version)
        new_version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': new_version, 'side': 'candidate', 'option': 'C',
            'start': 0, 'end': 3, 'quote': 'The', 'text': '新要求'})
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        groups = server.call('read_feedback', {**base, 'ids': [id_]})['items']
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]['options'], options)
        self.assertEqual([n['option'] for n in groups[0]['requests']], ['A', 'B'])
        self.assertEqual(groups[0]['current_version'], new_version)
        self.assertEqual(groups[1]['requests'][0]['quote'], 'The')
        self.assertEqual(server.call('read_feedback', {**base, 'ids': []})['items'], [])

    def test_batch_saves_ordered_successes_stops_on_failure_and_resumes_remaining_only(self):
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        def operation(before):
            return {'operation': 'propose_options', 'spec': {'file': 'main.tex', 'kind': 'manuscript', 'before': before, 'options': options}}
        source = (self.root / 'main.tex').read_bytes()
        operations = [operation('Unchanged context before.'), operation('Missing source.'), operation('Unchanged context after.')]
        reply = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'submit_options',
            'arguments': {**base, 'expected_sha256': digest(self.review().raw), 'operations': operations}}})['result']
        self.assertTrue(reply['isError'])
        result = reply['structuredContent']
        self.assertEqual(result['failed_index'], 1)
        self.assertEqual(result['not_attempted_indices'], [2])
        self.assertEqual([r['id'] for r in result['results']], ['1'])
        self.assertEqual(result['sha256'], digest(self.review().raw))
        self.assertEqual(result['error']['code'], 'source_changed')
        self.assertEqual(set(self.review().state['edits']), {'1'})
        operations[1] = operation('The model is strong and fast.')
        saved = server.call('submit_options', {**base, 'expected_sha256': result['sha256'], 'operations': operations[1:]})
        self.assertTrue(saved['complete'])
        self.assertEqual([r['id'] for r in saved['results']], ['2', '3'])
        rework = {'operation': 'rework_options', 'id': '2', 'version': saved['results'][0]['version'],
                  'spec': {'options': [{**o, 'after': o['after'].replace('.', ' here.')} for o in options]}}
        revised = server.call('submit_options', {**base, 'expected_sha256': saved['sha256'], 'operations': [rework]})
        self.assertTrue(revised['complete'])
        self.assertEqual(revised['results'][0]['id'], '2')
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        self.assertTrue(all(e['status'] in ('pending', 'rework') for e in self.review().state['edits'].values()))

    def test_batch_keeps_concurrent_write_guard_and_returns_scoped_recovery(self):
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': word}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        operations = [{'operation': 'propose_options', 'spec': {'file': 'main.tex', 'kind': 'manuscript',
            'before': before, 'options': options}} for before in ['Unchanged context before.', 'Unchanged context after.']]
        original_call = server.call
        def concurrent(name, args):
            value = original_call(name, args)
            if name == 'propose_options' and value['id'] == '1':
                self.apply('feedback', {'id': '1', 'version': value['version'], 'side': 'original',
                    'start': 0, 'end': 0, 'quote': '', 'text': '作者同时新增的批注'})
            return value
        with patch.object(server, 'call', side_effect=concurrent):
            result = server.call('submit_options', {**base, 'expected_sha256': digest(self.review().raw), 'operations': operations})
        self.assertFalse(result['complete'])
        self.assertEqual(result['error']['code'], 'state_changed')
        self.assertEqual(result['error']['recovery']['files'], ['main.tex'])
        self.assertEqual(self.review().state['edits']['1']['requests'][0]['text'], '作者同时新增的批注')
        self.assertEqual(set(self.review().state['edits']), {'1'})
        args = {**base, 'id': '1', 'version': 'stale', 'expected_sha256': digest(self.review().raw), 'spec': {'options': options}}
        failure = server.message({'id': 2, 'method': 'tools/call', 'params': {'name': 'rework_options', 'arguments': args}})['result']['structuredContent']
        self.assertEqual(failure['code'], 'candidate_changed')
        self.assertEqual(failure['recovery']['ids'], ['1'])
        raw = self.review().raw
        with self.review().writer_lock():
            locked = server.call('submit_options', {**base, 'expected_sha256': digest(raw), 'operations': operations})
        self.assertFalse(locked['complete'])
        self.assertEqual(locked['results'], [])
        self.assertEqual(self.review().raw, raw)
