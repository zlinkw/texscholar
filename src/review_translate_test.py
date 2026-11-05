"""Translation contracts, using synthetic text and no remote services."""
import io
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch
from review_translate import Provider, chunks, protect_tex, restore_tex, translate_many, translate_text


class Translation(unittest.TestCase):
    def test_default_proxy_uses_os_settings_despite_inherited_proxy_environment(self):
        system = {'http': 'http://system-proxy.invalid:8000', 'https': 'http://system-proxy.invalid:8000'}
        for platform, lookup in [('win32', 'getproxies_registry'), ('darwin', 'getproxies_macosx')]:
            with self.subTest(platform=platform), patch('review_translate.sys.platform', platform), \
                    patch.dict(os.environ, {'NO_PROXY': 'localhost', 'HTTPS_PROXY': 'http://inherited.invalid:9000'}), \
                    patch.object(urllib.request, lookup, return_value=system, create=True) as discover:
                provider = Provider('google')
                handler = next(item for item in provider.opener.handlers if isinstance(item, urllib.request.ProxyHandler))
                self.assertEqual(handler.proxies, system)
                discover.assert_called_once_with()
                explicit = Provider('bing', 'http://explicit.invalid:7000')
                handler = next(item for item in explicit.opener.handlers if isinstance(item, urllib.request.ProxyHandler))
                self.assertEqual(handler.proxies['https'], 'http://explicit.invalid:7000')

    def test_tex_and_unicode_are_preserved_and_formatting_words_can_be_translated(self):
        text = r'Use $p_{i}=0.5$ and \(x+y\), see \cite [Sec. 2] {key_a} and \textbf{useful features}. 😀'
        prepared, kept, pattern = protect_tex(text)
        self.assertNotIn('key_a', prepared)
        self.assertNotIn('p_{i}', prepared)
        self.assertEqual(restore_tex(prepared, kept, pattern), text)
        class Engine:
            def translate(self, value):
                return value.replace('Use', '使用').replace('useful features', '有用的特征')
        translated = translate_text(text, Engine())
        self.assertIn(r'\textbf{有用的特征}', translated)
        for literal in (r'$p_{i}=0.5$', r'\(x+y\)', r'\cite [Sec. 2] {key_a}', '😀'):
            self.assertIn(literal, translated)
        warnings = []
        partial = restore_tex(prepared.replace('TEXSCHOLARX0XEND', ''), kept, pattern, warnings)
        self.assertIn(r'\cite [Sec. 2] {key_a}', partial)
        self.assertEqual(len(warnings), 1, 'incomplete formatting is a reading notice, not a failed translation')
        plain, formulas, tokens = protect_tex('Use $a$ and $b$.')
        warnings = []
        reordered = restore_tex('先 TEXSCHOLARX1XEND，后 TEXSCHOLARX0XEND。', formulas, tokens, warnings)
        self.assertEqual(reordered, '先 $b$，后 $a$。')
        self.assertEqual(warnings, [], 'natural Chinese ordering does not have to match English placeholder order')
        self.assertIn('[标记请见原文]', restore_tex('译文 TEXSCHOLARX99XEND', formulas, tokens, warnings))
        with self.assertRaisesRegex(ValueError, '未闭合'):
            protect_tex('Broken $math')

    def test_complete_long_content_is_chunked_without_cutting_protected_markers(self):
        source = ('The full content must survive. ' * 80) + r'Use \ref{sec:one} and $x=3.14$.'
        text, kept, pattern = protect_tex(source)
        pieces = list(chunks(text, pattern))
        self.assertEqual(''.join(pieces), text)
        self.assertTrue(all(len(part) <= 500 for part in pieces))
        self.assertEqual(restore_tex(''.join(pieces), kept, pattern), source)
        calls = []
        class Engine:
            def translate(self, value):
                calls.append(value)
                return value
        self.assertEqual(translate_text(source, Engine()), source)
        self.assertEqual(calls, [text], 'send a full excerpt once, not one request per 500 characters')
        class NoNetwork:
            def translate(self, value):
                raise AssertionError('math-only content must stay local')
        self.assertEqual(translate_text(r'$x+y$', NoNetwork()), r'$x+y$')

    def test_each_provider_uses_its_selected_service_and_validates_output(self):
        for name in ('google', 'googleapi', 'bing', 'deepl', 'transmart'):
            with self.subTest(name=name):
                provider = Provider(name, '')
                requests = []
                def request(url, data=None, content_type=None, headers=None):
                    requests.append((url, data))
                    responses = {'google': [[['合成', 'Synthetic'], None, ['译文', 'text.']]],
                                 'googleapi': [[['合成', 'Synthetic'], None, ['译文', 'text.']]],
                                 'bing': [{'translations': [{'text': '合成译文'}]}],
                                 'deepl': {'translations': [{'text': '合成译文'}]},
                                 'transmart': {'auto_translation': ['合成译文']}}
                    return json.dumps(responses[name])
                provider.request = request
                self.assertEqual(provider.translate('Synthetic text.'), '合成译文')
                expected = {'google': 'translate.google.com', 'googleapi': 'translate.googleapis.com',
                            'bing': 'edge.microsoft.com/translate/translatetext',
                            'deepl': 'oneshot-free.www.deepl.com', 'transmart': 'transmart.qq.com'}[name]
                self.assertTrue(all(expected in url for url, _ in requests), 'no unselected service receives the text')
                if name == 'bing':
                    self.assertEqual(len(requests), 1, 'no legacy Bing page, token or cookie request')
                    self.assertEqual(json.loads(requests[0][1]), ['Synthetic text.'])
                provider.request = lambda *a, **kw: '{}'
                with self.assertRaises(ValueError):
                    provider.translate('Another synthetic text.')

    def test_zotero_compatible_http_requests_preserve_unicode_and_keep_hosts_explicit(self):
        source = 'Medical segmentation: café 😀.'
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                response = [{'translations': [{'text': '医学分割'}]}] if request.get_method() == 'POST' else [[['医学分割', source]]]
                return io.BytesIO(json.dumps(response).encode('utf-8'))
        for name, host in [('google', 'translate.google.com'), ('googleapi', 'translate.googleapis.com')]:
            provider = Provider(name, '')
            provider.opener = Opener()
            self.assertEqual(provider.translate(source), '医学分割')
            request = requests[-1]
            url = urllib.parse.urlsplit(request.full_url)
            query = urllib.parse.parse_qs(url.query)
            self.assertEqual((url.scheme, url.netloc, url.path), ('https', host, '/translate_a/single'))
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(query['q'], [source])
            self.assertEqual(query['client'], ['gtx'])
            self.assertEqual(query['tk'], ['776745.912989'])
            self.assertEqual((query['sl'], query['tl']), (['en'], ['zh-CN']))
            self.assertEqual(query['dt'], ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'])
        provider = Provider('bing', '')
        provider.opener = Opener()
        self.assertEqual(provider.translate(source), '医学分割')
        request = requests[-1]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), [source])
        self.assertEqual(request.get_header('Content-type'), 'application/json')
        self.assertIn('Edg/113.0.1774.42', request.get_header('User-agent'))
        self.assertIsNone(request.get_header('Cookie'), 'never imports browser credentials')
        self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual(len(requests), 3, 'each selected source sends exactly one request for this short input')
        provider = Provider('transmart', '')
        class TencentOpener:
            def open(self, request, timeout):
                requests.append(request)
                return io.BytesIO(json.dumps({'auto_translation': ['医学分割']}).encode('utf-8'))
        provider.opener = TencentOpener()
        self.assertEqual(provider.translate(source), '医学分割')
        request = requests[-1]
        self.assertEqual(request.get_header('Referer'), 'https://transmart.qq.com/zh-CN/index')
        self.assertIn('Chrome/110.0.0.0', request.get_header('User-agent'))
        payload = json.loads(request.data)
        self.assertEqual(payload['source'], {'lang': 'en', 'text_list': [source]})
        self.assertEqual(set(payload['header']), {'fn', 'client_key'})

    def test_success_deduplication_and_partial_failure_do_not_retry_or_switch_source(self):
        calls = []
        class Engine:
            def translate(self, text):
                calls.append(text)
                if text == 'Second text.':
                    raise urllib.error.HTTPError('https://example.invalid/?private=not-for-errors', 429, 'limited', None, None)
                return '中文译文'
        result = translate_many('google', [{'key': 'original', 'text': 'First text.'},
                                          {'key': 'candidate', 'text': 'First text.'},
                                          {'key': 'question0', 'text': 'Second text.'},
                                          {'key': 'question1', 'text': 'Third text.'}], provider=Engine())
        self.assertEqual(calls, ['First text.', 'Second text.'])
        self.assertEqual(result['results'], {'original': '中文译文', 'candidate': '中文译文'})
        self.assertEqual(set(result['errors']), {'question0', 'question1'})
        self.assertIn('429', result['errors']['question0'])
        self.assertNotIn('private', result['errors']['question0'])
        with self.assertRaisesRegex(ValueError, '不能重复'):
            translate_many('google', [{'key': 'x', 'text': 'one'}, {'key': 'x', 'text': 'two'}], provider=Engine())

    def test_display_format_damage_keeps_chinese_and_does_not_block_other_card_parts(self):
        class Engine:
            def translate(self, text):
                return '这是便于阅读的中文。' if 'TEXSCHOLAR' in text else '原始意见的中文。'
        result = translate_many('bing', [{'key': 'original', 'text': 'The score is $x_i$.'},
                                         {'key': 'question0', 'text': 'Please clarify the score.'}], provider=Engine())
        self.assertEqual(result['results']['original'], '这是便于阅读的中文。')
        self.assertEqual(result['results']['question0'], '原始意见的中文。')
        self.assertEqual(result['errors'], {})
        self.assertEqual(set(result['warnings']), {'original'})


if __name__ == '__main__':
    unittest.main()
