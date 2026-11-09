"""Isolated file-role discovery, durable confirmation and writer-boundary checks."""
from pathlib import Path
import os
import tempfile
import unittest

from document_roles import scan, save, parse_block, selected_root, RoleError
from source_review import digest, writer_lock_at, Review, Conflict
from chktex_filter import ledger_lines


class FileRoles(unittest.TestCase):
    def setUp(self):
        parent = Path(os.environ['SOURCE_REVIEW_FIXTURES']); parent.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix='roles-', dir=parent))
        (self.root / '章节').mkdir()
        self.write('任意名称.tex', '% !TeX program = pdflatex\n\\documentclass{article}\n\\begin{document}\n\\input{章节/method}\n\\end{document}\n')
        self.write('章节/method.tex', '\\section{Method}\nA factual sentence.\n')
        self.write('letter.tex', '\\documentclass{letter}\nResponse to reviewers. Reviewer 1 comments. We thank the reviewer.\n')
        self.write('opinions.tex', 'Reviewer 2 comments. Major comments.\n')
        self.write('reference_template.tex', '\\documentclass{article}\nReference content.\n')

    def write(self, file, text):
        (self.root / file).write_text(text, encoding='utf-8')

    def spec(self, data=None):
        data = data or scan(self.root)
        return {'owner': '任意名称.tex', 'previous_owner': data['owner'], 'previous_files': data['files'],
                'owner_sha256': digest((self.root / '任意名称.tex').read_bytes()), 'structure': data['structure'],
                'files': [{k: item[k] for k in ('file', 'roles', 'root')} for item in data['suggested']]}

    def test_arbitrary_names_graph_combined_reply_and_no_write_on_scan(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        data = scan(self.root)
        inferred = {f['file']: f for f in data['suggested']}
        self.assertEqual(inferred['任意名称.tex']['roles'], ['manuscript'])
        self.assertEqual(inferred['章节/method.tex']['root'], '任意名称.tex')
        self.assertEqual(inferred['letter.tex']['roles'], ['response', 'review'])
        self.assertEqual(inferred['opinions.tex']['roles'], ['review'])
        self.assertEqual(inferred['reference_template.tex']['roles'], ['template'])
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertFalse((self.root / '.codex-review').exists())

    def test_confirmation_preserves_bom_crlf_magic_body_and_no_ordinary_reconfirmation(self):
        file = self.root / '任意名称.tex'
        raw = b'\xef\xbb\xbf' + file.read_text(encoding='utf-8').replace('\n', '\r\n').encode('utf-8')
        file.write_bytes(raw)
        save(self.root, self.spec())
        updated = file.read_bytes()
        self.assertTrue(updated.startswith(b'\xef\xbb\xbf% !TeX program = pdflatex\r\n% CODEX-FILE-ROLES-BEGIN'))
        self.assertTrue(updated.endswith(raw[len(b'\xef\xbb\xbf% !TeX program = pdflatex\r\n'):]))
        self.assertEqual(scan(self.root)['status'], 'confirmed')
        self.write('章节/method.tex', '\\section{Method}\nA revised factual sentence.\n')
        self.assertEqual(scan(self.root)['status'], 'confirmed')
        self.assertEqual(selected_root(self.root, '章节/method.tex')['root'], '任意名称.tex')
        self.assertFalse((self.root / '.codex-review/objects').exists())

    def test_add_remove_rename_and_compile_relation_changes_require_confirmation(self):
        save(self.root, self.spec())
        self.write('new.tex', 'A new source.\n')
        self.assertEqual(scan(self.root)['changes'], ['new.tex'])
        self.assertIsNone(selected_root(self.root, '章节/method.tex')['root'])
        save(self.root, self.spec())
        (self.root / 'new.tex').rename(self.root / 'renamed.tex')
        self.assertEqual(set(scan(self.root)['changes']), {'new.tex', 'renamed.tex'})
        save(self.root, self.spec())
        file = self.root / '任意名称.tex'
        file.write_text(file.read_text(encoding='utf-8').replace('\\input{章节/method}', '\\input{renamed}'), encoding='utf-8')
        self.assertEqual(scan(self.root)['status'], 'changed')
        self.assertIn('任意名称.tex', scan(self.root)['changes'])

    def test_stale_structure_owner_bytes_and_metadata_stop_without_source_writes(self):
        spec = self.spec(); self.write('new.tex', 'New source.')
        before = (self.root / '任意名称.tex').read_bytes()
        with self.assertRaisesRegex(RoleError, '文件或编译关系变化'):
            save(self.root, spec)
        self.assertEqual((self.root / '任意名称.tex').read_bytes(), before)
        spec = self.spec(); spec['owner_sha256'] = '0' * 64
        with self.assertRaisesRegex(RoleError, '拥有文件已改变'):
            save(self.root, spec)
        spec = self.spec(); save(self.root, spec)
        with self.assertRaisesRegex(RoleError, '文件或编译关系变化'):
            save(self.root, spec)

    def test_shared_writer_lock_blocks_other_role_and_review_writes(self):
        before = (self.root / '任意名称.tex').read_bytes()
        with writer_lock_at(self.root / '.codex-review'):
            with self.assertRaisesRegex(Conflict, '另一个审核写入'):
                save(self.root, self.spec())
        self.assertEqual((self.root / '任意名称.tex').read_bytes(), before)

    def test_literal_graph_comments_verbatim_cycles_magic_and_dynamic_inputs(self):
        self.write('章节/method.tex', '% !TeX root = ../任意名称.tex\n% \\documentclass{fake}\n\\verb|\\input{fake}|\n\\input{\\dynamic}\n\\input{../任意名称}\n')
        data = scan(self.root)
        fact = next(f for f in data['structure'] if f['file'] == '章节/method.tex')
        self.assertEqual(fact['documentclass'], [])
        self.assertEqual(fact['tex_root'], ['任意名称.tex'])
        self.assertEqual(fact['unresolved'], ['\\dynamic'])
        self.assertNotIn('fake.tex', fact['includes'])

    def test_malformed_duplicate_and_outside_targets_are_not_overwritten(self):
        for bad in ['% CODEX-FILE-ROLES-BEGIN\n% incomplete\n', '% CODEX-FILE-ROLES-BEGIN\nReal prose\n% CODEX-FILE-ROLES-END\n']:
            with self.assertRaises(RoleError):
                parse_block(bad)
        spec = self.spec(); spec['owner'] = '../outside.tex'
        with self.assertRaisesRegex(RoleError, '不能越出'):
            save(self.root, spec)
        spec = self.spec(); spec['files'][0]['root'] = '../outside.tex'
        with self.assertRaisesRegex(RoleError, '不存在'):
            save(self.root, spec)
        save(self.root, self.spec())
        self.write('duplicate.tex', (self.root / '任意名称.tex').read_text(encoding='utf-8'))
        with self.assertRaisesRegex(RoleError, '多份'):
            scan(self.root)

    def test_role_config_is_not_a_prose_candidate_and_only_machine_comments_are_excluded(self):
        save(self.root, self.spec())
        text = (self.root / '任意名称.tex').read_text(encoding='utf-8')
        mask = ledger_lines(text.encode('utf-8'))
        self.assertTrue(mask)
        self.assertNotIn(text[:text.index('\\documentclass')].count('\n') + 1, mask)
        self.write('state.tex', '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n')
        review = Review(self.root, 'state.tex')
        updated, _ = review.begin('round', ['任意名称.tex', 'state.tex']); review.persist(updated, digest(review.raw))
        review = Review(self.root, 'state.tex')
        with self.assertRaisesRegex(Conflict, '文件角色登记'):
            review.propose({'file': '任意名称.tex', 'kind': 'manuscript', 'before': '% CODEX-FILE-ROLES-BEGIN', 'after': '% changed'})
        self.assertEqual((self.root / '任意名称.tex').read_text(encoding='utf-8'), text)

    def test_confirmed_role_update_and_manual_prose_accompany_explicit_source_backup(self):
        import base64
        from review_checkpoint import plan
        self.write('state.tex', '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n')
        def apply(method, *args):
            r = Review(self.root, 'state.tex'); updated, result = getattr(r, method)(*args); r.persist(updated, digest(r.raw)); return result
        apply('begin', 'round', ['任意名称.tex', 'state.tex'])
        apply('propose', {'file': '任意名称.tex', 'kind': 'manuscript', 'before': '\\input{章节/method}', 'after': '\\input{章节/method}\nAccepted text.'})
        r = Review(self.root, 'state.tex'); version = r.state['edits']['1']['versions'][-1]
        apply('decide', ['1'], [], {'1': version})
        save(self.root, self.spec())
        checkpoint = plan(Review(self.root, 'state.tex'))
        payload = base64.b64decode(checkpoint['sources']['任意名称.tex']['content']).decode('utf-8')
        self.assertIn('CODEX-FILE-ROLES-BEGIN', payload)
        self.assertIn('Accepted text.', payload)
        self.assertNotIn('CODEX-REVIEW-DATA', payload)
        file = self.root / '任意名称.tex'
        file.write_text(file.read_text(encoding='utf-8').replace('Accepted text.', 'Author manual text.'), encoding='utf-8')
        checkpoint = plan(Review(self.root, 'state.tex'))
        payload = base64.b64decode(checkpoint['sources']['任意名称.tex']['content']).decode('utf-8')
        self.assertIn('Author manual text.', payload)
        self.assertIn('CODEX-FILE-ROLES-BEGIN', payload)
        self.assertNotIn('CODEX-REVIEW-DATA', payload)
        self.assertIn('任意名称.tex', checkpoint['manual_files'])
