'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
function notifyProblem(vscode, reason) {
    return vscode.window.showWarningMessage('原始审稿问题关联有问题：' + reason, '一键复制给 AI', '查看规则').then(async choice => {
        const guide = path.join(__dirname, 'question-linking-guide.md');
        if (choice === '一键复制给 AI') await vscode.env.clipboard.writeText(await fs.readFile(guide, 'utf8'));
        else if (choice === '查看规则') await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(guide));
    });
}
function validateTarget(repo, question) {
    if (!question || !['id', 'file', 'quote'].every(k => typeof question[k] === 'string' && question[k].trim()))
        throw new Error('没有完整的原始审稿意见关联；不能按编号猜测。');
    const target = path.resolve(repo, question.file), relative = path.relative(repo, target);
    if (path.isAbsolute(question.file) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('问题源文件必须位于当前论文项目内。');
    return target;
}
async function jump(vscode, repo, question) {
    const target = validateTarget(repo, question), real = await fs.realpath(target), root = await fs.realpath(repo);
    const relative = path.relative(root, real);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('原始问题文件链接越出当前论文项目。');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const text = doc.getText();
    // Link metadata repeats excerpts; search original prose, not that metadata,
    // while retaining the real document offsets for the editor selection.
    const excluded = [...text.matchAll(/^% CODEX-REVIEW-STATE-BEGIN\r?\n[\s\S]*?^% CODEX-REVIEW-STATE-END(?:\r?\n|$)|^[ \t]*%[ \t]*CODEX-QUESTION[^\r\n]*/gm)]
        .map(match => [match.index, match.index + match[0].length]);
    const hits = [];
    for (let at = text.indexOf(question.quote); at >= 0; at = text.indexOf(question.quote, at + 1)) {
        if (!excluded.some(([a, b]) => at < b && at + question.quote.length > a)) hits.push(at);
    }
    const editor = await vscode.window.showTextDocument(doc, {preview: false});
    if (hits.length !== 1) {
        notifyProblem(vscode, '问题原文已变化或不唯一，已打开源文件但没有猜测定位。').catch(error => vscode.window.showErrorMessage(error.message)); return;
    }
    const [start] = hits;
    editor.selection = new vscode.Selection(doc.positionAt(start), doc.positionAt(start + question.quote.length));
    editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
function links(text) {
    return [...text.matchAll(/^\s*%\s*CODEX-QUESTION (\{[^\n]+\})\s*$/gm)].map(match => {
        const question = JSON.parse(match[1]);
        return {start: match.index, question};
    });
}
function activate(context, vscode = require('vscode')) {
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.jumpQuestion', async spec => {
        if (!vscode.workspace.isTrusted || !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(spec.repo)))
            return vscode.window.showErrorMessage('请在对应的受信任论文项目内打开问题。');
        try {
            await jump(vscode, spec.repo, spec.question);
        } catch (error) {notifyProblem(vscode, error.message).catch(problem => vscode.window.showErrorMessage(problem.message));}
    }));
    context.subscriptions.push(vscode.languages.registerHoverProvider({language: 'latex', scheme: 'file'}, {
        provideHover(document, position) {
            const line = document.lineAt(position.line).text;
            if (!/Comment|Question|Reviewer|审稿|问题|CODEX-QUESTION|\\Q\w*/i.test(line)) return;
            const folder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!folder) return;
            try {
                const at = document.offsetAt(position), related = links(document.getText()).filter(item => item.start <= at).at(-1);
                if (!related) return;
                const q = related.question;
                validateTarget(folder.uri.fsPath, q);
                const body = new vscode.MarkdownString();
                body.appendText(`${q.id}\n${q.quote}`);
                const arg = encodeURIComponent(JSON.stringify([{repo: folder.uri.fsPath, question: q}]));
                body.appendMarkdown(`\n\n[跳转原始问题文件](command:localLatex.jumpQuestion?${arg})`);
                body.isTrusted = {enabledCommands: ['localLatex.jumpQuestion']};
                return new vscode.Hover(body);
            } catch (error) {
                return new vscode.Hover('问题关联无效：' + error.message);
            }
        }
    }));
}
module.exports = {activate, jump, links, validateTarget, notifyProblem};
