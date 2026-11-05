"""Build the same portable VSIX/source archive without installing dependencies."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ('main.js', 'extension.js', 'core.js', 'backup.js', 'navigation.js', 'menu_commands.js',
           'chktex_actions.js', 'chktex_messages.js', 'chktex_filter.py', 'inline_review.js', 'review_positions.js', 'candidate_panel.js', 'review_pdf.py', 'review_translate.py', 'tools.js',
           'setup.js', 'questions.js', 'writing.js', 'ai_setup.js', 'review_style.js', 'pdf_navigation.js', 'writing-guide.md', 'question-linking-guide.md', 'writing-presets.json',
           'paper.code-snippets', 'source_review.py', 'review_checkpoint.py')


def archive_bytes(files):
    stream = io.BytesIO()
    # Store the small text resources without compressor-version differences
    # between local Python runtimes.
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_STORED) as archive:
        for name, raw in sorted(files.items()):
            # All packaged resources are UTF-8 text. Match Git's canonical
            # line endings so local Windows and Mac builds use the same bytes.
            raw = raw.replace(b'\r\n', b'\n')
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_STORED
            archive.writestr(entry, raw)
    return stream.getvalue()


def write_product(path, raw):
    if path.exists() and path.read_bytes() != raw:
        raise SystemExit('An artifact with different content exists; use a new version or output directory.')
    if not path.exists():
        path.write_bytes(raw)
    print(path)
    print('SHA256', hashlib.sha256(raw).hexdigest())


def build(output):
    metadata = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    identity = escape(metadata['name'])
    manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{identity}" Version="{escape(metadata['version'])}" Publisher="{escape(metadata['publisher'])}"/>
<DisplayName>{escape(metadata['displayName'])}</DisplayName><Description xml:space="preserve">{escape(metadata['description'])}</Description>
<Tags>latex,paper,review</Tags><Categories>Formatters</Categories><Properties>
<Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(metadata['engines']['vscode'])}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="{escape(','.join(metadata.get('extensionDependencies', [])))}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/>
</Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'''
    content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/>
<Default Extension="py" ContentType="text/x-python"/><Default Extension="md" ContentType="text/markdown"/>
<Default Extension="code-snippets" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>'''
    files = {'extension/package.json': (ROOT / 'package.json').read_bytes(),
             'extension/README.md': (ROOT / 'README.md').read_bytes(),
             'extension/LICENSE': (ROOT / 'LICENSE').read_bytes(),
             '[Content_Types].xml': content_types.encode('utf-8'),
             'extension.vsixmanifest': manifest.encode('utf-8')}
    files.update({'extension/src/' + name: (ROOT / 'src' / name).read_bytes() for name in RUNTIME})
    output.mkdir(parents=True, exist_ok=True)
    write_product(output / ('texscholar-' + metadata['version'] + '.vsix'), archive_bytes(files))
    sources = {name: (ROOT / name).read_bytes() for name in ('package.json', 'README.md', 'LICENSE', 'DEVELOPMENT.md', '.gitignore', '.gitattributes')}
    sources.update({'src/' + name: (ROOT / 'src' / name).read_bytes() for name in RUNTIME})
    for name in ('review_archive.py', 'native_review_test.py', 'source_review_test.py', 'review_pdf_test.py', 'review_translate_test.py',
                 'inline_review.test.js', 'candidate_panel.test.js', 'setup.test.js', 'questions.test.js', 'extension.test.js',
                 'core.test.js', 'backup.test.js', 'menu_commands.test.js', 'navigation.test.js', 'chktex_actions.test.js', 'writing.test.js', 'pdf_navigation.test.js'):
        sources['src/' + name] = (ROOT / 'src' / name).read_bytes()
    sources['scripts/build.py'] = Path(__file__).read_bytes()
    sources['scripts/check.py'] = (ROOT / 'scripts/check.py').read_bytes()
    sources['scripts/publish_release.py'] = (ROOT / 'scripts/publish_release.py').read_bytes()
    sources['scripts/publish_release_test.py'] = (ROOT / 'scripts/publish_release_test.py').read_bytes()
    sources['.github/workflows/release.yml'] = (ROOT / '.github/workflows/release.yml').read_bytes()
    write_product(output / ('texscholar-' + metadata['version'] + '-source.zip'), archive_bytes(sources))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    build(parser.parse_args().output)
