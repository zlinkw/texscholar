"""Read public TeXScholar release metadata using the desktop system proxy."""
import json
import sys
import urllib.request
import urllib.parse
import re

URL = 'https://github.com/zlinkw/texscholar/releases/latest'


def latest():
    if sys.platform == 'win32':
        proxies = urllib.request.getproxies_registry()
    elif sys.platform == 'darwin':
        proxies = urllib.request.getproxies_macosx()
    else:
        proxies = urllib.request.getproxies()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies))
    request = urllib.request.Request(URL, headers={'User-Agent': 'TeXScholar-update-check'})
    # A failed hourly metadata check must not leave a permanently running request.
    with opener.open(request, timeout=20) as response:
        url = response.geturl()
    if url.rstrip('/') == 'https://github.com/zlinkw/texscholar/releases':
        return {'available': False}
    prefix = 'https://github.com/zlinkw/texscholar/releases/tag/'
    if not url.startswith(prefix) or not re.fullmatch(r'v?\d+\.\d+\.\d+', urllib.parse.unquote(url[len(prefix):])):
        raise ValueError('Latest release redirect did not identify a TeXScholar version')
    return {'tag_name': urllib.parse.unquote(url[len(prefix):]), 'html_url': url, 'draft': False, 'prerelease': False}


if __name__ == '__main__':
    try:
        print(json.dumps(latest(), ensure_ascii=False))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
