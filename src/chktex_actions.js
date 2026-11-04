'use strict';
const vscode = require('vscode');
const {explanation} = require('./chktex_messages');

// Reuse Workshop's installed fixes, rather than inventing TeX rewrites.
const nativeFixes = new Set([1, 2, 4, 5, 6, 11, 12, 13, 18, 24, 26, 28, 32, 33, 34, 35, 39, 42, 45, 46]);
const commandId = 'localLatex.chktexAction';
const quickFixId = 'localLatex.chktexQuickFix';
const operations = [['accept', '接受建议'], ['acceptAll', '接受全文此类建议'], ['line', '忽略本行警告'], ['file', '忽略全文此类警告']];
function codeOf(diagnostic) {
    const value = typeof diagnostic.code === 'object' ? diagnostic.code?.value : diagnostic.code;
    return diagnostic.source === 'ChkTeX' && /^\d+$/.test(String(value)) && Number(value) > 0 ? Number(value) : undefined;
}
function snapshot(document, diagnostic) {
    const r = diagnostic.range;
    return {uri: document.uri.toString(), version: document.version, code: codeOf(diagnostic),
        range: [r.start.line, r.start.character, r.end.line, r.end.character], message: diagnostic.message};
}
function sameRange(range, numbers) {
    return range.start.line === numbers[0] && range.start.character === numbers[1]
        && range.end.line === numbers[2] && range.end.character === numbers[3];
}
async function current(target) {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任当前本地工作区。');
    const uri = vscode.Uri.parse(target.uri);
    if (uri.scheme !== 'file') throw new Error('此操作仅适用于本地 LaTeX 文件。');
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.version !== target.version) throw new Error('文件已变化，请重新悬浮警告后操作。');
    const diagnostic = vscode.languages.getDiagnostics(uri).find(d => codeOf(d) === target.code
        && d.message === target.message && sameRange(d.range, target.range));
    if (!diagnostic) throw new Error('该警告已更新，请重新打开快速修复。');
    return {document, diagnostic};
}
function suppressionEdit(document, diagnostic, scope) {
    const code = codeOf(diagnostic);
    const edit = new vscode.WorkspaceEdit();
    if (scope === 'line') {
        const line = document.lineAt(diagnostic.range.start.line);
        // A separating space preserves TeX's ordinary end-of-line space.
        edit.insert(document.uri, line.range.end, ` % chktex ${code}`);
    } else {
        // Keep BOM and initial %!TeX editor directives in their original positions.
        let line = 0;
        while (line < document.lineCount && /^(?:\uFEFF)?%\s*!\s*TeX\b/i.test(document.lineAt(line).text)) line++;
        const first = document.lineAt(Math.min(line, document.lineCount - 1));
        const position = new vscode.Position(first.lineNumber, first.text.startsWith('\uFEFF') ? 1 : 0);
        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        edit.insert(document.uri, position, `% chktex-file ${code}${eol}`);
    }
    return edit;
}
function fixUnavailable(document, diagnostic) {
    const code = codeOf(diagnostic);
    if (!nativeFixes.has(code)) return '此类警告没有可靠的自动修复；请手动修改，或选择忽略范围。';
    if (code === 46 && !/^\$[^]*\$$/.test(document.getText(diagnostic.range))) {
        return '行内数学的完整边界不在此警告范围内，请手动修改。';
    }
    return undefined;
}
function accepting(mode) { return mode === 'accept' || mode === 'acceptAll'; }
function batchReplacements(document, diagnostic) {
    const reason = fixUnavailable(document, diagnostic);
    if (reason) throw new Error(reason);
    const range = diagnostic.range, code = codeOf(diagnostic), text = document.getText(range);
    const replace = text => [{range, text}];
    const whitespace = (shift, replacement) => {
        const position = range.end.translate(0, shift);
        const line = document.lineAt(position.line).text;
        if (position.character < 0 || position.character > line.length) throw new Error('警告位置超出当前行，请等待检查更新后重试。');
        const before = line.slice(0, position.character), spaces = /\s*$/.exec(before)[0];
        if (code === 1 && !/\\[a-zA-Z@]+\s*$/.test(before)) throw new Error('命令边界已变化，请等待检查更新后重试。');
        return [{range: new vscode.Range(position.translate(0, -spaces.length), position), text: replacement}];
    };
    // Workshop's command dispatches edits without awaiting them. Build one edit
    // from its supported transformations instead of racing many native commands.
    switch (code) {
        case 1: return whitespace(-1, '{}');
        case 2: return whitespace(0, '~');
        case 6: return whitespace(-1, '\\/');
        case 13: return whitespace(-1, '\\@');
        case 24: case 26: case 39: case 42: return whitespace(0, '');
        case 4: case 5: case 28: return replace('');
        case 11: {
            const match = /\\[cl]?dots/.exec(diagnostic.message);
            if (!match) throw new Error('此省略号警告没有明确的替换建议。');
            return replace(match[0] + ' ');
        }
        case 12: return replace('\\ ');
        case 18: case 32: case 33: case 34: {
            if (range.start.line !== range.end.line) throw new Error('跨行引号不能安全批量替换。');
            const opening = range.start.character === 0 || document.lineAt(range.start.line).text[range.start.character - 1] === ' ';
            const quote = code === 32 ? '`' : code === 33 ? "'" : opening ? '`' : "'";
            return replace(quote.repeat((code === 18 ? 2 : 1) * text.length));
        }
        case 35: {
            const match = /`(.+)'/.exec(diagnostic.message);
            if (!match) throw new Error('此警告没有明确的替换建议。');
            return replace(match[1]);
        }
        case 45: case 46: {
            const delimiter = code === 45 ? '$$' : '$';
            if (range.start.line !== range.end.line || text.length < delimiter.length * 2
                || !text.startsWith(delimiter) || !text.endsWith(delimiter)) {
                throw new Error('数学环境边界不完整，不能安全批量替换；请单独处理该处。');
            }
            return [
                {range: new vscode.Range(range.start, range.start.translate(0, delimiter.length)), text: code === 45 ? '\\[' : '\\('},
                {range: new vscode.Range(range.end.translate(0, -delimiter.length), range.end), text: code === 45 ? '\\]' : '\\)'}
            ];
        }
        default: throw new Error('此类警告没有可靠的全文自动修复。');
    }
}
function batchEdit(document, code) {
    const diagnostics = vscode.languages.getDiagnostics(document.uri).filter(d => codeOf(d) === code);
    const replacements = [];
    for (const diagnostic of diagnostics) {
        const changes = batchReplacements(document, diagnostic).filter(e => document.getText(e.range) !== e.text);
        if (!changes.length) throw new Error('至少一处警告已变化或没有可应用的替换，请重新检查后再试。');
        replacements.push(...changes);
    }
    const unique = new Map();
    for (const change of replacements) {
        const start = document.offsetAt(change.range.start), end = document.offsetAt(change.range.end);
        unique.set(JSON.stringify([start, end, change.text]), {...change, start, end});
    }
    const ordered = [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < ordered.length; i++) {
        if (ordered[i - 1].end > ordered[i].start || ordered[i - 1].start === ordered[i].start) {
            throw new Error('同类建议的修改范围重叠，未应用任何修改；请逐处处理。');
        }
    }
    const edit = new vscode.WorkspaceEdit();
    ordered.forEach(e => edit.replace(document.uri, e.range, e.text));
    return {edit, count: diagnostics.length};
}
function provideCodeActions(document, range, context) {
    if (!vscode.workspace.isTrusted || document.uri.scheme !== 'file') return [];
    const diagnostics = context.diagnostics.filter(d => codeOf(d) && d.range.intersection(range));
    const multiple = diagnostics.length > 1;
    return diagnostics.flatMap(diagnostic => operations.map(([mode, label]) => {
        const action = new vscode.CodeAction(label + (multiple ? `（ChkTeX ${codeOf(diagnostic)}）` : ''), vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.command = {command: commandId, title: label, arguments: [mode, snapshot(document, diagnostic)]};
        const reason = accepting(mode) && fixUnavailable(document, diagnostic);
        if (reason) action.disabled = {reason};
        return action;
    }));
}
function provideHover(document, position) {
    if (!vscode.workspace.isTrusted || document.uri.scheme !== 'file') return;
    const diagnostics = vscode.languages.getDiagnostics(document.uri).filter(d => codeOf(d)
        && d.range.start.line <= position.line && d.range.end.line >= position.line);
    if (!diagnostics.length) return;
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = {enabledCommands: [commandId]};
    for (const d of diagnostics) {
        // Keep direct actions even over the native squiggle; Quick Fix requires another click.
        const help = explanation(document, d, codeOf(d));
        markdown.appendText(`ChkTeX ${codeOf(d)}：${help.title}`);
        markdown.appendMarkdown('  \n');
        markdown.appendText(`原因：${help.cause}`);
        markdown.appendMarkdown('  \n');
        const reason = fixUnavailable(document, d);
        markdown.appendText(`推荐：${help.recommendation}` + (reason ? ` ${reason}` : ''));
        markdown.appendMarkdown('  \n');
        operations.forEach(([mode, label], index) => {
            if (index) markdown.appendMarkdown('　|　');
            if (accepting(mode) && reason) markdown.appendText(`${label}（不可自动修复）`);
            else {
                const args = encodeURIComponent(JSON.stringify([mode, snapshot(document, d)]));
                markdown.appendMarkdown(`[${label}](command:${commandId}?${args})`);
            }
        });
        markdown.appendMarkdown('\n\n');
    }
    return new vscode.Hover(markdown, document.lineAt(position.line).range);
}
function activate(context) {
    const report = handler => async (...args) => {
        try { return await handler(...args); }
        catch (error) { void vscode.window.showErrorMessage(`ChkTeX：${error.message}`); }
    };
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({language: 'latex', scheme: 'file'}, {provideCodeActions},
            {providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]}),
        vscode.languages.registerHoverProvider({language: 'latex', scheme: 'file'}, {provideHover}),
        vscode.commands.registerCommand(quickFixId, report(async target => {
            const {document, diagnostic} = await current(target);
            const editor = await vscode.window.showTextDocument(document, {preserveFocus: false});
            editor.selection = new vscode.Selection(diagnostic.range.start, diagnostic.range.start);
            await vscode.commands.executeCommand('editor.action.quickFix');
        })),
        vscode.commands.registerCommand(commandId, report(async (mode, target) => {
            const {document, diagnostic} = await current(target);
            if (mode === 'acceptAll') {
                const {edit, count} = batchEdit(document, codeOf(diagnostic));
                if (!await vscode.workspace.applyEdit(edit)) throw new Error('编辑器未应用全文建议，未执行后续操作。');
                void vscode.window.showInformationMessage(`已接受当前文件 ${count} 处 ChkTeX ${codeOf(diagnostic)} 建议；可用 Ctrl+Z 撤销，未保存、编译或操作 Git。`);
            } else if (mode === 'accept') {
                const reason = fixUnavailable(document, diagnostic);
                if (reason) throw new Error(reason);
                const workshop = vscode.extensions.getExtension('james-yu.latex-workshop');
                if (!workshop) throw new Error('请安装并启用 LaTeX Workshop。');
                await workshop.activate();
                // Activation is asynchronous. Check again before delegating the edit.
                await current(target);
                await vscode.commands.executeCommand('latex-workshop.code-action', document, diagnostic.range,
                    codeOf(diagnostic), diagnostic.message);
            } else if (mode === 'line' || mode === 'file') {
                if (!await vscode.workspace.applyEdit(suppressionEdit(document, diagnostic, mode))) {
                    throw new Error('未能写入忽略注释，文件未被此操作修改。');
                }
            } else throw new Error('未知的警告操作。');
            // Workshop onType checks the unsaved buffer; no save/build/Git/review acceptance here.
        }))
    );
}
module.exports = {activate};
