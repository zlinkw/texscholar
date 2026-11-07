"""Read public TeXScholar release metadata using the desktop system proxy."""
import json
import sys
import urllib.request
import urllib.parse
import re
import argparse
import hashlib
import io
import zipfile
from pathlib import Path
from source_review import Review

URL = 'https://github.com/zlinkw/texscholar/releases/latest'


def opener():
    if sys.platform == 'win32':
        proxies = urllib.request.getproxies_registry()
    elif sys.platform == 'darwin':
        proxies = urllib.request.getproxies_macosx()
    else:
        proxies = urllib.request.getproxies()
    return urllib.request.build_opener(urllib.request.ProxyHandler(proxies))


def latest():
    request = urllib.request.Request(URL, headers={'User-Agent': 'TeXScholar-update-check'})
    # A failed hourly metadata check must not leave a permanently running request.
    with opener().open(request, timeout=20) as response:
        url = response.geturl()
    if url.rstrip('/') == 'https://github.com/zlinkw/texscholar/releases':
        return {'available': False}
    prefix = 'https://github.com/zlinkw/texscholar/releases/tag/'
    if not url.startswith(prefix) or not re.fullmatch(r'v?\d+\.\d+\.\d+', urllib.parse.unquote(url[len(prefix):])):
        raise ValueError('Latest release redirect did not identify a TeXScholar version')
    return {'tag_name': urllib.parse.unquote(url[len(prefix):]), 'html_url': url, 'draft': False, 'prerelease': False}


def download(tag, directory):
    if not re.fullmatch(r'v?\d+\.\d+\.\d+', tag):
        raise ValueError('Invalid release version')
    folder = Path(directory)
    if folder.is_symlink() or folder.is_junction() or not folder.is_dir():
        raise ValueError('Update directory must be a regular directory')
    target = folder / 'pending.vsix'
    if target.is_symlink() or target.is_junction() or (target.exists() and not target.is_file()):
        raise ValueError('Update target is not a regular file')
    name = 'texscholar-' + tag.removeprefix('v') + '.vsix'
    base = 'https://github.com/zlinkw/texscholar/releases/download/' + tag + '/'
    client = opener()
    def read(asset):
        request = urllib.request.Request(base + asset, headers={'User-Agent': 'TeXScholar-update-install'})
        with client.open(request, timeout=20) as response:
            if not response.geturl().startswith('https://'):
                raise ValueError('Release download requires HTTPS')
            return response.read()
    checksums = read('SHA256SUMS.txt').decode('utf-8')
    matches = re.findall(r'^([0-9a-f]{64})  ' + re.escape(name) + r'$', checksums, re.M)
    if len(matches) != 1:
        raise ValueError('Release checksum for VSIX is missing or ambiguous')
    raw = read(name)
    actual = hashlib.sha256(raw).hexdigest()
    if actual != matches[0]:
        raise ValueError('Release VSIX SHA256 mismatch; installation stopped')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest = json.loads(archive.read('extension/package.json').decode('utf-8'))
    if (manifest.get('name'), manifest.get('publisher'), manifest.get('version')) != ('latex-writing-tools', 'local-research', tag.removeprefix('v')):
        raise ValueError('Release VSIX identity or version mismatch; installation stopped')
    Review.write(target, raw)
    return {'path': str(target.resolve()), 'sha256': actual, 'version': tag.removeprefix('v')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download')
    parser.add_argument('--directory')
    args = parser.parse_args()
    try:
        if args.download and not args.directory:
            raise ValueError('Download requires an update directory')
        print(json.dumps(download(args.download, args.directory) if args.download else latest(), ensure_ascii=False))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
