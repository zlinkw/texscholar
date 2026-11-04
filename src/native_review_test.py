"""Git-independent review tests; fixtures are retained for inspection."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
import sys

from source_review import Review, body, digest, Conflict

ROOT = Path(os.environ['SOURCE_REVIEW_FIXTURES']); ROOT.mkdir(parents=True, exist_ok=True)


class NativeReview(unittest.TestCase):
    def setUp(self):
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
        self.assertNotIn(second, packet['cards'])
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
                'after': 'The model is reliable and fast.', 'deferred': False}
        result = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__).with_name('source_review.py')),
                                 '--project', str(self.root), '--state', 'reply.tex', '--apply',
                                 '--expect', digest(state), 'propose'], input=json.dumps(spec).encode('utf-8'), capture_output=True)
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
