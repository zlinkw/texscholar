"""Publish the most recently active MCP process identity, without paper data."""
from pathlib import Path
import json
import os
from source_review import Review


def report(registrations, version, server):
    path = Path(registrations).resolve(strict=True).parent / 'mcp-runtime.json'
    if path.is_symlink() or path.is_junction() or (path.exists() and not path.is_file()):
        raise ValueError('MCP runtime status target is not a regular file')
    value = {'version': version, 'pid': os.getpid(), 'server': str(Path(server).resolve(strict=True))}
    raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if not path.exists() or path.read_bytes() != raw:
        Review.write(path, raw)
