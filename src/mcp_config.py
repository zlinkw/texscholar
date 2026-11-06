"""Maintain only the explicitly owned [mcp_servers.texscholar] TOML section."""
from pathlib import Path
import argparse
import json
import os
import re
import tomllib
import uuid

MARKER = '# TeXScholar managed MCP connection\n'

def atomic(path, raw, previous):
    if path.is_symlink() or path.is_junction() or (path.exists() and not path.is_file()):
        raise ValueError('MCP configuration target is not a regular file')
    if (path.read_bytes() if path.exists() else None) != previous:
        raise ValueError('Concurrent MCP configuration change; no overwrite')
    temporary = path.with_name(path.name + '.write-' + uuid.uuid4().hex)
    with temporary.open('xb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())
    if (path.read_bytes() if path.exists() else None) != previous:
        raise ValueError('Concurrent MCP configuration change; temporary result retained')
    os.replace(temporary, path)

def configure(home, launcher, python, connect=False):
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    if home.is_symlink() or home.is_junction():
        raise ValueError('Codex config home is a link; use its verified actual location')
    path = home / 'config.toml'
    if path.is_symlink() or path.is_junction():
        raise ValueError('Codex configuration is a link; no write')
    previous = path.read_bytes() if path.exists() else None
    text = (previous or b'').decode('utf-8-sig')
    newline = '\r\n' if '\r\n' in text else '\n'
    text = text.replace('\r\n', '\n')
    parsed = tomllib.loads(text)
    entry = parsed.get('mcp_servers', {}).get('texscholar')
    match = re.search(r'(?m)^\[mcp_servers\.texscholar\][ \t]*\r?\n', text)
    managed = match is not None and text[:match.start()].replace('\r\n', '\n').endswith(MARKER)
    if entry and not managed:
        raise ValueError('An unmanaged texscholar MCP entry already exists; it was not replaced')
    if entry and 'url' in entry:
        raise ValueError('Existing texscholar uses a different transport; no overwrite')
    wanted = {**(entry or {}), 'command': python, 'args': ['-X', 'utf8', str(launcher)],
              'enabled': True if connect else (entry or {}).get('enabled', True)}
    if not connect and not managed:
        return {'connected': False, 'changed': False}
    if entry == wanted:
        return {'connected': wanted['enabled'], 'changed': False}
    table = '[mcp_servers.texscholar]\ncommand = ' + json.dumps(python, ensure_ascii=False) + '\nargs = ' + json.dumps(wanted['args'], ensure_ascii=False) + '\nenabled = ' + str(wanted['enabled']).lower() + '\n'
    if entry:
        if managed:
            next_table = re.search(r'(?m)^\s*\[', text[match.end():])
            end = match.end() + next_table.start() if next_table else len(text)
            original_table = text[match.end():end]
            # Preserve author-configured timeouts, approvals and enablement.
            table = '[mcp_servers.texscholar]\n' + original_table
            for field in ('command', 'args', 'enabled'):
                line = field + ' = ' + (str(wanted[field]).lower() if field == 'enabled' else json.dumps(wanted[field], ensure_ascii=False))
                pattern = r'(?m)^' + field + r'\s*=.*$'
                if re.search(pattern, table):
                    table = re.sub(pattern, lambda m: line, table)
                else:
                    table = table.rstrip('\r\n') + '\n' + line + '\n'
    if managed:
        next_table = re.search(r'(?m)^\s*\[', text[match.end():])
        end = match.end() + next_table.start() if next_table else len(text)
        text = text[:match.start()] + table + '\n' + text[end:]
    else:
        text = text.rstrip('\n') + '\n\n' + MARKER + table
    after = tomllib.loads(text)
    expected = dict(parsed)
    expected['mcp_servers'] = {**parsed.get('mcp_servers', {}), 'texscholar': wanted}
    if after != expected:
        raise ValueError('MCP change would alter unrelated configuration; no write')
    raw = (b'\xef\xbb\xbf' if previous and previous.startswith(b'\xef\xbb\xbf') else b'') + text.replace('\n', newline).encode('utf-8')
    atomic(path, raw, previous)
    return {'connected': wanted['enabled'], 'changed': True, 'restart_required': True}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', required=True)
    parser.add_argument('--launcher', required=True)
    parser.add_argument('--python', required=True)
    parser.add_argument('--connect', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(configure(args.home, args.launcher, args.python, args.connect), ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(str(error), file=__import__('sys').stderr)
        raise SystemExit(2)
