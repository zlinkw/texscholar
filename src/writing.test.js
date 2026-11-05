'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {activate} = require('./writing');
const {activate: aiSetup, buildPrompt} = require('./ai_setup');
test('writing context uses installed guide and current source, adds both to Codex without sending or creating files', async () => {
    const handlers = new Map(), calls = [], messages = [];
    const source = {scheme: 'file', fsPath: '/paper/new-paper.tex'};
    const vscode = {Uri: {file: file => ({scheme: 'file', fsPath: file})}, workspace: {isTrusted: true, findFiles: async () => [],
        createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}})}), onDidChangeWorkspaceFolders: () => ({dispose() {}})},
        window: {activeTextEditor: {document: {uri: source, languageId: 'latex'}},
            showInformationMessage: text => messages.push(text), showErrorMessage: text => {throw new Error(text);}},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};},
            getCommands: async () => ['chatgpt.addFileToThread'], executeCommand: async (...args) => calls.push(args)}};
    await activate({subscriptions: [], globalState: {get: (_, fallback) => fallback}}, vscode).ready;
    await handlers.get('localLatex.addWritingContext')();
    assert.equal(calls.length, 2);
    assert(calls.every(x => x[0] === 'chatgpt.addFileToThread'));
    assert(calls[0][1].fsPath.endsWith('writing-guide.md'));
    assert.equal(calls[1][1], source);
    assert(messages[0].includes('自行发送'));
});

test('AI setup prompt is portable, complete and reuses one configuration/shortcut authority', async () => {
    const prompt = await buildPrompt();
    assert(prompt.includes('全局 SKILL'));
    assert(prompt.includes('先检测系统'));
    assert(prompt.includes('不是让我反复手动安装技能的教程'));
    for (let n = 1; n <= 40; n++) assert(prompt.includes('\n' + n + '. '), 'missing approved migration group ' + n);
    assert(!/[CD]:[\\/]/.test(prompt), 'no author machine paths or executable locations');
    assert(!prompt.includes('127.0.0.1:7897'));
    assert(prompt.includes('不自动发送'));
    assert(prompt.includes('discard_annotations'));
    const translation = require('../package.json').contributes.configuration.properties;
    assert.equal(translation['localLatex.translation.provider'].default, 'bing');
    assert.equal(translation['localLatex.translation.autoTranslate'].default, true);
    assert(prompt.includes('默认来源 Bing'));
    const rows = [...require('./writing-presets.json').settings, ...require('./setup').bindings({})];
    const keys = rows.map(row => (row.language || '') + ':' + row.key);
    assert.equal(new Set(keys).size, keys.length, 'one definition per setting and language');
});

test('project onboarding is nonblocking, respects explicit acknowledgement and can be restored', async () => {
    const state = new Map(), handlers = new Map(), notices = [], copied = [];
    let tex = true, choice, changed;
    const context = {subscriptions: [], globalState: {get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value)}};
    const vscode = {env: {clipboard: {writeText: async text => copied.push(text)}}, commands: {
        registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};}},
        workspace: {isTrusted: true, findFiles: async () => tex ? ['paper.tex'] : [],
            createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}})}),
            onDidChangeWorkspaceFolders: callback => {changed = callback; return {dispose() {}};}},
        window: {showInformationMessage: async (text, ...buttons) => {notices.push({text, buttons}); return buttons.length ? choice : undefined;},
            showErrorMessage: text => {throw new Error(text);}}};
    await aiSetup(context, vscode).ready;
    assert.equal(notices.length, 1);
    assert.equal(state.size, 0, 'opening a project does not claim AI configuration is complete');
    await handlers.get('localLatex.copyAISetupPrompt')();
    assert.equal(copied.length, 1);
    assert.equal(state.size, 0, 'copying is not acknowledgement');
    choice = '已配置，不再提示';
    await aiSetup(context, vscode).ready;
    assert.equal(state.get('aiSetupConfigured'), true);
    const before = notices.length;
    await aiSetup(context, vscode).ready;
    assert.equal(notices.length, before, 'acknowledgement persists across projects/restarts in the same profile');
    choice = '重新启用项目提示';
    await handlers.get('localLatex.aiSetupGuide')();
    assert.equal(state.get('aiSetupConfigured'), false);
    tex = false;
    const noTex = notices.length;
    await aiSetup(context, vscode).ready;
    assert.equal(notices.length, noTex, 'code-only and Typst workspaces do not prompt');
    tex = true; vscode.workspace.isTrusted = false;
    changed(); await Promise.resolve();
    assert.equal(notices.length, noTex, 'untrusted projects do not trigger onboarding');
    vscode.workspace.isTrusted = true;
    vscode.window.showInformationMessage = () => new Promise(() => {});
    await aiSetup(context, vscode).ready;
    assert(true, 'activation does not await notification dismissal');
});
