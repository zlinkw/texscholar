"""Isolated MCP transport, source integrity and owned-config checks."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from mcp_server import Server, TOOLS, ToolConflict
from mcp_config import configure, check
import native_review_test as fixtures
from source_review import digest, Conflict
from document_roles import scan as scan_roles, save as save_roles
from unittest.mock import patch

class MCP(unittest.TestCase):
    def test_context_returns_structured_question_and_reply_dependencies(self):
        result = self.apply('propose', {'file':'main.tex', 'kind':'manuscript',
                                       'before':'The model is strong and fast.', 'after':'The model is reliable.'})
        id_ = result['id']; fixtures.NativeReview.install_sidecar(self, dict(self.review().state, schema=3))
        review = fixtures.Review(self.root, '.codex-review/state.json', 'missing-git')
        source = review.read('main.tex'); start = source.index('The model'); end = source.index('\n', start) + 1
        question = {'id':'R1-Q2', 'file':'reply.tex', 'quote':'Thank you.'}
        updated, block = review.prepare_block({'file':'main.tex', 'kind':'question', 'start':start, 'end':end,
                                               'source_revision':review.source_digest(source), 'questions':[question]})
        review.state['blocks'][block['block_id']]['response_dependencies'] = [id_]
        review.persist(updated, digest(review.raw))
        packet = self.server().call('read_context', {'project':str(self.root), 'state':'.codex-review/state.json', 'ids':[]})
        row = next(x for x in packet['context']['blocks']['main.tex'] if x['id'] == block['block_id'])
        self.assertEqual(row['questions'], [question])
        self.assertEqual(row['response_dependencies'], [id_])

    def test_read_feedback_includes_open_previous_note_on_decided_item(self):
        result = self.apply('propose', {'file':'main.tex', 'kind':'manuscript',
                                       'before':'The model is strong and fast.', 'after':'The model is reliable.'})
        id_ = result['id']; version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original', 'start':0,
                                'end':0, 'quote':'', 'text':'Still unresolved.'})
        self.apply('propose', {'after':'The model remains reliable.', 'discard_annotations':True}, id_)
        review = self.review(); original = review.state['edits'][id_]['previous_feedback']['requests'][0].copy()
        review.state['edits'][id_]['status'] = 'rejected'; review.persist({}, digest(review.raw))
        packet = self.server().call('read_feedback', {'project':str(self.root), 'state':'reply.tex', 'ids':[id_]})
        self.assertEqual(len(packet['items']), 1)
        self.assertEqual(packet['items'][0]['version'], version)
        self.assertEqual(packet['items'][0]['requests'][0]['id'], original['id'])
        self.assertEqual(packet['items'][0]['requests'][0]['text'], 'Still unresolved.')

    def test_migration_conflict_rejects_mcp_apply_without_host_or_state_change(self):
        self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'The model is strong and fast.',
                               'after':'The model is reliable.'})
        source = self.root / 'main.tex'
        source.write_text(source.read_text(encoding='utf-8').replace('The model is strong and fast.',
                                                                      'The author changed the sentence.'), encoding='utf-8')
        server = self.server(); base = {'project':str(self.root), 'state':'reply.tex'}
        packet = server.call('migrate_state', base)['preview']
        self.assertTrue(packet['conflicts'])
        paths = [source, self.root / 'reply.tex']
        before = {path:path.read_bytes() for path in paths}
        objects = {path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}
        with patch('review_host_client.HostSession', side_effect=AssertionError('host must not be contacted')):
            with self.assertRaisesRegex(Conflict, '未解决冲突'):
                server.call('migrate_state', {**base, 'apply':True, 'approved':packet})
        self.assertEqual({path:path.read_bytes() for path in paths}, before)
        self.assertEqual({path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}, objects)
        self.assertFalse((self.root / '.codex-review' / 'state.json').exists())

    def test_ai_confirms_structured_roles_without_source_injection(self):
        from document_roles import without_block
        owner = self.root / 'main.tex'
        owner.write_text(without_block(owner.read_text(encoding='utf-8')), encoding='utf-8')
        server = self.server(); base = {'project':str(self.root)}
        data = server.call('read_file_roles', base)
        self.assertEqual(data['status'], 'unconfirmed')
        spec = {'owner':'main.tex', 'previous_owner':data['owner'], 'previous_files':data['files'],
                'owner_sha256':data['file_sha256']['main.tex'], 'structure':data['structure'],
                'files':[{k: item[k] for k in ('file','roles','root')} for item in data['suggested']], 'revision':data['revision']}
        before = owner.read_bytes()
        saved = server.call('write_file_roles', {**base, 'spec':spec})
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(owner.read_bytes(), before)
        self.assertEqual(server.call('read_file_roles', base)['authority'], 'paper')
        with self.assertRaises(ValueError):
            server.call('write_file_roles', {**base, 'spec':spec})
        self.assertEqual(owner.read_bytes(), before)

    def test_paper_roles_share_identity_without_overwriting_background(self):
        from paper_background import read, write, read_roles, write_roles
        storage = self.server().registrations.parent
        entry = {'kind':'constraints', 'text':'只用于本论文', 'evidence':'author', 'source':'作者'}
        write(storage, self.root, 'reply.tex', 0, [entry])
        record = {'owner':'main.tex', 'files':[{'file':'main.tex','roles':['manuscript'],'root':None}], 'structure':[]}
        saved = write_roles(storage, self.root, 'reply.tex', 0, record)
        self.assertEqual(saved, {'revision':1, 'record':record})
        self.assertEqual(read(storage, self.root, 'reply.tex')['entries'], [entry])
        write(storage, self.root, 'reply.tex', 1, [{**entry,'text':'更新的约定'}])
        self.assertEqual(read_roles(storage, self.root), saved)
        self.assertEqual(read_roles(storage.parent / 'other-profile', self.root), {'revision':0, 'record':None})
        different = self.root / 'other' / self.root.name
        different.mkdir(parents=True)
        self.assertEqual(read_roles(storage, different), {'revision':0, 'record':None})
        with self.assertRaisesRegex(ValueError, '角色已变化'):
            write_roles(storage, self.root, 'reply.tex', 0, record)
        with self.assertRaisesRegex(ValueError, '保留原拥有文件'):
            write_roles(storage, self.root, 'reply.tex', 1, {**record, 'owner':'reply.tex'})
        self.assertEqual(read_roles(storage, self.root), saved)
        with self.assertRaisesRegex(ValueError, '未明确关联'):
            read(storage, self.root, '.codex-review/state.json')
        with self.assertRaisesRegex(ValueError, '未明确关联'):
            write_roles(storage, self.root, '.codex-review/state.json', 1, record)

    def test_personal_prompts_are_shared_across_papers_and_revision_protected(self):
        server = self.server()
        base = {'project':str(self.root), 'state':'reply.tex'}
        empty = server.call('read_personal_prompts', base)
        self.assertEqual(empty['entries'], [])
        first = {'category':'response','text':'先给可用文本','enabled':True}
        saved = server.call('write_personal_prompts', {**base,'profile_id':None,'revision':0,'entries':[first]})
        second = {'category':'writing','text':'解释简明','enabled':True}
        with self.assertRaisesRegex(ValueError, '个人提示词已变化'):
            server.call('write_personal_prompts', {**base,'profile_id':None,'revision':0,'entries':[second]})
        current = server.call('write_personal_prompts', {**base,'profile_id':saved['profile_id'],'revision':1,'entries':[first,second]})
        self.assertEqual(current['revision'], 2)
        packet = server.call('read_context', {**base,'ids':[]})
        self.assertNotIn('personal_prompts', packet)
        self.assertEqual(server.call('read_personal_prompts', base)['entries'], [first,second])
        other = Path(tempfile.mkdtemp(prefix='other-profile-',dir=fixtures.ROOT)) / 'registrations'
        other.mkdir()
        (other/'workspace.json').write_text(json.dumps({'roots':[str(self.root)]}),encoding='utf-8')
        self.assertEqual(Server(other).call('read_personal_prompts',base)['entries'], [])

    def test_paper_background_is_scoped_and_rejects_old_revision(self):
        server = self.server()
        base = {'project':str(self.root), 'state':'reply.tex'}
        empty = server.call('read_paper_background', base)
        self.assertEqual(empty['revision'], 0)
        entry = {'kind':'method','text':'本论文术语甲','evidence':'author','source':'作者说明','scope':'main.tex 第 2 节'}
        saved = server.call('write_paper_background', {**base,'revision':0,'entries':[entry]})
        self.assertEqual(saved['revision'], 1)
        with self.assertRaisesRegex(ValueError, '背景已变化'):
            server.call('write_paper_background', {**base,'revision':0,'entries':[]})
        self.assertNotIn('paper_background', server.call('read_context', {**base,'ids':[]}))
        with self.assertRaisesRegex(ValueError, 'source'):
            server.call('write_paper_background', {**base,'revision':1,'entries':[{**entry,'evidence':'source','source':''}]})
        self.assertEqual(server.call('read_paper_background', base)['entries'], [entry])
        with self.assertRaises(ValueError):
            server.call('read_paper_background', {**base,'state':'../outside.tex'})

    def test_paper_background_filtered_reads_keep_history_and_allow_new_requirements(self):
        server = self.server(); base = {'project':str(self.root), 'state':'reply.tex'}
        from paper_background import candidate_entry_digest
        old = {'kind':'constraints','text':'旧注释原文','evidence':'source','source':'legacy:1','scope':'main.tex'}
        history = {**old,'kind':'other','scope':'历史迁移原注释，非当前作者要求；原范围：'+old['scope']}
        proof = {'kind':'other','text':'待审方案意图','evidence':'source','source':'candidate:1'}
        server.call('write_paper_background', {**base,'revision':0,'entries':[old,proof]})
        before = server.call('read_paper_background',base)
        server.call('write_paper_background', {**base,'revision':before['revision'],'entries':[history,proof]})
        self.assertEqual(candidate_entry_digest(proof), candidate_entry_digest(server.call('read_paper_background',base)['entries'][1]))
        current = server.call('read_paper_background', {**base,'kinds':['constraints']})
        self.assertEqual(current['entries'], []); self.assertTrue(current['partial'])
        self.assertIsNone(current['revision'])
        with self.assertRaises(ValueError):
            server.call('write_paper_background',{**base,'revision':current['revision'],'entries':[]})
        self.assertIn('无筛选读取', current['write_notice'])
        self.assertEqual(server.call('read_paper_background',{**base,'sources':['legacy:1']})['entries'], [history])
        full = server.call('read_paper_background',base)
        requirement = {'kind':'constraints','text':'作者明确的新要求','evidence':'author','source':'作者'}
        server.call('write_paper_background',{**base,'revision':full['revision'],'entries':[*full['entries'],requirement]})
        self.assertEqual(server.call('read_paper_background',{**base,'kinds':['constraints']})['entries'], [requirement])
        self.assertEqual(server.call('read_paper_background',base)['entries'], [history,proof,requirement])

    def test_paper_background_distinguishes_same_named_registered_roots(self):
        server = self.server()
        roots = [self.root / 'a' / 'paper', self.root / 'b' / 'paper']
        for root in roots:
            root.mkdir(parents=True)
            (root / 'reply.tex').write_bytes((self.root / 'reply.tex').read_bytes())
        (server.registrations / 'two-papers.json').write_text(json.dumps({'roots':[str(root) for root in roots]}), encoding='utf-8')
        entries = [{'kind':'method','text':term,'evidence':'unconfirmed','source':''} for term in ('术语甲','术语乙')]
        for root, entry in zip(roots, entries):
            server.call('write_paper_background', {'project':str(root),'state':'reply.tex','revision':0,'entries':[entry]})
        for root, entry in zip(roots, entries):
            again=Server(server.registrations).call('read_paper_background', {'project':str(root),'state':'reply.tex'})
            self.assertEqual(again['entries'], [entry])

    def test_explicit_background_link_shares_one_revision_without_overwriting_target(self):
        from paper_background import link, read, write
        server=self.server(); storage=server.registrations.parent
        other=self.root/'moved'; other.mkdir()
        entry={'kind':'constraints','text':'本稿术语','evidence':'author','source':'作者'}
        saved=write(storage,self.root,'reply.tex',0,[entry])
        linked=link(storage,other,'reply.tex',{'project':saved['project'],'state':saved['state']},saved['revision'])
        self.assertEqual(linked['entries'],[entry])
        updated=write(storage,other,'reply.tex',1,[{**entry,'text':'新术语'}])
        self.assertEqual(read(storage,self.root,'reply.tex')['revision'],updated['revision'])
        with self.assertRaisesRegex(ValueError,'已有背景'):
            link(storage,other,'reply.tex',{'project':saved['project'],'state':saved['state']},1)

    def test_sidecar_sync_preview_apply_and_unchanged_receipt(self):
        from source_review import Review
        state = '.codex-review/state.json'
        fixtures.NativeReview.install_sidecar(self, dict(self.review().state, schema=3))
        def review(): return Review(self.root, state, 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable and fast.'}); r.persist(updated, digest(r.raw))
        current = self.server().call('read_context', {'project': str(self.root), 'state': state, 'ids': [item['id']]})['context']
        span = current['items'][item['id']]['source_range']
        self.assertEqual(review().read('main.tex')[span['start']:span['end']], 'The model is strong and fast.')
        self.assertEqual(span['source_revision'], current['source_revisions']['main.tex'])
        source = self.root / 'main.tex'; source.write_bytes(source.read_bytes().replace(b'The model', b'A model'))
        r = review(); version = r.state['edits'][item['id']]['versions'][-1]
        args = {'project': str(self.root), 'state': state, 'id': item['id'], 'version': version,
                'source_revision': r.source_digest(r.read('main.tex')), 'expected_sha256': digest(r.raw)}
        server = self.server(); before = r.raw
        preview = server.call('sync_block', {**args, 'apply': False})
        self.assertTrue(preview['changed']); self.assertEqual(review().raw, before)
        applied = server.call('sync_block', args)
        self.assertEqual(applied['options'][0]['after'], 'A model is reliable and fast.')
        r = review(); before = r.raw
        unchanged = server.call('sync_block', {**args, 'version': applied['version'], 'expected_sha256': digest(before)})
        self.assertFalse(unchanged['changed']); self.assertEqual(review().raw, before)
        self.assertEqual(unchanged['sha256'], digest(before))

    def test_new_project_context_and_begin_use_external_state(self):
        root = Path(tempfile.mkdtemp(prefix='mcp-sidecar-', dir=fixtures.ROOT))
        source = root / 'draft.tex'
        source.write_text('\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n', encoding='utf-8')
        registrations = root / 'registrations'
        registrations.mkdir()
        (registrations / 'workspace.json').write_text(json.dumps({'roots': [str(root)]}), encoding='utf-8')
        server = Server(registrations)
        before = source.read_bytes()
        (root / '.codex-review').mkdir()
        (root / '.codex-review' / 'automatic-backup.json').write_text(json.dumps({
            'saved_status': {'status': 'done', 'commit': 'saved-commit', 'message': '已备份'},
            'saved_done': {'commit': 'saved-commit', 'files': {}}}), encoding='utf-8')
        context = server.call('read_context', {'project': str(root), 'files': ['draft.tex']})
        self.assertFalse(context['initialized'])
        self.assertEqual(context['context']['auto_backup']['commit'], 'saved-commit')
        args = {'project': str(root), 'state': context['state'], 'expected_sha256': context['sha256'],
                'round': 'first', 'files': ['draft.tex']}
        self.assertFalse(server.call('begin_review', {**args, 'apply': False})['applied'])
        self.assertFalse((root / '.codex-review' / 'state.json').exists())
        result = server.call('begin_review', args)
        self.assertTrue(result['applied'])
        self.assertEqual(source.read_bytes(), before)
        current = server.call('read_context', {'project': str(root), 'files': ['draft.tex']})
        self.assertEqual(current['owner'], '.codex-review/state.json')
        self.assertEqual(current['context']['sha256'], result['sha256'])
        text = source.read_bytes().decode('utf-8')
        start = text.index('Text.')
        spec = {'file': 'draft.tex', 'kind': 'paragraph', 'start': start, 'end': text.index('\n', start) + 1,
                'source_revision': current['context']['source_revisions']['draft.tex']}
        request = {'project': str(root), 'state': current['owner'], 'expected_sha256': result['sha256'], 'spec': spec}
        preview = server.call('prepare_block', {**request, 'apply': False})
        self.assertEqual(source.read_bytes(), before)
        self.assertIn('TS-BLOCK-BEGIN', preview['marked'])
        applied = server.call('prepare_block', {**request, 'spec': {**spec, 'block_id': preview['block_id']}})
        self.assertTrue(applied['applied'])
        self.assertEqual(source.read_text(encoding='utf-8').count(preview['block_id']), 2)

    def test_ai_context_uses_saved_backup_status_and_preserves_legacy_snapshot(self):
        state = self.review().state
        journal = self.root / '.codex-review' / 'automatic-backup.json'
        journal.write_text(json.dumps({'session': state['session'], 'status': {'status': 'failed', 'message': 'old failure'},
            'done': 'legacy-snapshot', 'saved_status': {'status': 'done', 'commit': 'new-commit', 'message': '已备份'},
            'saved_done': {'commit': 'new-commit', 'files': {}}}), encoding='utf-8')
        context = self.server().call('read_context', {'project': str(self.root), 'state': 'reply.tex'})['context']
        self.assertEqual(context['auto_backup']['status'], 'done')
        self.assertEqual(context['auto_backup']['commit'], 'new-commit')
        self.assertEqual(context['auto_backup_done'], 'legacy-snapshot')
        self.assertEqual(context['saved_backup_done']['commit'], 'new-commit')
        self.assertEqual(json.loads(journal.read_text(encoding='utf-8'))['status']['message'], 'old failure')

    def test_exact_relocation_and_safe_rejection_keep_versions_and_delayed_notes(self):
        id_ = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'The model is strong and fast.', 'after':'The model is reliable.'})['id']
        r = self.review()
        version = r.state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original', 'start':0, 'end':0, 'quote':'', 'text':'Keep until later.'})
        old = self.review().state['edits'][id_]
        source = self.review().read('main.tex')
        (self.root/'main.tex').write_text(source + source,encoding='utf-8',newline='')
        r = self.review()
        server = self.server()
        base = {'project':str(self.root),'state':'reply.tex','id':id_,'version':version}
        point = source.index('The model')
        result = server.call('relocate_options', {**base,'expected_sha256':digest(r.raw),'spec':{
            'before':'The model is strong and fast.', 'left':source[:point], 'right':(source+source)[point+len('The model is strong and fast.'):]}})
        self.assertEqual(result['version'],version)
        self.assertEqual(self.review().state['edits'][id_]['requests'],old['requests'])
        (self.root/'main.tex').write_text('Author replaced source.',encoding='utf-8')
        raw=(self.root/'main.tex').read_bytes()
        result=server.call('reject_options',{**base,'expected_sha256':digest(self.review().raw)})
        self.assertEqual(self.review().state['edits'][id_]['status'],'rejected')
        self.assertEqual((self.root/'main.tex').read_bytes(),raw)

    def test_managed_client_ownership_is_platform_aware_and_excludes_other_mcp_services(self):
        from mcp_clients import classify
        windows = [
            {'pid': 1, 'parent': 0, 'executable': 'C:/WindowsApps/OpenAI.Codex_build/app/codex.exe', 'command': 'codex app-server'},
            {'pid': 2, 'parent': 1, 'command': 'python -X utf8 C:/Store/texscholar-mcp.py'},
            {'pid': 3, 'parent': 4, 'command': 'python -X utf8 C:/Store/texscholar-mcp.py'},
            {'pid': 4, 'parent': 0, 'executable': 'C:/Users/u/.vscode/extensions/openai.chatgpt-build/bin/codex.exe', 'command': 'codex app-server'},
            {'pid': 5, 'parent': 1, 'command': 'python C:/Other/texscholar-mcp.py'}]
        self.assertEqual(classify(windows, 'c:/store', True)['clients'],
                         [{'pid': 2, 'parent_pid': 1, 'client': 'desktop'}, {'pid': 3, 'parent_pid': 4, 'client': 'vscode'}])
        mac = [{'pid': 6, 'parent': 7, 'command': 'python /Users/u/store/texscholar-mcp.py'},
               {'pid': 7, 'parent': 0, 'command': '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'},
               {'pid': 8, 'parent': 7, 'command': 'python /users/u/store/texscholar-mcp.py'}]
        self.assertEqual(classify(mac, '/Users/u/store', False)['clients'], [{'pid': 6, 'parent_pid': 7, 'client': 'desktop'}])

    def test_explicit_reference_lookup_preserves_exact_source_and_reports_ambiguity(self):
        tex = ('% \\label{ignored}\r\n\\begin{verbatim}\r\n\\label{ignored}\r\n\\end{verbatim}\r\n'
               '\\newcommand{\\methodname}[1]["a]{Model {#1}}\r\n'
               '\\NewDocumentCommand{\\pair}{m O{Y}}{#1 and #2}\r\n'
               '\\def\\score#1{f({#1})}\r\n'
               '\\begin{equation}\r\nx=1.5 \\label{eq:test}\r\n\\end{equation}\r\n'
               '\\renewcommand{\\methodname}{Updated}\r\n')
        bib = ('% @article{ignored,title={Comment}}\n'
               '@article{ref1, title={Nested {MRI} and 100% precision}, url={https://example.org/a%20b}, year={2026}}\n'
               '@book(ref2, title="A (parenthesized) title", year={2025})\n')
        (self.root / 'definitions.sty').write_bytes(tex.encode('utf-8'))
        (self.root / 'refs.bib').write_bytes(bib.encode('utf-8'))
        requests = [{'kind': 'label', 'key': 'eq:test', 'files': ['definitions.sty']},
            {'kind': 'macro', 'key': r'\methodname', 'files': ['definitions.sty']},
            {'kind': 'macro', 'key': r'\pair', 'files': ['definitions.sty']},
            {'kind': 'macro', 'key': r'\score', 'files': ['definitions.sty']},
            {'kind': 'citation', 'key': 'ref1', 'files': ['refs.bib']},
            {'kind': 'citation', 'key': 'ref2', 'files': ['refs.bib']},
            {'kind': 'label', 'key': 'ignored', 'files': ['definitions.sty']},
            {'kind': 'citation', 'key': 'ignored', 'files': ['refs.bib']}]
        server = self.server()
        raw = self.review().raw
        result = server.call('read_context', {'project': str(self.root), 'ids': [], 'references': requests})
        rows = result['references']
        self.assertEqual([r['status'] for r in rows], ['found', 'ambiguous', 'found', 'found', 'found', 'found', 'missing', 'missing'])
        for row in rows:
            for match in row['matches']:
                text = tex if match['file'].endswith('.sty') else bib
                self.assertEqual(match['text'], text[match['start']:match['end']])
        self.assertIn('Model {#1}', rows[1]['matches'][0]['text'])
        self.assertIn(r'{m O{Y}}{#1 and #2}', rows[2]['matches'][0]['text'])
        self.assertIn('a%20b', rows[4]['matches'][0]['text'])
        self.assertIn('(parenthesized)', rows[5]['matches'][0]['text'])
        self.assertEqual(self.review().raw, raw)
        for spec in [{'kind': 'citation', 'key': 'x', 'files': ['../escape.bib']},
                     {'kind': 'macro', 'key': 'not-a-command', 'files': ['definitions.sty']},
                     {'kind': 'label', 'key': 'x', 'files': ['refs.bib']},
                     {'kind': 'citation', 'key': 'x', 'files': ['.codex-review/object.bib']}]:
            with self.assertRaises(ValueError):
                server.call('read_context', {'project': str(self.root), 'ids': [], 'references': [spec]})
        from reference_context import read_references
        read_bytes = Path.read_bytes
        changed = False
        def concurrent(path):
            nonlocal changed
            data = read_bytes(path)
            if path == self.root / 'refs.bib' and not changed:
                changed = True
                path.write_bytes(data + b'\n% external change')
            return data
        with patch.object(Path, 'read_bytes', concurrent), self.assertRaisesRegex(ValueError, 'changed during reading'):
            read_references(self.root, [requests[4]])

    def test_feedback_receipts_reuse_only_unchanged_attachment_fields(self):
        options = [{'label': k, 'after': 'Candidate ' + k + '.', 'reason': k} for k in 'ABC']
        id_ = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options})['id']
        version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': version, 'side': 'candidate', 'option': 'A',
            'start': 0, 'end': 9, 'quote': 'Candidate', 'text': '作者当前要求'})
        attachment = self.review().feedback_context()
        selected = self.review().feedback_context([id_])
        self.assertEqual(selected['session'], self.review().state['session'])
        self.assertEqual(selected['current_versions'], {id_: version})
        self.assertEqual(selected['items'], attachment['items'])
        with self.assertRaises(ValueError): self.review().feedback_context([id_, id_])
        with self.assertRaises(ValueError): self.review().feedback_context(['missing'])
        receipts = attachment['known_feedback']
        self.assertEqual(len(receipts), 1)
        server = self.server()
        args = {'project': str(self.root), 'state': 'reply.tex', 'ids': [id_], 'known_feedback': receipts}
        before = self.review().raw
        response = server.call('read_context', args)
        self.assertNotIn('feedback_skill_protocol', response)
        self.assertIn('只有作者明确确认具体方案后', server.call('get_instructions', {'modules':['feedback']})['protocol'])
        data = response['context']
        self.assertTrue(data['items'][id_]['feedback_reused'])
        self.assertTrue(data['items'][id_]['source_match'])
        for field in ('original', 'options', 'requests'):
            self.assertNotIn(field, data['items'][id_])
        self.assertTrue(data['sources']['main.tex'])
        self.assertEqual(self.review().raw, before)
        self.apply('feedback', {'id': id_, 'version': version, 'side': 'original', 'start': 0, 'end': 0, 'quote': '', 'text': '新增要求'})
        changed = server.call('read_context', args)['context']['items'][id_]
        self.assertNotIn('feedback_reused', changed)
        self.assertEqual(len(changed['requests']), 2)
        self.assertEqual(changed['options'], options)
        current = self.review().feedback_context()['known_feedback']
        main = self.root / 'main.tex'
        main.write_bytes(main.read_bytes().replace(b'The model is strong and fast.', b'Manually changed sentence.'))
        changed = server.call('read_context', {**args, 'known_feedback': current})['context']['items'][id_]
        self.assertFalse(changed['source_match'], 'reusing an attachment cannot hide real source changes')
        with self.assertRaises(ValueError): server.call('read_context', {**args, 'known_feedback': ['bad']})

    def test_rework_defaults_to_disposable_notes_only_after_success(self):
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        options = [{'label': k, 'after': 'Candidate ' + k + '.', 'reason': k} for k in 'ABC']
        id_ = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'options': options})['id']
        version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': version, 'side': 'original', 'start': 0, 'end': 0, 'quote': '', 'text': '重写即可'})
        before, source = self.review().raw, (self.root / 'main.tex').read_bytes()
        args = {**base, 'id': id_, 'version': version, 'expected_sha256': digest(before), 'spec': {'options': options}}
        with self.assertRaisesRegex(ValueError, 'No content change'): server.call('rework_options', args)
        self.assertEqual(self.review().raw, before)
        args['spec']['options'] = [{**o, 'after': o['after'].replace('.', ' revised.')} for o in options]
        saved = server.call('rework_options', args)
        edit = self.review().state['edits'][id_]
        self.assertEqual(edit.get('requests', []), [])
        self.assertEqual(edit['previous_feedback']['requests'][0]['text'], '重写即可')
        context = server.call('read_context', {**base, 'ids': [id_]})['context']['items'][id_]
        self.assertNotIn('previous_feedback', context, 'read-only comparison does not become recurring AI work or duplicate context')
        self.assertEqual(self.review().inspect(id_)['original'], 'The model is strong and fast.')
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        self.apply('feedback', {'id': id_, 'version': saved['version'], 'side': 'original', 'start': 0, 'end': 0, 'quote': '', 'text': '显式保留'})
        saved = server.call('rework_options', {**args, 'version': saved['version'], 'expected_sha256': digest(self.review().raw),
            'spec': {'options': options, 'discard_annotations': False}})
        self.assertEqual(self.review().state['edits'][id_]['requests'][0]['text'], '显式保留')
        self.apply('decide', [id_], [], {id_: saved['version']}, 'A')
        accepted = (self.root / 'main.tex').read_bytes()
        with self.assertRaisesRegex(ValueError, 'Only unresolved'):
            server.call('rework_options', {**args, 'version': saved['version'], 'expected_sha256': digest(self.review().raw)})
        self.assertEqual((self.root / 'main.tex').read_bytes(), accepted)

    def test_rework_fulfillment_validates_request_and_exact_option_range(self):
        server = self.server(); base = {'project':str(self.root), 'state':'reply.tex'}
        options = [{'label':k, 'after':'Candidate ' + k + '.', 'reason':k} for k in 'ABC']
        id_ = self.apply('propose_options', {'file':'main.tex', 'kind':'manuscript', 'before':'The model is strong and fast.', 'options':options})['id']
        version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original', 'start':0, 'end':0, 'quote':'', 'text':'请补限定'})
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original', 'start':0, 'end':0, 'quote':'', 'text':'另一条要求'})
        request = self.review().state['edits'][id_]['requests'][0]
        revised = [{**o, 'after':o['after'] + ' Limited.'} for o in options]
        mapping = {'request':request['id'], 'request_version':version, 'request_text':request['text'], 'option':'A',
                   'start':13, 'end':20, 'quote':'Limited', 'explanation':'加入限定。', 'status':'partial'}
        before = self.review().raw
        args = {**base, 'id':id_, 'version':version, 'expected_sha256':digest(before), 'spec':{'options':revised, 'discard_annotations':False}}
        for invalid in ({**mapping, 'request':'missing'}, {**mapping, 'request_version':'wrong'}, {**mapping, 'start':0}):
            with self.assertRaises(ValueError): server.call('rework_options', {**args, 'spec':{**args['spec'], 'fulfillment':[invalid]}})
            self.assertEqual(self.review().raw, before)
        saved = server.call('rework_options', {**args, 'spec':{**args['spec'], 'fulfillment':[mapping]}})
        result = self.review().inspect(id_)
        self.assertEqual(result['fulfillment'], [mapping])
        self.assertEqual(len(result['edit']['requests']), 2)
        context = server.call('read_context', {**base, 'ids':[id_]})['context']['items'][id_]
        self.assertEqual(context['fulfillment'], [mapping])
        updated = [{**o, 'after':o['after'] + ' Again.'} for o in revised]
        server.call('rework_options', {**args, 'version':saved['version'], 'expected_sha256':saved['sha256'],
                                      'spec':{'options':updated, 'discard_annotations':False}})
        self.assertEqual(self.review().inspect(id_)['fulfillment'], [])

    def test_fact_hints_use_explicit_terms_and_actual_candidate(self):
        server = self.server(); base = {'project':str(self.root), 'state':'reply.tex'}
        options = [{'label':k, 'after':'The model is ' + word + ' and fast.', 'reason':k}
                   for k, word in zip('ABC', ('reliable', 'compact', 'efficient'))]
        result = server.call('propose_options', {**base, 'expected_sha256':digest(self.review().raw),
            'spec':{'file':'main.tex', 'kind':'manuscript', 'before':'The model is strong and fast.',
                    'options':options, 'protected_terms':['strong']}})
        packet = self.review().inspect(result['id'])
        self.assertEqual(packet['options'][0]['fact_changes'][0]['kind'], 'term')
        self.assertEqual(packet['options'][0]['fact_changes'][0]['evidence'], 'unsupported')
        self.assertEqual(server.call('read_context', {**base,'ids':[result['id']]})['context']['items'][result['id']]['protected_terms'], ['strong'])
        newer = [{**o, 'after':o['after'] + ' Here.'} for o in options]
        server.call('rework_options', {**base, 'id':result['id'], 'version':result['version'], 'expected_sha256':result['sha256'], 'spec':{'options':newer}})
        self.assertEqual(self.review().inspect(result['id'])['options'][0]['fact_changes'][0]['kind'], 'term')

    def test_fact_evidence_is_bound_to_exact_change_and_fresh_source(self):
        server=self.server();base={'project':str(self.root),'state':'reply.tex'}
        evidence=self.root/'experiments'/'results.csv';evidence.parent.mkdir();evidence.write_text('count,score\n42,0.91\n',encoding='utf-8')
        start=evidence.read_bytes().decode('utf-8').index('42,0.91')
        read=server.call('read_context',{**base,'ids':[],'evidence_scopes':[{'file':'experiments/results.csv','start':start,'end':start+7}]})['evidence_scopes'][0]
        self.assertEqual(read['quote'],'42,0.91')
        options=[{'label':k,'after':f'The model has 42 {word}.','reason':k} for k,word in zip('ABC',('results','cases','records'))]
        from review_facts import changes
        change=changes('The model is strong and fast.',options[0]['after'])[0]
        mapping={'option':'A','change_index':0,'kind':'number','change_old':[list(v) for v in change['old']], 'change_new':[list(v) for v in change['new']],**read}
        args={**base,'expected_sha256':digest(self.review().raw),'spec':{'file':'main.tex','kind':'manuscript','before':'The model is strong and fast.','options':options}}
        before=self.review().raw
        for invalid in ({**mapping,'file':'../outside.csv'}, {**mapping,'quote':'wrong'}, {**mapping,'source_revision':'old'},
                        {**mapping,'end':999}, {**mapping,'change_index':99}, {**mapping,'kind':'math'}, {**mapping,'change_new':[['43',14,16]]}):
            with self.assertRaises(ValueError): server.call('propose_options',{**args,'spec':{**args['spec'],'fact_evidence':[invalid]}})
            self.assertEqual(self.review().raw,before)
        saved=server.call('propose_options',{**args,'spec':{**args['spec'],'fact_evidence':[mapping]}})
        result=self.review().inspect(saved['id']);self.assertTrue(result['fact_evidence'][0]['location_checked'])
        packet=server.call('read_context',{**base,'ids':[saved['id']]})['context']['items'][saved['id']]
        self.assertTrue(packet['fact_evidence'][0]['location_checked'])
        self.assertEqual(packet['fact_changes']['A'][0]['kind'],'number')
        self.assertEqual(result['options'][0]['fact_changes'][0]['evidence'],'unsupported')
        evidence.write_text('count,score\n42,0.90\n',encoding='utf-8')
        self.assertFalse(self.review().inspect(saved['id'])['fact_evidence'][0]['location_checked'])
        self.assertFalse(server.call('read_context',{**base,'ids':[saved['id']]})['context']['items'][saved['id']]['fact_evidence'][0]['location_checked'])
        revised=[{**o,'after':o['after']+' Revised.'} for o in options]
        with self.assertRaises(ValueError): server.call('rework_options',{**base,'id':saved['id'],'version':'old','expected_sha256':saved['sha256'],'spec':{'options':revised,'fact_evidence':[mapping]}})
        server.call('rework_options',{**base,'id':saved['id'],'version':saved['version'],'expected_sha256':saved['sha256'],'spec':{'options':revised}})
        self.assertEqual(self.review().inspect(saved['id'])['fact_evidence'],[])

    def test_evidence_scopes_exclude_runtime_paths_and_embedded_review_state(self):
        server=self.server();base={'project':str(self.root),'state':'reply.tex'}
        from source_review import BEGIN, END
        text='Source 42.\n'+BEGIN+'\n% private annotation\n'+END+'\nTail.\n'
        (self.root/'evidence.tex').write_text(text,encoding='utf-8',newline='')
        read=lambda file,start,end: server.call('read_context',{**base,'ids':[], 'evidence_scopes':[{'file':file,'start':start,'end':end}]})
        self.assertEqual(read('evidence.tex',0,10)['evidence_scopes'][0]['quote'],'Source 42.')
        with self.assertRaises(ValueError): read('evidence.tex',text.index('private'),text.index('private')+7)
        with self.assertRaises(ValueError): read('evidence.tex',0,text.index('private')+7)
        with self.assertRaises(ValueError): read('.CODEX-REVIEW/objects/secret.json',0,1)

    def test_evidence_change_between_preparation_and_persist_stops_write(self):
        from source_review import Conflict
        evidence=self.root/'basis.txt';evidence.write_text('42 cases',encoding='utf-8');raw=evidence.read_bytes()
        options=[{'label':k,'after':'The model has 42 '+word+'.','reason':k} for k,word in zip('ABC',('cases','results','records'))]
        from review_facts import changes
        change=changes('The model is strong and fast.',options[0]['after'])[0]
        mapping={'option':'A','change_index':0,'kind':'number','change_old':[list(v) for v in change['old']], 'change_new':[list(v) for v in change['new']],
                 'file':'basis.txt','start':0,'end':8,'quote':'42 cases','source_revision':digest(raw)}
        r=self.review();before=r.raw
        updated,_=r.propose_options({'file':'main.tex','kind':'manuscript','before':'The model is strong and fast.','options':options,'fact_evidence':[mapping]})
        evidence.write_text('43 cases',encoding='utf-8')
        with self.assertRaisesRegex(Conflict,'Evidence source changed'):r.persist(updated,digest(before))
        self.assertEqual(self.review().raw,before)

    def test_existing_candidate_can_add_evidence_without_changing_options(self):
        server=self.server();base={'project':str(self.root),'state':'reply.tex'}
        source=self.root/'basis.txt';source.write_bytes(b'42 cases')
        options=[{'label':k,'after':'The model has 42 '+word+'.','reason':k} for k,word in zip('ABC',('cases','results','records'))]
        saved=server.call('propose_options',{**base,'expected_sha256':digest(self.review().raw),'spec':{'file':'main.tex','kind':'manuscript','before':'The model is strong and fast.','options':options}})
        context=server.call('read_context',{**base,'ids':[saved['id']],'evidence_scopes':[{'file':'basis.txt','start':0,'end':8}]})
        change=context['context']['items'][saved['id']]['fact_changes']['A'][0]
        mapping={**context['evidence_scopes'][0],'option':'A','change_index':0,'kind':change['kind'],
                 'change_old':[list(v) for v in change['old']],'change_new':[list(v) for v in change['new']]}
        result=server.call('rework_options',{**base,'id':saved['id'],'version':saved['version'],'expected_sha256':saved['sha256'],
            'spec':{'options':options,'discard_annotations':False,'fact_evidence':[mapping]}})
        self.assertNotEqual(result['version'],saved['version'])
        self.assertTrue(self.review().inspect(saved['id'])['fact_evidence'][0]['location_checked'])

    def test_fulfillment_does_not_survive_source_sync_or_manual_candidate_save(self):
        from source_review import Review
        from review_facts import changes
        state = '.codex-review/state.json'
        fixtures.NativeReview.install_sidecar(self, dict(self.review().state, schema=3))
        def review(): return Review(self.root,state,'missing-git')
        r=review();text=r.read('main.tex');start=text.index('The model');end=text.index('\n',start)+1
        updated,block=r.prepare_block({'file':'main.tex','kind':'paragraph','start':start,'end':end,'source_revision':r.source_digest(text)});r.persist(updated,digest(r.raw))
        options=[{'label':k,'after':'The model is '+word+' and fast.','reason':k} for k,word in zip('ABC',('reliable','compact','efficient'))]
        r=review();updated,item=r.propose_options({'file':'main.tex','kind':'manuscript','block_id':block['block_id'],'before':'The model is strong and fast.','options':options});r.persist(updated,digest(r.raw))
        id_=item['id'];r=review();version=r.state['edits'][id_]['versions'][-1]
        updated,note=r.feedback({'id':id_,'version':version,'side':'original','start':0,'end':0,'quote':'','text':'Clarify'});r.persist(updated,digest(r.raw))
        basis=self.root/'basis.txt';basis.write_bytes(b'Author specified strong')
        def mapped_rework():
            r=review();e=r.state['edits'][id_];old=r.payload(e); revised=[{**o,'after':o['after']+' Here.'} for o in old['options']]
            request=e['requests'][0];mapping={'request':request['id'],'request_version':request['version'],'request_text':request['text'],
                'option':'A','start':0,'end':1,'quote':revised[0]['after'][0],'explanation':'Attempted','status':'attempted'}
            fact=changes(old['before'],revised[0]['after'],['strong'])[0]
            proof={'option':'A','change_index':0,'kind':'term','change_old':[list(v) for v in fact['old']],'change_new':[list(v) for v in fact['new']],
                   'file':'basis.txt','start':0,'end':23,'quote':'Author specified strong','source_revision':digest(basis.read_bytes())}
            updated,result=r.propose_options({'options':revised,'fulfillment':[mapping],'protected_terms':['strong'],'fact_evidence':[proof]},id_,e['versions'][-1]);r.persist(updated,digest(r.raw));return review().state['edits'][id_]['versions'][-1]
        first=mapped_rework();self.assertTrue(review().inspect(id_)['fulfillment']);self.assertTrue(review().inspect(id_)['fact_evidence'][0]['location_checked'])
        source=self.root/'main.tex';source.write_bytes(source.read_bytes().replace(b'The model',b'A model'))
        r=review();updated,synced=r.sync_block(id_,first,r.source_digest(r.read('main.tex')));r.persist(updated,digest(r.raw))
        self.assertEqual(review().inspect(id_)['fulfillment'],[])
        self.assertEqual(review().inspect(id_)['fact_evidence'],[])
        latest=mapped_rework();r=review();self.assertTrue(r.inspect(id_)['fulfillment'])
        argv=[sys.executable,'-B','-X','utf8',str(Path(__file__).with_name('source_review.py')),'--project',str(self.root),'--state',state,'--apply','--expect',digest(r.raw),
              'edit-option','--id',id_,'--version',latest,'--option','A']
        after=r.inspect(id_)['options'][0]['after']+' Edited.'
        run=subprocess.run(argv,input=json.dumps({'after':after}).encode(),capture_output=True)
        self.assertEqual(run.returncode,0,run.stderr.decode('utf-8'))
        self.assertEqual(review().inspect(id_)['fulfillment'],[])
        self.assertEqual(review().inspect(id_)['fact_evidence'],[])

    def test_default_context_is_local_and_confirmed_roles_are_compact(self):
        main = self.root / 'main.tex'
        main.write_bytes(main.read_bytes().replace(b'\\end{document}', b'\n\nDistant paragraph.\n\nFar away context.\n\\end{document}'))
        options = [{'label': k, 'after': 'Candidate ' + k + '.', 'reason': k} for k in 'ABC']
        self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options})
        server = self.server()
        data = server.call('read_context', {'project': str(self.root)})
        self.assertNotIn('file_roles', data)
        self.assertEqual(data['context']['items'], {})
        self.assertEqual(server.call('read_file_roles', {'project':str(self.root)})['status'], 'confirmed')
        self.assertNotIn('Far away context.', str(data['context']['sources']))
        full = server.call('read_context', {'project': str(self.root), 'files': ['main.tex']})
        self.assertIn('Far away context.', str(full['context']['sources']))
        core = server.call('get_instructions', {})
        self.assertNotIn('## 界面与交付细节', core['protocol'])
        self.assertNotIn('structure 保存', core['protocol'])
        details = server.call('get_instructions', {'modules': ['roles', 'interface', 'backup'], 'known_rules': core['rules_receipt']})
        self.assertIn('## 界面与交付细节', details['protocol'])
        self.assertIn('structure 保存', details['protocol'])
        self.assertIn('## 每批成果', details['protocol'])

    def test_shared_question_pool_and_batched_metadata_keep_other_fields(self):
        import copy
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        options = [{'label': k, 'after': 'Candidate ' + k + '.', 'reason': k} for k in 'ABC']
        question = {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}
        created = server.call('submit_options', {**base, 'expected_sha256': digest(self.review().raw), 'question_pool': {'q': question},
            'operations': [{'operation': 'propose_options', 'spec': {'file': 'main.tex', 'kind': 'manuscript', 'before': original,
                'options': options, 'question_refs': ['q']}} for original in ['Unchanged context before.', 'The model is strong and fast.']]})
        self.assertTrue(created['complete'])
        old = copy.deepcopy(self.review().state)
        replacement = {**question, 'id': 'R2-Q1'}
        operations = [{'operation': 'link_questions', 'id': r['id'], 'version': r['version'], 'question_refs': ['r'], 'replace': True} for r in created['results']]
        saved = server.call('submit_options', {**base, 'expected_sha256': created['sha256'], 'question_pool': {'r': replacement}, 'operations': operations})
        self.assertTrue(saved['complete'])
        for id_, edit in self.review().state['edits'].items():
            self.assertEqual(edit['questions'], [replacement])
            self.assertEqual({k: v for k, v in edit.items() if k != 'questions'}, {k: v for k, v in old['edits'][id_].items() if k != 'questions'})
        failed = server.call('submit_options', {**base, 'expected_sha256': saved['sha256'], 'question_pool': {'r': question},
            'operations': [operations[0], {**operations[1], 'question_refs': ['missing']}, operations[1]]})
        self.assertFalse(failed['complete'])
        self.assertEqual(failed['failed_index'], 1)
        self.assertEqual(failed['not_attempted_indices'], [2])
        self.assertEqual(failed['error']['field'], 'question_refs')
        self.assertEqual(failed['error']['recovery']['action'], 'correct_request')
        self.assertEqual(self.review().state['edits']['1']['questions'], [question])
        raw = self.review().raw
        args = {**base, 'expected_sha256': digest(raw), **operations[1], 'question_pool': {'r': {**question, 'quote': 'Absent quote'}}}
        error = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'link_questions', 'arguments': args}})['result']['structuredContent']
        self.assertEqual(error['code'], 'question_quote_invalid')
        self.assertEqual(error['recovery']['files'], ['reply.tex'])
        self.assertEqual(self.review().raw, raw)

    def test_batch_candidate_question_locations_preview_save_and_readback(self):
        import copy
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        q1 = {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}
        q2 = {'id': 'R2-Q1', 'file': 'main.tex', 'quote': 'Unchanged context before.'}
        q3 = {'id': 'R3-Q1', 'file': 'main.tex', 'quote': 'Unchanged context after.'}
        pool = {'first': q1, 'second': q2, 'third': q3}
        cases = [({}, {'questions': [q1]}, [q1]), ({}, {'question_refs': ['first']}, [q1]),
                 ({'questions': [q1]}, {}, [q1]), ({'question_refs': ['first']}, {}, [q1]),
                 ({'questions': [q1], 'question_refs': ['second']},
                  {'questions': [q2, q1], 'question_refs': ['first', 'second', 'third']}, [q1, q2, q3])]
        source = self.root / 'main.tex'
        text = source.read_text(encoding='utf-8').replace('\\end{document}',
            '\n\n'.join('Batch target %d.' % i for i in range(len(cases))) + '\n\\end{document}')
        source.write_text(text, encoding='utf-8', newline='')
        for i, (inside, outside, expected) in enumerate(cases):
            with self.subTest(case=i):
                options = [{'label': label, 'after': 'Candidate %d %s.' % (i, label), 'reason': label} for label in 'ABC']
                spec = {'file': 'main.tex', 'kind': 'manuscript', 'before': 'Batch target %d.' % i, 'options': options, **inside}
                operation = {'operation': 'propose_options', 'spec': spec, **outside}
                sha = digest(self.review().raw)
                preview_args = {**base, **outside, 'spec': spec, 'question_pool': pool, 'expected_sha256': sha, 'apply': False}
                preview = server.call('propose_options', preview_args)
                self.assertEqual(digest(self.review().raw), sha)
                args = {**base, 'expected_sha256': sha, 'question_pool': pool, 'operations': [operation]}
                unchanged = copy.deepcopy(args)
                created = server.call('submit_options', args)
                self.assertTrue(created['complete'])
                receipt = created['results'][0]
                self.assertEqual(self.review().inspect(receipt['id'])['edit'].get('questions', []), expected)
                self.assertEqual(receipt['questions'], expected)
                self.assertEqual(preview['questions'], expected)
                self.assertEqual(args, unchanged, 'normalization does not mutate caller-owned inputs')
                revised = {'operation': 'rework_options', 'id': receipt['id'], 'version': receipt['version'],
                    'spec': {'options': [{**o, 'after': o['after'].replace('.', ' revised.')} for o in options], **inside}, **outside}
                prior = self.review().raw
                rework_preview = server.call('rework_options', {**base, **{k: v for k, v in revised.items() if k != 'operation'},
                    'expected_sha256': created['sha256'], 'question_pool': pool, 'apply': False})
                self.assertEqual(rework_preview['questions'], expected)
                self.assertEqual(self.review().raw, prior)
                saved = server.call('submit_options', {**base, 'expected_sha256': created['sha256'], 'question_pool': pool, 'operations': [revised]})
                self.assertTrue(saved['complete'])
                self.assertEqual(saved['results'][0]['questions'], expected)
                self.assertEqual(self.review().inspect(receipt['id'])['edit']['questions'], expected)
                self.assertNotEqual(saved['results'][0]['version'], receipt['version'])
                self.assertEqual(saved['sha256'], digest(self.review().raw))
        self.assertEqual(source.read_text(encoding='utf-8'), text)

    def test_batch_candidate_question_errors_stop_without_saving_failed_item(self):
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        q = {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}
        bad = {**q, 'quote': 'This quote is not in the original review.'}
        cases = [({}, {'question_refs': ['unknown']}, 'invalid_field'),
                 ({'question_refs': ['unknown']}, {}, 'invalid_field'),
                 ({'questions': [q]}, {'questions': [bad]}, 'question_quote_invalid'),
                 ({'questions': [bad]}, {'questions': [q]}, 'question_quote_invalid')]
        options = [{'label': label, 'after': 'Candidate ' + label + '.', 'reason': label} for label in 'ABC']
        def operation(before, **links):
            return {'operation': 'propose_options', 'spec': {'file': 'main.tex', 'kind': 'manuscript', 'before': before, 'options': options}, **links}
        for i, (inside, outside, code) in enumerate(cases):
            with self.subTest(case=i):
                self.apply('begin', 'links-' + str(i), ['main.tex', 'reply.tex'])
                failed = operation('The model is strong and fast.', **outside)
                failed['spec'].update(inside)
                old_source = (self.root / 'main.tex').read_bytes()
                result = server.call('submit_options', {**base, 'expected_sha256': digest(self.review().raw),
                    'question_pool': {'known': q}, 'operations': [operation('Unchanged context before.', questions=[q]), failed,
                    operation('Unchanged context after.', questions=[q])]})
                self.assertFalse(result['complete'])
                self.assertEqual(result['failed_index'], 1)
                self.assertEqual(result['not_attempted_indices'], [2])
                self.assertEqual(result['error']['code'], code)
                if code == 'question_quote_invalid':
                    self.assertEqual(result['error']['recovery']['files'], ['reply.tex'])
                self.assertEqual(result['results'][0]['questions'], [q])
                self.assertEqual(set(self.review().state['edits']), {'1'})
                self.assertEqual(self.review().state['next'], [2, 1])
                self.assertEqual(self.review().state['edits']['1']['questions'], [q])
                self.assertEqual(result['sha256'], digest(self.review().raw))
                self.assertEqual((self.root / 'main.tex').read_bytes(), old_source)
                prior = self.review().raw
                pending = json.loads(json.dumps(self.review().state['edits']['1']))
                rework = {'operation': 'rework_options', 'id': '1', 'version': result['results'][0]['version'],
                    'spec': {'options': [{**o, 'after': o['after'].replace('.', ' revised.')} for o in options], **inside}, **outside}
                failed_rework = server.call('submit_options', {**base, 'expected_sha256': digest(prior),
                    'question_pool': {'known': q}, 'operations': [rework]})
                self.assertFalse(failed_rework['complete'])
                self.assertEqual(failed_rework['error']['code'], code)
                self.assertEqual(self.review().raw, prior)
                self.assertEqual(self.review().state['edits']['1'], pending)

    def test_host_save_failure_is_distinct_from_question_validation_and_not_retried(self):
        server = self.server()
        q = {'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}
        options = [{'label': label, 'after': 'Candidate ' + label + '.', 'reason': label} for label in 'ABC']
        raw = self.review().raw
        args = {'project': str(self.root), 'state': 'reply.tex', 'expected_sha256': digest(raw),
            'operations': [{'operation': 'propose_options', 'questions': [q], 'spec': {
                'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options}}]}
        denied = PermissionError(5, '[WinError 5] Access is denied')
        denied.winerror = 5
        with patch('review_host_test_support.FakeHostSession.write', side_effect=denied) as replace:
            failed = server.call('submit_options', args)
        self.assertFalse(failed['complete'])
        self.assertEqual(failed['results'], [])
        self.assertEqual(failed['error']['code'], 'operation_failed')
        self.assertIn('WinError 5', failed['error']['message'])
        self.assertEqual(replace.call_count, 1)
        self.assertEqual(self.review().raw, raw)
        saved = server.call('submit_options', args)
        self.assertTrue(saved['complete'])
        self.assertEqual(saved['results'][0]['questions'], [q])
        self.assertEqual(set(self.review().state['edits']), {'1'})

    def test_sidecar_atomic_replace_failure_retains_temporary_file(self):
        target = self.root / '.codex-review' / 'failure-probe.json'
        denied = PermissionError(5, '[WinError 5] Access is denied')
        with patch('source_review.os.replace', side_effect=denied) as replace:
            with self.assertRaises(PermissionError):
                self.review().write(target, b'{"probe":true}')
        self.assertEqual(replace.call_count, 1)
        self.assertFalse(target.exists())
        temporary = list(target.parent.glob('failure-probe.json.codex-write-*'))
        self.assertEqual(len(temporary), 1)
        self.assertEqual(temporary[0].read_bytes(), b'{"probe":true}')

    def test_field_errors_identify_option_without_requiring_context_reread(self):
        server = self.server()
        options = [{'label': k, 'after': 'Candidate ' + k + '.', 'reason': k} for k in 'ABC']
        options[1]['reason'] = ''
        args = {'project': str(self.root), 'state': 'reply.tex', 'expected_sha256': digest(self.review().raw),
            'spec': {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options}}
        raw = self.review().raw
        error = server.message({'id': 1, 'method': 'tools/call', 'params': {'name': 'propose_options', 'arguments': args}})['result']['structuredContent']
        self.assertEqual(error['field'], 'spec.options[1].reason')
        self.assertFalse(error['recovery']['reread_required'])
        self.assertEqual(self.review().raw, raw)
        options[1].update(reason='Different mechanism', after='First paragraph.\n\nSecond paragraph.')
        error = server.message({'id': 2, 'method': 'tools/call', 'params': {'name': 'propose_options', 'arguments': args}})['result']['structuredContent']
        self.assertEqual(error['field'], 'spec.options[1].after')
        self.assertEqual(self.review().raw, raw)

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

    def test_interrupted_context_reports_actual_owner_without_guessing_or_recovery(self):
        review = self.review()
        review.state['transaction'] = {'commit': 'fixture-intent', 'files': [], 'owner': False}
        raw = review.encode(review.embedded())
        review.state_path.write_bytes(raw)
        reply = self.server().message({'id': 8, 'method': 'tools/call', 'params': {
            'name': 'read_context', 'arguments': {'project': str(self.root)}}})['result']
        self.assertTrue(reply['isError'])
        error = reply['structuredContent']
        self.assertEqual(error['code'], 'interrupted_transaction')
        self.assertEqual(error['recovery']['state'], 'reply.tex')
        self.assertFalse(error['recovery']['automatic_retry'])
        self.assertEqual(review.state_path.read_bytes(), raw)

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
        wrong = {**args, 'scopes': [{'file': 'draft.tex', 'section': r'\section{Introduction}'}]}
        reply = server.message({'id': 7, 'method': 'tools/call', 'params': {'name': 'read_context', 'arguments': wrong}})['result']
        self.assertTrue(reply['isError'])
        error = reply['structuredContent']
        self.assertEqual(error['code'], 'section_selector_invalid')
        self.assertEqual(error['recovery']['files'], ['draft.tex'])
        self.assertEqual(error['recovery']['available_sections'], [{'section': r'\section{Intro}', 'start': disk.index(r'\section{Intro}')}])
        self.assertFalse(error['recovery']['reread_required'])
        self.assertEqual((root / 'draft.tex').read_text(encoding='utf-8'), source)

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
        with self.assertRaises(ToolConflict) as mismatch:
            server.call('propose_options', {**args, 'expected_plugin_version': 'old-fixture'})
        self.assertEqual(mismatch.exception.code, 'plugin_version_mismatch')
        self.assertEqual(mismatch.exception.recovery['server_pid'], os.getpid())
        self.assertEqual(mismatch.exception.recovery['parent_pid'], os.getppid())
        self.assertFalse(mismatch.exception.recovery['automatic_retry'])
        with self.assertRaises(ToolConflict) as stale_task:
            server.call('read_context', {**base, 'expected_plugin_version': '0.0.1'})
        self.assertEqual(stale_task.exception.code, 'task_version_outdated')
        self.assertEqual(stale_task.exception.recovery['action'], 'refresh_plugin_task')

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
        self.assertNotIn('protocol', context)
        self.assertIn('propose-options', server.call('get_instructions', {})['protocol'])
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
        report = json.loads((registrations.parent / 'mcp-runtime.json').read_text(encoding='utf-8'))
        self.assertEqual(report['version'], replies[0]['result']['serverInfo']['version'])
        self.assertIsInstance(report['pid'], int)
        self.assertEqual(report['server'], str(Path(__file__).with_name('mcp_server.py').resolve()))
        self.assertEqual(set(report), {'schema', 'version', 'pid', 'server', 'instances'})
        self.assertEqual(report['schema'], 2)
        self.assertIn({k: report[k] for k in ('version', 'pid', 'server')}, report['instances'])
        for instance in report['instances']:
            self.assertEqual(set(instance), {'version', 'pid', 'server'}, 'runtime identities never include paper data')
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
        context = server.call('read_file_roles', {'project': str(self.root)})
        self.assertEqual(context['status'], 'confirmed')
        self.assertEqual(context['owner'], 'main.tex')
        spec = {'file': 'main.tex', 'kind': 'response', 'before': 'The model is strong and fast.', 'options': [
            {'label': label, 'after': 'The model is ' + word + '.', 'reason': label} for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]}
        args = {'project': str(self.root), 'state': 'reply.tex', 'expected_sha256': digest(self.review().raw), 'spec': spec}
        original, state = (self.root / 'main.tex').read_bytes(), self.review().raw
        with self.assertRaisesRegex(ValueError, '文件角色不符'):
            server.call('propose_options', args)
        (self.root / 'new.tex').write_text('New chapter.', encoding='utf-8')
        self.assertEqual(server.call('read_file_roles', {'project': str(self.root)})['status'], 'changed')
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
            self.assertNotIn('main.tex', context['author_comments']['global'])
            self.assertIn('解释边界', '\n'.join(b['text'] for b in context['author_comments']['local']['main.tex']))
            for file, spans in context['sources'].items():
                text = self.review().read(file)
                for span in spans:
                    self.assertEqual(span['text'], text[span['start']:span['end']])
            self.assertNotIn('CODEX-REVIEW-DATA', json.dumps(context))
            full = server.call('read_context', {**base, 'files': ['main.tex']})['context']
            self.assertEqual(full['sources']['main.tex'][0]['text'], self.review().read('main.tex'))
            self.assertIn('保留实验数值', '\n'.join(b['text'] for b in full['author_comments']['global']['main.tex']))
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
                'start': 0, 'end': 3, 'quote': 'The', 'text': '要求 ' + option, 'purpose':'personal' if option == 'B' else 'revision'})
        legacy = self.review()
        del legacy.state['edits'][id_]['requests'][0]['purpose']
        legacy.persist({}, digest(legacy.raw))
        self.apply('propose_options', {'options': [{**o, 'after': o['after'].replace('.', ' here.')} for o in options]}, id_, version)
        new_version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': new_version, 'side': 'candidate', 'option': 'C',
            'start': 0, 'end': 3, 'quote': 'The', 'text': '新要求'})
        server = self.server()
        base = {'project': str(self.root), 'state': 'reply.tex'}
        packet = server.call('read_feedback', {**base, 'ids': [id_]})
        self.assertNotIn('feedback_skill_protocol', packet)
        self.assertNotIn('personal_prompts', packet)
        self.assertNotIn('paper_background', packet)
        narrow = server.call('read_context', {**base, 'ids':[id_]})
        self.assertNotIn('protocol', narrow)
        self.assertNotIn('personal_prompts', narrow)
        self.assertNotIn('paper_background', narrow)
        self.assertIn(id_, narrow['context']['items'])
        self.assertEqual(server.call('read_context', base)['context']['items'], {})
        groups = packet['items']
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]['options'], options)
        self.assertEqual([n['option'] for n in groups[0]['requests']], ['A', 'B'])
        self.assertEqual([n['purpose'] for n in groups[0]['requests']], ['revision', 'personal'])
        self.assertEqual(groups[0]['current_version'], new_version)
        self.assertEqual(groups[1]['requests'][0]['quote'], 'The')
        empty = server.call('read_feedback', {**base, 'ids': []})
        self.assertEqual(empty['items'], [])
        self.assertNotIn('feedback_skill_protocol', empty)

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
