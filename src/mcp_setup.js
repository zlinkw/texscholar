'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {run} = require('./backup');
const EXCLUDE = '**/{.git,.codex-review,.latex-build,node_modules,clean_dir}/**';
const launcher = `from pathlib import Path
import json, runpy, sys
connection = json.loads(Path(__file__).with_name('connection.json').read_text(encoding='utf-8'))
server = Path(connection['server']).resolve(strict=True)
sys.path.insert(0, str(server.parent))
sys.argv = [str(server), '--registrations', connection['registrations']]
runpy.run_path(str(server), run_name='__main__')
`;
async function write(file, text) {
    let previous;
    try {const info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('MCP 登记目标不是普通文件。'); previous = await fs.readFile(file, 'utf8');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (previous === text) return;
    const temporary = file + '.write-' + crypto.randomUUID();
    await fs.writeFile(temporary, text, {encoding: 'utf8', flag: 'wx'}); await fs.rename(temporary, file);
}
function activate(context, vscode = require('vscode')) {
    let chain = Promise.resolve();
    async function register(connect = false) {
        if (!vscode.workspace.isTrusted) throw new Error('请先信任本地 LaTeX 工作区。');
        const roots = [];
        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (folder.uri.scheme !== 'file') continue;
            if ((await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.tex'), EXCLUDE, 1)).length)
                roots.push(await fs.realpath(folder.uri.fsPath));
        }
        if (!roots.length) {if (connect) throw new Error('当前不是含 .tex 的本地论文项目。'); return;}
        const cfg = vscode.workspace.getConfiguration('localLatex');
        const python = require('./tools').discover(key => cfg.get(key)).found.pythonPath;
        if (!python) throw new Error('请先配置可用的 Python 3.12+，再连接 Codex。');
        const storage = context.globalStorageUri.fsPath;
        await fs.mkdir(path.join(storage, 'mcp-workspaces'), {recursive: true});
        for (const folder of [storage, path.join(storage, 'mcp-workspaces')]) {
            const info = await fs.lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('MCP 登记目录存在链接或类型异常。');
        }
        let id = context.workspaceState.get('mcpWorkspaceId');
        if (!id) {id = crypto.randomUUID(); await context.workspaceState.update('mcpWorkspaceId', id);}
        await write(path.join(storage, 'mcp-workspaces', id + '.json'), JSON.stringify({roots, git: cfg.get('gitPath', 'git')}));
        await write(path.join(storage, 'connection.json'), JSON.stringify({server: path.join(__dirname, 'mcp_server.py'), registrations: path.join(storage, 'mcp-workspaces')}));
        const script = path.join(storage, 'texscholar-mcp.py'); await write(script, launcher);
        const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
        const result = JSON.parse(await run(python, ['-X', 'utf8', path.join(__dirname, 'mcp_config.py'), '--home', home, '--launcher', script, '--python', python, ...(connect ? ['--connect'] : [])], storage));
        await context.workspaceState.update('texscholarMCPConfigured', result.connected);
        if (connect) vscode.window.showInformationMessage('TeXScholar MCP 已连接配置。请重启 Codex 扩展或新开会话，并在 MCP 列表核对 texscholar；未修改 SKILL。');
        return result;
    }
    const queued = connect => {const task = chain.then(() => register(connect)); chain = task.catch(() => {}); return task;};
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.connectCodex', () => queued(true).catch(error => vscode.window.showErrorMessage(error.message))));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.startPaperTask', async () => {
        try {
            const connected = await queued(true); if (!connected) return;
            const goal = await vscode.window.showInputBox({prompt: '本次论文任务是什么？将准备首条消息，不自动发送', placeHolder: '例如：修改引言第二段，保留事实并提供三方案'});
            if (!goal?.trim()) return;
            const commands = await vscode.commands.getCommands(true);
            if (!commands.includes('chatgpt.addFileToThread')) throw new Error('未找到 Codex 上下文入口；请先安装并启用 Codex。');
            const directory = path.join(context.globalStorageUri.fsPath, 'task-requests'); await fs.mkdir(directory, {recursive: true});
            const file = path.join(directory, 'first-message-' + crypto.randomUUID() + '.txt');
            await write(file, '请先使用 texscholar MCP read_context 读取当前论文项目与最新协议，再执行任务。不修改全局 SKILL。\n本次任务：\n' + goal + '\n工作区：\n' + (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath).join('\n'));
            if (commands.includes('chatgpt.newChat')) await vscode.commands.executeCommand('chatgpt.newChat');
            await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
            await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(path.join(__dirname, 'collaboration-guide.md')));
            vscode.window.showInformationMessage('首条任务与三方案协议已加入新会话。请检查并自行发送；首次连接须先重启 Codex，使 MCP 生效。');
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => queued(false).catch(error => vscode.window.showErrorMessage(error.message))));
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    context.subscriptions.push(watcher, watcher.onDidCreate(() => queued(false).catch(error => vscode.window.showErrorMessage(error.message))));
    return {ready: queued(false).catch(error => vscode.window.showErrorMessage('TeXScholar MCP 登记失败：' + error.message)), register: queued};
}
module.exports = {activate, launcher};
