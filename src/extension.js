'use strict';
const vscode = require('vscode');
const core = require('./core');
let busy = false;
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.saveBuild', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || !editor || editor.document.languageId !== 'latex' || editor.document.uri.scheme !== 'file') return;
        if (!await editor.document.save()) return vscode.window.showErrorMessage('保存失败，未开始编译。');
        await vscode.commands.executeCommand('latex-workshop.build');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.formatOnly', async () => {
        if (busy) return vscode.window.showWarningMessage('本次格式化尚未结束。');
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex') {
            return vscode.window.showWarningMessage('请打开受信任的本地 .tex 文件。');
        }
        const document = editor.document, version = document.version, original = document.getText();
        busy = true;
        try {
            const formatted = await core.formatText(original, vscode.workspace.getConfiguration('localLatex').get('texFmtPath'), require('node:path').dirname(document.uri.fsPath));
            if (document.isClosed || document.version !== version) throw new Error('格式化期间正文有新编辑，已停止，未覆盖。');
            if (formatted === original) {
                if (document.isDirty && !await document.save()) throw new Error('保存失败；未执行 Git 操作。');
                return vscode.window.showInformationMessage('没有可安全应用的缩进调整；已保留正文，未操作 Git。');
            }
            const range = new vscode.Range(document.positionAt(0), document.positionAt(original.length));
            if (!await editor.edit(build => build.replace(range, formatted), {undoStopBefore: true, undoStopAfter: true})) throw new Error('编辑器没有应用缩进调整。');
            if (!await document.save()) throw new Error('缩进已调整，但保存失败；未执行 Git 操作。');
            vscode.window.showInformationMessage('已整理缩进并保存，原正文和换行保持不变；未操作 Git。');
        } catch (error) { vscode.window.showErrorMessage(error.message); }
        finally { busy = false; }
    }));
// Retired by author choice on 2026-11-03. Keep commented until the next confirmed cleanup.
//     context.subscriptions.push(vscode.commands.registerCommand('localLatex.formatAndCommit', async () => {
//         if (busy) return vscode.window.showWarningMessage('本次格式化尚未结束。');
//         const editor = vscode.window.activeTextEditor;
//         if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex') {
//             return vscode.window.showWarningMessage('请在受信任的本地 LaTeX 工作区打开 .tex 文件。');
//         }
//         const document = editor.document;
//         busy = true;
//         let written = false;
//         let contentId = null;
//         try {
//             const cfg = vscode.workspace.getConfiguration('localLatex');
//             if (document.isDirty && !await document.save()) throw new Error('正文保存失败，未开始自动提交。');
//             if (document.isDirty || document.isClosed) throw new Error('保存期间内容又有变化，停止操作。');
//             const version = document.version;
//             const state = await core.prepare(document.uri.fsPath, {git: cfg.get('gitPath'), formatter: cfg.get('texFmtPath')}, {allowContentChanges: true, preserveOtherStaged: true});
//             if (document.isClosed || document.version !== version || document.isDirty) throw new Error('编辑器内容已变化，停止格式化。');
//             if (document.getText().replace(/^\uFEFF/, '') !== state.text.replace(/^\uFEFF/, '')) throw new Error('编辑器与磁盘内容不一致，停止操作。');
//             await core.assertCurrent(state, state.before);
//             if (document.isClosed || document.version !== version || document.isDirty) throw new Error('编辑器内容已变化，停止操作。');
//             contentId = await core.checkpoint(state);
//             if (document.isClosed || document.version !== version || document.isDirty) throw new Error('正文提交后编辑器又有变化，停止格式化。');
//             if (state.formatted === state.text) return vscode.window.showInformationMessage((contentId ? '已单独保存正文提交：' + contentId.slice(0, 8) + '。' : '') + '没有可安全应用的缩进调整；不创建空提交。');
//             await core.assertCurrent(state, state.before);
//             if (document.isClosed || document.version !== version || document.isDirty) throw new Error('编辑器内容已变化，停止格式化。');
//             const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
//             if (!await editor.edit(builder => builder.replace(range, state.formatted.replace(/^\uFEFF/, '')), {undoStopBefore: true, undoStopAfter: true})) throw new Error('编辑器未接受格式化。');
//             written = true;
//             if (!await document.save()) throw new Error('保存失败，未提交 Git。');
//             if (document.isDirty) throw new Error('保存后又有编辑，停止提交。');
//             const id = await core.commit(state);
//             vscode.window.showInformationMessage((contentId ? '正文提交：' + contentId.slice(0, 8) + '；' : '') + '已仅格式化并提交 Git：' + id.slice(0, 8) + '。未推送远端。');
//         } catch (error) {
//             vscode.window.showErrorMessage((contentId ? '正文已单独提交：' + contentId.slice(0, 8) + '。' : '') + (written ? '格式化可能已保存，但 Git 提交未完成。' : '') + error.message);
//         } finally { busy = false; }
//     }));
}
exports.activate = activate;
