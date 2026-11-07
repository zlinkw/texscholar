'use strict';
const path = require('node:path');
const CURRENT = require('../package.json').version;
const RELEASES = 'https://github.com/zlinkw/texscholar/releases';
const HOUR = 60 * 60 * 1000;

function newer(tag, installed = CURRENT) {
    const a = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag), b = /^(\d+)\.(\d+)\.(\d+)$/.exec(installed);
    if (!a || !b) throw new Error('发布版本号无效。');
    for (let i = 1; i <= 3; i++) {if (+a[i] !== +b[i]) return +a[i] > +b[i];}
    return false;
}
function prompt(tag) {
    return ['# 更新 TeXScholar VS Code 插件及 MCP',
        '本机当前版本：' + CURRENT, '目标 GitHub Release：' + tag, '发布地址：' + RELEASES,
        '仅使用该公开仓库的最新正式 Release。下载适合本机 Windows 或 macOS 的 VSIX；本插件通用包同时用于两种平台。',
        '核对仓库、版本和 Release 提供的 SHA256／资产摘要，再用本机 VS Code CLI 安装下载的 VSIX。保留真实失败信息，不从其他网站下载，也不触发云端打包。',
        '先保存用户输入，再提示正常重载 VS Code。插件激活后会更新自身的 MCP 启动指向。',
        '执行“TeXScholar：检查 Codex MCP 运行版本（复制恢复提示词）”。仅更新 VSIX 或配置文件不足以确认正在运行的 MCP 已升级。',
        '若活动 MCP 版本不一致或尚未核实，在当前 Codex 客户端的 MCP 设置里对 texscholar 执行 Restart；没有此入口时保存输入并正常重启该 Codex 客户端。保留原聊天。',
        '重启后先调用 texscholar.read_context，expected_plugin_version 使用实际安装的新版本，沿用原任务的 project、state、ids/scopes，核对返回 plugin_version 一致后继续。',
        '当前会话工具仍为旧版本时停止写入并说明，不用旧 CLI 绕过，不重放已成功项。',
        '保护论文、候选、批注、审核状态、暂存选择及全局 SKILL。更新不表示接收候选，不清理项目缓存，不改其他插件、代理或凭据。'].join('\n');
}
function activate(context, vscode = require('vscode'), dependencies = {}) {
    let running, timer;
    const fetchRelease = dependencies.fetchRelease || (async () => {
        const cfg = vscode.workspace.getConfiguration('localLatex');
        const python = require('./tools').discover(key => cfg.get(key)).found.pythonPath;
        if (!python) throw new Error('更新检查需要可用的 Python 3.12+。');
        return JSON.parse(await require('./backup').run(python, ['-X', 'utf8', path.join(__dirname, 'update_check.py')], __dirname));
    });
    async function check(explicit = false) {
        if (running) return running;
        running = (async () => {
            if (!explicit && !vscode.workspace.getConfiguration('localLatex').get('updates.checkHourly', true)) return;
            const previous = context.globalState.get('releaseCheckAt', 0);
            if (!explicit && Date.now() - previous < HOUR) return;
            await context.globalState.update('releaseCheckAt', Date.now());
            try {
                const release = await fetchRelease();
                await context.globalState.update('releaseCheckError', undefined);
                if (release.available === false) {
                    if (explicit) vscode.window.showInformationMessage('当前更新渠道尚无已发布版本。');
                    return release;
                }
                if (release.draft || release.prerelease || release.html_url !== RELEASES + '/tag/' + release.tag_name)
                    throw new Error('发布元数据不属于该仓库或当前更新渠道。');
                if (!newer(release.tag_name)) {
                    if (explicit) vscode.window.showInformationMessage('TeXScholar 已安装 ' + CURRENT + '，当前发布渠道没有更新。');
                    return release;
                }
                if (!explicit && context.globalState.get('releaseNotified') === release.tag_name) return release;
                await context.globalState.update('releaseNotified', release.tag_name);
                Promise.resolve(vscode.window.showInformationMessage(`TeXScholar 有新版 ${release.tag_name}（当前 ${CURRENT}）。`,
                    '复制更新提示词（含 MCP）', '打开发布页')).then(async choice => {
                    if (choice === '复制更新提示词（含 MCP）') await vscode.env.clipboard.writeText(prompt(release.tag_name));
                    else if (choice === '打开发布页') await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
                }).catch(error => vscode.window.showErrorMessage('更新提示处理失败：' + error.message));
                return release;
            } catch (error) {
                const previousError = context.globalState.get('releaseCheckError');
                await context.globalState.update('releaseCheckError', error.message);
                if (explicit || previousError !== error.message) vscode.window.showErrorMessage('TeXScholar 更新检查失败：' + error.message + '。可稍后执行“检查插件更新”重试。');
            }
        })().catch(error => vscode.window.showErrorMessage('TeXScholar 更新检查失败：' + error.message))
            .finally(() => {running = undefined;});
        return running;
    }
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.checkForUpdates', () => check(true)));
    timer = (dependencies.setInterval || setInterval)(() => check(), HOUR);
    timer.unref?.();
    context.subscriptions.push({dispose() {(dependencies.clearInterval || clearInterval)(timer);}});
    return {ready: check(), check};
}
module.exports = {activate, newer, prompt};
