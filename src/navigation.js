'use strict';
const vscode = require('vscode');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
function run(command, args, cwd, acceptedCodes = []) {
    return new Promise((resolve, reject) => {
        const env = require('./tools').environment();
        cp.execFile(command, args, {cwd, env, windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024},
            (error, stdout, stderr) => error && !acceptedCodes.includes(error.code) ? reject(new Error(stderr.trim() || stdout.trim() || error.message)) : resolve(stdout));
    });
}
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.checkUnusedCitations', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex') return;
        try {
            if (!/^\s*\\documentclass(?:\[[^\]]*\])?\s*\{/m.test(editor.document.getText())) {
                throw new Error('请先打开实际的主文档，再检查未引用文献。');
            }
            const file = editor.document.uri.fsPath, dir = path.dirname(file), stem = path.basename(file, '.tex');
            const cfg = vscode.workspace.getConfiguration('latex-workshop', editor.document.uri);
            const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
            const replacements = {'%DIR%': dir, '%DOCFILE%': stem, '%DOC%': file.slice(0, -4), '%WORKSPACE_FOLDER%': workspace};
            const output = cfg.get('latex.outDir', '%DIR%').replace(/%[A-Z_]+%/g, key => replacements[key] ?? key);
            if (/%[A-Z_]+%/.test(output)) throw new Error('输出目录包含暂不支持的占位符，请先核对实际编译目录。');
            const aux = path.join(path.resolve(dir, output), stem + '.aux');
            await fs.access(aux).catch(() => {throw new Error('未找到编译生成的 .aux，请先保存并编译主文档。');});
            if (editor.document.isDirty) throw new Error('主文档尚未保存，请先保存并编译后再检查。');
            const stat = await fs.stat(file), built = await fs.stat(aux);
            if (stat.mtimeMs > built.mtimeMs) throw new Error('主文档比 .aux 更新，请先重新编译，避免检查旧引用。');
            const raw = await run(vscode.workspace.getConfiguration('localLatex').get('checkcitesPath'), ['-u', aux], dir, [1]);
            if (!/^Unused references in your TeX document:\s*\d+/m.test(raw)) throw new Error(raw.trim() || 'checkcites 未返回有效报告，请检查编译产物和参考文献路径。');
            const unused = raw.split(/\r?\n/).filter(line => line.startsWith('=>')).map(line => line.slice(2).trim());
            if (unused.length) await vscode.window.showQuickPick(unused, {placeHolder: '编译快照中未引用的文献键（仅查看，不删除）'});
            else vscode.window.showInformationMessage('checkcites 检查结束：未报告未引用文献；以最近编译快照为准，不代表文献真实性已核验。');
        } catch (error) { vscode.window.showErrorMessage(error.message); }
    }));
    const currentTex = () => {
        const tab = vscode.window.tabGroups?.activeTabGroup.activeTab;
        const uri = tab?.input?.uri ?? vscode.window.activeTextEditor?.document.uri;
        return uri?.scheme === 'file' && uri.path.toLowerCase().endsWith('.tex') ? uri : undefined;
    };
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.toggleVisual', async () => {
        const uri = currentTex();
        if (uri) await vscode.commands.executeCommand('latexVisualEditor.toggle', uri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.formatFromVisual', async () => {
        const uri = currentTex();
        if (!uri || !vscode.workspace.isTrusted) return;
        await vscode.commands.executeCommand('latexVisualEditor.openSource', uri);
        if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
            await vscode.commands.executeCommand('localLatex.formatOnly');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.foldReviewComments', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'latex') return;
        const starts = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            if (/^\s*%\s*(?:region\b|CODEX-(?:RULES|FILE-ROLES|REVIEW-STATE|WRITING-PROFILE|PARAGRAPH-PLAN|REVIEW-PREAMBLE)-BEGIN\b)/.test(editor.document.lineAt(i).text)) starts.push(i);
        }
        if (starts.length) await vscode.commands.executeCommand('editor.fold', {selectionLines: starts});
    }));
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider({language: 'latex', scheme: 'file'}, {
        provideFoldingRanges(document) {
            const ranges = [], stack = [];
            for (let i = 0; i < document.lineCount; i++) {
                const text = document.lineAt(i).text;
                const start = text.match(/^\s*%\s*(CODEX-(?:RULES|FILE-ROLES|REVIEW-STATE|WRITING-PROFILE|PARAGRAPH-PLAN|REVIEW-PREAMBLE))-BEGIN\b/);
                if (start) stack.push({tag: start[1], line: i});
                const end = text.match(/^\s*%\s*(CODEX-(?:RULES|FILE-ROLES|REVIEW-STATE|WRITING-PROFILE|PARAGRAPH-PLAN|REVIEW-PREAMBLE))-END\b/);
                if (end && stack.length && stack[stack.length - 1].tag === end[1]) {
                    const begin = stack.pop();
                    if (i > begin.line) ranges.push(new vscode.FoldingRange(begin.line, i, vscode.FoldingRangeKind.Comment));
                }
            }
            return ranges;
        }
    }));
// Retired by author choice on 2026-11-03. Keep commented until the next confirmed cleanup.
//     context.subscriptions.push(vscode.commands.registerCommand('localLatex.compareHistory', async () => {
//         const editor = vscode.window.activeTextEditor;
//         if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex') return;
//         const cfg = vscode.workspace.getConfiguration('localLatex');
//         try {
//             const file = editor.document.uri.fsPath;
//             const folder = path.dirname(file);
//             const raw = await run(cfg.get('gitPath'), ['log', '-50', '--format=%H%x09%ad%x09%s', '--date=short'], folder);
//             const revisions = raw.trim().split(/\r?\n/).filter(Boolean).map(line => {
//                 const [sha, date, ...subject] = line.split('\t');
//                 return {label: sha.slice(0, 8) + ' ' + subject.join('\t'), description: date, sha};
//             });
//             if (revisions.length < 2) throw new Error('至少需要两个包含主文档的 Git 历史版本。');
//             const old = await vscode.window.showQuickPick(revisions, {placeHolder: '选择旧版本（历史快照，不包含未提交修改）'});
//             if (!old) return;
//             const current = await vscode.window.showQuickPick(revisions.filter(x => x.sha !== old.sha), {placeHolder: '选择新版本'});
//             if (!current) return;
//             await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: '生成历史差异 PDF'}, async () => {
//                 const result = JSON.parse(await run(cfg.get('pythonPath'), ['-X', 'utf8', path.join(__dirname, 'history_diff.py'),
//                     '--document', file, '--old', old.sha, '--new', current.sha, '--git', cfg.get('gitPath'),
//                     '--latexdiff', cfg.get('latexdiffPath'), '--latexmk', cfg.get('latexmkPath')], folder));
//                 await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(result.pdf));
//                 vscode.window.showInformationMessage('差异 PDF 已生成。原手稿和 Git 历史未改动。');
//             });
//         } catch (error) { vscode.window.showErrorMessage(error.message); }
//     }));
}
module.exports = {activate};
