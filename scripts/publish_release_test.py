"""Bounded release-resume and byte-identity checks; never access GitHub."""
from pathlib import Path
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import publish_release as release
from build import archive_bytes
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))
import update_check


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
        self.assertFalse(api.call_args_list[1].args[1]['prerelease'])
        self.assertEqual(api.call_args_list[1].args[1]['make_latest'], 'true')
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
            self.assertEqual(archive.getinfo('source.tex').compress_type, zipfile.ZIP_STORED)
        parent = Path(os.environ['LOCAL_LATEX_TEST_ROOT'])
        root = Path(tempfile.mkdtemp(prefix='release-', dir=parent))
        (root / 'package.json').write_text(json.dumps({'version': '1.0.0'}), encoding='utf-8')
        note = ''
        for label, name in [('VSIX', 'texscholar-1.0.0.vsix'), ('SOURCE', 'texscholar-1.0.0-source.zip')]:
            (root / name).write_bytes(canonical)
            note += label + '-SHA256: ' + hashlib.sha256(canonical).hexdigest() + '\n'
        (root / 'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(canonical).hexdigest() + '  ' + name + '\n'
            for name in ('texscholar-1.0.0.vsix', 'texscholar-1.0.0-source.zip')), encoding='utf-8')
        with patch.object(release.subprocess, 'check_output', return_value=note.encode('utf-8')):
            self.assertEqual({p.name for p in release.verify_artifacts(root, root, 'v1.0.0')},
                             {'texscholar-1.0.0.vsix', 'texscholar-1.0.0-source.zip', 'SHA256SUMS.txt'})
            (root / 'texscholar-1.0.0.vsix').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'tested artifact digest'):
                release.verify_artifacts(root, root, 'v1.0.0')

    def test_readme_png_resources_keep_their_binary_bytes(self):
        png = b'\x89PNG\r\n\x1a\n' + b'example\r\npayload'
        with zipfile.ZipFile(io.BytesIO(archive_bytes({'docs/images/example.png': png}))) as archive:
            self.assertEqual(archive.read('docs/images/example.png'), png)

    @patch.object(release, 'publish')
    @patch.object(release, 'verify_artifacts')
    def test_local_cli_uploads_existing_artifacts_and_sets_only_process_proxy(self, verify, publish):
        verify.return_value = self.files
        with patch.dict(os.environ, {}, clear=True):
            release.main(['--tag', 'v1.0.0', '--repo', 'example/paper', '--artifacts', 'dist/v1.0.0',
                          '--proxy', 'http://127.0.0.1:12345'])
            self.assertEqual(os.environ['HTTPS_PROXY'], 'http://127.0.0.1:12345')
            self.assertEqual(os.environ['HTTP_PROXY'], 'http://127.0.0.1:12345')
        verify.assert_called_once_with(Path(release.__file__).resolve().parent.parent, Path('dist/v1.0.0'), 'v1.0.0')
        publish.assert_called_once_with('example/paper', 'v1.0.0', self.files)

    @patch.object(release.time, 'sleep')
    @patch.object(release, 'gh')
    def test_transient_read_is_retried_without_repeating_a_write(self, gh, sleep):
        gh.side_effect = [subprocess.CompletedProcess([], 1, b'', b'Get "https://api.github.com/example": EOF'),
                          subprocess.CompletedProcess([], 0, b'{"id": 1}', b'')]
        self.assertEqual(release.api('example'), {'id': 1})
        self.assertEqual(gh.call_count, 2)
        sleep.assert_called_once_with(1)

    @patch.object(release.time, 'sleep')
    @patch.object(release, 'gh')
    def test_post_gateway_error_is_never_blindly_retried(self, gh, sleep):
        gh.return_value = subprocess.CompletedProcess([], 1, b'', b'HTTP 502: Bad Gateway')
        with self.assertRaisesRegex(RuntimeError, '502'):
            release.api('example', {'tag_name': 'v1.0.0'})
        gh.assert_called_once()
        sleep.assert_not_called()

    def test_update_download_checks_digest_and_vsix_identity_before_replacing_pending(self):
        root = Path(tempfile.mkdtemp(prefix='download-', dir=os.environ['LOCAL_LATEX_TEST_ROOT']))
        target = root / 'pending.vsix'
        class Response(io.BytesIO):
            def geturl(self):
                return 'https://release-assets.githubusercontent.com/fixture'
        for mode in ('success', 'digest', 'identity', 'network'):
            with self.subTest(mode=mode):
                target.write_bytes(b'previous')
                manifest = {'name': 'latex-writing-tools', 'publisher': 'local-research', 'version': '1.0.0' if mode != 'identity' else '2.0.0'}
                raw = archive_bytes({'extension/package.json': json.dumps(manifest).encode('utf-8')})
                digest = hashlib.sha256(raw).hexdigest() if mode != 'digest' else '0' * 64
                checksums = (digest + '  texscholar-1.0.0.vsix\n').encode('utf-8')
                with patch.object(update_check, 'opener') as mocked:
                    mocked.return_value.open.side_effect = OSError('HTTP 429') if mode == 'network' else [Response(checksums), Response(raw)]
                    if mode == 'success':
                        result = update_check.download('v1.0.0', root)
                        self.assertEqual(target.read_bytes(), raw)
                        self.assertEqual(result['sha256'], digest)
                        self.assertEqual(result['version'], '1.0.0')
                        self.assertTrue(all(call.args[0].full_url.startswith('https://github.com/zlinkw/texscholar/releases/download/v1.0.0/') for call in mocked.return_value.open.call_args_list))
                    else:
                        with self.assertRaises((OSError, ValueError)):
                            update_check.download('v1.0.0', root)
                        self.assertEqual(target.read_bytes(), b'previous')

    def test_update_channel_redirect_and_system_proxy_selection(self):
        class Response(io.BytesIO):
            url = 'https://github.com/zlinkw/texscholar/releases/tag/v1.0.0'
            def geturl(self):
                return self.url
        with patch.object(update_check, 'opener') as mocked:
            mocked.return_value.open.side_effect = [Response(), Response()]
            self.assertEqual(update_check.latest()['tag_name'], 'v1.0.0')
            Response.url = 'https://example.com/releases/tag/v1.0.0'
            with self.assertRaises(ValueError):
                update_check.latest()
        for platform, method in [('win32', 'getproxies_registry'), ('darwin', 'getproxies_macosx')]:
            with self.subTest(platform=platform), patch.object(update_check.sys, 'platform', platform), \
                 patch.object(update_check.urllib.request, method, create=True, return_value={'https': 'http://proxy.test:8080'}) as proxies, \
                 patch.object(update_check.urllib.request, 'ProxyHandler') as handler, \
                 patch.object(update_check.urllib.request, 'build_opener'):
                update_check.opener()
                proxies.assert_called_once()
                handler.assert_called_once_with({'https': 'http://proxy.test:8080'})


if __name__ == '__main__':
    unittest.main()
