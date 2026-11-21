import unittest
from review_facts import changes


class FactChanges(unittest.TestCase):
    def test_local_values_citations_and_math(self):
        old = r'The score is 90.1 in \cite{old2020} and $\alpha + x = 2$.'
        new = r'The score is 91.2 in \cite{new2021} and $\beta - x = 3$.'
        items = changes(old, new)
        self.assertEqual({item['kind'] for item in items}, {'number','citation','math'})
        self.assertTrue(all(item['evidence'] == 'unsupported' for item in items))
        for item in items:
            for value, start, end in item['old']:
                self.assertEqual(old[start:end], value)
            for value, start, end in item['new']:
                self.assertEqual(new[start:end], value)

    def test_tex_layout_escapes_and_comments_do_not_create_changes(self):
        old = 'Price is \\$5; value $x^2 + \\alpha$. % 19\nSee \\cite{key2}.'
        new = 'Price is \\$5; value $\\left(\\mathrm{x}^{2}+\\alpha\\right)$. % 20\nSee \\cite{key2}.'
        self.assertEqual(changes(old, new), [])

    def test_explicit_term_and_unchanged_prose(self):
        items = changes('Use model A and retain atlas.', 'Use model A and a map.', ['atlas'])
        self.assertEqual([item['kind'] for item in items], ['term'])
        self.assertEqual(changes('The model is accurate.', 'The model is reliable.'), [])
        self.assertIn('math', [item['kind'] for item in changes(r'$x_1$', r'$x_2$')])
        self.assertIn('math', [item['kind'] for item in changes(r'\begin{equation}x=\alpha\end{equation}', r'\begin{equation}x=\beta\end{equation}')])


if __name__ == '__main__':
    unittest.main()
