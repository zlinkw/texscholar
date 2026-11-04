"""Bounded release-resume and byte-identity checks; never access GitHub."""
from pathlib import Path
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import publish_release as release
from build import archive_bytes


class Publish(unittest.TestCase):
    def setUp(self):
        self.files = {Path('texscholar-1.0.0.vsix'): 'sha256:a', Path('texscholar-1.0.0-source.zip'): 'sha256:b'}
        self.full = {'id': 1, 'draft': False, 'html_url': 'https://github.com/example/paper/releases/tag/v1.0.0',
                     'assets': [{'name': p.name, 'digest': d} for p, d in self.files.items()]}

    @patch.object(release, 'gh')
    @patch.object(release, 'api')
    def test_existing_equal_assets_are_not_uploaded_again(self, api, gh):
        api.return_value = self.full
        release.publish('example/paper', 'v1.0.0', self.files)
        gh.assert_not_called()

    @patch.object(release, 'gh')
    @patch.object(release, 'api')
    def test_mismatched_asset_stops_before_any_upload(self, api, gh):
        self.full['assets'][-1]['digest'] = 'sha256:different'
        api.return_value = self.full
        with self.assertRaisesRegex(ValueError, 'different content'):
            release.publish('example/paper', 'v1.0.0', self.files)
        gh.assert_not_called()

    @patch.object(release, 'gh')
    @patch.object(release, 'api')
    def test_post_502_reconciles_then_uploads_only_missing_asset(self, api, gh):
        partial = {**self.full, 'assets': self.full['assets'][:1]}
        api.side_effect = [None, RuntimeError('HTTP 502'), partial, self.full]
        gh.return_value = subprocess.CompletedProcess([], 0, b'', b'')
        release.publish('example/paper', 'v1.0.0', self.files)
        gh.assert_called_once_with('release', 'upload', 'v1.0.0', 'texscholar-1.0.0-source.zip', '--repo', 'github.com/example/paper')
        self.assertEqual(sum(bool(c.kwargs.get('payload')) or len(c.args) > 1 for c in api.call_args_list), 1)

    @patch.object(release, 'gh')
    @patch.object(release, 'api')
    def test_failed_creation_without_release_is_not_retried(self, api, gh):
        api.side_effect = [None, RuntimeError('HTTP 502'), None]
        with self.assertRaisesRegex(RuntimeError, '502'):
            release.publish('example/paper', 'v1.0.0', self.files)
        gh.assert_not_called()

    @patch.object(release, 'gh')
    @patch.object(release, 'api')
    def test_draft_is_published_only_after_assets_match(self, api, gh):
        api.side_effect = [{**self.full, 'draft': True}, {**self.full, 'draft': True}, self.full]
        release.publish('example/paper', 'v1.0.0', self.files)
        self.assertEqual(api.call_args.args[1], {'draft': False})
        self.assertEqual(api.call_args.kwargs['method'], 'PATCH')

    def test_source_line_endings_and_annotated_tag_digests(self):
        canonical = archive_bytes({'source.tex': '中文\nBody.\n'.encode('utf-8')})
        self.assertEqual(canonical, archive_bytes({'source.tex': '中文\r\nBody.\r\n'.encode('utf-8')}))
        with zipfile.ZipFile(io.BytesIO(canonical)) as archive:
            self.assertEqual(archive.read('source.tex').decode('utf-8'), '中文\nBody.\n')
        parent = Path(os.environ['LOCAL_LATEX_TEST_ROOT'])
        root = Path(tempfile.mkdtemp(prefix='release-', dir=parent))
        (root / 'package.json').write_text(json.dumps({'version': '1.0.0'}), encoding='utf-8')
        note = ''
        for label, name in [('VSIX', 'texscholar-1.0.0.vsix'), ('SOURCE', 'texscholar-1.0.0-source.zip')]:
            (root / name).write_bytes(canonical)
            note += label + '-SHA256: ' + hashlib.sha256(canonical).hexdigest() + '\n'
        with patch.object(release.subprocess, 'check_output', return_value=note.encode('utf-8')):
            self.assertEqual(len(release.verify_artifacts(root, root, 'v1.0.0')), 2)
            (root / 'texscholar-1.0.0.vsix').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'tested artifact digest'):
                release.verify_artifacts(root, root, 'v1.0.0')


if __name__ == '__main__':
    unittest.main()
