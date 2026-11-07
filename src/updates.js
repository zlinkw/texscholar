'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const CURRENT = require('../package.json').version;
const RELEASES = 'https://github.com/zlinkw/texscholar/releases';
const HOUR = 60 * 60 * 1000;

function newer(tag, installed = CURRENT) {
    const a = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag), b = /^(\d+)\.(\d+)\.(\d+)$/.exec(installed);
    if (!a || !b) throw new Error('发布版本号无效。');
    for (let i = 1; i <= 3; i++) {if (+a[i] !== +b[i]) return +a[i] > +b[i];}
    return false;
}
function activate(context, vscode = require('vscode'), dependencies = {}) {
    let running, installing, timer;
    async function invoke(args = []) {
        const cfg = vscode.workspace.getConfiguration('localLatex');
        const python = require('./tools').discover(key => cfg.get(key)).found.pythonPath;
        if (!python) throw new Error('更新检查需要可用的 Python 3.12+。');
        return JSON.parse(await require('./backup').run(python, ['-X', 'utf8', path.join(__dirname, 'update_check.py'), ...args], __dirname));
    }
    const fetchRelease = dependencies.fetchRelease || (() => invoke());
    const downloadRelease = dependencies.downloadRelease || ((tag, directory) => invoke(['--download', tag, '--directory', directory]));
    async function install(release) {
        if (installing) return installing;
        installing = (async () => {
            try {
                await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: 'TeXScholar：下载并安装 ' + release.tag_name}, async () => {
                    const directory = path.join(context.globalStorageUri.fsPath, 'update-download');
                    await fs.mkdir(directory, {recursive: true});
                    const stat = await fs.lstat(directory);
                    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('更新下载目录不是普通目录。');
                    const result = await downloadRelease(release.tag_name, directory);
                    const target = path.join(directory, 'pending.vsix');
                    if (!require('./tools').samePath(path.resolve(result.path), target) || result.version !== release.tag_name.replace(/^v/, '') || !/^[0-9a-f]{64}$/.test(result.sha256))
                        throw new Error('更新下载结果与目标版本不符。');
                    const info = await fs.lstat(target);
                    if (!info.isFile() || info.isSymbolicLink() || crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') !== result.sha256)
                        throw new Error('安装前 VSIX 校验失败。');
                    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(target));
                });
                const choice = await vscode.window.showInformationMessage('新版 TeXScholar 已安装。请等待当前 AI 操作结束，保留未发送的聊天输入后保存并重载 VS Code；重载后会核对 MCP 实际版本。', '保存文件并重载 VS Code');
                if (choice === '保存文件并重载 VS Code') await vscode.commands.executeCommand('localLatex.reloadForMCP');
            } catch (error) {await vscode.window.showErrorMessage('TeXScholar 更新安装失败：' + error.message);}
        })().finally(() => {installing = undefined;});
        return installing;
    }
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
                    '下载并安装', '打开发布页')).then(async choice => {
                    if (choice === '下载并安装') await install(release);
                    else if (choice === '打开发布页') await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
                }).catch(error => vscode.window.showErrorMessage('更新操作失败：' + error.message));
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
module.exports = {activate, newer};
