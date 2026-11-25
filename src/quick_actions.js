'use strict';

const GROUPS = [
    {label:'审核与批注', actions:[
        ['打开审核工作台','localLatex.reviewWorkbench'],
        ['打开论文评论','localLatex.openReviewList'],
        ['管理论文批注','localLatex.manageReviewNotes']
    ]},
    {label:'资料与设置', actions:[
        ['AI 论文助手','localLatex.startPaperTask'],
        ['当前论文背景','localLatex.paperBackground'],
        ['个人论文提示词','localLatex.personalPrompts'],
        ['检查写作环境','localLatex.checkEnvironment'],
        ['检查插件更新','localLatex.checkForUpdates']
    ]}
];

function activate(context, vscode = require('vscode')) {
    const groups = GROUPS.map(group => {
        const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Expanded);
        item.children = group.actions.map(([label, command]) => {
            const child = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            child.command = {command, title:label};
            return child;
        });
        return item;
    });
    const provider = {getTreeItem: item => item, getChildren: item => item ? item.children || [] : groups};
    const view = vscode.window.createTreeView('texscholar.quickActions', {treeDataProvider:provider});
    context.subscriptions.push(view);
    return {view, provider};
}

module.exports = {activate};
