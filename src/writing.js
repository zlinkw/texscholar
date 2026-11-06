'use strict';
const path = require('node:path');
function selectedScope(editor, folder) {
    if (editor.document.isDirty) throw new Error('请先保存当前 LaTeX 文件，再添加写作上下文；未自动保存或编译。');
    const source = require('./review_positions').view(editor.document.getText());
    if (!source) throw new Error('审核状态注释边界异常，请先核对。');
    let start = editor.document.offsetAt(editor.selection.start), end = editor.document.offsetAt(editor.selection.end);
    if (source.start !== undefined) {
        if (start === end ? start >= source.start && start < source.end : start < source.end && end > source.start)
            throw new Error('请选择正文位置；审核状态记录不作为写作上下文。');
        if (start >= source.end) start -= source.end - source.start;
        if (end >= source.end) end -= source.end - source.start;
    }
    const file = path.relative(folder.uri.fsPath, editor.document.uri.fsPath);
    if (!file || path.isAbsolute(file) || file.split(path.sep).includes('..')) throw new Error('当前文件不在所选论文工作区内。');
    return {project: folder.uri.fsPath, scopes: [{file: file.split(path.sep).join('/'), quote: source.body.slice(start, end),
        left: source.body.slice(Math.max(0, start - 120), start), right: source.body.slice(end, end + 120)}]};
}
function activate(context, vscode = require('vscode')) {
    const onboarding = require('./ai_setup').activate(context, vscode);
    const guide = vscode.Uri.file(path.join(__dirname, 'writing-guide.md'));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.openWritingGuide', async () =>
        vscode.commands.executeCommand('markdown.showPreview', guide)));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.copyReviewContract', async () => {
        await vscode.env.clipboard.writeText(await require('node:fs/promises').readFile(path.join(__dirname, 'collaboration-guide.md'), 'utf8'));
        vscode.window.showInformationMessage('已复制本次 AI 三方案协作协议，不要求改全局 SKILL；请粘贴到论文会话。');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.addWritingContext', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex')
                throw new Error('请先打开受信任的本地 LaTeX 正文或回复信。');
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!folder) throw new Error('请先将当前 LaTeX 文件所在项目作为工作区打开。');
            await vscode.commands.executeCommand('localLatex.startPaperTask', {readRequest: selectedScope(editor, folder),
                keepCurrentChat: true, goal: '读取指定选区或光标位置及其必要上下文，按我随后提供的目标工作；仅添加上下文不授权改写。'});
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.interfaceGuide', async () => {
        const picked = await vscode.window.showQuickPick(['查看完整安装与界面说明', '打开章节目录树', '配置 VS Code 显示语言'],
            {placeHolder: '原生布局和显示语言通过官方界面处理，不写内部数据库'});
        if (picked === '配置 VS Code 显示语言') await vscode.commands.executeCommand('workbench.action.configureLocale');
        else if (picked === '打开章节目录树') {
            if (!(await vscode.commands.getCommands(true)).includes('latex-workshop-structure.focus'))
                return vscode.window.showInformationMessage('请先打开 .tex 文件以启用 Workshop 章节树。');
            await vscode.commands.executeCommand('latex-workshop-structure.focus');
            vscode.window.showInformationMessage('需要与文件树放在一起时，可在章节树标题右键“移动视图”至资源管理器；这是原生布局状态，不改论文。');
        } else if (picked) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(__dirname, '..', 'README.md')));
    }));
    return onboarding;
}
module.exports = {activate, selectedScope};
