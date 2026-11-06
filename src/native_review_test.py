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
        self.assertEqual(latest['edit']['requests'][0]['option'], 'C')
        self.assertEqual(latest['edit']['requests'][0]['version'], data['version'])
        with patch('sys.stdin', io.StringIO(json.dumps({'after': 'Stale replacement.'}))):
            with self.assertRaisesRegex(Conflict, 'stale'):
                dispatch(self.review(), Namespace(**{**vars(args), 'expect': digest(self.review().raw)}))

    def test_explicit_new_batch_resets_ids_with_fixed_identity_and_rejects_old_versions(self):
        original = (self.root / 'main.tex').read_bytes()
        id_ = self.proposal(); previous = self.review().inspect(id_)
        self.apply('feedback', {'id': id_, 'version': previous['version'], 'side': 'candidate', 'start': 13, 'end': 21,
                                'quote': 'reliable', 'text': '再核对一下。'})
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
