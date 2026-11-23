import unittest
from review_header_migration import mapped_header


class HeaderMigrationTests(unittest.TestCase):
    def test_only_supported_header_content_is_mapped(self):
        text = ('% chktex-file 8\n% CODEX-RULES-FILE: main.tex\n'
                '% CODEX-REVIEW-STATE-BEGIN\n% 作者约定：原文。\n'
                '% CODEX-REVIEW-NEXT manuscript=2 response=b\n'
                '% CODEX-REVIEW-MIGRATED state=.codex-review/state.json\n'
                '% CODEX-REVIEW-STATE-END\n% 回复信约定：使用原意。\n'
                '% Ordinary author comment\n\\documentclass{letter}\nbody\n')
        result, records = mapped_header(text, 'reply.tex')
        self.assertEqual(result, '% chktex-file 8\n% Ordinary author comment\n\\documentclass{letter}\nbody\n')
        self.assertEqual([item['text'] for item in records], ['% 作者约定：原文。\n', '% 回复信约定：使用原意。\n'])
        self.assertEqual(records[0]['source'], 'reply.tex:header-line-4')

    def test_unknown_machine_header_or_unpaired_header_refused(self):
        with self.assertRaises(ValueError):
            mapped_header('% CODEX-REVIEW-STATE-BEGIN\n% CODEX-NEW value\n% CODEX-REVIEW-STATE-END\n\\documentclass{x}\n', 'x.tex')
        with self.assertRaises(ValueError):
            mapped_header('% CODEX-REVIEW-STATE-BEGIN\n\\documentclass{x}\n', 'x.tex')

    def test_superseded_authorization_is_historical(self):
        _, records = mapped_header('% CODEX-REVIEW-STATE-BEGIN\n% 旧候选已获准废弃。\n% CODEX-REVIEW-STATE-END\n\\documentclass{x}\n', 'x.tex')
        self.assertTrue(records[0]['historical'])


if __name__ == '__main__':
    unittest.main()
