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
    assert.equal(calls.length, 3);
    assert(calls.every(x => x[0] === 'chatgpt.addFileToThread'));
    assert(calls[0][1].fsPath.endsWith('writing-guide.md'));
    assert(calls[1][1].fsPath.endsWith('collaboration-guide.md'));
    assert.equal(calls[2][1], source);
    assert(messages[0].includes('自行发送'));
});

test('AI setup prompt is portable, complete and reuses one configuration/shortcut authority', async () => {
    const prompt = await buildPrompt();
    assert(prompt.includes('全局 SKILL'));
    assert(prompt.includes('不要修改或安装全局 SKILL'));
    assert(prompt.includes('propose-options'));
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
    assert(notices[0].buttons.includes('AI 论文助手'));
    assert(!notices[0].buttons.includes('一键复制提示词'));
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

test('one AI assistant prepares one packet, connects safely, respects cancellation and keeps setup optional', async () => {
    const fs = require('node:fs/promises'), path = require('node:path');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'assistant-'));
    const home = path.join(root, 'codex-home'), paper = path.join(root, 'paper'), storage = path.join(root, 'storage');
    await fs.mkdir(home); await fs.mkdir(paper);
    const source = '\\documentclass{article}\nOriginal paper stays unchanged.\n';
    await fs.writeFile(path.join(paper, 'paper.tex'), source, 'utf8');
    const unrelated = 'model = "keep-author-model"\n[mcp_servers.other]\ncommand = "keep-service"\n';
    await fs.writeFile(path.join(home, 'config.toml'), unrelated, 'utf8');
    const previousHome = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
    const handlers = new Map(), state = new Map(), workspaceState = new Map(), calls = [], notices = [], copied = [];
    let goal, available = ['chatgpt.newChat', 'chatgpt.addFileToThread'], copyChoice, python = process.env.LOCAL_LATEX_PYTHON;
    const folder = {uri: {scheme: 'file', fsPath: paper}};
    const vscode = {Uri: {file: fsPath => ({scheme: 'file', fsPath})}, RelativePattern: class {},
        workspace: {isTrusted: true, workspaceFolders: [folder], findFiles: async () => [path.join(paper, 'paper.tex')],
            getConfiguration: () => ({get: (key, fallback) => key === 'pythonPath' ? python : fallback}),
            createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}})}),
            onDidChangeWorkspaceFolders: () => ({dispose() {}})},
        env: {clipboard: {writeText: async text => copied.push(text)}},
        window: {showInputBox: async () => goal, showInformationMessage: text => notices.push(text),
            showWarningMessage: async text => {notices.push(text); return copyChoice;},
            showErrorMessage: text => {throw new Error(text);}},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};},
            getCommands: async () => available, executeCommand: async (...args) => calls.push(args)}};
    const context = {subscriptions: [], globalStorageUri: {fsPath: storage},
        globalState: {get: (key, fallback) => state.get(key) ?? fallback},
        workspaceState: {get: key => workspaceState.get(key), update: async (key, value) => workspaceState.set(key, value)}};
    try {
        await require('./mcp_setup').activate(context, vscode).ready;
        const start = handlers.get('localLatex.startPaperTask');
        await start();
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), unrelated, 'cancel before connecting');
        assert.equal(calls.length, 0);
        goal = '完善引言，保留证据'; await start();
        const attachments = calls.filter(c => c[0] === 'chatgpt.addFileToThread');
        assert.equal(attachments.length, 1, 'task and rules are a single attachment');
        const initial = await fs.readFile(attachments[0][1].fsPath, 'utf8');
        assert(initial.includes(goal)); assert(initial.includes('read_context')); assert(initial.includes('\n40. '));
        assert.equal(initial.split('# TeXScholar 当前任务协作协议：').length, 2, 'protocol appears only once');
        assert(notices.at(-1).includes('首次连接需重启 Codex'));
        const configured = await fs.readFile(path.join(home, 'config.toml'), 'utf8');
        assert(configured.includes(unrelated.trim())); assert(configured.includes('[mcp_servers.texscholar]'));
        state.set('aiSetupConfigured', true); calls.length = 0; notices.length = 0;
        goal = '修改回复信'; await start();
        const everyday = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(everyday.includes(goal)); assert(everyday.includes('A/B/C')); assert(!everyday.includes('\n40. '));
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), configured, 'repeat setup is idempotent');
        assert(!notices.at(-1).includes('首次连接'));
        available = []; calls.length = 0; copyChoice = '复制完整任务说明'; await start();
        assert.equal(copied.length, 1); assert(copied[0].includes(goal)); assert(copied[0].includes('A/B/C'));
        assert.equal(calls.length, 0, 'no unavailable command or automatic sending');
        available = ['chatgpt.addFileToThread']; python = path.join(root, 'missing-python');
        await start();
        const repair = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(repair.includes('MCP 尚未连接成功')); assert(repair.includes('\n40. '));
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), configured, 'connection failure preserves configuration');
        assert.equal(await fs.readFile(path.join(paper, 'paper.tex'), 'utf8'), source);
        assert(!calls.some(c => /send|submit/i.test(c[0])));
    } finally {
        if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    }
});
