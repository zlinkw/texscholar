'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {activate} = require('./writing');
const {activate: aiSetup, buildPrompt} = require('./ai_setup');
test('writing context uses installed guide and current source, adds both to Codex without sending or creating files', async () => {
    const handlers = new Map(), calls = [], messages = [];
    const source = {scheme: 'file', fsPath: '/paper/new-paper.tex'};
    const vscode = {Uri: {file: file => ({scheme: 'file', fsPath: file})}, extensions: {onDidChange: () => ({dispose() {}})}, workspace: {onDidChangeConfiguration: () => ({dispose() {}}), isTrusted: true, findFiles: async () => [],
        createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}})}), onDidChangeWorkspaceFolders: () => ({dispose() {}})},
        window: {onDidChangeWindowState: () => ({dispose() {}}), activeTextEditor: {document: {uri: source, languageId: 'latex'}},
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
    assert(!rows.some(row => row.key.startsWith('bookmarks.')));
    assert(rows.some(row => row.key.startsWith('todo-tree.')));
});

test('configuration status is event-driven, readonly and cannot be acknowledged into success', async () => {
    const handlers = new Map(), notices = [], events = [];
    let tex = true, scans = 0;
    const context = {subscriptions: [], globalState: {get: () => true}};
    const event = cb => {events.push(cb); return {dispose() {}};};
    const vscode = {commands: {registerCommand: (id, fn) => {handlers.set(id,fn); return {dispose() {}};}, getCommands: async () => []},
        extensions: {getExtension: () => undefined, onDidChange: event},
        workspace: {isTrusted: true, findFiles: async () => {scans++; return tex ? ['paper.tex'] : []}, getConfiguration: () => ({get: key => key === 'pythonPath' ? '/missing-python-for-test' : undefined}),
            onDidChangeConfiguration: event, onDidChangeWorkspaceFolders: event,
            createFileSystemWatcher: () => ({dispose() {}, onDidCreate: event})},
        window: {onDidChangeWindowState: event, showInformationMessage: async (text,...buttons) => {notices.push({text,buttons});}, showErrorMessage: text => {throw Error(text);}}};
    await aiSetup(context,vscode).ready;
    assert.equal(require('./ai_setup').status().ready,false);
    assert(notices[0].text.includes('配置不完整')); assert(!notices[0].buttons.includes('已配置，不再提示'));
    const scansBefore = scans; await events[0]({scheme: 'file', fsPath: '/paper/.latex-build/review/main.tex'});
    assert.equal(scans, scansBefore, 'generated TeX never starts configuration scans');
    const count = notices.length; await events[0]({scheme: 'file', fsPath: '/paper/main.tex'}); assert.equal(notices.length,count,'unchanged missing items do not repeat notifications');
    await handlers.get('localLatex.checkAIConfiguration')(); assert.equal(notices.length,count+1);
    tex=false; await events[0]({scheme: 'file', fsPath: '/paper/main.tex'}); assert.equal(notices.length,count+1,'non-TeX projects do not check');
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
    const vscode = {extensions: {getExtension: () => ({}), onDidChange: () => ({dispose() {}})}, Uri: {file: fsPath => ({scheme: 'file', fsPath})}, RelativePattern: class {},
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
        assert(initial.includes(goal)); assert(initial.includes('read_context')); assert(!initial.includes('\n40. '), 'first writing task is not a machine migration');
        assert(initial.includes('插件版本：' + require('../package.json').version));
        assert(initial.includes('expected_plugin_version'));
        assert(!initial.includes('# TeXScholar 当前任务协作协议：'), 'MCP provides the actual applicable protocol once');
        assert(initial.includes('known_rules')); assert(initial.includes('ids'));
        assert(notices.at(-1).includes('首次连接需重启 Codex'));
        const configured = await fs.readFile(path.join(home, 'config.toml'), 'utf8');
        assert(configured.includes(unrelated.trim())); assert(configured.includes('[mcp_servers.texscholar]'));
        state.set('aiSetupConfigured', true); calls.length = 0; notices.length = 0;
        goal = '修改回复信'; await start();
        const everyday = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(everyday.includes(goal)); assert(everyday.includes('A/B/C')); assert(!everyday.includes('\n40. '));
        assert(everyday.includes('rules_receipt'));
        assert(!everyday.includes('工具升级后读取同目录 source_review.py 的 --help'));
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), configured, 'repeat setup is idempotent');
        assert(!notices.at(-1).includes('首次连接'));
        available = []; calls.length = 0; copyChoice = '复制完整任务说明'; await start();
        assert.equal(copied.length, 1); assert(copied[0].includes(goal)); assert(copied[0].includes('A/B/C'));
        assert.equal(calls.length, 0, 'no unavailable command or automatic sending');
        available = ['chatgpt.addFileToThread']; python = path.join(root, 'missing-python');
        await start();
        const repair = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(repair.includes('MCP 尚未连接成功')); assert(!repair.includes('\n40. '), 'connection repair does not request unrelated compiler installation');
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), configured, 'connection failure preserves configuration');
        calls.length = 0; python = process.env.LOCAL_LATEX_PYTHON;
        goal = '配置新电脑'; await start({setup: true});
        const setup = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(setup.includes('\n40. '), 'explicit setup retains all approved migration groups');
        assert.equal(await fs.readFile(path.join(paper, 'paper.tex'), 'utf8'), source);
        assert(!calls.some(c => /send|submit/i.test(c[0])));
    } finally {
        if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    }
});

test('missing compiler tools do not make a configured writing connection unavailable', async () => {
    const tools = require('./tools'), backup = require('./backup');
    const fs = require('node:fs/promises'), path = require('node:path');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'capabilities-'));
    await fs.mkdir(path.join(root, 'mcp-workspaces'));
    await fs.writeFile(path.join(root, 'mcp-workspaces', 'test.json'), JSON.stringify({roots: [root]}), 'utf8');
    await fs.writeFile(path.join(root, 'texscholar-mcp.py'), '# test launcher', 'utf8');
    const saved = {discover: tools.discover, searchDirectories: tools.searchDirectories, findExecutable: tools.findExecutable, version: tools.version, run: backup.run};
    try {
        tools.discover = () => ({found: {pythonPath: process.env.LOCAL_LATEX_PYTHON}});
        tools.searchDirectories = () => []; tools.findExecutable = () => undefined;
        tools.version = async () => 'Python 3.14.0'; backup.run = async () => JSON.stringify({connected: true});
        const vscode = {RelativePattern: class {}, extensions: {getExtension: () => ({})},
            commands: {getCommands: async () => ['chatgpt.addFileToThread']}, workspace: {
                getConfiguration: () => ({get: () => undefined}), findFiles: async () => ['paper.tex'],
                workspaceFolders: [{uri: {scheme: 'file', fsPath: root}}]}};
        const result = await require('./ai_setup').inspectConfiguration({globalStorageUri: {fsPath: root}, workspaceState: {get: () => 'test'}}, vscode);
        assert.equal(result.ready, false);
        assert.equal(result.writingReady, true);
        assert.deepEqual(result.writingIssues, []);
        assert(result.compileIssues.some(issue => issue.includes('SyncTeX')));
    } finally {
        Object.assign(tools, {discover: saved.discover, searchDirectories: saved.searchDirectories, findExecutable: saved.findExecutable, version: saved.version});
        backup.run = saved.run;
    }
});
