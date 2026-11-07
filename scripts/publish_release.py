"""Upload existing local, tag-verified packages; never build or launch Actions."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time


def gh(*args, payload=None):
    result = subprocess.run(['gh', *args], input=None if payload is None else json.dumps(payload).encode('utf-8'),
                            capture_output=True)
    return result


def api(endpoint, payload=None, missing=False, method='POST'):
    args = ['api', '--hostname', 'github.com', endpoint]
    if payload is not None:
        args += ['--method', method, '--input', '-']
    # GETs have actually failed with gateway errors/EOF on this connection.
    # Retry only those reads; mutation failures still require reconciliation.
    attempts = 3 if payload is None else 1
    for attempt in range(attempts):
        result = gh(*args, payload=payload)
        if not result.returncode:
            return json.loads(result.stdout)
        error = result.stderr.decode('utf-8', errors='replace').strip()
        if missing and '(HTTP 404)' in error:
            return None
        if attempt + 1 == attempts or not re.search(r'\bHTTP (?:502|503|504)\b|:\s*EOF\b|unexpected EOF\b', error):
            raise RuntimeError(error)
        print(f'GitHub read failed; retry {attempt + 1}/{attempts - 1}: {error}', file=sys.stderr)
        time.sleep(attempt + 1)


def verify_artifacts(root, directory, tag):
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    if tag != 'v' + version or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('The release tag must match package.json version.')
    note = subprocess.check_output(['git', 'for-each-ref', '--format=%(contents)', 'refs/tags/' + tag], cwd=root).decode('utf-8')
    files = {}
    for label, name in [('VSIX', f'texscholar-{version}.vsix'), ('SOURCE', f'texscholar-{version}-source.zip')]:
        expected = re.search(r'^' + label + r'-SHA256: ([0-9a-f]{64})$', note, re.MULTILINE)
        artifact = directory / name
        actual = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if not expected or actual != expected[1]:
            raise ValueError(f'{name} does not match the tested artifact digest in the annotated tag.')
        files[artifact] = 'sha256:' + actual
    checksum = directory / 'SHA256SUMS.txt'
    wanted = ''.join(digest.removeprefix('sha256:') + '  ' + artifact.name + '\n' for artifact, digest in files.items())
    if checksum.read_text(encoding='utf-8') != wanted:
        raise ValueError('Release checksum file differs from tested artifact digests')
    files[checksum] = 'sha256:' + hashlib.sha256(checksum.read_bytes()).hexdigest()
    return files


def publish(repo, tag, files):
    endpoint = f'repos/{repo}/releases/tags/{tag}'
    release = api(endpoint, missing=True)
    if release is None:
        try:
            release = api(f'repos/{repo}/releases', {
                'tag_name': tag, 'name': f'TeXScholar {tag}', 'prerelease': False,
                'make_latest': 'true', 'body': 'Packages from the tested source tag ' + tag + '.'})
        except RuntimeError:
            # A failed POST can have succeeded server-side. Reconcile before
            # any retry instead of creating another release or replacing assets.
            release = api(endpoint, missing=True)
            if release is None:
                raise
    assets = {asset['name']: asset for asset in release['assets']}
    for artifact, digest in files.items():
        if artifact.name in assets and assets[artifact.name]['digest'] != digest:
            raise ValueError(f'{artifact.name} already exists with different content; nothing will be overwritten.')
    for artifact in files:
        if artifact.name not in assets:
            result = gh('release', 'upload', tag, str(artifact), '--repo', 'github.com/' + repo)
            if result.returncode:
                raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip())
    release = api(endpoint)
    assets = {asset['name']: asset for asset in release['assets']}
    for artifact, digest in files.items():
        if artifact.name not in assets or assets[artifact.name]['digest'] != digest:
            raise ValueError(f'{artifact.name} upload is not verified; rerun to resume, do not overwrite.')
    if release['draft']:
        release = api(f'repos/{repo}/releases/{release["id"]}', {'draft': False}, method='PATCH')
    print(release['html_url'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY'), required=not os.environ.get('GITHUB_REPOSITORY'))
    parser.add_argument('--artifacts', type=Path, default=Path('dist'))
    parser.add_argument('--proxy', help='HTTP proxy for this publisher process only; does not change system settings.')
    args = parser.parse_args(argv)
    if args.proxy:
        os.environ['HTTPS_PROXY'] = args.proxy
        os.environ['HTTP_PROXY'] = args.proxy
    files = verify_artifacts(Path(__file__).resolve().parent.parent, args.artifacts, args.tag)
    publish(args.repo, args.tag, files)


if __name__ == '__main__':
    main()
