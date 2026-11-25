'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {activate} = require('./quick_actions');

test('activity bar actions route to registered features while keeping the existing panel', () => {
    const views = new Map(), context = {subscriptions:[]};
    const vscode = {TreeItem:class {constructor(label, state) {this.label=label; this.collapsibleState=state;}},
        TreeItemCollapsibleState:{None:0,Expanded:2}, window:{createTreeView(id, options) {
            assert(!views.has(id)); views.set(id,options.treeDataProvider); return {dispose() {}};
        }}};
    const result = activate(context, vscode);
    assert.equal(views.get('texscholar.quickActions'),result.provider);
    const actions = result.provider.getChildren().flatMap(group=>result.provider.getChildren(group));
    assert.deepEqual(actions.map(item=>item.command.command), ['localLatex.reviewWorkbench','localLatex.openReviewList',
        'localLatex.manageReviewNotes','localLatex.startPaperTask','localLatex.paperBackground','localLatex.personalPrompts',
        'localLatex.checkEnvironment','localLatex.checkForUpdates']);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
    assert(pkg.contributes.viewsContainers.activitybar.some(view=>view.id==='texscholarTools'));
    assert(pkg.contributes.views.texscholarTools.some(view=>view.id==='texscholar.quickActions' && !view.when));
    assert(pkg.contributes.viewsContainers.panel.some(view=>view.id==='texscholarReviews'));
    assert(pkg.contributes.views.texscholarReviews.some(view=>view.id==='texscholar.reviewList'));
    const declared = new Set(pkg.contributes.commands.map(row=>row.command));
    for (const item of actions) if (item.command.command!=='localLatex.openReviewList') assert(declared.has(item.command.command));
});
