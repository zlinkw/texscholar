"""Keep the canonical machine ledger out of Workshop's ChkTeX diagnostics.

Uses the configured checker and Workshop's normal output protocol. No source,
third-party extension or diagnostic collection is modified.
"""
from pathlib import Path
import os
import re
import subprocess
import sys

FORMAT = '-f%f:%l:%c:%d:%k:%n:%m\n'
DIAGNOSTIC = re.compile(rb'^(.*?):(\d+):\d+:\d+:[^:]*:\d+:.*$')


def ledger_lines(raw):
    lines = raw.splitlines(keepends=True)
    if lines:
        lines[0] = lines[0].removeprefix(b'\xef\xbb\xbf')
    excluded = set()
    for kind in [b'REVIEW-STATE', b'FILE-ROLES']:
        starts = [i for i, line in enumerate(lines) if line.rstrip(b'\r\n') == b'% CODEX-' + kind + b'-BEGIN']
        ends = [i for i, line in enumerate(lines) if line.rstrip(b'\r\n') == b'% CODEX-' + kind + b'-END']
        if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
            continue
        # A malformed marker must never turn real TeX into an excluded region.
        if any(line.strip() and not line.lstrip().startswith(b'%') for line in lines[starts[0]:ends[0] + 1]):
            continue
        if kind == b'FILE-ROLES' and any(line.strip() and not line.lstrip().startswith(b'%') for line in lines[:starts[0]]):
            continue
        excluded.update(range(starts[0] + 1, ends[0] + 2))
    return excluded


def mask_ledger(raw, excluded):
    return b''.join(b'%' + line[len(line.rstrip(b'\r\n')):] if number in excluded else line
                    for number, line in enumerate(raw.splitlines(keepends=True), 1))


def filter_output(raw, stdin_lines):
    files = {}
    result = []
    for line in raw.splitlines(keepends=True):
        match = DIAGNOSTIC.fullmatch(line.rstrip(b'\r\n'))
        if match:
            name, number = match.groups()
            if stdin_lines is not None:
                excluded = stdin_lines
            else:
                # Windows ChkTeX emits the %f field through its native ANSI argv
                # interface. Decode that external field explicitly; never use
                # this encoding for manuscript content or rewrite raw output.
                file = Path(name.decode('mbcs' if os.name == 'nt' else 'utf-8'))
                if file not in files:
                    files[file] = ledger_lines(file.read_bytes())
                excluded = files[file]
            if int(number) in excluded:
                continue
        result.append(line)
    return b''.join(result)


def main():
    # Only the two documented Workshop calls are supported: active stdin, or
    # root-file checking (which can also report diagnostics from included files).
    if len(sys.argv) < 5 or sys.argv[1] != '--chktex' or sys.argv[3] != '--':
        raise ValueError('Expected --chktex <configured checker> -- <Workshop arguments>')
    command, args = sys.argv[2], sys.argv[4:]
    if FORMAT not in args:
        raise ValueError('Expected the LaTeX Workshop ChkTeX diagnostic format')
    content = sys.stdin.buffer.read() if args[-1] == FORMAT else None
    excluded = ledger_lines(content) if content is not None else None
    checked = mask_ledger(content, excluded) if content is not None else None
    result = subprocess.run([command, *args], input=checked, capture_output=True)
    sys.stderr.buffer.write(result.stderr)
    try:
        output = filter_output(result.stdout, excluded)
    except (OSError, UnicodeError):
        # Preserve ordinary diagnostics if a reported source cannot be read;
        # retain the actual failure instead of silently clearing all warnings.
        sys.stdout.buffer.write(result.stdout)
        raise
    sys.stdout.buffer.write(output)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
