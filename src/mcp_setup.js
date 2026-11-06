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
async function taskRequest(goal, roots, setup, connection) {
    const rules = setup ? await require('./ai_setup').buildPrompt()
        : '每个位置提交排序后的 A/B/C。具体规则由 read_context 按需返回，不重复附带安装指南。已有编号传 ids，新写位置可传 files。按任务选择 modules，并用 rules_receipt 作为下次 known_rules。同一会话上下文丢失时不声称已加载规则。';
    return ['# TeXScholar AI 论文任务', '', '插件版本：' + require('../package.json').version,
        '首次 read_context 传 expected_plugin_version 为上方版本；不匹配或旧服务缺少版本信息时，提示重启 Codex 的 MCP，不能转用另一个版本的 CLI 继续。', '', '本次任务：', goal.trim(), '', '当前工作区：', ...roots, '',
        '先使用 texscholar MCP read_context 读取实际项目、file_roles 和最新协议。不修改全局 SKILL，不自动发送或接收候选。',
        connection || '若当前会话尚未发现 texscholar，请先核对连接与重载状态，不绕过接口直接修改审核数据。', '', rules].join('\n');
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
        const version = /Python (\d+)\.(\d+)/.exec(await require('./tools').version(python));
        if (!version || +version[1] !== 3 || +version[2] < 12) throw new Error('连接 Codex 需要 Python 3.12+；请先更新 Python，再继续写作任务。');
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
        return result;
    }
    const queued = connect => {const task = chain.then(() => register(connect)); chain = task.catch(() => {}); return task;};
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.connectCodex', () => queued(true).then(() =>
        vscode.window.showInformationMessage('TeXScholar MCP 连接配置已核对；首次或配置变化后请重启 Codex 并核对 texscholar。日常使用 AI 论文助手即可。')).catch(error => vscode.window.showErrorMessage(error.message))));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.startPaperTask', async (options = {}) => {
        try {
            const setup = options.setup === true;
            if (!vscode.workspace.isTrusted) throw new Error('请先信任本地 LaTeX 工作区。');
            if (!(await vscode.workspace.findFiles('**/*.tex', EXCLUDE, 1)).length) throw new Error('请先打开含 .tex 的本地论文项目。');
            const goal = await vscode.window.showInputBox({prompt: 'AI 论文助手：填写写作目标；完整安装／迁移请用“AI 协作配置引导”；不自动发送', placeHolder: '例如：修改引言第二段并提供三方案'});
            if (!goal?.trim()) return;
            const commands = await vscode.commands.getCommands(true);
            const roots = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
            if (!commands.includes('chatgpt.addFileToThread')) {
                if (await vscode.window.showWarningMessage('未找到 Codex 的输入区接口。可复制一份合并后的任务说明到 Codex；未更改连接。', '复制完整任务说明') === '复制完整任务说明')
                    await vscode.env.clipboard.writeText(await taskRequest(goal, roots, setup));
                return;
            }
            let connected, connectionError;
            try {connected = await queued(true);}
            catch (error) {connectionError = error.message;}
            const connection = connectionError ? 'MCP 尚未连接成功：' + JSON.stringify(connectionError) + '。请先诊断此问题，不覆盖其他服务或绕过安全检查；恢复连接后再执行论文任务。'
                : connected.restart_required ? 'MCP 配置刚更新；首次连接或配置变化后需重启 Codex，再在新会话核对 texscholar。连接配置不等于当前会话已加载工具。' : undefined;
            const directory = path.join(context.globalStorageUri.fsPath, 'task-requests'); await fs.mkdir(directory, {recursive: true});
            const file = path.join(directory, 'first-message-' + crypto.randomUUID() + '.txt');
            await write(file, await taskRequest(goal, roots, setup, connection));
            if (commands.includes('chatgpt.newChat')) await vscode.commands.executeCommand('chatgpt.newChat');
            await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
            await vscode.commands.executeCommand('localLatex.checkAIConfiguration');
            const notice = '任务、三方案入口' + (setup ? '与完整环境配置' : connectionError ? '与连接修复要求' : '') + '已合为一份说明，加入 Codex 输入区；请检查并自行发送。';
            if (connectionError) vscode.window.showWarningMessage(notice + ' MCP 尚未连接成功：' + connectionError);
            else vscode.window.showInformationMessage(notice + (connected.restart_required ? ' 首次连接需重启 Codex，之后可再用本入口准备任务；不必分别配置或复制规则。' : ' 未修改全局 SKILL。'));
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => queued(false).catch(error => vscode.window.showErrorMessage(error.message))));
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    context.subscriptions.push(watcher, watcher.onDidCreate(file => {if (file.scheme === 'file' && !/(?:^|[\\/])(?:\.git|\.codex-review|\.latex-build|node_modules|clean_dir)(?:[\\/]|$)/.test(file.fsPath)) return queued(false).catch(error => vscode.window.showErrorMessage(error.message));}));
    return {ready: queued(false).catch(error => vscode.window.showErrorMessage('TeXScholar MCP 登记失败：' + error.message)), register: queued};
}
module.exports = {activate, launcher, taskRequest};
