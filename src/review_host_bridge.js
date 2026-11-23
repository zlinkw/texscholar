'use strict';
const vscode = require('vscode');
const {openRegistry} = require('./review_host_registry');
const {applyTransaction} = require('./review_host_transaction');
const {applyLegacy} = require('./review_host_legacy');
const {applyMigration} = require('./review_host_migration');

async function activate(context, open = openRegistry) {
    const registry = await open();
    const roots = () => (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath);
    let pending = Promise.resolve();
    const update = () => {
        pending = pending.catch(() => {}).then(() => registry.join(roots()));
        pending.catch(error => vscode.window.showErrorMessage('审核宿主登记失败，源码受控写入已停止：' + error.message));
        return pending;
    };
    registry.onTransaction(message => message.role ? applyLegacy(vscode, registry, message.root, message.generation, null, message.role_plan, context) : message.migration ? applyMigration(vscode, registry, message.root, message.generation, message.commit, message.recover) : message.legacy ? applyLegacy(vscode, registry, message.root, message.generation, message.commit) :
        applyTransaction(vscode, registry, message.root, message.generation, message.state_sha, message.commit, message.recover));
    try {await update();}
    catch (error) {await registry.close(); throw error;}
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {update();}));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.resolveReviewHost', async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!folder || folder.uri.scheme !== 'file') return vscode.window.showWarningMessage('请在论文工作区打开源文件。');
        const root = folder.uri.fsPath, state = registry.state(root);
        if (!state?.uncertain) return vscode.window.showInformationMessage('当前工作区没有待核对的宿主登记。');
        const choice = await vscode.window.showWarningMessage('请确认其他审核窗口均已关闭，并核对未完成事务。确认后才恢复当前工作区的受控源码写入。', {modal:true}, '已核对，恢复写入');
        if (choice === '已核对，恢复写入') {
            try {await registry.resolveStale(root); vscode.window.showInformationMessage('审核宿主登记已恢复；未完成事务仍需单独核对。');}
            catch (error) {vscode.window.showErrorMessage(error.message);}
        }
    }));
    return {close: () => registry.close(), onHeaderSettled: callback => registry.onHeaderSettled(callback)};
}

module.exports = {activate};
