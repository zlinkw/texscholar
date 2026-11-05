"""Full-paper, stacked original/proposal PDF without Git."""
from pathlib import Path
import json
import os
import re
import unittest
from pypdf import PdfReader, PdfWriter
from native_review_test import NativeReview
from review_pdf import preview, sentences, sentence_changes, review_units, with_legend

BIN = Path(os.environ['LOCAL_LATEX_TEXBIN'])
EXE = '.exe' if os.name == 'nt' else ''


class ReviewUnits(unittest.TestCase):
    def test_prose_environments_do_not_expand_a_sentence_to_the_complete_abstract(self):
        for environment in ['abstract', 'quote', 'quotation']:
            opening, closing = '\\begin{' + environment + '}\n', '\\end{' + environment + '}'
            content = 'The clinical background stays. The model is weak. The method overview stays. The results stay.'
            before = opening + content + '\n' + closing
            after = before.replace('The model is weak.', '% 局部计划\nThe model is robust.')
            self.assertEqual(''.join(sentences(before)), before)
            for edits in [
                [('82', 'The model is weak.', '% 局部计划\nThe model is robust.')],
                [('82', before, after)]
            ]:
                changes = self.changes(before, edits)
                self.assertEqual([(u['before'].strip(), u['after'].strip(), u['ids']) for u in changes],
                                 [('The model is weak.', '% 局部计划\nThe model is robust.', ['82'])])
                self.assertEqual(changes[0]['change_type'], 'Within paragraph')
            removed = self.changes(before, [('82', before, '')])
            self.assertEqual(len(removed), 1, 'removing a whole wrapper still needs one balanced comparison')
            self.assertEqual(removed[0]['before'], before)

    def test_paragraph_candidate_displays_only_changed_sentence_runs_with_the_same_id(self):
        before = 'Opening context stays. The model is strong. Middle context stays. The model is fast. Ending context stays.'
        for after, pairs in [
            (before.replace('strong', 'reliable'), [('The model is strong.', 'The model is reliable.')]),
            (before.replace('strong', 'reliable').replace('fast', 'efficient'),
             [('The model is strong.', 'The model is reliable.'), ('The model is fast.', 'The model is efficient.')]),
            ('% 局部写作逻辑\n' + before.replace('strong', 'reliable'), [('The model is strong.', 'The model is reliable.')])
        ]:
            edits = [{'id': '9', 'start': 37, 'end': 37 + len(before), 'item': {'after': after}}]
            units = list(review_units(before, edits, 37))
            changed = [unit for unit in units if unit['kind'] != 'equal']
            self.assertEqual([(u['before'].strip(), u['after'].strip()) for u in changed], pairs)
            self.assertEqual([u['ids'] for u in changed], [['9']] * len(pairs))
            displayed = ''.join(u['after'] if u['kind'] == 'equal' else u['before'] + u['after'] for u in units)
            for context in ['Opening context stays.', 'Middle context stays.', 'Ending context stays.']:
                self.assertEqual(displayed.count(context), 1)
            self.assertTrue(all(u['change_type'] == 'Within paragraph' for u in changed))
        adjacent = 'Opening stays. The model is strong. The model is fast. Ending stays.'
        changed = self.changes(adjacent, [('9', adjacent, adjacent.replace('strong', 'reliable').replace('fast', 'efficient'))])
        self.assertEqual([(u['before'].strip(), u['after'].strip()) for u in changed],
                         [('The model is strong. The model is fast.', 'The model is reliable. The model is efficient.')])
        self.assertEqual(changed[0]['ids'], ['9'])
        full = self.changes('First old sentence. Second old sentence.', [('9', 'First old sentence. Second old sentence.', 'First new sentence. Second new sentence.')])
        self.assertEqual(len(full), 1, 'a genuinely rewritten whole paragraph remains one compact pair')
        self.assertEqual(full[0]['change_type'], 'Paragraph rewrite')

    def test_real_paragraph_types_ignore_soft_lines_and_comment_only_lines(self):
        text = 'Opening sentence.\nOld sentence. Tail stays.\n\nWhole old paragraph.\n\nNext stays.'
        changes = self.changes(text, [('1', 'Old sentence.', 'New sentence.'), ('2', 'Whole old paragraph.', 'Whole new paragraph.')])
        self.assertEqual([(u['change_type'], u['paragraph_start']) for u in changes], [('Within paragraph', False), ('Paragraph rewrite', True)])
        for added, kind in [('\n% plan\nAdded sentence.\n', 'Inline addition'), ('\n\n% plan\nAdded paragraph.\n\n', 'New paragraph')]:
            text = 'First stays. Second stays.'
            edits = [{'id': '3', 'start': 12, 'end': 13, 'item': {'after': added}}]
            changed = [u for u in review_units(text, edits) if u['kind'] != 'equal']
            self.assertEqual(changed[0]['change_type'], kind)
            self.assertEqual(changed[0]['paragraph_start'], kind == 'New paragraph')
        changes = self.changes('First stays.\\par\n% plan\nOld paragraph.', [('4', 'Old paragraph.', 'New paragraph.')])
        self.assertEqual(changes[0]['change_type'], 'Paragraph rewrite')
        self.assertTrue(changes[0]['paragraph_start'])

    def changes(self, text, replacements):
        edits = []
        for id_, old, new in replacements:
            start = text.index(old)
            edits.append({'id': id_, 'start': start + 37, 'end': start + len(old) + 37, 'item': {'after': new}})
        return [unit for unit in review_units(text, edits, 37) if unit['kind'] != 'equal']

    def test_adjacent_equation_does_not_absorb_changed_sentence(self):
        before = 'First sentence stays. The model is strong.\\begin{equation}x=1\\end{equation}Last sentence stays.'
        after = before.replace('strong', 'reliable')
        changes = [(old.strip(), new.strip()) for kind, old, new in sentence_changes(before, after) if kind != 'equal']
        self.assertEqual(changes, [('The model is strong.', 'The model is reliable.')])
        self.assertEqual(len(sentences(before)), 4)

    def test_plain_sentence_and_independent_ids_with_length_changes(self):
        text = 'Context stays. The model is strong. The model is fast. Tail stays.'
        changes = self.changes(text, [('1', 'strong', 'highly reliable'), ('2', 'fast', 'compact')])
        self.assertEqual([unit['ids'] for unit in changes], [['1'], ['2']])
        self.assertEqual([unit['before'].strip() for unit in changes], ['The model is strong.', 'The model is fast.'])

    def test_text_and_equation_remain_independent(self):
        text = r'The model is strong.\begin{equation}\begin{aligned}x&=1\\y&=2\end{aligned}\label{eq:a}\end{equation}Tail stays.'
        changes = self.changes(text, [('1', 'strong', 'reliable'), ('2', 'x&=1', 'x&=3')])
        self.assertEqual([unit['ids'] for unit in changes], [['1'], ['2']])
        self.assertEqual(changes[0]['before'], 'The model is strong.')
        self.assertTrue(changes[1]['before'].startswith(r'\begin{equation}'))
        self.assertNotIn('Tail stays.', changes[1]['after'])

    def test_protected_tex_and_figure_boundaries_are_lossless(self):
        text = (r'At 1.5 mm, e.g. in Fig. 2, \cite{demo} uses $p=0.05$ and \(z=2.3\). '
                r'The \textbf{first clause. Still one macro} and \verb|a. b| stay. '
                r'Changed sentence.\begin{figure}[t]\fbox{Diagram}\caption{A figure.}\end{figure}Tail stays.')
        self.assertEqual(''.join(sentences(text)), text)
        self.assertEqual(len(sentences(text)), 5)
        changes = self.changes(text, [('7', 'Changed sentence.', 'Improved sentence.')])
        self.assertEqual([(unit['before'], unit['after'], unit['ids']) for unit in changes],
                         [('Changed sentence.', 'Improved sentence.', ['7'])])

    def test_display_math_and_insert_delete(self):
        text = r'Old sentence.\[x=1\] Tail stays.'
        changes = self.changes(text, [('1', 'Old sentence.', ''), ('2', 'x=1', 'x=3')])
        self.assertEqual([unit['ids'] for unit in changes], [['1'], ['2']])
        changes = self.changes('Tail stays.', [('3', 'Tail stays.', 'Added sentence. Tail stays.')])
        self.assertEqual(changes[0]['ids'], ['3'])

    def test_comment_prefixed_replacements_and_gap_additions_keep_their_own_original_and_id(self):
        first = 'The teacher uses three views.'
        second = 'Reliability uses mean probabilities.'
        text = first + ' ' + second + ' Tail stays.'
        plan = '% CODEX-PARAGRAPH-PLAN-BEGIN\n% 中文逻辑说明。\n% CODEX-PARAGRAPH-PLAN-END\n'
        edits = [
            {'id': '45', 'start': 0, 'end': len(first), 'item': {'after': plan + 'The teacher predicts three probability maps.'}},
            {'id': '48', 'start': len(first), 'end': len(first) + 1, 'item': {'after': '\n' + plan + 'Before screening, soft targets are used.\n'}},
            {'id': '46', 'start': len(first) + 1, 'end': len(first) + 1 + len(second), 'item': {'after': plan + 'Reliability uses the view mean and entropy.'}},
            {'id': '47', 'start': len(first) + 1 + len(second), 'end': len(first) + 2 + len(second), 'item': {'after': '\n' + plan + 'After screening, hard targets are used.\n'}}
        ]
        units = list(review_units(text, edits))
        changes = [u for u in units if u['kind'] != 'equal']
        self.assertEqual([u['ids'] for u in changes], [['45'], ['48'], ['46'], ['47']])
        self.assertEqual(changes[0]['before'], first)
        self.assertEqual(changes[2]['before'], second)
        self.assertTrue(changes[1]['addition_only'])
        self.assertTrue(changes[3]['addition_only'])
        self.assertEqual(''.join(u['after'] for u in units).count('Tail stays.'), 1)

    def test_two_ids_in_one_original_sentence_are_reported_not_silently_aggregated(self):
        with self.assertRaisesRegex(ValueError, '同一原文.*1.*2'):
            self.changes('The model is strong and fast.', [('1', 'strong', 'reliable'), ('2', 'fast', 'compact')])

    def test_legend_follows_title_once_and_ignores_commented_title(self):
        for newline in ['\n', '\r\n']:
            text = newline.join(['% \\maketitle', '\\maketitle', 'Body.'])
            result = with_legend(text)
            self.assertEqual(result.count(r'\textbf{Legend:}'), 1)
            self.assertLess(result.index(newline + '\\maketitle' + newline), result.index(r'\textbf{Legend:}'))
            self.assertLess(result.index(r'\textbf{Legend:}'), result.index('Body.'))
        self.assertTrue(with_legend('Body.').endswith('Body.'))


class ReviewPDF(unittest.TestCase):
    setUp = NativeReview.setUp
    review = NativeReview.review
    apply = NativeReview.apply
    proposal = NativeReview.proposal

    def test_abstract_and_quote_keep_their_wrappers_once_and_compare_only_modified_sentences(self):
        main = self.root / 'main.tex'
        source = (r'\documentclass[twocolumn]{article}' + '\n' +
                  r'\usepackage{amsmath}' + '\n' +
                  r'\renewenvironment{abstract}{\par\noindent\bfseries\textit{Abstract}---}{\par}' + '\n' +
                  r'\begin{document}' + '\n' + r'\begin{abstract}' + '\n' +
                  'Clinical context stays. The model is weak under domain shift. The method overview stays. The outcome stays.\n' +
                  r'\end{abstract}' + '\n' + r'\section{Introduction}' + '\n' +
                  'Main context stays.\n\n' + r'\begin{quote}' + '\n' +
                  'The reply opening stays. The analysis is weak. The reply ending stays.\n' + r'\end{quote}' + '\n' +
                  r'\begin{equation}z=13\label{eq:kept}\end{equation}' + '\n' + r'\end{document}' + '\n')
        main.write_text(source, encoding='utf-8', newline='')
        self.apply('begin', 'prose-containers', ['main.tex', 'reply.tex'])
        for old, new in [('The model is weak under domain shift.', '% 局部逻辑\nThe model is robust under domain shift.'),
                         ('The analysis is weak.', 'The analysis is robust.')]:
            self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': old, 'after': new})
        source_bytes, state_bytes = main.read_bytes(), (self.root / 'reply.tex').read_bytes()
        data = self.review().inspect('1')
        result = preview(self.root, 'reply.tex', main, '1', data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        derived = (Path(result['output']) / 'source/__codex_inline_review__.tex').read_text(encoding='utf-8')
        for wrapper in ('abstract', 'quote'):
            self.assertEqual(derived.count('\\begin{' + wrapper + '}'), 1)
            self.assertEqual(derived.count('\\end{' + wrapper + '}'), 1)
        for context in ['Clinical context stays.', 'The method overview stays.', 'The outcome stays.',
                        'The reply opening stays.', 'The reply ending stays.', 'Main context stays.', r'\label{eq:kept}']:
            self.assertEqual(derived.count(context), 1, context)
        self.assertEqual(derived.count(r'\begin{codexreviewold}'), 2)
        for id_ in ('1', '2'):
            self.assertEqual(derived.count(r'\textbf{[' + id_ + ']}'), 1)
        self.assertNotIn('Environment |', derived)
        self.assertEqual(main.read_bytes(), source_bytes)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state_bytes)
        text = ' '.join(' '.join(page.extract_text() for page in PdfReader(result['pdf']).pages).split())
        self.assertEqual(text.count('Abstract'), 1)
        for context in ['Clinical context stays.', 'The method overview stays.', 'The reply opening stays.']:
            self.assertEqual(text.count(context), 1)
        self.assertIn('weak', text)
        self.assertIn('robust', text)
        print('ABSTRACT_SENTENCE_PDF', result['pdf'])

    def test_incremental_review_reuses_unchanged_regions_and_bibliography_at_personal_scale(self):
        import time
        paragraphs = [f'The model for case {i} is strong.\nContext for case {i} remains unchanged.' for i in range(1, 101)]
        main = self.root / 'main.tex'
        main.write_text('\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\n'
                        + '\n\n'.join(paragraphs) + '\n\nFixture citation \\cite{fixture}.\n'
                        + '\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n', encoding='utf-8')
        (self.root / 'refs.bib').write_text('@article{fixture, author={Fixture, Test}, title={Isolated compilation fixture}, journal={Fixture Journal}, year={2026}}\n', encoding='utf-8')
        self.apply('begin', 'incremental', ['main.tex', 'reply.tex'])
        for i in range(1, 101):
            self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': f'The model for case {i} is strong.',
                                   'after': f'The model for case {i} is reliable.'})
        def build():
            data = self.review().inspect('1')
            before = main.read_bytes(), (self.root / 'reply.tex').read_bytes()
            start = time.perf_counter()
            result = preview(self.root, 'reply.tex', main, '1', data['version'], 'missing-git',
                             str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
            elapsed = time.perf_counter() - start
            self.assertEqual((main.read_bytes(), (self.root / 'reply.tex').read_bytes()), before)
            return result, elapsed
        first, cold = build()
        bibliography = (Path(first['output']) / 'pdf/review.bbl').read_bytes()
        self.apply('propose', {'after': 'The model for case 1 is robust.'}, '1')
        one, one_seconds = build()
        self.assertEqual(one['reused_fragments'], 198)
        self.assertTrue(one['reused_auxiliary'])
        for i in range(2, 7):
            self.apply('propose', {'after': f'The model for case {i} is compact and reliable.'}, str(i))
        five, five_seconds = build()
        self.assertEqual(five['reused_fragments'], 190)
        for result in [one, five]:
            out = Path(result['output'])
            self.assertEqual((out / 'pdf/review.bbl').read_bytes(), bibliography)
            self.assertNotRegex((out / 'compile.stdout.log').read_text(encoding='utf-8'), r"applying rule ['\"]bibtex")
        text = ' '.join(page.extract_text() for page in PdfReader(five['pdf']).pages)
        self.assertIn('compact and reliable', text)
        self.assertIn('Isolated compilation fixture', text)
        self.assertNotIn('citation [?]', text)
        self.assertEqual(first['pdf'], five['pdf'])
        print('INCREMENTAL_REVIEW_SECONDS', json.dumps({'items': 100, 'cold': cold, 'update_1': one_seconds,
                                                     'update_5': five_seconds, 'pdf': five['pdf']}))

    def test_missing_disposable_diff_metadata_rebuilds_and_foreign_auxiliary_path_is_refused(self):
        from unittest.mock import patch
        id_ = self.proposal(); data = self.review().inspect(id_)
        args = (self.root, 'reply.tex', self.root / 'main.tex', id_, data['version'], 'missing-git',
                str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        first = preview(*args)
        missing = Path(first['output']) / 'comparison.json'
        is_file = Path.is_file
        # Simulate a disposable cache file being absent without deleting artifacts.
        with patch.object(Path, 'is_file', lambda path: False if path == missing else is_file(path)):
            rebuilt = preview(*args)
        self.assertEqual(rebuilt['reused_fragments'], 0)
        self.assertTrue(rebuilt['reused_auxiliary'])
        self.assertIn('reliable', ' '.join(page.extract_text() for page in PdfReader(rebuilt['pdf']).pages))
        pdf = Path(rebuilt['pdf']).read_bytes()
        source = (self.root / 'main.tex').read_bytes(), (self.root / 'reply.tex').read_bytes()
        navigation = Path(rebuilt['navigation'])
        metadata = json.loads(navigation.read_text(encoding='utf-8'))
        metadata['compiled_pdf'] = str(self.root / 'foreign-cache/pdf/review.pdf')
        navigation.write_text(json.dumps(metadata), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '越出专用目录'):
            preview(*args)
        self.assertEqual(Path(rebuilt['pdf']).read_bytes(), pdf)
        self.assertEqual(((self.root / 'main.tex').read_bytes(), (self.root / 'reply.tex').read_bytes()), source)

    def test_changed_citations_and_bibliography_are_not_hidden_by_incremental_auxiliary_state(self):
        main = self.root / 'main.tex'
        main.write_text(main.read_text(encoding='utf-8').replace(r'\end{document}',
            'Reference context \\cite{first}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}'), encoding='utf-8')
        bib = self.root / 'refs.bib'
        bib.write_text('@article{first,author={Fixture, First},title={First isolated reference},journal={Fixture},year={2026}}\n', encoding='utf-8')
        self.apply('begin', 'bibliography-invalidation', ['main.tex', 'reply.tex'])
        id_ = self.proposal()
        def build():
            data = self.review().inspect(id_)
            return preview(self.root, 'reply.tex', main, id_, data['version'], 'missing-git',
                           str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        first = build()
        before = (Path(first['output']) / 'pdf/review.bbl').read_bytes()
        bib.write_text(bib.read_text(encoding='utf-8') + '@article{second,author={Fixture, Second},title={New isolated reference},journal={Fixture},year={2026}}\n', encoding='utf-8')
        self.apply('propose', {'after': r'The model is reliable and compact~\cite{second}.'}, id_)
        changed = build()
        self.assertTrue(changed['reused_auxiliary'])
        self.assertNotEqual((Path(changed['output']) / 'pdf/review.bbl').read_bytes(), before)
        self.assertIn('New isolated reference', ' '.join(page.extract_text() for page in PdfReader(changed['pdf']).pages))

    def test_positional_multi_sentence_item_repeats_only_changes_with_the_same_question_ids(self):
        main = self.root / 'main.tex'
        paragraph = 'The model is strong. The context remains unchanged. The model is fast.'
        after = 'The model is reliable. The context remains unchanged. The model is efficient.'
        main.write_text('\\documentclass{article}\n\\begin{document}\nOpening context.\n\n' + paragraph
                        + '\n\nEnding context.\n\\end{document}\n', encoding='utf-8')
        (self.root / 'questions.txt').write_text('Please clarify reliability.\nPlease explain efficiency.\n', encoding='utf-8')
        self.apply('begin', 'positional-round', ['main.tex', 'reply.tex'])
        id_ = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': paragraph, 'after': after})['id']
        data = self.review().inspect(id_)
        self.apply('update_questions', id_, data['version'], [
            {'id': 'R1-Q3', 'file': 'questions.txt', 'quote': 'Please clarify reliability.'},
            {'id': 'R4-Q5', 'file': 'questions.txt', 'quote': 'Please explain efficiency.'}])
        before = {p: (self.root / p).read_bytes() for p in ('main.tex', 'reply.tex')}
        result = preview(self.root, 'reply.tex', main, id_, data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        source = (Path(result['output']) / 'source/__codex_inline_review__.tex').read_text(encoding='utf-8')
        self.assertEqual(source.count(r'\textbf{[' + id_ + ']}'), 2)
        self.assertEqual(source.count(r'\rule{\linewidth}{0.3pt}'), 2)
        self.assertNotIn('[' + id_ + '] Original', source)
        self.assertNotIn('[' + id_ + '] Proposed', source)
        text = ' '.join(' '.join(page.extract_text() for page in PdfReader(result['pdf']).pages).split())
        self.assertIn('R1-Q3, R4-Q5', text)
        self.assertIn('Within paragraph', text)
        self.assertIn(r'\P{} Within paragraph', source)
        self.assertEqual(text.count('The context remains unchanged.'), 1)
        self.assertIn('The model is reliable.', text)
        self.assertEqual({p: (self.root / p).read_bytes() for p in before}, before)
        print('COMPACT_POSITIONAL_PDF', result['pdf'])

    def test_deletions_show_complete_surviving_candidate_and_explicit_empty_result(self):
        main = self.root / 'main.tex'
        text = ('\\documentclass[twocolumn]{article}\n\\title{Isolated review example}\n\\author{Test}\n\\date{}\n'
                '\\begin{document}\n\\maketitle\nOpening stays.\n\n'
                'The model uses an obsolete prior.\n\nRemove this sentence.\n\n'
                'The remaining context stays.\n\\end{document}\n')
        main.write_text(text, encoding='utf-8')
        self.apply('begin', 'deletions-round', ['main.tex', 'reply.tex'])
        self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'an obsolete prior', 'after': 'a prior'})
        self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'Remove this sentence.', 'after': ''})
        before, state = main.read_bytes(), (self.root / 'reply.tex').read_bytes()
        data = self.review().inspect('1')
        result = preview(self.root, 'reply.tex', main, '1', data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        pdf_text = re.sub(r'(?<=\w)-\s+(?=\w)', '', ' '.join(' '.join(page.extract_text() for page in PdfReader(result['pdf']).pages).split()))
        self.assertIn('The model uses a prior.', pdf_text)
        self.assertIn('Sentence/item deleted. Remaining context continues below.', pdf_text)
        self.assertEqual(pdf_text.count('The remaining context stays.'), 1)
        self.assertEqual(pdf_text.count('Legend:'), 1)
        self.assertLess(pdf_text.index('Isolated review example'), pdf_text.index('Legend:'))
        self.assertLess(pdf_text.index('Legend:'), pdf_text.index('Opening stays.'))
        self.assertEqual(main.read_bytes(), before)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state)
        print('DELETION_PDF', result['pdf'])

    def test_comment_prefixed_replacements_and_addition_labels_in_complete_pdf(self):
        main = self.root / 'main.tex'
        first, second = 'The teacher uses three views.', 'Reliability uses mean probabilities.'
        diagram = self.root / 'diagram.pdf'
        writer = PdfWriter(); writer.add_blank_page(width=72, height=72)
        with diagram.open('wb') as stream:
            writer.write(stream)
        self.assertRaises(UnicodeDecodeError, diagram.read_bytes().decode, 'utf-8')
        main.write_text('\\documentclass[twocolumn]{article}\n\\usepackage{amsmath,graphicx}\n\\begin{document}\nUnique opening context.\n\n'
                        '\\section{Method}\n' + first + ' ' + second + ' Tail stays.\n'
                        '\\begin{equation}z=1\\label{eq:unchanged}\\end{equation}\n\\includegraphics[width=1cm]{diagram.pdf}\nUnique ending context.\n\\end{document}\n', encoding='utf-8')
        self.apply('begin', 'original-unit-round', ['main.tex', 'reply.tex'])
        plan = '% CODEX-PARAGRAPH-PLAN-BEGIN\n% 中文逻辑注释，保留源文件。\n% CODEX-PARAGRAPH-PLAN-END\n'
        first_id = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': first,
                                         'after': plan + 'The teacher predicts three probability maps.'})['id']
        second_id = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': second,
                                          'after': plan + 'Reliability uses the view mean and entropy.'})['id']
        addition = self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': ' ', 'left': first,
                                         'right': second, 'after': '\n' + plan + 'Before screening, soft targets are used.\n'})['id']
        source, owner = main.read_bytes(), (self.root / 'reply.tex').read_bytes()
        data = self.review().inspect(first_id)
        result = preview(self.root, 'reply.tex', main, first_id, data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        tex = (Path(result['output']) / 'source/__codex_inline_review__.tex').read_text(encoding='utf-8')
        self.assertIn(r'\textbf{[' + first_id + ']}', tex)
        self.assertIn(r'\textbf{[' + second_id + ']}', tex)
        self.assertIn(r'\textbf{[' + addition + ']}', tex)
        self.assertIn('Addition only; no corresponding original text.', tex)
        self.assertNotRegex(tex, r'\[\d+,\d+')
        text = '\n'.join(page.extract_text() for page in PdfReader(result['pdf']).pages)
        normalized = ' '.join(text.split())
        self.assertIn(first, normalized)
        self.assertIn(second, normalized)
        self.assertIn('Addition only; no corresponding original text.', normalized)
        self.assertEqual(normalized.count('Tail stays.'), 1)
        self.assertEqual(normalized.count('Unique opening context.'), 1)
        self.assertEqual(tex.count(r'\label{eq:unchanged}'), 1)
        self.assertIn('diagram.pdf', (Path(result['output']) / 'pdf/review.fls').read_text(encoding='utf-8'))
        navigation = json.loads(Path(result['navigation']).read_text(encoding='utf-8'))
        self.assertEqual(set(navigation['targets']), {first_id, second_id, addition})
        self.assertTrue(all(target['file'].endswith('.tex') for target in navigation['targets'].values()))
        self.assertEqual(main.read_bytes(), source)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), owner)
        print('ORIGINAL_UNIT_PDF', result['pdf'])

    def test_complete_paper_sentence_environment_and_id_granularity(self):
        main = self.root / 'main.tex'
        text = r'''\documentclass{article}
\usepackage{amsmath,graphicx,hyperref}
\begin{document}
Unique opening context.

\section{Plain}
Plain anchor stays. The plain model is strong. Plain tail stays.

\section{Adjacent}
The adjacent model is weak.\begin{equation}E_{\mathrm{adj}}=17\label{eq:adj}\end{equation}Adjacent tail stays.

\section{Separate}
The separate model is slow.\begin{equation}G=2\label{eq:changed}\end{equation}Separate tail stays.

\section{Independent}
The first model is fragile. The second model is large. Independent tail stays.

\section{Protected}
At 1.5 mm, e.g. in Fig. 2, \cite{demo} uses $p=0.05$ and \(z=2.3\). The \textbf{first clause. Still one macro} stays. The protected model is noisy.

\section{Figures}
The figure model is crude.\begin{figure}[h]\centering\fbox{Unique unchanged diagram}\caption{Unique unchanged caption.}\end{figure}Figure tail stays.

\begin{equation}L=9\label{eq:last}\end{equation}
Unique ending context.
\begin{thebibliography}{1}
\bibitem{demo} Example reference.
\end{thebibliography}
\end{document}
'''
        main.write_text(text, encoding='utf-8', newline='')
        self.apply('begin', 'granularity-round', ['main.tex', 'reply.tex'])
        replacements = [('strong', 'reliable'), ('weak', 'robust'), ('slow', 'efficient'), ('G=2', 'G=3'),
                        ('fragile', 'highly stable'), ('large', 'compact'), ('noisy', 'precise'), ('crude', 'refined')]
        for old, new in replacements:
            self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': old, 'after': new})
        source_bytes, state_bytes = main.read_bytes(), (self.root / 'reply.tex').read_bytes()
        data = self.review().inspect('1')
        result = preview(self.root, 'reply.tex', main, '1', data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        source = (Path(result['output']) / 'source/__codex_inline_review__.tex').read_text(encoding='utf-8')
        for unchanged in ['Plain anchor stays.', 'Plain tail stays.', 'Adjacent tail stays.', 'Separate tail stays.',
                          'Independent tail stays.', 'At 1.5 mm', 'first clause.', 'Figure tail stays.',
                          'Unique opening context.', 'Unique ending context.', 'Unique unchanged caption.',
                          r'\label{eq:adj}', r'\label{eq:last}']:
            self.assertEqual(source.count(unchanged), 1, unchanged)
        for id_ in map(str, range(1, 9)):
            self.assertEqual(source.count(r'\textbf{[' + id_ + ']}'), 1)
            self.assertNotIn('[' + id_ + '] Original', source)
            self.assertNotIn('[' + id_ + '] Proposed', source)
        self.assertNotIn('[5,6]', source)
        self.assertEqual(source.count(r'\begin{equation}'), 4)
        aux = (Path(result['output']) / 'pdf/review.aux').read_text(encoding='utf-8')
        self.assertRegex(aux, r'newlabel\{eq:last\}\{\{3\}')
        self.assertIn(r'\bibcite{demo}{1}', aux)
        pdf_text = '\n'.join(page.extract_text() for page in PdfReader(result['pdf']).pages)
        for unchanged in ['Unique opening context.', 'Unique ending context.', 'Unique unchanged diagram', 'Plain anchor stays.']:
            self.assertEqual(pdf_text.count(unchanged), 1)
        self.assertEqual(set(result['shown_ids']), set(map(str, range(1, 9))))
        self.assertEqual(main.read_bytes(), source_bytes)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state_bytes)
        print('GRANULARITY_PDF', result['pdf'])

    def test_one_complete_pdf_keeps_context_and_only_marks_different_words(self):
        main = self.root / 'main.tex'
        main.write_text(main.read_text(encoding='utf-8').replace('The model is strong and fast.',
                        'The first sentence stays. The model is strong and fast. The last sentence stays.'), encoding='utf-8')
        id_ = self.proposal()
        data = self.review().inspect(id_)
        before = (self.root / 'main.tex').read_bytes()
        state = (self.root / 'reply.tex').read_bytes()
        result = preview(self.root, 'reply.tex', self.root / 'main.tex', id_, data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        pdf = Path(result['pdf'])
        text = '\n'.join(page.extract_text() for page in PdfReader(pdf).pages)
        self.assertIn('Unchanged context before.', text)
        self.assertIn('Unchanged context after.', text)
        self.assertEqual(text.count('Unchanged context before.'), 1)
        self.assertEqual(text.count('Unchanged context after.'), 1)
        self.assertEqual(text.count('The first sentence stays.'), 1)
        self.assertEqual(text.count('The last sentence stays.'), 1)
        self.assertLess(text.index('strong'), text.index('reliable'))
        self.assertEqual(text.count('[' + id_ + ']'), 1)
        self.assertIn('strong', text)
        self.assertIn('reliable', text)
        self.assertEqual(len(list(pdf.parent.glob('*.pdf'))), 1)
        source = next((Path(result['output']) / 'source').glob('__codex_inline_review__.tex')).read_text(encoding='utf-8')
        self.assertIn('codexreviewold', source)
        self.assertNotRegex(source, r'\\DIFadd(?:FL)?\{[^{}]*\band\b')
        self.assertEqual((self.root / 'main.tex').read_bytes(), before)
        self.assertEqual((self.root / 'reply.tex').read_bytes(), state)
        self.assertFalse((self.root / '.git').exists())
        print('REVIEW_PDF', pdf)
        import json
        import subprocess
        meta = json.loads(Path(result['navigation']).read_text(encoding='utf-8'))
        target = meta['targets'][id_]
        sync = subprocess.run([str(BIN / ('synctex' + EXE)), 'view', '-i',
                               f"{target['line']}:0:{target['file']}", '-o', meta['compiled_pdf']], capture_output=True)
        self.assertEqual(sync.returncode, 0, sync.stderr.decode('utf-8', errors='replace'))
        self.assertRegex(sync.stdout.decode('utf-8'), r'Page:[1-9][0-9]*')
        from unittest.mock import patch
        import review_pdf
        old_pdf = pdf.read_bytes()
        original_command = review_pdf.command
        def compile_failure(args, cwd, log):
            if Path(args[0]).name.startswith('latexmk'):
                raise ValueError('isolated compile failure')
            return original_command(args, cwd, log)
        with patch.object(review_pdf, 'command', compile_failure):
            with self.assertRaisesRegex(ValueError, 'isolated compile failure'):
                preview(self.root, 'reply.tex', self.root / 'main.tex', id_, data['version'], 'missing-git',
                        str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        self.assertEqual(pdf.read_bytes(), old_pdf)
        again = preview(self.root, 'reply.tex', self.root / 'main.tex', id_, data['version'], 'missing-git',
                        str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        self.assertEqual(again['pdf'], str(pdf), 'subsequent generation updates the same viewer artifact')

    def test_sentence_boundaries_preserve_tex_math_and_abbreviations(self):
        text = r'Fig. 2 uses $x=1.5$. The model uses \textbf{a feature. Another feature}. It works.'
        self.assertEqual(len(sentences(text)), 3)
        self.assertEqual(''.join(sentences(text)), text)
        pairs = list(sentence_changes('First old sentence. Second old sentence.', 'First new sentence. Second new sentence.'))
        self.assertEqual(len(pairs), 2)

    def test_graphicx_hyperref_preamble_does_not_require_figure_markup_packages(self):
        main = self.root / 'main.tex'
        main.write_text(main.read_text(encoding='utf-8').replace(r'\documentclass{article}',
                        '\\documentclass{article}\n\\usepackage{graphicx}\n\\usepackage{hyperref}'), encoding='utf-8')
        id_ = self.proposal()
        data = self.review().inspect(id_)
        result = preview(self.root, 'reply.tex', main, id_, data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        self.assertTrue(Path(result['pdf']).is_file())
        source = (Path(result['output']) / 'source/__codex_inline_review__.tex').read_text(encoding='utf-8')
        self.assertNotIn(r'\RequirePackage{settobox}', source)

    def test_independent_reply_changes_are_not_included_in_manuscript_pdf(self):
        id_ = self.proposal()
        self.apply('propose', {'file': 'reply.tex', 'kind': 'response', 'before': 'Thank you.',
                              'after': r'Thank you. \undefinedReplyTemplateMacro{reply only}'})
        data = self.review().inspect(id_)
        result = preview(self.root, 'reply.tex', self.root / 'main.tex', id_, data['version'], 'missing-git',
                         str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        self.assertEqual(result['shown_ids'], ['1'])

    def test_equation_numbers_and_unchanged_sections_are_not_duplicated(self):
        main = self.root / 'main.tex'
        main.write_text('\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n'
                        '\\section{Method}\nBefore the equation.\n\n\\begin{equation}x=1\\label{first}\\end{equation}\n\n'
                        '\\begin{equation}y=2\\label{second}\\end{equation}\n\nAfter both equations.\n\\end{document}\n', encoding='utf-8')
        self.apply('propose', {'file': 'main.tex', 'kind': 'manuscript', 'before': 'x=1', 'after': 'x=3', 'deferred': True})
        data = self.review().inspect('1')
        result = preview(self.root, 'reply.tex', main, '1', data['version'], 'missing-git', str(BIN / ('latexdiff' + EXE)), str(BIN / ('latexmk' + EXE)))
        aux = (Path(result['output']) / 'pdf/review.aux').read_text(encoding='utf-8')
        self.assertRegex(aux, r'newlabel\{second\}\{\{2\}')
        text = '\n'.join(page.extract_text() for page in PdfReader(result['pdf']).pages)
        self.assertEqual(text.count('Method'), 1)
        self.assertIn('After both equations.', text)
        self.assertEqual(text.count('Before the equation.'), 1)
        self.assertEqual(text.count('After both equations.'), 1)


if __name__ == '__main__':
    unittest.main()
