"""Read the clients owning this managed MCP connection. Never stop processes."""
import argparse
import json
import re
import shutil
import subprocess
import sys


def classify(rows, storage, windows):
    normalize = lambda value: value.replace('\\', '/').lower() if windows else value
    base = normalize(str(storage)).rstrip('/')
    launcher = base + '/texscholar-mcp.py'
    registrations = base + '/mcp-workspaces'
    parents = {int(row['pid']): row for row in rows}
    found = []
    for row in rows:
        command = normalize(row['command'] or '')
        if launcher not in command and not ('mcp_server.py' in command and registrations in command):
            continue
        client, current, seen = 'unknown', row, set()
        while current and current['pid'] not in seen:
            seen.add(current['pid'])
            name = ((current.get('executable') or '') + ' ' + (current['command'] or '')).replace('\\', '/').lower()
            if 'openai.chatgpt-' in name or 'visual studio code.app/' in name or re.search(r'(?:^|[/\\])code\.exe(?:\s|$)', name, re.I):
                client = 'vscode'; break
            if 'openai.codex_' in name or '/chatgpt.app/' in name or '/codex.app/' in name or re.search(r'(?:^|[/\\])chatgpt\.exe(?:\s|$)', name, re.I):
                client = 'desktop'; break
            current = parents.get(int(current['parent']))
        found.append({'pid': int(row['pid']), 'parent_pid': int(row['parent']), 'client': client})
    return {'available': True, 'clients': sorted(found, key=lambda item: item['pid'])}


def inspect(storage):
    if sys.platform == 'win32':
        pwsh = shutil.which('pwsh.exe')
        if not pwsh:
            return {'available': False, 'reason': '未找到 PowerShell 7，无法识别连接所属客户端；最近报告不能代替当前会话核验。'}
        script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @(" \
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(pythonw?|codex|code|chatgpt)\\.exe$' } | " \
            "ForEach-Object { @{pid=$_.ProcessId;parent=$_.ParentProcessId;executable=$_.ExecutablePath;command=$_.CommandLine} }) | ConvertTo-Json -Compress"
        result = subprocess.run([pwsh, '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, check=True)
        rows = json.loads(result.stdout.decode('utf-8-sig'))
    elif sys.platform == 'darwin':
        result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,command='], capture_output=True, check=True)
        rows = []
        for line in result.stdout.decode('utf-8').splitlines():
            match = re.match(r'\s*(\d+)\s+(\d+)\s+(.*)', line)
            if match:
                rows.append({'pid': int(match[1]), 'parent': int(match[2]), 'command': match[3]})
    else:
        return {'available': False, 'reason': '当前平台未实现连接归属检查；请在实际会话核验版本。'}
    return classify(rows, storage, sys.platform == 'win32')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--storage', required=True)
    args = parser.parse_args()
    print(json.dumps(inspect(args.storage), ensure_ascii=False))
