'use strict';
const path = require('node:path');
function activate(context, vscode = require('vscode')) {
    const onboarding = require('./ai_setup').activate(context, vscode);
    const guide = vscode.Uri.file(path.join(__dirname, 'writing-guide.md'));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.openWritingGuide', async () =>
        vscode.commands.executeCommand('markdown.showPreview', guide)));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.addWritingContext', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!vscode.workspace.isTrusted || !editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex')
                throw new Error('请先打开受信任的本地 LaTeX 正文或回复信。');
            if (!(await vscode.commands.getCommands(true)).includes('chatgpt.addFileToThread'))
                throw new Error('未找到 Codex 的添加上下文入口；可先打开内置写作指南，不会启动其他 AI。');
            await vscode.commands.executeCommand('chatgpt.addFileToThread', guide);
            await vscode.commands.executeCommand('chatgpt.addFileToThread', editor.document.uri);
            vscode.window.showInformationMessage('写作规则与当前源文件已加入 Codex 输入区；请说明写作目标后自行发送。没有生成论文文件或自动接收修改。');
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
module.exports = {activate};
