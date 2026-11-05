"""On-demand review-display translation. No project reads, writes or AI calls."""
import argparse
import http.cookiejar
import json
import re
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request

from review_pdf import _command, _environment_end

PROVIDERS = {'google': 'Google', 'bing': 'Bing', 'deepl': 'DeepL 网页版', 'transmart': '腾讯 TranSmart'}
# Comment Translate's Google adapter uses 500-character requests; keep complete
# content by splitting rather than truncating. A card is translated only on click.
REQUEST_CHARS = 500


def protect_tex(text):
    prefix = 'TEXSCHOLARX'
    while prefix in text:
        prefix += 'X'
    kept, output, cursor = [], [], 0
    references = {r'\cite', r'\citep', r'\citet', r'\ref', r'\eqref', r'\cref', r'\Cref', r'\label', r'\url', r'\autoref'}
    while cursor < len(text):
        end = cursor
        if text.startswith(r'\begin{', cursor):
            end = _environment_end(text, cursor)
        elif text.startswith((r'\(', r'\['), cursor):
            closing = r'\)' if text[cursor + 1] == '(' else r'\]'
            stop = text.find(closing, cursor + 2)
            if stop < 0:
                raise ValueError('待翻译内容有未闭合数学区域；未发送该项。')
            end = stop + 2
        elif text[cursor] == '$':
            delimiter = '$$' if text.startswith('$$', cursor) else '$'
            end = cursor + len(delimiter)
            while end < len(text) and not text.startswith(delimiter, end):
                end = _command(text, end)[1] if text[end] == '\\' else end + 1
            if end == len(text):
                raise ValueError('待翻译内容有未闭合数学区域；未发送该项。')
            end += len(delimiter)
        elif text[cursor] == '\\':
            token, end = _command(text, cursor)
            if token.rstrip('*') in references:
                while end < len(text):
                    argument = end
                    while argument < len(text) and text[argument].isspace():
                        argument += 1
                    if argument == len(text) or text[argument] not in '[{':
                        break
                    end = argument
                    opening, closing = text[end], ']' if text[end] == '[' else '}'
                    depth, end = 1, end + 1
                    while end < len(text) and depth:
                        if text[end] == '\\':
                            end = _command(text, end)[1]
                            continue
                        if text[end] == opening:
                            depth += 1
                        elif text[end] == closing:
                            depth -= 1
                        end += 1
                    if depth:
                        raise ValueError('待翻译引用或命令参数未闭合；未发送该项。')
        elif text[cursor] in '{}':
            end = cursor + 1
        if end > cursor:
            output.append(prefix + str(len(kept)) + 'XEND')
            kept.append(text[cursor:end])
            cursor = end
        else:
            output.append(text[cursor])
            cursor += 1
    pattern = re.compile(re.escape(prefix) + r'\s*(\d+)\s*XEND', re.I)
    return ''.join(output), kept, pattern


def restore_tex(text, kept, pattern):
    matches = list(pattern.finditer(text))
    if [int(match[1]) for match in matches] != list(range(len(kept))):
        raise ValueError('翻译服务改变了数学或 LaTeX 标记，未展示错误译文；可换源重试。')
    return pattern.sub(lambda match: kept[int(match[1])], text)


def chunks(text, pattern, limit=REQUEST_CHARS):
    start = 0
    while start < len(text):
        end = min(start + limit, len(text))
        if end < len(text):
            space = max(text.rfind(' ', start, end), text.rfind('\n', start, end))
            if space > start:
                end = space + 1
            for match in pattern.finditer(text, start):
                if match.start() < end < match.end():
                    end = match.start() if match.start() > start else match.end()
                    break
                if match.start() >= end:
                    break
        yield text[start:end]
        start = end


class Provider:
    def __init__(self, name, proxy=None):
        if name not in PROVIDERS:
            raise ValueError('未知翻译来源。')
        self.name = name
        handler = urllib.request.ProxyHandler() if proxy is None else urllib.request.ProxyHandler({'http': proxy, 'https': proxy} if proxy else {})
        self.opener = urllib.request.build_opener(handler, urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.bing_session = None
        self.bing_sequence = 0

    def request(self, url, data=None, content_type=None, headers=None):
        request_headers = {'User-Agent': 'Mozilla/5.0', **(headers or {})}
        if content_type:
            request_headers['Content-Type'] = content_type
        request = urllib.request.Request(url, data=data, headers=request_headers)
        # Bound an unavailable remote request, not the author's work or output.
        with self.opener.open(request, timeout=20) as response:
            return response.read().decode('utf-8')

    def json_request(self, url, value):
        return json.loads(self.request(url, json.dumps(value, ensure_ascii=False).encode('utf-8'), 'application/json'))

    def translate(self, text):
        if self.name == 'google':
            form = urllib.parse.urlencode({'sl': 'en', 'tl': 'zh-CN', 'q': text}).encode('utf-8')
            result = json.loads(self.request('https://translate.google.com/translate_a/single?client=at&dt=t&dt=rm&dj=1', form, 'application/x-www-form-urlencoded;charset=utf-8'))
            rows = result.get('sentences') if isinstance(result, dict) else None
            if not isinstance(rows, list):
                raise ValueError('Google 返回格式已变化。')
            parts = [row['trans'] for row in rows if isinstance(row, dict) and isinstance(row.get('trans'), str)]
            value = ''.join(parts)
        elif self.name == 'bing':
            if self.bing_session is None:
                page = self.request('https://www.bing.com/translator')
                ig = re.search(r'IG:"([^"]+)"', page)
                iid = re.search(r'data-iid="([^"]+)"', page)
                tokens = re.search(r'params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])', page)
                if not all((ig, iid, tokens)):
                    raise ValueError('Bing 未提供翻译会话，可能需要网页验证；不会绕过验证。')
                key, token, *_ = json.loads(tokens[1])
                self.bing_session = ig[1], iid[1], key, token
            ig, iid, key, token = self.bing_session
            self.bing_sequence += 1
            url = 'https://www.bing.com/ttranslatev3?' + urllib.parse.urlencode({'isVertical': 1, 'IG': ig, 'IID': iid, 'SFX': self.bing_sequence,
                                                                              'ref': 'TThis', 'edgepdftranslator': 1})
            form = urllib.parse.urlencode({'fromLang': 'en', 'to': 'zh-Hans', 'text': text, 'key': key, 'token': token}).encode('utf-8')
            result = json.loads(self.request(url, form, 'application/x-www-form-urlencoded', {'Referer': 'https://www.bing.com/translator'}))
            rows = result[0].get('translations') if isinstance(result, list) and result and isinstance(result[0], dict) else None
            if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
                raise ValueError('Bing 返回验证要求或未知结果。')
            value = rows[0].get('text')
        elif self.name == 'transmart':
            result = self.json_request('https://transmart.qq.com/api/imt', {
                'header': {'fn': 'auto_translation', 'session': '', 'user': '',
                           'client_key': 'browser-chrome-130.0.0-' + ('Mac OS' if sys.platform == 'darwin' else 'Windows') + '-' + str(uuid.uuid4()) + '-' + str(int(time.time() * 1000))},
                'type': 'plain', 'model_category': 'normal', 'text_domain': '',
                'source': {'lang': 'en', 'text_list': [text]}, 'target': {'lang': 'zh'}})
            parts = result.get('auto_translation') if isinstance(result, dict) else None
            if not isinstance(parts, list) or not all(isinstance(part, str) for part in parts):
                raise ValueError('腾讯 TranSmart 未返回有效译文。')
            value = '\n'.join(parts)
        else:
            # Current anonymous endpoint, not retired JSON-RPC or a public relay.
            raw = self.request('https://oneshot-free.www.deepl.com/v1/translate',
                json.dumps({'text': [text], 'source_lang': 'en', 'target_lang': 'zh-Hans', 'usage_type': 'translate'}).encode('utf-8'),
                'application/json', {'Authorization': 'None'})
            result = json.loads(raw)
            rows = result.get('translations') if isinstance(result, dict) else None
            if not rows or not isinstance(rows, list) or not isinstance(rows[0], dict):
                raise ValueError('DeepL 匿名接口拒绝请求或接口已变化；可手动选择其他来源。')
            value = rows[0].get('text')
        if not isinstance(value, str) or not value.strip():
            raise ValueError(PROVIDERS[self.name] + ' 没有返回译文。')
        return value


def translate_text(text, provider):
    prepared, kept, pattern = protect_tex(text)
    if not re.search(r'[A-Za-z]', pattern.sub('', prepared)):
        return text
    output = []
    for part in chunks(prepared, pattern):
        leading = re.match(r'^\s*', part)[0]
        trailing = re.search(r'\s*$', part)[0]
        center = part.strip()
        if not center or not re.search(r'[A-Za-z]', pattern.sub('', center)):
            output.append(part)
        else:
            output.append(leading + provider.translate(center).strip() + trailing)
    return restore_tex(''.join(output), kept, pattern)


def failure(error):
    if isinstance(error, urllib.error.HTTPError):
        return 'HTTP ' + str(error.code) + ('：服务要求验证或限制匿名请求，可手动换源。' if error.code in (401, 403, 429) else '：翻译服务请求失败。')
    if isinstance(error, (urllib.error.URLError, TimeoutError, OSError)):
        return '翻译连接失败或超时；请检查网络、代理及所选服务。'
    return str(error)


def translate_many(provider_name, items, proxy=None, provider=None):
    if not isinstance(items, list) or any(not isinstance(item, dict) or not isinstance(item.get('key'), str) or not isinstance(item.get('text'), str) for item in items):
        raise ValueError('翻译输入须为带 key/text 的数组。')
    if len({item['key'] for item in items}) != len(items):
        raise ValueError('翻译位置标识不能重复。')
    engine = provider or Provider(provider_name, proxy)
    results, errors, translated = {}, {}, {}
    for index, item in enumerate(items):
        try:
            text = item['text']
            if text not in translated:
                translated[text] = translate_text(text, engine)
            results[item['key']] = translated[text]
        except (ValueError, OSError) as error:
            message = failure(error)
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            # Stop this click on failure/rate limiting, no repeated requests to
            # the same unavailable service and no switch to another recipient.
            errors.update({remaining['key']: message for remaining in items[index:]})
            break
    return {'provider': provider_name, 'results': results, 'errors': errors}


if __name__ == '__main__':
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        request = json.load(sys.stdin)
        print(json.dumps(translate_many(request['provider'], request['items'], request.get('proxy')), ensure_ascii=False))
    except (ValueError, OSError, KeyError) as error:
        print(failure(error), file=sys.stderr)
        sys.exit(2)
