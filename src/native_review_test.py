"""Git-independent review tests; fixtures are retained for inspection."""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest
import sys

from source_review import Review, body, digest, Conflict

ROOT = Path(os.environ['SOURCE_REVIEW_FIXTURES']); ROOT.mkdir(parents=True, exist_ok=True)


class NativeReview(unittest.TestCase):
    def test_manage_feedback_exact_batch_and_protect_begin(self):
        from unittest.mock import patch
        ids = [self.proposal(), self.apply('propose', {'file':'reply.tex', 'kind':'response',
               'before':'Thank you.', 'after':'Thank you for the suggestion.'})['id']]
        for id_ in ids:
            data = self.review().inspect(id_)
            self.apply('feedback', {'id':id_, 'version':data['version'], 'side':'original',
                                    'start':0, 'end':0, 'quote':'', 'text':'相同要求'})
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        initial = review()
        items = [{'id':id_, 'version':initial.state['edits'][id_]['versions'][-1], 'file':initial.state['edits'][id_]['file'],
                  'source':'requests', 'note':initial.state['edits'][id_]['requests'][0].copy()} for id_ in ids]
        spec = {'session':initial.state['session'], 'items':items, 'action':'hold'}
        before, sources = initial.raw, {name:(self.root / name).read_bytes() for name in ('main.tex','reply.tex')}
        stale = {**spec, 'items':[items[0], {**items[1], 'version':'old'}]}
        with self.assertRaises(Conflict): review().manage_feedback(stale)
        self.assertEqual(review().raw, before)
        with self.assertRaisesRegex(Conflict, '未处理或暂留批注'):
            review().begin('next', ['main.tex','reply.tex'])
        self.assertEqual(review().raw, before)
        current = review(); updated, result = current.manage_feedback(spec)
        with patch.object(current, 'write', side_effect=PermissionError('busy')):
            with self.assertRaises(PermissionError): current.persist(updated, digest(current.raw))
        self.assertEqual(review().raw, before)
        current = review(); updated, result = current.manage_feedback(spec); current.persist(updated, digest(current.raw))
        self.assertEqual(result['count'], 2)
        held = review()
        self.assertTrue(all(held.state['edits'][id_]['requests'][0]['held'] for id_ in ids))
        self.assertTrue(all(group['requests'][0]['held'] for group in held.feedback_context()['items']))
        held_items = [{**item, 'note':held.state['edits'][item['id']]['requests'][0].copy()} for item in items]
        current = review(); updated, _ = current.manage_feedback({'session':spec['session'], 'items':held_items[:1], 'action':'release'}); current.persist(updated, digest(current.raw))
        after = review()
        self.assertNotIn('held', after.state['edits'][ids[0]]['requests'][0])
        self.assertTrue(after.state['edits'][ids[1]]['requests'][0]['held'])
        selected = {**items[0], 'note':after.state['edits'][ids[0]]['requests'][0].copy()}
        updated, _ = after.manage_feedback({'session':spec['session'], 'items':[selected], 'action':'delete'}); after.persist(updated, digest(after.raw))
        final = review()
        self.assertEqual(final.state['edits'][ids[0]]['requests'], [])
        self.assertEqual(final.state['edits'][ids[1]]['requests'][0]['text'], '相同要求')
        self.assertEqual({name:(self.root / name).read_bytes() for name in sources}, sources)

    def test_old_unresolved_and_held_previous_feedback_are_protected(self):
        from source_review import protected_feedback
        self.assertTrue(protected_feedback({'requests':[{'text':'旧批注'}]}))
        self.assertTrue(protected_feedback({'requests':[], 'previous_feedback':{'requests':[{'id':'old', 'version':'v', 'status':'open'}]}}))
        self.assertTrue(protected_feedback({'requests':[], 'previous_feedback':{'requests':[{'id':'old', 'version':'v', 'status':'resolved', 'held':True}]}}))
        self.assertFalse(protected_feedback({'requests':[{'id':'done', 'version':'v', 'status':'resolved'}]}))

    def test_manage_previous_only_feedback_without_losing_its_original_version(self):
        id_ = self.proposal(); data = self.review().inspect(id_)
        self.apply('feedback', {'id':id_, 'version':data['version'], 'side':'original',
                                'start':0, 'end':0, 'quote':'', 'text':'较早的未处理批注'})
        self.apply('propose', {'after':'The model is reliable and fast.', 'discard_annotations':True}, id_)
        self.install_sidecar(dict(self.review().state, schema=3))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        edit = r.state['edits'][id_]
        note = edit['previous_feedback']['requests'][0].copy()
        item = {'id':id_, 'file':edit['file'], 'version':edit['versions'][-1], 'note':note, 'source':'previous_feedback'}
        updated, result = r.manage_feedback({'session':r.state['session'], 'items':[item], 'action':'hold'})
        r.persist(updated, digest(r.raw))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        self.assertTrue(r.state['edits'][id_]['previous_feedback']['requests'][0]['held'])
        self.assertEqual(r.feedback_context()['items'][0]['version'], data['version'])
        self.assertTrue(r.feedback_context()['items'][0]['requests'][0]['held'])
        with self.assertRaisesRegex(Conflict, '未处理或暂留批注'):
            r.begin('next', ['main.tex','reply.tex'])
        r.state['edits'][id_]['status'] = 'accepted'
        r.persist({}, digest(r.raw))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        from mcp_server import feedback_packet
        self.assertTrue(feedback_packet(r)['items'][0]['requests'][0]['held'])

    def test_open_previous_feedback_on_decided_item_remains_in_handoff(self):
        from mcp_server import feedback_packet
        id_ = self.proposal(); version = self.review().state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original',
                                'start':0, 'end':0, 'quote':'', 'text':'Unresolved older note.'})
        self.apply('propose', {'after':'The model remains strong.', 'discard_annotations':True}, id_)
        r = self.review(); previous = r.state['edits'][id_]['previous_feedback']['requests'][0].copy()
        r.state['edits'][id_]['status'] = 'accepted'
        r.persist({}, digest(r.raw))
        r = self.review()
        for packet in (r.feedback_context(), feedback_packet(r)):
            items = packet['items']
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]['id'], id_)
            self.assertEqual(items[0]['version'], version)
            self.assertEqual(items[0]['requests'][0]['id'], previous['id'])
            self.assertEqual(items[0]['requests'][0]['status'], 'open')
        r.state['edits'][id_]['previous_feedback']['requests'][0]['status'] = 'closed-by-author-acceptance'
        r.persist({}, digest(r.raw))
        r = self.review()
        self.assertEqual(r.feedback_context()['items'], [])
        self.assertEqual(feedback_packet(r)['items'], [])

    def install_sidecar(self, state):
        owner = self.root / 'reply.tex'
        owner.write_text(''.join(line for line in owner.read_bytes().decode('utf-8').splitlines(keepends=True)
                                 if not line.startswith('% CODEX-REVIEW-DATA ')), encoding='utf-8', newline='')
        (self.root / '.codex-review' / 'state.json').write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')

    def test_unavailable_host_leaves_sidecar_and_source_unchanged(self):
        from unittest.mock import patch
        from review_host_client import HostError
        self.install_sidecar(dict(self.review().state, schema=3))
        review = Review(self.root, '.codex-review/state.json', 'missing-git')
        text = review.read('main.tex')
        start = text.index('The model is strong and fast.')
        end = text.index('\n', start) + 1
        updated, _ = review.prepare_block({'file':'main.tex', 'kind':'paragraph', 'start':start, 'end':end,
                                           'source_revision':review.source_digest(text)})
        state_path, source_path = self.root / '.codex-review' / 'state.json', self.root / 'main.tex'
        state_before, source_before = state_path.read_bytes(), source_path.read_bytes()
        with patch('review_host_client.HostSession', side_effect=HostError('unavailable')):
            with self.assertRaisesRegex(Conflict, '审核宿主事务失败'):
                review.persist(updated, digest(review.raw))
        self.assertEqual(state_path.read_bytes(), state_before)
        self.assertEqual(source_path.read_bytes(), source_before)

    def test_block_markers_preview_preserves_source_and_rejects_damage(self):
        from review_blocks import index, prepare
        source = '\\begin{document}\r\n标题 🙂\r\n\r\nParagraph.\r\n\r\n\\end{document}\r\n'
        start = source.index('Paragraph.')
        end = source.index('\r\n', start) + 2
        marked, block = prepare(source, start, end, 'paragraph')
        self.assertEqual(marked[block['start']:block['end']], 'Paragraph.\r\n')
        self.assertEqual(marked[:block['marker_start']] + marked[block['start']:block['end']] + marked[block['marker_end']:], source)
        self.assertEqual(index(marked)[block['id']], block)
        with self.assertRaisesRegex(ValueError, '重复'):
            index(marked + marked[block['marker_start']:block['marker_end']])
        with self.assertRaisesRegex(ValueError, '缺失'):
            index(marked[:block['end']] + marked[block['marker_end']:])
        unsafe = '\\begin{document}\n\\textbf{\ninside\n}\n\\end{document}\n'
        with self.assertRaisesRegex(ValueError, '安全'):
            prepare(unsafe, unsafe.index('inside'), unsafe.index('}\n', unsafe.index('inside')), 'paragraph')

    def test_target_block_ignores_unrelated_damage_but_rejects_local_ambiguity(self):
        from review_blocks import index_target, prepare
        text = '\\begin{document}\nFirst paragraph.\n\nSecond paragraph.\n\\end{document}\n'
        start = text.index('First paragraph.'); end = text.index('\n', start) + 1
        marked, block = prepare(text, start, end, 'paragraph')
        damaged = marked + '% TS-BLOCK-BEGIN broken\n'
        row = index_target(damaged, block['id'])
        self.assertEqual(damaged[row['start']:row['end']], 'First paragraph.\n')
        with self.assertRaises(ValueError):
            index_target(damaged[:row['end']] + '% TS-BLOCK-BEGIN broken\n' + damaged[row['end']:], block['id'])
        with self.assertRaises(ValueError):
            index_target(damaged + marked[row['marker_start']:row['marker_end']], block['id'])

    def test_question_container_allows_nested_blocks_but_not_crossing_boundaries(self):
        from review_blocks import index, prepare
        text = '\\begin{document}\nQuestion.\n\nFirst response.\n\nSecond response.\n\\end{document}\n'
        start = text.index('Question.'); end = text.index('\\end{document}')
        text, container = prepare(text, start, end, 'question')
        first = text.index('First response.'); first_end = text.index('\n', first) + 1
        nested, child = prepare(text, first, first_end, 'paragraph')
        self.assertEqual(index(nested)[child['id']]['parent'], container['id'])
        with self.assertRaisesRegex(ValueError, '只有审稿问题容器'):
            prepare(nested, nested.index('First response.'), nested.index('\n', nested.index('First response.')) + 1, 'paragraph')
        with self.assertRaisesRegex(ValueError, '错配'):
            prepare(text, first, len(text), 'question')

    def test_new_sidecar_requires_explicit_initialization_and_preserves_source(self):
        root = Path(tempfile.mkdtemp(prefix='sidecar-new-', dir=ROOT))
        source = root / 'main.tex'
        source.write_bytes(b'\\documentclass{article}\r\n\\begin{document}\r\nText.\r\n\\end{document}\r\n')
        before = source.read_bytes()
        with self.assertRaisesRegex(Conflict, 'missing'):
            Review(root, '.codex-review/state.json')
        r = Review(root, '.codex-review/state.json', initialize=True)
        with r.writer_lock():
            r = Review(root, '.codex-review/state.json', initialize=True)
            updated, _ = r.begin('first', ['main.tex'])
            r.persist(updated, digest(r.raw))
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(Review(root, '.codex-review/state.json').state['schema'], 3)
        self.assertEqual(Review(root, '.codex-review/state.json').state['rounds'][-1]['name'], 'first')
        self.assertFalse(Review(root, '.codex-review/state.json').interrupted)

    def test_old_owner_cannot_write_while_external_state_exists(self):
        state = dict(self.review().state, schema=3)
        sidecar = self.root / '.codex-review' / 'state.json'
        sidecar.write_text(json.dumps(state), encoding='utf-8')
        before = (self.root / 'reply.tex').read_bytes()
        with self.assertRaisesRegex(Conflict, '外置审核状态已存在'):
            self.review()
        with self.assertRaisesRegex(Conflict, '同时存在'):
            Review(self.root, '.codex-review/state.json', 'missing-git')
        self.assertEqual((self.root / 'reply.tex').read_bytes(), before)
        owner = self.root / 'reply.tex'
        owner.write_text(''.join(line for line in owner.read_text(encoding='utf-8').splitlines(keepends=True)
                                 if not line.startswith('% CODEX-REVIEW-DATA ')), encoding='utf-8', newline='')
        routed = self.review()
        self.assertTrue(routed.sidecar)
        self.assertEqual(routed.state_rel, '.codex-review/state.json')

    def test_sidecar_metadata_and_source_transaction_are_separate(self):
        from unittest.mock import patch
        from review_host_test_support import FakeHostSession
        legacy = self.review()
        state = dict(legacy.state, schema=3)
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(state)
        owner = (self.root / 'reply.tex').read_bytes()
        def review():
            return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review()
        text = r.read('main.tex')
        start = text.index('The model is strong and fast.')
        end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)})
        r.persist(updated, digest(r.raw))
        original = (self.root / 'main.tex').read_bytes()
        r = review()
        updated, result = r.propose({'file': 'main.tex', 'kind': 'manuscript',
            'block_id': block['block_id'], 'before': 'The model is strong and fast.', 'after': 'The model is reliable.'})
        r.persist(updated, digest(r.raw))
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        source = self.root / 'main.tex'
        source.write_bytes(source.read_bytes().replace(b'Unchanged context before.', b'Author edited outside the block.'))
        original = source.read_bytes()
        r = review()
        unchanged_state = r.raw
        self.assertTrue(r.inspect(result['id'])['source_match'])
        self.assertEqual(review().raw, unchanged_state)
        r = review()
        version = r.state['edits'][result['id']]['versions'][-1]
        updated, _ = r.decide([result['id']], [], {result['id']: version})
        write = FakeHostSession.write
        def interrupt(path, raw):
            if path.name == 'main.tex':
                raise OSError('simulated interruption')
            write(path, raw)
        with patch.object(FakeHostSession, 'write', side_effect=interrupt):
            with self.assertRaisesRegex(Conflict, 'simulated interruption'):
                r.persist(updated, digest(r.raw))
        interrupted = review()
        self.assertTrue(interrupted.interrupted)
        (self.root / 'main.tex').write_text('Author edited after interruption.\n', encoding='utf-8')
        with self.assertRaisesRegex(Conflict, 'author/concurrent edits'):
            interrupted.recover(digest(interrupted.raw))
        self.assertEqual((self.root / 'main.tex').read_text(encoding='utf-8'), 'Author edited after interruption.\n')
        (self.root / 'main.tex').write_bytes(original)
        interrupted = review()
        interrupted.recover(digest(interrupted.raw))
        self.assertIn('The model is reliable.', review().read('main.tex'))
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        self.assertNotIn('transaction', review().state)
        self.assertNotIn('auto_backup_projection_error', review().state)

    def test_fixed_block_detects_author_edit_and_missing_marker_without_relocation(self):
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex')
        start = text.index('The model is strong and fast.'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)})
        r.persist(updated, digest(r.raw))
        r = review(); updated, result = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable.'}); r.persist(updated, digest(r.raw))
        file = self.root / 'main.tex'; marked = file.read_bytes()
        file.write_bytes(marked.replace(b'strong and fast', b'changed by author'))
        r = review(); before_state = r.raw
        self.assertFalse(r.inspect(result['id'])['source_match'])
        with self.assertRaisesRegex(Conflict, '正文已修改'):
            r.decide([result['id']], [], {result['id']: r.state['edits'][result['id']]['versions'][-1]})
        self.assertEqual(review().raw, before_state)
        self.assertIn(b'changed by author', file.read_bytes())
        text = marked.decode('utf-8')
        line = next(line for line in text.splitlines(keepends=True) if line.startswith('% TS-BLOCK-END'))
        file.write_bytes(text.replace(line, '', 1).encode('utf-8'))
        r = review()
        self.assertFalse(r.cards()['cards'][result['id']]['source_match'])
        with self.assertRaisesRegex(Conflict, '标记'):
            r.decide([result['id']], [], {result['id']: r.state['edits'][result['id']]['versions'][-1]})

    def test_explicitly_restore_a_missing_block_identity(self):
        from review_blocks import index
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root,'.codex-review/state.json','missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n',start)+1
        updated, block = r.prepare_block({'file':'main.tex','kind':'paragraph','start':start,'end':end,'source_revision':r.source_digest(text)}); r.persist(updated,digest(r.raw))
        r = review(); updated, item = r.propose({'file':'main.tex','kind':'manuscript','block_id':block['block_id'],'before':'The model is strong and fast.','after':'The model is reliable.'}); r.persist(updated,digest(r.raw))
        source = self.root/'main.tex'; text = source.read_bytes().decode('utf-8'); row = index(text)[block['block_id']]
        source.write_bytes((text[:row['marker_start']] + text[row['start']:row['end']] + text[row['marker_end']:]).encode('utf-8'))
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n',start)+1
        spec = {'file':'main.tex','block_id':block['block_id'],'source_revision':r.source_digest(text),'restore':True,'start':start,'end':end}
        before = r.raw; _, preview = r.reassociate_block(spec)
        self.assertEqual(review().raw,before); self.assertTrue(preview['restored'])
        r = review(); updated, _ = r.reassociate_block(spec); r.persist(updated,digest(r.raw))
        r = review(); self.assertTrue(r.inspect(item['id'])['source_match'])
        self.assertEqual(r.state['edits'][item['id']]['block_id'],block['block_id'])

    def test_explicitly_reassociate_a_uniquely_moved_block(self):
        from review_blocks import index
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root,'.codex-review/state.json','missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n',start)+1
        updated, block = r.prepare_block({'file':'main.tex','kind':'paragraph','start':start,'end':end,'source_revision':r.source_digest(text)}); r.persist(updated,digest(r.raw))
        r = review(); updated, item = r.propose({'file':'main.tex','kind':'manuscript','block_id':block['block_id'],'before':'The model is strong and fast.','after':'The model is reliable.'}); r.persist(updated,digest(r.raw))
        main, reply = self.root/'main.tex', self.root/'reply.tex'
        text = main.read_bytes().decode('utf-8'); row = index(text)[block['block_id']]; snippet = text[row['marker_start']:row['marker_end']]
        main.write_bytes((text[:row['marker_start']]+text[row['marker_end']:]).encode('utf-8'))
        reply.write_bytes(reply.read_bytes().replace(b'\\end{document}',snippet.encode('utf-8')+b'\\end{document}'))
        r = review(); text = r.read('reply.tex')
        spec = {'file':'reply.tex','block_id':block['block_id'],'source_revision':r.source_digest(text)}
        updated, result = r.reassociate_block(spec); self.assertEqual(result['ids'],[item['id']]); r.persist(updated,digest(r.raw))
        r = review(); self.assertEqual(r.state['edits'][item['id']]['file'],'reply.tex'); self.assertTrue(r.inspect(item['id'])['source_match'])
    def test_sidecar_backup_preserves_source_conflicts_and_backup_journal(self):
        from review_archive import backup, restore
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable.'}); r.persist(updated, digest(r.raw))
        source = self.root / 'main.tex'; source.write_bytes(source.read_bytes().replace(b'strong and fast', b'author edit'))
        journal = self.root / '.codex-review' / 'automatic-backup.json'
        journal.write_text(json.dumps({'session': review().state['session'], 'status': {'state': 'idle'}}), encoding='utf-8')
        archive = self.root.parent / (self.root.name + '-conflict.zip')
        backup(self.root, '.codex-review/state.json', archive, 'missing-git')
        destination = self.root.parent / (self.root.name + '-conflict-restored')
        result = restore(archive, destination, 'missing-git')
        self.assertEqual(result['source_conflicts'], [item['id']])
        self.assertEqual((destination / 'main.tex').read_bytes(), source.read_bytes())
        self.assertEqual((destination / '.codex-review' / 'automatic-backup.json').read_bytes(), journal.read_bytes())
        self.assertEqual(Review(destination, '.codex-review/state.json').state['edits'][item['id']]['status'], 'pending')

    def test_sidecar_projection_does_not_guess_identical_text_in_old_snapshot(self):
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        source = self.root / 'main.tex'
        source.write_bytes(source.read_bytes().replace(b'Unchanged context before.', b'Author changed outside the block.'))
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable.'}); r.persist(updated, digest(r.raw))
        r = review(); version = r.state['edits'][item['id']]['versions'][-1]
        updated, _ = r.decide([item['id']], [], {item['id']: version}); r.persist(updated, digest(r.raw))
        r = review()
        self.assertIn('auto_backup_projection_error', r.state)
        self.assertIn('Author changed outside the block.', r.read('main.tex'))
        self.assertIn('The model is reliable.', r.read('main.tex'))

    def test_unbound_sidecar_item_remains_visible_as_conflict(self):
        id_ = self.proposal()
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        data = r.inspect(id_)
        self.assertFalse(data['source_match'])
        self.assertIn('没有已登记', data['block_conflict'])
        self.assertEqual(data['candidate'], 'The model is reliable and compact.')
        self.assertFalse(r.cards()['cards'][id_]['source_match'])

    def test_sidecar_checkpoint_compacts_only_safe_completed_history(self):
        import copy
        from review_checkpoint import compact
        id_ = self.proposal()
        sidecar = self.root / '.codex-review' / 'state.json'
        state = dict(self.review().state, schema=3)
        edit = state['edits'][id_]; edit['status'] = 'accepted'; version = edit['versions'][-1]
        edit['requests'] = [{'version': version, 'status': 'resolved', 'text': 'Preserve history'}]
        edit['questions'] = [{'id':'Q1','file':'reply.tex','quote':'Thank you.'}]
        state['edits']['2'] = copy.deepcopy(edit)
        state['edits']['2']['requests'][0]['status'] = 'open'
        state['edits']['3'] = copy.deepcopy(edit)
        state['edits']['3']['freshness'] = 'needs-recheck'
        state['edits']['4'] = copy.deepcopy(edit)  # Not in this verified checkpoint.
        state['edits']['5'] = copy.deepcopy(edit)
        state['edits']['6'] = copy.deepcopy(edit)
        state['edits']['6']['status'] = 'pending'
        state['edits']['6']['deps'] = ['5']
        state['next'][0] = 7
        protected = copy.deepcopy({i: state['edits'][i] for i in ('2','3','4','5','6')})
        state['rounds'].insert(0, copy.deepcopy(state['rounds'][0]))
        state['pending_backup'] = {'commit': 'fixture-commit', 'files': {}, 'accepted': {id_: version},
                                   'closed': {i: {'status': 'accepted', 'version': version} for i in (id_, '2', '3', '5')}}
        self.install_sidecar(state)
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        r.git = lambda *args: b'fixture-commit\n'
        _, result = compact(r)
        self.assertEqual(result['removed_ids'], [])
        self.assertEqual(len(r.state['rounds']), 1)
        self.assertEqual(r.state['edits'][id_]['versions'], [])
        self.assertNotIn('requests', r.state['edits'][id_])
        self.assertEqual(r.state['edits'][id_]['questions'][0]['id'], 'Q1')
        self.assertEqual(r.state['edits'][id_]['checkpoint'], 'fixture-commit')
        self.assertEqual({i: r.state['edits'][i] for i in protected}, protected)
        r.persist({}, digest(r.raw))
        persisted = Review(self.root, '.codex-review/state.json', 'missing-git').state
        self.assertEqual(persisted['edits'][id_]['versions'], [])
        self.assertEqual({i: persisted['edits'][i] for i in protected}, protected)

    def test_block_question_association_requires_verified_exact_quote(self):
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        spec = {'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                'source_revision': r.source_digest(text), 'questions': [{'id': 'R1-Q1', 'file': 'reply.tex', 'quote': 'Thank you.'}]}
        updated, result = r.prepare_block(spec)
        self.assertEqual(r.state['blocks'][result['block_id']]['questions'], spec['questions'])
        r.persist(updated, digest(r.raw))
        r = Review(self.root, '.codex-review/state.json', 'missing-git'); text = r.read('main.tex')
        spec.update(start=text.index('Unchanged context before.'), end=text.index('\n', text.index('Unchanged context before.')) + 1,
                    source_revision=r.source_digest(text), questions=[{'id': 'R1-Q2', 'file': 'reply.tex', 'quote': 'Not in the source.'}])
        with self.assertRaisesRegex(Conflict, 'match its actual source uniquely'):
            r.prepare_block(spec)

    def test_sidecar_block_in_old_owner_preserves_header_and_exact_offsets(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('reply.tex'); header = text[:text.index('\\documentclass')]
        start = text.index('Thank you.'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'reply.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        self.assertTrue((self.root / 'reply.tex').read_bytes().decode('utf-8').startswith(header))
        r = review(); updated, result = r.propose({'file': 'reply.tex', 'kind': 'response', 'block_id': block['block_id'],
                                                   'before': 'Thank you.', 'after': 'We thank the reviewer.'})
        r.persist(updated, digest(r.raw))
        item = review().inspect(result['id'], source=True)
        self.assertEqual(item['source']['text'][item['source']['start']:item['source']['end']], 'Thank you.')

    def test_sidecar_checkpoint_keeps_author_review_comments(self):
        from review_checkpoint import source_text
        text = ('% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-PLAN keep this author note\n'
                '% CODEX-REVIEW-SOURCE-ONLY: accepted-content\n% CODEX-REVIEW-STATE-END\nText.\n')
        self.assertEqual(source_text(text, sidecar=True), '% CODEX-REVIEW-PLAN keep this author note\nText.\n')

    def test_preparing_block_alone_is_not_a_source_checkpoint(self):
        from review_checkpoint import plan
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, _ = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                      'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        result = plan(review())
        self.assertEqual(result['manual_files'], [])
        self.assertEqual(result['accepted'], {})

    def test_conflict_in_one_fixed_block_does_not_block_another(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        blocks = []
        for excerpt in ('The model is strong and fast.', 'Unchanged context after.'):
            r = review(); text = r.read('main.tex'); start = text.index(excerpt); end = text.index('\n', start) + 1
            updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                              'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw)); blocks.append(block['block_id'])
        r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': blocks[0],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable.'}); r.persist(updated, digest(r.raw))
        source = self.root / 'main.tex'; source.write_bytes(source.read_bytes().replace(b'strong and fast', b'changed by author'))
        r = review(); self.assertFalse(r.inspect(item['id'])['source_match'])
        updated, second = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': blocks[1],
            'before': 'Unchanged context after.', 'after': 'Revised context after.'}); r.persist(updated, digest(r.raw))
        self.assertEqual(review().state['edits'][second['id']]['status'], 'pending')

    def test_two_insertions_in_same_slot_keep_order_and_remaining_candidate(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); point = text.index('Unchanged context after.')
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'slot', 'start': point, 'end': point,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        ids = []
        for addition in ('First addition.\n', 'Second addition.\n'):
            r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
                                                     'before': '', 'after': addition}); r.persist(updated, digest(r.raw)); ids.append(item['id'])
        r = review(); first_version = r.state['edits'][ids[0]]['versions'][-1]
        updated, _ = r.decide([ids[0]], [], {ids[0]: first_version}); r.persist(updated, digest(r.raw))
        r = review(); self.assertTrue(r.inspect(ids[1])['source_match'])
        second_version = r.state['edits'][ids[1]]['versions'][-1]
        updated, _ = r.decide([ids[1]], [], {ids[1]: second_version}); r.persist(updated, digest(r.raw))
        self.assertIn('First addition.\nSecond addition.\n', review().read('main.tex').replace('\r\n', '\n'))
        self.assertNotIn(b'\n', (self.root / 'main.tex').read_bytes().replace(b'\r\n', b''))

    def test_sidecar_batch_with_stale_item_changes_no_source_or_decisions(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        ids = []
        for original, candidate in [('The model is strong and fast.', 'The model is reliable.'),
                                    ('Unchanged context after.', 'Revised context after.')]:
            r = review(); text = r.read('main.tex'); start = text.index(original); end = text.index('\n', start) + 1
            updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                              'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
            r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
                                                     'before': original, 'after': candidate}); r.persist(updated, digest(r.raw)); ids.append(item['id'])
        r = review(); before_state = r.raw; before_source = (self.root / 'main.tex').read_bytes()
        versions = {id_: r.state['edits'][id_]['versions'][-1] for id_ in ids}; versions[ids[1]] = 'stale'
        with self.assertRaisesRegex(Conflict, 'Batch preflight failed'):
            r.decide(ids, [], versions)
        self.assertEqual(review().raw, before_state)
        self.assertEqual((self.root / 'main.tex').read_bytes(), before_source)
        self.assertTrue(all(review().state['edits'][id_]['status'] == 'pending' for id_ in ids))

    def test_clean_export_removes_only_review_markers_and_keeps_working_source(self):
        from review_archive import export_sources
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, _ = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                      'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        source = self.root / 'main.tex'; before = source.read_bytes()
        extra = self.root / 'data.dat'; extra.write_bytes(b'extra-data')
        destination = self.root.parent / (self.root.name + '-submission')
        result = export_sources(self.root, destination, ['data.dat'])
        self.assertFalse(result['source_modified']); self.assertEqual(source.read_bytes(), before)
        self.assertNotIn(b'% TS-BLOCK-', (destination / 'main.tex').read_bytes())
        self.assertEqual((destination / 'data.dat').read_bytes(), b'extra-data')
        self.assertFalse((destination / '.codex-review').exists())
        self.assertNotIn(b'CODEX-REVIEW-STATE', (destination / 'reply.tex').read_bytes())
        with self.assertRaisesRegex(Conflict, 'cannot include'):
            export_sources(self.root, self.root.parent / (self.root.name + '-bad-submission'), ['.codex-review/state.json'])
        with self.assertRaisesRegex(Conflict, 'cannot include'):
            export_sources(self.root, self.root.parent / (self.root.name + '-bad-case-submission'), ['.CODEX-REVIEW/state.json'])
        cli_destination = self.root.parent / (self.root.name + '-submission-cli')
        run = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('review_archive.py')),
                              'export', '--repo', str(self.root), '--destination', str(cli_destination)],
                             capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)['exported'], str(cli_destination.resolve()))
        source.write_bytes(before + b'% TS-BLOCK-END id=broken\n')
        invalid = self.root.parent / (self.root.name + '-invalid-submission')
        with self.assertRaisesRegex(Conflict, 'invalid block markers'):
            export_sources(self.root, invalid)
        self.assertFalse(invalid.exists())

    def test_retired_header_requires_matching_external_state_and_paper_authority(self):
        import base64
        from unittest.mock import patch
        from profile_transition_check import verify
        self.proposal(); state = dict(self.review().state, schema=3, legacy_owner='reply.tex')
        self.install_sidecar(state)
        owner = self.root / 'reply.tex'
        owner.write_bytes(owner.read_bytes().replace(b'% CODEX-REVIEW-STATE-END', b'% CODEX-REVIEW-MIGRATED state=.codex-review/state.json\n% CODEX-REVIEW-STATE-END'))
        external = self.root / '.codex-review/state.json'
        encode = lambda raw: base64.b64encode(raw).decode('ascii')
        plan = {'kind':'retired-review-header','owner':'reply.tex','owner_before':encode(owner.read_bytes()),
                'checks':[{'file':'.codex-review/state.json','before':encode(external.read_bytes())}]}
        authority = {'authority':'paper','status':'confirmed','review_owner':'.codex-review/state.json'}
        with patch('profile_transition_check.scan', return_value=authority):
            self.assertTrue(verify(self.root, self.root.parent, plan)['verified'])
            bad = {**plan, 'checks':[{'file':'.codex-review/state.json','before':encode(b'old')}]}
            with self.assertRaisesRegex(ValueError, '状态已变化'): verify(self.root, self.root.parent, bad)
            owner.write_bytes(owner.read_bytes().replace(b'manuscript=2', b'manuscript=9'))
            bad = {**plan, 'owner_before':encode(owner.read_bytes())}
            with self.assertRaisesRegex(ValueError, '计数'): verify(self.root, self.root.parent, bad)
        with patch('profile_transition_check.scan', return_value={**authority,'authority':'legacy'}):
            owner.write_bytes(base64.b64decode(plan['owner_before']))
            with self.assertRaisesRegex(ValueError, '权威'): verify(self.root, self.root.parent, plan)

    def test_migration_preview_keeps_legacy_state_source_and_notes(self):
        from review_migration import preview
        id_ = self.proposal(); r = self.review(); version = r.state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': version, 'side': 'original', 'start': 0, 'end': 3,
                                'quote': 'The', 'text': 'Keep the note.'})
        r = self.review(); state = r.raw; source = (self.root / 'main.tex').read_bytes()
        packet = preview(r)
        self.assertEqual(packet['state_sha256'], digest(state))
        self.assertEqual(packet['counts']['notes'], 1)
        self.assertEqual(packet['blocks'][0]['edits'][0]['id'], id_)
        self.assertIn('The model is strong and fast.', packet['blocks'][0]['text'])
        self.assertEqual(packet['conflicts'], [])
        self.assertEqual(self.review().raw, state)
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        self.assertFalse((self.root / '.codex-review' / 'state.json').exists())

    def test_migration_preview_does_not_assign_an_ambiguous_copied_paragraph(self):
        from review_migration import preview
        id_ = self.proposal(); source = self.root / 'main.tex'; raw = source.read_bytes()
        source.write_bytes(raw + raw)
        r = self.review(); state = r.raw; before = source.read_bytes()
        packet = preview(r)
        self.assertEqual(packet['blocks'], [])
        self.assertEqual(packet['conflicts'][0]['id'], id_)
        self.assertEqual(self.review().raw, state)
        self.assertEqual(source.read_bytes(), before)

    def test_migration_preparation_preserves_identity_without_changing_sources(self):
        from review_migration import preview, prepare, transaction
        id_ = self.proposal(); r = self.review()
        before = {name: (self.root / name).read_bytes() for name in ('main.tex','reply.tex')}
        old_edit = json.loads(json.dumps(r.state['edits'][id_]))
        packet = preview(r); prepared = prepare(r, packet)
        edit = prepared['state']['edits'][id_]
        self.assertEqual(edit['versions'], old_edit['versions'])
        self.assertEqual(edit['status'], old_edit['status'])
        self.assertEqual(edit['block_id'], packet['blocks'][0]['block_id'])
        self.assertIn(b'% TS-BLOCK-BEGIN', prepared['sources']['main.tex'])
        self.assertNotIn(b'% CODEX-REVIEW-DATA ', prepared['sources']['reply.tex'])
        self.assertIn(b'% CODEX-REVIEW-MIGRATED ', prepared['sources']['reply.tex'])
        self.assertEqual({name: (self.root / name).read_bytes() for name in before},before)
        self.assertEqual(r.raw, (self.root / 'reply.tex').read_bytes())
        self.assertFalse((self.root / '.codex-review' / 'state.json').exists())
        staged = transaction(r, packet)
        self.assertEqual(len(staged['commit']), 64)
        self.assertEqual(len(staged['plan']), 64)
        self.assertEqual({name: (self.root / name).read_bytes() for name in before},before)

    def test_migration_conflicts_reject_all_paths_before_host_or_write(self):
        from unittest.mock import patch
        from review_migration import preview, prepare, transaction, apply
        id_ = self.proposal(); r = self.review(); version = r.state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id':id_, 'version':version, 'side':'original', 'start':0,
                                'end':3, 'quote':'The', 'text':'Protect this note.'})
        source = self.root / 'main.tex'
        source.write_text(source.read_text(encoding='utf-8').replace('The model is strong and fast.',
                                                                      'Author changed this sentence.'), encoding='utf-8')
        r = self.review(); packet = preview(r)
        self.assertEqual([row['id'] for row in packet['conflicts']], [id_])
        paths = [source, self.root / 'reply.tex']
        before = {path:path.read_bytes() for path in paths}
        objects = {path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}
        for method in (prepare, transaction, apply):
            with patch('review_host_client.HostSession', side_effect=AssertionError('host must not be contacted')):
                with self.assertRaisesRegex(Conflict, '未解决冲突'):
                    method(r, packet)
        with patch('review_host_client.HostSession', side_effect=AssertionError('host must not be contacted')):
            with self.assertRaisesRegex(Conflict, '未解决冲突'):
                apply(r, {**packet, 'conflicts':[]})
        self.assertEqual({path:path.read_bytes() for path in paths}, before)
        self.assertEqual({path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}, objects)
        self.assertFalse((self.root / '.codex-review' / 'state.json').exists())
        self.assertEqual(self.review().state['schema'], 2)
        self.assertEqual(self.review().state['edits'][id_]['requests'][0]['text'], 'Protect this note.')
        support = self.root / 'isolated-support'; support.mkdir()
        (support / 'sitecustomize.py').write_text(
            'import review_host_client\nclass Blocked:\n def __init__(self,*a,**k): raise AssertionError("host forbidden")\nreview_host_client.HostSession=Blocked\n', encoding='utf-8')
        env = dict(os.environ, PYTHONPATH=os.pathsep.join((str(support), str(Path(__file__).parent))))
        command = [sys.executable, '-B', '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                   '--project', str(self.root), '--state', 'reply.tex', '--apply', 'migrate-state']
        result = subprocess.run(command, input=json.dumps(packet, ensure_ascii=False).encode('utf-8'),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('未解决冲突', result.stderr.decode('utf-8'))
        self.assertNotIn('host forbidden', result.stderr.decode('utf-8'))
        self.assertEqual({path:path.read_bytes() for path in paths}, before)
        self.assertEqual({path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}, objects)

    def test_migration_overlapping_blocks_rejects_complete_transaction(self):
        from unittest.mock import patch
        from review_migration import preview, prepare, transaction, apply
        source = self.root / 'main.tex'
        source.write_bytes(('\\documentclass{article}\n\\begin{document}\nIntroductory prose.\n'
                            '\\section{Heading} First detail.\nClosing prose.\n\\end{document}\n').encode('utf-8'))
        for before, after in [('Introductory prose.\n\\section{Heading}', 'Revised introduction.'), ('First detail.', 'Revised detail.')]:
            self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':before, 'after':after})
        r = self.review(); packet = preview(r)
        self.assertEqual({row['id'] for row in packet['conflicts']}, {'1', '2'})
        before = {path:path.read_bytes() for path in (source, self.root / 'reply.tex')}
        objects = {path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}
        for method in (prepare, transaction, apply):
            with patch('review_host_client.HostSession', side_effect=AssertionError('host must not be contacted')):
                with self.assertRaisesRegex(Conflict, '未解决冲突'):
                    method(r, packet)
        self.assertEqual({path:path.read_bytes() for path in before}, before)
        self.assertEqual({path.name:path.read_bytes() for path in (self.root / '.codex-review' / 'objects').iterdir()}, objects)
        self.assertEqual(self.review().state['schema'], 2)
        self.assertFalse((self.root / '.codex-review' / 'state.json').exists())

    def test_migration_keeps_exact_adjacent_line_items(self):
        from review_migration import preview, prepare
        source = self.root / 'main.tex'
        source.write_text('\\documentclass{article}\n\\begin{document}\nFirst sentence.\n'
                          '\\section{Heading} Second sentence.\nThird sentence.\n\\end{document}\n', encoding='utf-8')
        one = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'First sentence.',
                                     'after':'First improved.'})['id']
        two = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'Second sentence.',
                                     'after':'Second improved.'})['id']
        r = self.review(); packet = preview(r)
        self.assertEqual(packet['conflicts'], [])
        prepared = prepare(r, packet)
        self.assertEqual(set(prepared['state']['edits']), {one, two})
        self.assertNotEqual(prepared['state']['edits'][one]['block_id'], prepared['state']['edits'][two]['block_id'])
        self.assertIn(b'First sentence.', prepared['sources']['main.tex'])
        self.assertIn(b'Second sentence.', prepared['sources']['main.tex'])
        for name, raw in prepared['sources'].items():
            (self.root / name).write_bytes(raw)
        (self.root / '.codex-review' / 'state.json').write_bytes(prepared['state_raw'])
        current = Review(self.root, '.codex-review/state.json', 'missing-git')
        version_one = current.state['edits'][one]['versions'][-1]
        version_two = current.state['edits'][two]['versions'][-1]
        updated, _ = current.decide([one], [], {one:version_one})
        current.persist(updated, digest(current.raw))
        current = Review(self.root, '.codex-review/state.json', 'missing-git')
        self.assertEqual(current.state['edits'][two]['versions'][-1], version_two)
        self.assertTrue(current.inspect(two, source=True)['source_match'])

    def test_migration_keeps_inline_insertion_offset(self):
        from review_migration import preview, prepare
        source = self.root / 'main.tex'
        source.write_bytes(b'\\documentclass{article}\n\\begin{document}\nBefore insertion after.\n\\end{document}\n')
        id_ = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'',
                                    'left':'Before ', 'right':'insertion after.', 'after':'new '})['id']
        r = self.review(); packet = preview(r)
        self.assertEqual(packet['conflicts'], [])
        block = next(block for block in packet['blocks'] if block['edits'][0]['id'] == id_)
        self.assertEqual(block['kind'], 'paragraph')
        self.assertEqual(block['edits'][0]['start'], block['edits'][0]['end'])
        prepared = prepare(r, packet)
        anchor = prepared['state']['edits'][id_]['anchor']
        self.assertEqual(anchor['start'], len('Before '))
        self.assertEqual(anchor['start'], anchor['end'])

    def test_migration_shared_line_accept_preserves_other_item(self):
        from review_migration import preview, prepare
        source = self.root / 'main.tex'
        source.write_bytes(b'\\documentclass{article}\n\\begin{document}\nAlpha is clear. Beta is precise.\n\\end{document}\n')
        one = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'Alpha is clear.', 'after':'Alpha is clearer.'})['id']
        two = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'Beta is precise.', 'after':'Beta is more precise.'})['id']
        r = self.review(); packet = preview(r)
        self.assertEqual(packet['conflicts'], [])
        prepared = prepare(r, packet)
        self.assertEqual(prepared['state']['edits'][one]['block_id'], prepared['state']['edits'][two]['block_id'])
        for name, raw in prepared['sources'].items(): (self.root / name).write_bytes(raw)
        (self.root / '.codex-review' / 'state.json').write_bytes(prepared['state_raw'])
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        first = r.state['edits'][one]['versions'][-1]; second = r.state['edits'][two]['versions'][-1]
        updated, _ = r.decide([one], [], {one:first}); r.persist(updated, digest(r.raw))
        r = Review(self.root, '.codex-review/state.json', 'missing-git')
        self.assertEqual(r.state['edits'][two]['versions'][-1], second)
        self.assertTrue(r.inspect(two, source=True)['source_match'])

    def test_migration_refuses_stale_preview_and_existing_sidecar(self):
        from review_migration import preview, prepare
        self.proposal(); r = self.review(); packet = preview(r)
        source = self.root/'main.tex'; original = source.read_bytes()
        source.write_bytes(original + b'% author change\n')
        with self.assertRaisesRegex(Conflict, '预览|变化'):
            prepare(self.review(), packet)
        source.write_bytes(original)
        state = self.root/'.codex-review'/'state.json'; state.write_bytes(b'{"existing":true}')
        with self.assertRaisesRegex(Conflict, '已存在'):
            prepare(r, packet)
        self.assertEqual(state.read_bytes(),b'{"existing":true}')

    def test_migration_recovery_reconstructs_plan_after_old_data_is_removed(self):
        import base64
        from review_migration import preview, transaction, recovery_preview, _recovery_plan
        self.proposal(); r = self.review(); staged = transaction(r,preview(r))
        wrapper = json.loads((self.root/'.codex-review'/'objects'/(staged['plan']+'.json')).read_bytes())
        plan = json.loads(base64.b64decode(wrapper['files']['migration-plan']))
        decode = lambda value: base64.b64decode(value,validate=True)
        for file in plan['files']:
            (self.root/file['file']).write_bytes(decode(file['after']))
        (self.root/plan['owner']).write_bytes(decode(plan['owner_after']))
        (self.root/'.codex-review'/'state.json').write_bytes(decode(plan['state_pending']))
        info = recovery_preview(self.root)
        self.assertEqual(info['commit'], staged['commit'])
        plan_id, _ = _recovery_plan(self.root, info)
        self.assertEqual(plan_id,staged['plan'])

    def test_migration_preview_reports_real_offsets_in_legacy_owner(self):
        from review_migration import preview
        id_ = self.apply('propose', {'file':'reply.tex', 'kind':'response', 'before':'Thank you.', 'after':'We thank the reviewer.'})['id']
        r = self.review(); packet = preview(r)
        block = next(row for row in packet['blocks'] if row['edits'][0]['id'] == id_)
        owner = (self.root / 'reply.tex').read_bytes().decode('utf-8')
        self.assertEqual(owner[block['source_start']:block['source_end']], block['text'])

    def test_explicit_block_source_save_preserves_candidate(self):
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'after': 'The model is reliable.'}); r.persist(updated, digest(r.raw))
        r = review(); card = r.inspect(item['id']); version = card['version']
        spec = {'block_id': block['block_id'], 'source_revision': card['block']['source_revision'], 'text': 'Author rewritten text.\n'}
        updated, saved = r.save_block_source(item['id'], version, spec); r.persist(updated, digest(r.raw))
        self.assertTrue(saved['changed']); self.assertFalse(saved['accepted'])
        r = review(); self.assertEqual(r.state['edits'][item['id']]['versions'], [version])
        self.assertEqual(r.state['edits'][item['id']]['status'], 'pending')
        self.assertFalse(r.inspect(item['id'])['source_match'])
        self.assertIn('Author rewritten text.', r.read('main.tex'))

    def test_saved_block_prefix_reconciles_without_losing_author_text(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file':'main.tex', 'kind':'paragraph', 'start':start, 'end':end,
                                          'source_revision':r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); updated, item = r.propose({'file':'main.tex', 'kind':'manuscript', 'block_id':block['block_id'],
            'before':'The model is strong and fast.', 'after':'The model is reliable and fast.'}); r.persist(updated, digest(r.raw))
        r = review(); card = r.inspect(item['id']); old = card['version']
        updated, _ = r.save_block_source(item['id'], old, {'block_id':block['block_id'],
            'source_revision':card['block']['source_revision'], 'text':'Author ' + card['block']['text']})
        r.persist(updated, digest(r.raw)); r = review(); revision = r.source_digest(r.read('main.tex'))
        updated, result = r.sync_saved({'main.tex':revision})
        self.assertEqual(result['conflicts'], []); self.assertEqual(len(result['items']), 1)
        r.persist(updated, digest(r.raw)); r = review(); card = r.inspect(item['id'], source=True)
        self.assertTrue(card['source_match']); self.assertEqual(card['original'], 'Author The model is strong and fast.')
        self.assertEqual(card['options'][0]['after'], 'Author The model is reliable and fast.')
        self.assertEqual(r.state['edits'][item['id']]['versions'], [card['version']])
        self.assertEqual(r.state['edits'][item['id']]['generation'], 2)
        with self.assertRaisesRegex(Conflict, 'Version does not belong'):
            r.inspect(item['id'], old)
        updated, _ = r.decide([item['id']], [], {item['id']:card['version']}, 'A'); r.persist(updated, digest(r.raw))
        self.assertIn('Author The model is reliable and fast.', review().read('main.tex'))
        from review_blocks import reconcile
        with self.assertRaisesRegex(ValueError, '重叠'):
            reconcile('The model.\n', 'Author The model.\n', 0, 10, [{'after':'A model.'}])
        with self.assertRaisesRegex(ValueError, '边界'):
            reconcile('prefix|Target.\n', 'prefix|XYZTarget.\n', 7, 14, [{'after':'Method.'}])

    def test_block_sync_preserves_nonoverlapping_edits_and_versions(self):
        sidecar = self.root / '.codex-review' / 'state.json'
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file': 'main.tex', 'kind': 'paragraph', 'start': start, 'end': end,
                                          'source_revision': r.source_digest(text)}); r.persist(updated, digest(r.raw))
        r = review(); options = [{'label': 'A', 'after': 'The model is reliable and fast.', 'reason': 'A'},
                                 {'label': 'B', 'after': 'The model is compact and fast.', 'reason': 'B'}]
        updated, item = r.propose({'file': 'main.tex', 'kind': 'manuscript', 'block_id': block['block_id'],
            'before': 'The model is strong and fast.', 'options': options, 'fewer_options_reason': 'Two alternatives'}); r.persist(updated, digest(r.raw))
        r = review(); old = r.state['edits'][item['id']]['versions'][-1]
        updated, _ = r.feedback({'id': item['id'], 'version': old, 'side': 'original', 'start': 0, 'end': 3, 'quote': 'The', 'text': 'Keep this note'}); r.persist(updated, digest(r.raw))
        r = review(); updated, _ = r.feedback({'id': item['id'], 'version': old, 'side': 'original', 'start': 24, 'end': 28, 'quote': 'fast', 'text': 'Preserve this exact quote'}); r.persist(updated, digest(r.raw))
        file = self.root / 'main.tex'; file.write_bytes(file.read_bytes().replace(b'The model is strong', b'A model is strong'))
        r = review(); text = r.read('main.tex'); updated, sync = r.sync_block(item['id'], old, r.source_digest(text))
        self.assertTrue(sync['changed']); self.assertEqual(sync['options'][0]['after'], 'A model is reliable and fast.')
        r.persist(updated, digest(r.raw)); r = review()
        edit = r.state['edits'][item['id']]
        self.assertEqual(edit['versions'][0], old); self.assertEqual(edit['requests'][0]['version'], old)
        self.assertTrue(edit['requests'][0]['source_stale']); self.assertTrue(r.inspect(item['id'])['source_match'])
        self.assertFalse(edit['requests'][1].get('source_stale', False))
        unchanged = r.raw; text = r.read('main.tex'); updated, result = r.sync_block(item['id'], edit['versions'][-1], r.source_digest(text))
        self.assertFalse(result['changed']); self.assertEqual(review().raw, unchanged)
        file.write_bytes(file.read_bytes().replace(b'strong', b'powerful'))
        r = review(); text = r.read('main.tex'); before = r.raw
        with self.assertRaisesRegex(Conflict, '重叠'):
            r.sync_block(item['id'], edit['versions'][-1], r.source_digest(text))
        self.assertEqual(review().raw, before)
        self.assertIn(b'powerful', file.read_bytes())

    def test_saved_batch_keeps_conflicts_independent_and_checks_source_cas(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        updated, block = r.prepare_block({'file':'main.tex', 'kind':'paragraph', 'start':start, 'end':end,
                                          'source_revision':r.source_digest(text)}); r.persist(updated, digest(r.raw))
        ids = []
        for before, after in [('strong', 'reliable'), ('fast', 'quick')]:
            r = review(); updated, item = r.propose({'file':'main.tex', 'kind':'manuscript', 'block_id':block['block_id'],
                'before':before, 'after':after}); r.persist(updated, digest(r.raw)); ids.append(item['id'])
        r = review(); version = r.state['edits'][ids[1]]['versions'][-1]
        updated, _ = r.feedback({'id':ids[1], 'version':version, 'side':'original', 'start':0, 'end':4, 'quote':'fast', 'text':'Keep this note'}); r.persist(updated, digest(r.raw))
        source = self.root / 'main.tex'; source.write_bytes(source.read_bytes().replace(b'strong', b'powerful') + b'% TS-BLOCK-BEGIN broken\n')
        r = review(); revision = r.source_digest(r.read('main.tex')); before = r.raw
        updated, result = r.sync_saved({'main.tex':revision})
        self.assertEqual([x['id'] for x in result['conflicts']], [ids[0]])
        self.assertEqual([x['id'] for x in result['items']], [ids[1]])
        r.persist(updated, digest(r.raw)); r = review()
        self.assertEqual(len(r.state['edits'][ids[0]]['versions']), 1)
        self.assertEqual(len(r.state['edits'][ids[1]]['versions']), 2)
        self.assertFalse(r.state['edits'][ids[1]]['requests'][0].get('source_stale', False))
        self.assertNotEqual(before, r.raw)
        updated, result = r.sync_saved({'main.tex':revision})
        self.assertFalse(result['changed']); self.assertEqual(review().raw, r.raw)
        source.write_bytes(source.read_bytes().replace(b'powerful', b'powerful again'))
        with self.assertRaisesRegex(Conflict, '再次变化'):
            review().sync_saved({'main.tex':revision})
        r = review(); revision = r.source_digest(r.read('main.tex'))
        updated, result = r.sync_saved({'main.tex':revision}); self.assertTrue(result['changed'])
        state_before = r.raw; source.write_bytes(source.read_bytes().replace(b'powerful again', b'powerful latest'))
        with self.assertRaisesRegex(Conflict, 'Concurrent source/state'):
            r.persist(updated, digest(r.raw))
        self.assertEqual(review().raw, state_before)
        from unittest.mock import patch
        r = review(); revision = r.source_digest(r.read('main.tex'))
        with patch.object(r, 'sync_block', side_effect=Conflict('broken immutable object')):
            with self.assertRaisesRegex(Conflict, 'broken immutable object'):
                r.sync_saved({'main.tex':revision})

    def test_manual_rebase_uses_exact_current_selection_and_preserves_history(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        changed, block = r.prepare_block({'file':'main.tex', 'kind':'paragraph', 'start':start, 'end':end, 'source_revision':r.source_digest(text)})
        r.persist(changed, digest(r.raw))
        r = review(); options = [{'label':label, 'after':value, 'reason':label} for label, value in [('A','Reliable.'), ('B','Compact.')]]
        changed, item = r.propose({'file':'main.tex', 'kind':'manuscript', 'block_id':block['block_id'], 'before':'The model is strong and fast.',
                                   'options':options, 'fewer_options_reason':'Two options'})
        r.persist(changed, digest(r.raw)); r = review(); version = r.inspect(item['id'])['version']
        changed, _ = r.feedback({'id':item['id'], 'version':version, 'side':'original', 'start':0, 'end':3, 'quote':'The', 'text':'Keep this note'})
        r.persist(changed, digest(r.raw)); r = review()
        changed, _ = r.feedback({'id':item['id'], 'version':version, 'side':'original', 'start':13, 'end':19, 'quote':'strong', 'text':'Changed quote'})
        r.persist(changed, digest(r.raw)); file = self.root/'main.tex'
        file.write_bytes(file.read_bytes().replace(b'The model is strong', 'The model is powerful 🙂'.encode()))
        r = review(); card = r.inspect(item['id']); current = card['block']['text'].replace('\r\n','\n')
        quote = 'The model is powerful 🙂 and fast.'; begin = current.index(quote)
        spec = {'block_id':block['block_id'], 'source_revision':card['block']['source_revision'], 'start':begin, 'end':begin+len(quote),
                'quote':quote, 'options':[{'label':'A','after':'Manual A.'}, {'label':'B','after':'Manual B.'}]}
        with self.assertRaisesRegex(Conflict, '正文已修改'):
            r.propose({'options':options, 'fewer_options_reason':'Two options'}, item['id'])
        with self.assertRaisesRegex(Conflict, '正文已变化'):
            r.manual_rebase(item['id'],version,{**spec, 'source_revision':'stale'})
        with self.assertRaisesRegex(Conflict, '选区'):
            r.manual_rebase(item['id'],version,{**spec, 'quote':'wrong'})
        command = [sys.executable,'-X','utf8',str(Path(__file__).with_name('source_review.py')),'--project',str(self.root),'--state','.codex-review/state.json']
        suffix = ['manual-rebase','--id',item['id'],'--version',version]
        state_before = r.raw
        preview = subprocess.run(command+suffix,input=json.dumps(spec).encode('utf-8'),capture_output=True)
        self.assertEqual(preview.returncode,0,preview.stderr.decode('utf-8')); self.assertFalse(json.loads(preview.stdout)['applied'])
        self.assertEqual(review().raw,state_before)
        applied = subprocess.run(command+['--apply','--expect',digest(state_before)]+suffix,input=json.dumps(spec).encode('utf-8'),capture_output=True)
        self.assertEqual(applied.returncode,0,applied.stderr.decode('utf-8')); self.assertTrue(json.loads(applied.stdout)['applied'])
        r = review()
        card = r.inspect(item['id']); self.assertEqual(card['original'],quote); self.assertTrue(card['source_match'])
        self.assertEqual([o['after'] for o in card['options']], ['Manual A.','Manual B.'])
        self.assertEqual(card['edit']['versions'][0],version); self.assertFalse(card['edit']['requests'][0].get('source_stale',False))
        self.assertTrue(card['edit']['requests'][1]['source_stale'])
        self.assertEqual(card['edit']['requests'][0]['text'],'Keep this note')
        with self.assertRaisesRegex(Conflict, '已变化'):
            r.manual_rebase(item['id'],version,spec)
        current_version = card['version']
        changed, _ = r.manual_rebase(item['id'], current_version, spec); r.persist(changed,digest(r.raw)); r=review()
        repeated_version = r.inspect(item['id'])['version']
        self.assertNotEqual(repeated_version,current_version, 'an explicit rebase invalidates earlier clicks even with identical text')
        with self.assertRaisesRegex(Conflict, '已变化'):
            r.manual_rebase(item['id'],current_version,spec)
        insertion = {**spec, 'start':0, 'end':0, 'quote':''}
        changed, _ = r.manual_rebase(item['id'],repeated_version,insertion); r.persist(changed,digest(r.raw)); r=review()
        insertion_card = r.inspect(item['id']); self.assertEqual(insertion_card['original'], '')
        self.assertTrue(insertion_card['source_match'])
        changed, _ = r.decide([item['id']],[],{item['id']:insertion_card['version']},'A'); r.persist(changed,digest(r.raw)); r=review()
        self.assertEqual(r.state['edits'][item['id']]['status'],'accepted')
        self.assertIn('Manual A.The model is powerful 🙂',r.read('main.tex'))

    def test_manual_rebase_maps_unicode_and_crlf_selection(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        file = self.root/'main.tex'; file.write_bytes(file.read_bytes().replace(b'\n',b'\r\n'))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r=review(); text=r.read('main.tex'); start=text.index('The model'); end=text.index('\n',start)+1
        changed, block=r.prepare_block({'file':'main.tex','kind':'paragraph','start':start,'end':end,'source_revision':r.source_digest(text)})
        r.persist(changed,digest(r.raw)); r=review()
        changed,item=r.propose({'file':'main.tex','kind':'manuscript','block_id':block['block_id'],
                                'before':'The model is strong and fast.','after':'Reliable.'})
        r.persist(changed,digest(r.raw)); r=review(); version=r.inspect(item['id'])['version']
        file.write_bytes(file.read_bytes().replace(b'The model', '🙂 The model'.encode('utf-8')))
        r=review(); card=r.inspect(item['id']); selected=card['block']['text'].replace('\r\n','\n')
        spec={'block_id':block['block_id'],'source_revision':card['block']['source_revision'],'start':0,'end':len(selected),
              'quote':selected,'options':[{'label':'A','after':'Reliable.\n'}]}
        changed,_=r.manual_rebase(item['id'],version,spec); r.persist(changed,digest(r.raw)); card=review().inspect(item['id'])
        self.assertEqual(card['original'],selected.replace('\n','\r\n')); self.assertTrue(card['source_match'])

    def test_candidate_markers_are_rejected_at_input_and_acceptance(self):
        self.install_sidecar(dict(self.review().state, schema=3))
        def review(): return Review(self.root, '.codex-review/state.json', 'missing-git')
        r = review(); text = r.read('main.tex'); start = text.index('The model'); end = text.index('\n', start) + 1
        changed, block = r.prepare_block({'file':'main.tex','kind':'paragraph','start':start,'end':end,'source_revision':r.source_digest(text)})
        r.persist(changed,digest(r.raw)); r = review()
        marker = '% TS-BLOCK-BEGIN id=12345678-1234-4234-8234-123456789abc kind=paragraph\nNested.\n% TS-BLOCK-END id=12345678-1234-4234-8234-123456789abc\n'
        spec = {'file':'main.tex','kind':'manuscript','block_id':block['block_id'],'before':'The model is strong and fast.','after':marker}
        with self.assertRaisesRegex(Conflict, '标记'):
            r.propose(spec)
        with self.assertRaisesRegex(Conflict, '标记'):
            r.propose({k:v for k,v in spec.items() if k != 'after'} | {'options':[{'label':'A','after':'Safe.','reason':'A'},
                {'label':'B','after':marker,'reason':'B'}], 'fewer_options_reason':'Two'})
        changed, item = r.propose({**spec,'after':'Reliable.'}); r.persist(changed,digest(r.raw)); r=review()
        edit = r.state['edits'][item['id']]; version = edit['versions'][-1]
        with self.assertRaisesRegex(Conflict, '标记'):
            r.propose({'after':marker},item['id'])
        card = r.inspect(item['id']); current = card['block']['text'].replace('\r\n','\n')
        with self.assertRaisesRegex(Conflict, '标记'):
            r.manual_rebase(item['id'],version,{'block_id':block['block_id'],'source_revision':card['block']['source_revision'],
                'start':0,'end':len(current),'quote':current,'options':[{'label':'A','after':marker}]})
        text = r.read('main.tex'); other_start = text.index('Unchanged context before.'); other_end = text.index('\n',other_start)+1
        changed, other_block = r.prepare_block({'file':'main.tex','kind':'paragraph','start':other_start,'end':other_end,'source_revision':r.source_digest(text)})
        r.persist(changed,digest(r.raw)); r=review()
        changed, good = r.propose({'file':'main.tex','kind':'manuscript','block_id':other_block['block_id'],
                                   'before':'Unchanged context before.','after':'Revised context.'})
        r.persist(changed,digest(r.raw)); r=review(); edit = r.state['edits'][item['id']]
        good_version = r.state['edits'][good['id']]['versions'][-1]
        payload = r.payload(edit); payload['after'] = marker
        forged = r.snapshot({'original.tex':payload['before'].encode(), 'candidate.tex':marker.encode(),
                             'span.json':json.dumps(payload,ensure_ascii=False).encode()}, 'existing malformed fixture')
        edit['versions'][-1] = forged; r.persist({},digest(r.raw)); r=review(); before = (self.root/'main.tex').read_bytes()
        with self.assertRaisesRegex(Conflict, '标记'):
            r.decide([item['id']],[],{item['id']:forged})
        with self.assertRaisesRegex(Conflict, '标记'):
            r.decide([good['id'],item['id']],[],{good['id']:good_version,item['id']:forged})
        self.assertEqual((self.root/'main.tex').read_bytes(), before)
        self.assertEqual(r.state['edits'][item['id']]['status'],'pending')
        self.assertEqual(r.state['edits'][good['id']]['status'],'pending')

    def insertions(self):
        text = self.review().read('main.tex')
        point = text.index('The model')
        ids = []
        for label in ['Title.', 'Quote.', r'\[x=1\]', 'Variables.']:
            ids.append(self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': '',
                'left': text[:point], 'right': text[point:], 'after': label + '\n'})['id'])
        return ids

    def test_adjacent_insertions_remain_locatable_in_either_order(self):
        ids = self.insertions()
        for id_ in reversed(ids):
            self.apply('decide', [id_], [])
            for other in ids:
                if self.review().state['edits'][other]['status'] == 'pending':
                    self.assertTrue(self.review().inspect(other)['source_match'])

    def test_batch_insertions_preserve_explicit_order_and_selected_options(self):
        ids = self.insertions()
        before = self.review().read('main.tex')
        versions = {i: self.review().state['edits'][i]['versions'][-1] for i in ids}
        self.apply('decide', ids[1::2], [], {i: versions[i] for i in ids[1::2]})
        current = self.review()
        self.assertLess(current.read('main.tex').index('Quote.'), current.read('main.tex').index('Variables.'))
        for i in ids[::2]:
            self.assertTrue(current.inspect(i)['source_match'])
            self.assertEqual(current.state['edits'][i]['versions'][-1], versions[i])
        self.apply('decide', ids[::2], [])
        text = self.review().read('main.tex')
        for value in ['Title.', 'Quote.', r'\[x=1\]', 'Variables.']:
            self.assertEqual(text.count(value), 1)
        self.assertIn(before[:before.index('The model')], text)

    def test_all_insertions_accept_together_in_explicit_reverse_order(self):
        ids = self.insertions()
        before = self.review().read('main.tex')
        point = before.index('The model')
        self.apply('decide', list(reversed(ids)), [])
        self.assertEqual(self.review().read('main.tex'), before[:point] +
            'Variables.\n' + r'\[x=1\]' + '\nQuote.\nTitle.\n' + before[point:])

    def test_relocation_preserves_version_notes_and_long_unique_context(self):
        id_ = self.proposal()
        r = self.review()
        version = r.state['edits'][id_]['versions'][-1]
        self.apply('feedback', {'id': id_, 'version': version, 'side': 'original', 'start': 0, 'end': 0, 'quote': '', 'text': 'Delay until a later batch.'})
        edit = self.review().state['edits'][id_]
        text = self.review().read('main.tex')
        source = ('Repeated excerpt. ' * 20) + text + '\n' + text
        (self.root / 'main.tex').write_text(source, encoding='utf-8', newline='')
        r = self.review()
        self.assertFalse(r.inspect(id_)['source_match'])
        point = source.index('The model')
        self.apply('relocate', id_, version, {'before': 'The model is strong and fast.',
            'left': source[:point], 'right': source[point+len('The model is strong and fast.'):]})
        repaired = self.review()
        self.assertTrue(repaired.inspect(id_)['source_match'])
        self.assertEqual(repaired.state['edits'][id_]['versions'], edit['versions'])
        self.assertEqual(repaired.state['edits'][id_]['requests'], edit['requests'])
        self.assertGreater(len(repaired.anchor_context(repaired.state['edits'][id_], {})['left']), 120)

    def test_batch_stale_item_saves_no_subset_or_source(self):
        ids = self.insertions()
        r = self.review()
        before, raw, state = r.read('main.tex'), r.raw, json.loads(json.dumps(r.state))
        versions = {i: r.state['edits'][i]['versions'][-1] for i in ids}
        versions[ids[-1]] = 'expired'
        with self.assertRaisesRegex(Conflict, 'stale'):
            r.decide(ids, [], versions)
        self.assertEqual(r.state, state)
        self.assertEqual(r.state_path.read_bytes(), raw)
        self.assertEqual(r.read('main.tex'), before)

    def test_thirty_item_partial_batch_keeps_delayed_feedback_and_choices(self):
        import time
        source = '\n\n'.join('Repeated background excerpt. ' * 6 + f'Item {i} original.' for i in range(30))
        (self.root / 'main.tex').write_text(source, encoding='utf-8', newline='')
        ids = []
        for i in range(30):
            options = [{'label': label, 'after': f'Item {i} choice {label}.', 'reason': 'Explicit choice'} for label in 'ABC']
            ids.append(self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': f'Item {i} original.', 'options': options})['id'])
        last = ids[-1]
        self.apply('feedback', {'id': last, 'version': self.review().state['edits'][last]['versions'][-1],
            'side': 'original', 'start': 0, 'end': 0, 'quote': '', 'text': 'Deferred scientific question.'})
        delayed = self.review().state['edits'][last]
        selected = ids[:-1]
        r = self.review()
        start = time.perf_counter()
        updated, _ = r.decide(selected, [], {i: r.state['edits'][i]['versions'][-1] for i in selected}, {i: 'B' for i in selected})
        decision_time = time.perf_counter() - start
        start = time.perf_counter()
        r.persist(updated, digest(r.raw))
        persist_time = time.perf_counter() - start
        start = time.perf_counter()
        cards = self.review().cards()
        print(f'29 of 30 items: preflight/apply/snapshot {decision_time:.4f}s; persistence {persist_time:.4f}s; read/cards {time.perf_counter()-start:.4f}s')
        self.assertEqual({k:v for k,v in self.review().state['edits'][last].items() if k != 'anchor'},
                         {k:v for k,v in delayed.items() if k != 'anchor'})
        self.assertIn(last, cards['cards'])
        for i in range(29):
            self.assertIn(f'Item {i} choice B.', self.review().read('main.tex'))
        self.assertIn('Item 29 original.', self.review().read('main.tex'))

    def test_single_acceptance_within_author_five_second_budget_at_thirty_items(self):
        import time
        source = '\n\n'.join('Repeated context. ' * 10 + f'Item {i} original.' for i in range(30))
        (self.root / 'main.tex').write_text(source,encoding='utf-8',newline='')
        for i in range(30):
            self.apply('propose', {'file':'main.tex','kind':'manuscript','before':f'Item {i} original.',
                'options':[{'label':l,'after':f'Item {i} choice {l}.','reason':'Explicit choice'} for l in 'ABC']})
        common = [sys.executable,'-X','utf8',str(Path(__file__).with_name('source_review.py')),
                  '--project',str(self.root),'--state','reply.tex']
        def call(args):
            process = subprocess.run([*common,*args],capture_output=True,text=True,encoding='utf-8')
            self.assertEqual(process.returncode,0,process.stderr)
            return json.loads(process.stdout)
        start = time.perf_counter()
        shown = call(['inspect','--id','1','--source'])
        call(['--apply','--expect',shown['sha256'],'decide','--accept','1','--version',shown['version'],'--option','B'])
        cards = call(['cards'])
        elapsed = time.perf_counter()-start
        self.assertEqual(cards['edits']['1']['accepted_option'],'B')
        self.assertEqual(len(cards['cards']),29)
        self.assertLess(elapsed,5.0,'Author budget: inspect, durable acceptance and card refresh must finish within 5 seconds')
        print(f'30-item isolated single acceptance: {elapsed:.4f}s (author budget <5s; excludes native VS Code, PDF and Git)')

    def test_conflicted_item_is_visible_and_can_be_rejected_without_source_write(self):
        id_ = self.proposal()
        file = self.root / 'main.tex'
        file.write_text('Author changed the entire source.\n', encoding='utf-8')
        before = file.read_bytes()
        card = self.review().cards()['cards'][id_]
        self.assertFalse(card['source_match'])
        self.apply('decide', [], [id_])
        self.assertEqual(file.read_bytes(), before)
        self.assertEqual(self.review().state['edits'][id_]['status'], 'rejected')

    def setUp(self):
        from unittest.mock import patch
        from review_host_test_support import FakeHostSession
        host_patch = patch('review_host_client.HostSession', FakeHostSession)
        host_patch.start(); self.addCleanup(host_patch.stop)
        self.root = Path(tempfile.mkdtemp(prefix='no-git-', dir=ROOT))
        (self.root / 'main.tex').write_text('\\documentclass{article}\n\\begin{document}\nUnchanged context before.\n\nThe model is strong and fast.\n\nUnchanged context after.\n\\end{document}\n', encoding='utf-8')
        (self.root / 'reply.tex').write_text('% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n\\documentclass{article}\n\\begin{document}\nThank you.\n\\end{document}\n', encoding='utf-8')
        self.apply('begin', 'round-1', ['main.tex', 'reply.tex'])

    def review(self):
        return Review(self.root, 'reply.tex', 'this-git-executable-does-not-exist')

    def apply(self, method, *args):
        review = self.review()
        updated, result = getattr(review, method)(*args)
        review.persist(updated, digest(review.raw))
        return result

    def proposal(self):
        return self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
                                     'after': 'The model is reliable and compact.'})['id']

    def test_ranked_options_share_one_id_and_accept_only_chosen_result(self):
        original = (self.root / 'main.tex').read_bytes()
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': '取舍 ' + label}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        id_ = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options})['id']
        first = self.review().inspect(id_, source=True)
        self.assertEqual(first['options'][1]['after'], options[1]['after'])
        self.assertEqual(self.review().state['next'], [2, 1])
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)
        with self.assertRaisesRegex(Conflict, 'explicit option'):
            self.apply('decide', [id_], [], {id_: first['version']})
        note = {'id': id_, 'version': first['version'], 'side': 'candidate', 'option': 'B', 'start': 13, 'end': 20,
                'quote': 'compact', 'text': '请保留这个意思。'}
        self.apply('feedback', note)
        context = self.review().feedback_context()['items'][0]
        self.assertEqual(context['option'], 'B')
        self.assertEqual(context['candidate'], options[1]['after'])
        with self.assertRaisesRegex(Conflict, 'exact option'):
            self.apply('feedback', {k: v for k, v in note.items() if k != 'option'})
        with self.assertRaisesRegex(Conflict, 'Unknown candidate option'):
            self.apply('decide', [id_], [], {id_: first['version']}, 'D')
        self.apply('decide', [id_], [], {id_: first['version']}, 'B')
        accepted = self.review().inspect(id_)
        self.assertEqual(accepted['candidate'], options[1]['after'])
        accepted_source = self.review().contents(self.review().state['accepted'], 'main.tex')
        self.assertIn(options[1]['after'], accepted_source)
        self.assertNotIn(options[0]['after'], accepted_source)
        self.assertEqual(self.review().payload(accepted['edit'])['after'], options[1]['after'])
        self.assertIn(options[1]['after'], (self.root / 'main.tex').read_text(encoding='utf-8'))
        self.assertNotIn(options[0]['after'], (self.root / 'main.tex').read_text(encoding='utf-8'))

    def test_option_contract_and_manual_option_edit_retain_other_candidates_and_notes(self):
        from argparse import Namespace
        import io
        from unittest.mock import patch
        from source_review import dispatch
        with self.assertRaisesRegex(Conflict, 'ranked options'):
            Review.validate_options({'after': 'Not a group.'}, required=True)
        with self.assertRaisesRegex(Conflict, 'fewer_options_reason'):
            Review.validate_options({'options': [{'label': 'A', 'after': 'One.', 'reason': 'Only'}]})
        options = [{'label': label, 'after': 'The model is ' + word + '.', 'reason': label}
                   for label, word in zip('ABC', ['reliable', 'compact', 'efficient'])]
        id_ = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'options': options})['id']
        data = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'candidate', 'option': 'C',
                               'start': 0, 'end': 0, 'quote': '', 'text': '另一个方案的要求。'})
        review = self.review()
        args = Namespace(command='edit-option', id=id_, version=data['version'], option='B', apply=True, expect=digest(review.raw))
        with patch('sys.stdin', io.StringIO(json.dumps({'after': 'The model is compact and fast.'}))):
            saved = dispatch(review, args)
        latest = saved['card']
        self.assertEqual(latest['options'][0]['after'], options[0]['after'])
        self.assertEqual(latest['options'][2]['after'], options[2]['after'])
        self.assertEqual(latest['options'][1]['after'], 'The model is compact and fast.')
        self.assertTrue(latest['options'][1]['manually_edited'])
        self.assertNotIn('manually_edited', latest['options'][0])
        self.assertEqual(latest['options'][1]['reason'], options[1]['reason'])
        self.assertEqual(latest['edit']['requests'][0]['option'], 'C')
        self.assertEqual(latest['edit']['requests'][0]['version'], data['version'])
        with patch('sys.stdin', io.StringIO(json.dumps({'after': 'Stale replacement.'}))):
            with self.assertRaisesRegex(Conflict, 'stale'):
                dispatch(self.review(), Namespace(**{**vars(args), 'expect': digest(self.review().raw)}))
        fresh_options = [{**o, 'after': o['after'] + ' Revised.'} for o in options]
        self.apply('propose_options', {'options': fresh_options}, id_, latest['version'])
        self.assertFalse(any(o.get('manually_edited') for o in self.review().inspect(id_)['options']))

    def test_explicit_new_batch_resets_ids_with_fixed_identity_and_rejects_old_versions(self):
        original = (self.root / 'main.tex').read_bytes()
        id_ = self.proposal(); previous = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': previous['version'], 'side': 'candidate', 'start': 13, 'end': 21,
                                'quote': 'reliable', 'text': '再核对一下。'})
        resolved = self.review()
        resolved.state['edits'][id_]['requests'][0]['status'] = 'resolved'
        resolved.persist({}, digest(resolved.raw))
        first = self.review().state['session']
        self.apply('begin', 'round-1', ['main.tex', 'reply.tex'])
        state = self.review().state
        self.assertEqual(state['next'], [1, 1])
        self.assertEqual(state['edits'], {})
        self.assertEqual(len(state['rounds']), 1)
        self.assertRegex(state['session'], r'^[a-f0-9]{32}$')
        self.assertNotEqual(first, state['session'])
        self.assertEqual(self.proposal(), '1')
        self.assertEqual(self.apply('propose', {'file': 'reply.tex', 'kind': 'response', 'before': 'Thank you.', 'after': 'We thank the reviewer.'})['id'], 'a')
        latest = self.review().inspect('1')
        self.assertNotEqual(previous['version'], latest['version'], 'identical text in a new batch still has a different immutable version')
        with self.assertRaisesRegex(Conflict, 'Version does not belong'):
            self.review().inspect('1', previous['version'])
        with self.assertRaisesRegex(Conflict, 'stale'):
            self.review().decide(['1'], [], {'1': previous['version']})
        self.assertEqual(self.review().state['session'], state['session'], 'reopening does not reset a live batch')
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)

    def test_new_batch_protects_unpublished_accepted_results_and_accepted_jump_uses_new_text(self):
        id_ = self.proposal()
        self.apply('decide', [id_], [])
        self.assertTrue(self.review().inspect(id_, source=True)['source_match'])
        owner = (self.root / 'reply.tex').read_bytes()
        with self.assertRaisesRegex(Conflict, '提交与推送'):
            self.apply('begin', 'next', ['main.tex', 'reply.tex'])
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)

    def test_original_question_links_are_explicit_verified_and_retained_on_rework(self):
        (self.root / 'reviewer.txt').write_text('Reviewer 1\nPlease clarify reliability.\n', encoding='utf-8')
        questions = [{'id': 'R1.1', 'file': 'reviewer.txt', 'quote': 'Please clarify reliability.'}]
        spec = {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
                'after': 'The model is reliable and compact.', 'questions': questions}
        id_ = self.apply('propose', spec)['id']
        self.assertEqual(self.review().state['edits'][id_]['questions'], questions)
        self.apply('propose', {'after': 'The model is robust and compact.'}, id_)
        self.assertEqual(self.review().state['edits'][id_]['questions'], questions)
        owner = (self.root / 'reply.tex').read_bytes()
        spec['questions'][0]['quote'] = 'Not present in the original reviewer file.'
        objects = sorted(p.name for p in (self.root / '.codex-review/objects').iterdir())
        with self.assertRaisesRegex(Conflict, 'uniquely'):
            self.apply('propose', spec)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        self.assertEqual(sorted(p.name for p in (self.root / '.codex-review/objects').iterdir()), objects)

    def test_questions_metadata_append_replace_changes_only_associations(self):
        id_ = self.proposal()
        owner = self.root / 'reply.tex'
        owner.write_text(owner.read_text(encoding='utf-8') + '\nExact first reviewer question.\nExact second reviewer question.\n', encoding='utf-8')
        data = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '请重新修改。'})
        before = self.review().state
        original = (self.root / 'main.tex').read_bytes(), body(owner.read_text(encoding='utf-8'))
        links = [{'id': 'R1-Q3', 'file': 'reply.tex', 'quote': 'Exact first reviewer question.'},
                 {'id': 'R4-Q5', 'file': 'reply.tex', 'quote': 'Exact second reviewer question.'}]
        for incoming, replace, expected in [(links[:1], False, links[:1]), (links, False, links), (links[1:], True, links[1:])]:
            review = self.review()
            with review.writer_lock():
                updated, result = review.update_questions(id_, data['version'], incoming, replace=replace)
                self.assertEqual(updated, {})
                review.persist(updated, digest(review.raw))
            state = self.review().state
            self.assertEqual(state['edits'][id_]['questions'], expected)
            del state['edits'][id_]['questions']
            self.assertEqual(state, before, 'versions, counters, decisions, requests, dependencies and freshness are unchanged')
            self.assertEqual((self.root / 'main.tex').read_bytes(), original[0])
            self.assertEqual(body(owner.read_text(encoding='utf-8')), original[1])

    def test_questions_metadata_rejects_bad_quotes_stale_versions_and_concurrent_sources(self):
        id_ = self.proposal(); data = self.review().inspect(id_)
        question_file = self.root / 'questions.txt'
        question_file.write_text('Exact question.\n', encoding='utf-8')
        link = {'id': 'R1-Q3', 'file': 'questions.txt', 'quote': 'Exact question.'}
        owner = (self.root / 'reply.tex').read_bytes()
        for version, questions, message in [('old-version', [link], 'stale'),
                                            (data['version'], [{**link, 'quote': 'Missing question.'}], 'uniquely')]:
            with self.assertRaisesRegex(Conflict, message):
                self.review().update_questions(id_, version, questions)
            self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        question_file.write_text('Exact question. Exact question.\n', encoding='utf-8')
        with self.assertRaisesRegex(Conflict, 'uniquely'):
            self.review().update_questions(id_, data['version'], [link])
        question_file.write_text('Exact question.\n', encoding='utf-8')
        review = self.review(); updated, _ = review.update_questions(id_, data['version'], [link])
        question_file.write_text('Author has changed the original question.\n', encoding='utf-8')
        with self.assertRaisesRegex(Conflict, 'Concurrent'):
            review.persist(updated, digest(review.raw))
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)

    def test_questions_cli_preview_apply_stale_owner_and_shared_writer_lock(self):
        id_ = self.proposal(); data = self.review().inspect(id_)
        (self.root / 'questions.txt').write_text('A precise original question.\n', encoding='utf-8')
        spec = {'questions': [{'id': 'R1-Q3', 'file': 'questions.txt', 'quote': 'A precise original question.'}]}
        owner = (self.root / 'reply.tex').read_bytes()
        command = [sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                   '--project', str(self.root), '--state', 'reply.tex']
        suffix = ['link-questions', '--id', id_, '--version', data['version']]
        run = lambda options: subprocess.run(command + options + suffix, input=json.dumps(spec).encode('utf-8'), capture_output=True)
        result = run([])
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        self.assertFalse(json.loads(result.stdout)['applied'])
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        result = run(['--apply', '--expect', '0' * 64])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Stale', result.stderr.decode('utf-8'))
        with self.review().writer_lock():
            result = run(['--apply', '--expect', digest(owner)])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('审核写入', result.stderr.decode('utf-8'))
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        result = run(['--apply', '--expect', digest(owner)])
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        self.assertEqual(self.review().state['edits'][id_]['questions'], spec['questions'])

    def test_ai_rework_can_discard_old_annotations_without_an_author_decision(self):
        id_ = self.proposal(); data = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '直接重新生成候选。'})
        original = (self.root / 'main.tex').read_bytes(); before = self.review().state
        self.apply('propose', {'after': 'The model is reliable and fast.', 'discard_annotations': True}, id_)
        state = self.review().state; edit = state['edits'][id_]
        self.assertFalse(edit.get('requests'))
        self.assertEqual(edit['status'], 'rework')
        self.assertEqual(len(edit['versions']), len(before['edits'][id_]['versions']) + 1)
        self.assertEqual(state['next'], before['next'])
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)
        prior = edit['previous_feedback']
        self.assertEqual(prior['version'], data['version'])
        self.assertEqual(prior['requests'][0]['text'], '直接重新生成候选。')
        self.assertEqual(self.review().feedback_context()['items'][0]['requests'][0]['text'], '直接重新生成候选。')
        self.apply('propose', {'after': 'The model is compact and fast.', 'discard_annotations': True}, id_)
        rolled = self.review().state['edits'][id_]
        self.assertEqual(rolled['previous_feedback']['requests'][0]['text'], '直接重新生成候选。')
        self.assertIn(data['version'], rolled['versions'], '未处理批注的原始版本须保留')
        self.assertEqual(rolled['generation'], 3)
        newer = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': newer['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '新的这一轮要求。'})
        self.apply('propose', {'after': 'The model is efficient and fast.', 'discard_annotations': True}, id_)
        current = self.review().state['edits'][id_]
        self.assertEqual([n['text'] for n in current['previous_feedback']['requests']], ['直接重新生成候选。', '新的这一轮要求。'])
        self.assertEqual(current['previous_feedback']['version'], newer['version'])
        saved = (self.root / 'reply.tex').read_bytes()
        with self.assertRaisesRegex(Conflict, 'No content change'):
            self.apply('propose', {'after': 'The model is efficient and fast.', 'discard_annotations': True}, id_)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), saved)

    def test_feedback_context_contains_exact_original_and_candidate_for_each_note_generation(self):
        id_ = self.proposal(); data = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '修改这里。'})
        self.apply('propose', {'after': 'The model is reliable and fast.'}, id_)
        before = {p: (self.root / p).read_bytes() for p in ('main.tex', 'reply.tex')}
        context = self.review().feedback_context()['items'][0]
        self.assertEqual(context['id'], id_)
        self.assertEqual(context['original'], data['original'])
        self.assertEqual(context['candidate'], data['candidate'])
        self.assertEqual(context['version'], data['version'])
        self.assertNotEqual(context['version'], context['current_version'])
        self.assertEqual(context['requests'][0]['quote'], 'strong')
        self.assertEqual({p: (self.root / p).read_bytes() for p in before}, before)

    def test_cards_cli_is_read_only_and_shares_source_for_multiple_pending_items(self):
        import json
        first = self.proposal()
        second = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'Unchanged context after.',
                                       'after': 'The final context remains unchanged.'})['id']
        reply = self.apply('propose', {'file': 'reply.tex', 'kind': 'response', 'before': 'Thank you.',
                                      'after': 'Thank you for the suggestion.'})['id']
        self.apply('decide', [reply], [])
        detail = self.review().inspect(first, source=True)
        self.apply('feedback', {'id': first, 'version': detail['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '保留原文，继续审核。'})
        before = {name: (self.root / name).read_bytes() for name in ('main.tex', 'reply.tex')}
        objects = sorted(p.name for p in (self.root / '.codex-review/objects').iterdir())
        result = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                                 '--project', str(self.root), '--state', 'reply.tex', 'cards'], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        packet = json.loads(result.stdout.decode('utf-8'))
        self.assertEqual(set(packet['cards']), {first, second})
        self.assertEqual(set(packet['sources']), {'main.tex'})
        self.assertEqual(packet['sources']['main.tex'], before['main.tex'].decode('utf-8-sig'))
        for id_, card in packet['cards'].items():
            expected = self.review().inspect(id_, source=True)
            expected['source'].pop('text')
            self.assertEqual(card, expected)
        reused = self.review().cards({first: packet['cards'][first]['version']})
        cached = reused['cards'][first]
        self.assertTrue(cached.pop('diff_reused'))
        self.assertNotIn('changes', cached)
        for option in cached['options']:
            self.assertNotIn('changes', option)
            self.assertNotIn('scope', option)
            self.assertNotIn('fact_changes', option)
        wrong = self.review().cards({first: 'wrong-version'})['cards'][first]
        self.assertNotIn('diff_reused', wrong)
        self.assertIn('fact_changes', wrong['options'][0])
        self.assertEqual(cached['source'], packet['cards'][first]['source'])
        self.assertEqual(reused['cards'][second], packet['cards'][second])
        self.assertEqual(packet['cards'][first]['edit']['requests'][0]['text'], '保留原文，继续审核。')
        self.assertEqual({name: (self.root / name).read_bytes() for name in before}, before)
        self.assertEqual(sorted(p.name for p in (self.root / '.codex-review/objects').iterdir()), objects)

    def test_cards_preserve_conflicts_and_stop_if_shared_source_changes_during_read(self):
        from unittest.mock import patch
        first = self.proposal()
        second = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'Unchanged context after.',
                                       'after': 'The final context remains unchanged.'})['id']
        main = self.root / 'main.tex'
        text = main.read_text(encoding='utf-8')
        main.write_text(text.replace('Unchanged context after.', 'Author manually changed this sentence.'), encoding='utf-8')
        packet = self.review().cards()
        self.assertIn(first, packet['cards'])
        self.assertIn(second, packet['cards'])
        self.assertFalse(packet['cards'][second]['source_match'])
        self.assertFalse(packet['edits'][second]['source_match'])
        main.write_text(text, encoding='utf-8')
        owner = (self.root / 'reply.tex').read_bytes()
        review = self.review()
        inspect = review.inspect
        def change_after_first(id_, **kwargs):
            result = inspect(id_, **kwargs)
            if id_ == first:
                main.write_text(text + '% concurrent author edit\n', encoding='utf-8')
            return result
        with patch.object(review, 'inspect', side_effect=change_after_first):
            with self.assertRaisesRegex(Conflict, '读取期间原文发生变化'):
                review.cards()
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)

    def test_decision_receipt_contains_final_state_and_reusable_next_card(self):
        first = self.proposal()
        second = self.apply('propose', {'file':'main.tex', 'kind':'manuscript', 'before':'Unchanged context after.',
                                       'after':'The final context remains unchanged.'})['id']
        review = self.review()
        versions = {id_: review.state['edits'][id_]['versions'][-1] for id_ in (first, second)}
        argv = [sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                '--project', str(self.root), '--state', 'reply.tex', '--apply', '--expect', digest(review.raw),
                'decide', '--accept', first, '--version', versions[first], '--return-cards']
        result = subprocess.run(argv, input=json.dumps({'reuse':versions}).encode('utf-8'), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        receipt = json.loads(result.stdout.decode('utf-8'))
        self.assertTrue(receipt['applied'])
        self.assertEqual(receipt['cards_packet']['edits'][first]['status'], 'accepted')
        self.assertNotIn(first, receipt['cards_packet']['cards'])
        self.assertTrue(receipt['cards_packet']['cards'][second]['diff_reused'])
        self.assertTrue(receipt['cards_packet']['cards'][second]['source_match'])
        self.assertIn('The model is reliable and compact.', (self.root / 'main.tex').read_text(encoding='utf-8'))
        self.assertNotIn('transaction', self.review().state)

    def test_selected_feedback_rework_and_acceptance_need_no_git(self):
        old = (self.root / 'main.tex').read_bytes()
        id_ = self.proposal()
        self.assertEqual((self.root / 'main.tex').read_bytes(), old)
        data = self.review().inspect(id_, source=True)
        for change in data['changes']:
            self.assertNotIn(' and ', data['original'][change['old_start']:change['old_end']])
            self.assertNotIn(' and ', data['candidate'][change['new_start']:change['new_end']])
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '只修改这个词，保留 fast。'})
        self.apply('propose', {'after': 'The model is reliable and fast.'}, id_)
        self.assertEqual((self.root / 'main.tex').read_bytes(), old)
        self.apply('decide', [id_], [])
        self.assertIn('The model is reliable and fast.', (self.root / 'main.tex').read_text(encoding='utf-8'))
        self.assertEqual(self.review().state['schema'], 2)
        self.assertFalse((self.root / '.git').exists())
        self.assertTrue((self.root / '.codex-review/objects').is_dir())

    def test_new_candidates_cannot_write_live_prose_before_acceptance(self):
        source, state = (self.root / 'main.tex').read_bytes(), (self.root / 'reply.tex').read_bytes()
        with self.assertRaisesRegex(Conflict, 'deferred=true'):
            self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
                                  'after': 'The model is reliable and fast.', 'deferred': False})
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state)
        import json
        spec = {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
                'options': [{'label': 'A', 'after': 'The model is reliable and fast.', 'reason': '测试'}], 'fewer_options_reason': '隔离测试', 'deferred': False}
        result = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                                 '--project', str(self.root), '--state', 'reply.tex', '--apply',
                                 '--expect', digest(state), 'propose-options'], input=json.dumps(spec).encode('utf-8'), capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deferred=true', result.stderr.decode('utf-8'))
        self.assertEqual((self.root / 'main.tex').read_bytes(), source)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state)

    def test_new_review_units_refuse_multiple_paragraphs_or_mixed_equations(self):
        original = (self.root / 'main.tex').read_bytes()
        owner = (self.root / 'reply.tex').read_bytes()
        bad_candidates = [
            'A revised sentence.\n\nAnother paragraph.',
            'A revised sentence.\n\\begin{equation}x=1\\end{equation}\nA following sentence.',
            'A revised sentence.\n\\[x=1\\]\nA following sentence.',
            r'A revised paragraph.\par Another paragraph.',
            '\\begin{abstract}A paragraph.\n\nAnother paragraph.\\end{abstract}'
        ]
        for candidate in bad_candidates:
            with self.subTest(candidate=candidate), self.assertRaisesRegex(Conflict, '修订范围过大'):
                self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.', 'after': candidate})
            self.assertEqual((self.root / 'main.tex').read_bytes(), original)
            self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        id_ = self.proposal()
        self.assertEqual(id_, '1')
        with self.assertRaisesRegex(Conflict, '修订范围过大'):
            self.apply('propose', {'after': bad_candidates[0]}, id_)
        with self.assertRaisesRegex(Conflict, '旧独立差异窗口已停用'):
            self.review().view(id_, 'must-not-launch-code')

    def test_standalone_equation_and_local_plan_keep_independent_review_ids(self):
        main = self.root / 'main.tex'
        text = main.read_text(encoding='utf-8').replace('Unchanged context after.',
                '\\begin{equation}\n\\begin{aligned}\nx&=1\\\\\ny&=2\n\\end{aligned}\n\\end{equation}\n\nUnchanged context after.')
        main.write_text(text, encoding='utf-8', newline='')
        self.apply('begin', 'equation-round', ['main.tex', 'reply.tex'])
        equation = text[text.index('\\begin{equation}'):text.index('\\end{equation}') + len('\\end{equation}')]
        self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': equation, 'after': equation.replace('x&=1', 'x&=3')})
        self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'The model is strong and fast.',
                              'after': '% CODEX-PARAGRAPH-PLAN-BEGIN\n% 中文逻辑，不在正文显示。\n% CODEX-PARAGRAPH-PLAN-END\nThe model is reliable and fast.'})
        self.apply('decide', ['2'], [])
        self.assertIn('The model is reliable and fast.', main.read_text(encoding='utf-8'))
        self.assertIn('x&=1', main.read_text(encoding='utf-8'))
        self.assertEqual(self.review().state['edits']['1']['status'], 'pending')

    def test_reject_and_manual_overlap_never_replace_original(self):
        id_ = self.proposal()
        original = (self.root / 'main.tex').read_bytes()
        self.apply('decide', [], [id_])
        self.assertEqual((self.root / 'main.tex').read_bytes(), original)
        id_ = self.proposal()
        source = self.root / 'main.tex'
        source.write_text(source.read_text(encoding='utf-8').replace('strong', 'author-edited'), encoding='utf-8')
        with self.assertRaises(Conflict):
            self.apply('decide', [id_], [])
        self.assertIn('author-edited', source.read_text(encoding='utf-8'))

    def test_accept_uses_latest_manual_context_without_overwriting_it(self):
        for rel, kind, before in [('main.tex', 'manuscript', 'The model is strong and fast.'),
                                  ('reply.tex', 'response', 'Thank you.')]:
            with self.subTest(file=rel):
                source = self.root / rel
                text = source.read_text(encoding='utf-8')
                changed = text.replace('\\begin{document}', '\\begin{document}\nAuthor changed the opening context.')
                changed = changed.replace('\\end{document}', 'Author changed the closing context.\n\\end{document}')
                source.write_text(changed, encoding='utf-8', newline='')
                options = [{'label': label, 'after': word + ' accepted text.', 'reason': label}
                           for label, word in zip('ABC', ['First', 'Second', 'Third'])]
                id_ = self.apply('propose_options', {'file': rel, 'kind': kind, 'before': before, 'options': options})['id']
                r = self.review()
                data = r.inspect(id_, source=True)
                self.assertTrue(data['source_match'])
                projection = r.contents(r.state['accepted'], rel)
                self.assertEqual(projection.count(before), 1)
                from source_review import locate
                item = r.payload(r.state['edits'][id_])
                with self.assertRaises(Conflict):
                    locate(projection, before, item['left'], item['right'])
                self.apply('decide', [id_], [], {id_: data['version']}, 'B')
                r = self.review()
                self.assertEqual(r.state['edits'][id_]['accepted_option'], 'B')
                self.assertEqual(r.contents(r.state['accepted'], rel), body(changed).replace(before, options[1]['after']))
                self.assertEqual(body(source.read_text(encoding='utf-8')), body(changed).replace(before, options[1]['after']))

    def test_unique_live_source_acceptance_does_not_require_an_old_projection_match(self):
        source = self.root / 'main.tex'
        for label, baseline, current, before in [
            ('duplicate', 'Old context.\nTarget sentence.\nOther.\nTarget sentence.\nOld end.',
             'New context.\nTarget sentence.\nNew end.', 'Target sentence.'),
            ('missing', 'Old context.\nOld target.\nOld end.',
             'New context.\nTarget sentence.\nNew end.', 'Target sentence.'),
            ('insertion', 'Old context.\nOld end.', 'New context.\nNew end.', ''),
            ('whitespace', 'Old context.\n \nOld end.', 'New context.\n \nNew end.', ' \n'),
        ]:
            with self.subTest(case=label):
                self.setUp()
                source = self.root / 'main.tex'
                source.write_text(baseline, encoding='utf-8', newline='')
                self.apply('begin', label, ['main.tex', 'reply.tex'])
                source.write_text(current, encoding='utf-8', newline='')
                id_ = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': before,
                    'left': 'New context.\n' if not before else '', 'after': 'Proposed sentence.'})['id']
                r = self.review()
                item = r.payload(r.state['edits'][id_])
                from source_review import locate
                a, b = locate(current, before, item['left'], item['right'])
                self.apply('decide', [id_], [])
                expected = current[:a] + item['after'] + current[b:]
                self.assertEqual(source.read_text(encoding='utf-8'), expected)
                self.assertEqual(self.review().contents(self.review().state['accepted'], 'main.tex'), expected)

    def test_accept_after_manual_deletion_maps_only_the_selected_scope(self):
        source = self.root / 'main.tex'
        text = '% Outside original\n% ' + 'x' * 180 + '\n' + source.read_text(encoding='utf-8')
        source.write_text(text, encoding='utf-8', newline='')
        self.apply('begin', 'manual-edit', ['main.tex', 'reply.tex'])
        old = 'GMAP and all compared segmentation methods use the same evaluation protocol.'
        first = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript',
            'before': 'The model is strong and fast.', 'after': old})['id']
        self.apply('decide', [first], [])
        peer = self.apply('propose', {'file': 'reply.tex', 'kind': 'response',
            'before': 'Thank you.', 'after': 'Thank you for your careful review.'})['id']
        peer_version = self.review().state['edits'][peer]['versions'][-1]
        self.apply('feedback', {'id': peer, 'version': peer_version, 'side': 'original', 'start': 0, 'end': 5,
            'quote': 'Thank', 'text': 'Keep this pending note.'})
        latest = old.replace('segmentation ', '')
        live = source.read_text(encoding='utf-8').replace(old, latest).replace('% Outside original', '% Outside author edit')
        source.write_text(live, encoding='utf-8', newline='')
        choices = [{'label': label, 'after': latest.replace('protocol.', tail), 'reason': label}
                   for label, tail in zip('ABC', ['protocol and data splits.', 'protocol and metrics.', 'protocol and seeds.'])]
        id_ = self.apply('propose_options', {'file': 'main.tex', 'kind': 'manuscript', 'before': latest,
            'options': choices, 'deps': [first]})['id']
        r = self.review()
        original_state = json.loads(json.dumps(r.state))
        projection = r.contents(r.state['accepted'], 'main.tex')
        self.assertTrue(r.inspect(id_)['source_match'])
        self.assertNotIn(latest, projection)
        # Exercise the public CLI, which takes the shared writer lock and rereads.
        result = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
            '--project', str(self.root), '--state', 'reply.tex', '--apply', '--expect', digest(r.raw),
            'decide', '--accept', id_, '--version', r.state['edits'][id_]['versions'][-1], '--option', 'A'], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        fresh = self.review()
        self.assertEqual(source.read_text(encoding='utf-8'), live.replace(latest, choices[0]['after']))
        self.assertEqual(fresh.contents(fresh.state['accepted'], 'main.tex'), body(live).replace(latest, choices[0]['after']))
        self.assertIn('% Outside author edit', fresh.contents(fresh.state['accepted'], 'main.tex'))
        self.assertEqual(fresh.state['next'], original_state['next'])
        self.assertEqual(fresh.state['edits'][peer], original_state['edits'][peer])
        self.assertEqual(fresh.state['edits'][first], original_state['edits'][first])
        self.assertEqual(fresh.state['edits'][id_]['deps'], [first])
        self.assertEqual(fresh.state['edits'][id_]['accepted_option'], 'A')

    def test_changed_projection_requires_unique_boundaries_and_current_batch_provenance(self):
        from unittest.mock import patch
        source = self.root / 'main.tex'
        left, right = 'L' * 120, 'R' * 120
        for case in ['ambiguous', 'missing-provenance', 'changed-live-source']:
            with self.subTest(case=case):
                baseline = left + 'Old target.' + right
                source.write_text((baseline + '\n' + baseline) if case == 'ambiguous' else baseline, encoding='utf-8', newline='')
                self.apply('begin', case, ['main.tex', 'reply.tex'])
                source.write_text(left + 'Current target.' + right, encoding='utf-8', newline='')
                id_ = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript',
                    'before': 'Current target.', 'after': 'Accepted target.'})['id']
                if case == 'changed-live-source':
                    source.write_text(left + 'Author edited again.' + right, encoding='utf-8', newline='')
                r = self.review()
                old_source, old_state, old_projection = source.read_bytes(), r.raw, r.state['accepted']
                payload = r.payload(r.state['edits'][id_])
                if case == 'missing-provenance':
                    payload.pop('batch')
                with patch.object(r, 'payload', return_value=payload):
                    if case == 'changed-live-source':
                        with self.assertRaisesRegex(Conflict, '当前正文失配.*' + id_ + '.*main.tex'):
                            r.decide([id_], [])
                    else:
                        with self.assertRaises(Conflict):
                            r.projection_span(r.contents(old_projection, 'main.tex'), payload)
                self.assertEqual(source.read_bytes(), old_source)
                self.assertEqual((self.root / 'reply.tex').read_bytes(), old_state)
                self.assertEqual(r.state['accepted'], old_projection)
                self.assertEqual(r.state['edits'][id_]['status'], 'pending')

    def test_later_decision_failure_leaves_all_decisions_and_projection_unchanged(self):
        import copy
        from unittest.mock import patch
        first = self.proposal()
        second = self.apply('propose', {'file': 'reply.tex', 'kind': 'response',
            'before': 'Thank you.', 'after': 'Thank you for the suggestion.'})['id']
        owner = self.root / 'reply.tex'
        saved_owner = owner.read_bytes()
        for phase in ['live', 'projection']:
            with self.subTest(phase=phase):
                owner.write_bytes(saved_owner)
                if phase == 'projection':
                    owner.write_bytes(saved_owner.replace(b'Thank you.', b'Thank you for the suggestion.'))
                if phase == 'live':
                    owner.write_text(owner.read_text(encoding='utf-8').replace('Thank you.', 'Author changed the reply.'), encoding='utf-8', newline='')
                r = self.review()
                if phase == 'projection':
                    r.state['edits'][second]['deferred'] = False  # Existing inline legacy path still uses its projection.
                state, source_bytes, owner_bytes = copy.deepcopy(r.state), (self.root / 'main.tex').read_bytes(), owner.read_bytes()
                payload = r.payload
                contents = r.contents
                def older_projection(commit, rel):
                    text = contents(commit, rel)
                    return text.replace('Thank you.', 'Earlier reply.') if phase == 'projection' and commit == state['accepted'] and rel == 'reply.tex' else text
                def without_origin(edit):
                    item = payload(edit)
                    if edit['file'] == 'reply.tex':
                        item.pop('batch', None)
                    return item
                with patch.object(r, 'payload', side_effect=without_origin), patch.object(r, 'contents', side_effect=older_projection):
                    with self.assertRaisesRegex(Conflict, '当前正文失配' if phase == 'live' else '已接收投影失配'):
                        r.decide([first, second], [])
                self.assertEqual(r.state, state)
                self.assertEqual((self.root / 'main.tex').read_bytes(), source_bytes)
                self.assertEqual(owner.read_bytes(), owner_bytes)

    def test_state_owner_offsets_include_header_and_unicode(self):
        self.apply('propose', {'file': 'reply.tex', 'kind': 'response', 'before': 'Thank you.', 'after': 'Thank you for the suggestion.', 'deferred': True})
        data = self.review().inspect('a', source=True)
        self.assertEqual(data['source']['text'][data['source']['start']:data['source']['end']], 'Thank you.')
        self.assertEqual(body(data['source']['text']).count('Thank you.'), 1)
        self.apply('decide', ['a'], [])
        self.assertIn('Thank you for the suggestion.', (self.root / 'reply.tex').read_text(encoding='utf-8'))

    def test_legacy_objects_migrate_once_and_keep_ids_notes_and_original(self):
        git = os.environ['SOURCE_REVIEW_GIT']
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
        for args in [['init', '-b', 'master'], ['config', 'user.name', 'Migration fixture'], ['config', 'user.email', 'fixture@example.invalid']]:
            subprocess.run([git, '-C', str(self.root), *args], env=env, capture_output=True, check=True)
        # A separate legacy owner avoids changing or reusing the native session.
        owner = self.root / 'legacy.tex'
        owner.write_text('% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\nOriginal legacy sentence.\n', encoding='utf-8')
        def legacy_apply(method, *args):
            review = Review(self.root, 'legacy.tex', git, storage='git')
            updated, result = getattr(review, method)(*args); review.persist(updated, digest(review.raw)); return result
        legacy_apply('begin', 'legacy-round', ['legacy.tex'])
        legacy_apply('propose', {'file': 'legacy.tex', 'kind': 'response', 'before': 'Original legacy sentence.', 'after': 'Revised legacy sentence.'})
        review = Review(self.root, 'legacy.tex', git)
        updated, result = review.migrate_storage(True); review.persist(updated, digest(review.raw))
        restored = Review(self.root, 'legacy.tex', 'missing-git')
        self.assertEqual(restored.state['schema'], 2)
        self.assertTrue(restored.state['edits']['a']['deferred'])
        self.assertIn('Original legacy sentence.', body(owner.read_text(encoding='utf-8')))
        self.assertEqual(restored.inspect('a')['candidate'], 'Revised legacy sentence.')

    def test_private_backup_restore_and_acceptance_do_not_need_git(self):
        from review_archive import backup, restore
        id_ = self.proposal()
        data = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': data['version'], 'side': 'original', 'start': 13, 'end': 19,
                                'quote': 'strong', 'text': '保留原词的批注。'})
        archive = self.root.parent / (self.root.name + '.zip')
        result = backup(self.root, 'reply.tex', archive, 'missing-git')
        self.assertFalse(result['git_required'])
        dest = self.root.parent / (self.root.name + '-restored')
        restore(archive, dest, 'missing-git')
        review = Review(dest, 'reply.tex', 'missing-git')
        self.assertEqual(review.inspect('1')['candidate'], data['candidate'])
        self.assertEqual(review.state['edits']['1']['requests'][0]['text'], '保留原词的批注。')
        updated, _ = review.decide(['1'], [])
        review.persist(updated, digest(review.raw))
        self.assertIn('reliable', (dest / 'main.tex').read_text(encoding='utf-8'))
        self.assertFalse((dest / '.git').exists())


if __name__ == '__main__':
    unittest.main()
