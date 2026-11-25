import unittest

from review_excerpts import references, resolve, safe_source

ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
REF = r'\TSExcerpt{正文/one.tex}{' + ID + '}'
SOURCE = '% TS-BLOCK-BEGIN id=' + ID + ' kind=paragraph\nSaved text.\n% TS-BLOCK-END id=' + ID + '\n'


class ExcerptTests(unittest.TestCase):
    def test_order_and_current_source(self):
        source = {'正文/one.tex': SOURCE}
        text = REF + ' explanation ' + REF
        self.assertEqual([r['content'] for r in resolve(text, source.__getitem__)], ['Saved text.\n'] * 2)
        source['正文/one.tex'] = SOURCE.replace('Saved text.', 'Author edit.')
        self.assertEqual([r['content'] for r in resolve(text, source.__getitem__)], ['Author edit.\n'] * 2)

    def test_comments_and_verbatim_are_not_references(self):
        text = '% ' + REF + '\n' + r'\verb|' + REF + '|\n' + r'\begin{verbatim}' + REF + r'\end{verbatim}' + '\n' + REF
        self.assertEqual(len(references(text)), 1)

    def test_missing_duplicate_and_malformed_sources_fail(self):
        for content in ('', SOURCE + SOURCE, SOURCE.replace('TS-BLOCK-END', 'TS-BLOCK-BROKEN')):
            with self.subTest(content=content), self.assertRaisesRegex(ValueError, ID):
                resolve(REF, lambda _: content)
        with self.assertRaisesRegex(ValueError, ID):
            resolve(REF, lambda _: (_ for _ in ()).throw(FileNotFoundError()))
        with self.assertRaises(ValueError):
            references(r'\TSExcerpt{one.tex}{broken}')

    def test_unsafe_paths_and_nested_references_fail(self):
        for path in ('../one.tex', '/one.tex', 'C:/one.tex', 'a\\b.tex', 'a/#b.tex', 'a//b.tex'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                safe_source(path)
        self.assertEqual(safe_source('正文/file space.tex'), '正文/file space.tex')
        with self.assertRaisesRegex(ValueError, '嵌套'):
            resolve(REF, lambda _: SOURCE.replace('Saved text.', REF))


if __name__ == '__main__':
    unittest.main()
