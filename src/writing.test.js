'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {activate} = require('./writing');
const {activate: aiSetup, buildPrompt} = require('./ai_setup');

test('actual MCP process reports its version; absent, outdated and exited reports are distinct', async () => {
    const fs = require('node:fs/promises'), path = require('node:path'), cp = require('node:child_process');
    const {once} = require('node:events'), {createInterface} = require('node:readline');
    const version = require('./mcp_version');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'mcp-runtime-'));
    const registrations = path.join(root, 'registrations'); await fs.mkdir(registrations);
    assert.equal((await version.inspect(root)).state, 'unknown');
    const child = cp.spawn(process.env.LOCAL_LATEX_PYTHON, ['-X', 'utf8', path.join(__dirname, 'mcp_server.py'), '--registrations', registrations], {windowsHide: true});
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    let stderr = ''; child.stderr.on('data', data => {stderr += data;});
    try {
        child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-03-26'}}) + '\n');
        const reply = JSON.parse((await lines.next()).value);
        assert.equal(reply.result.serverInfo.version, require('../package.json').version);
        assert.equal((await version.inspect(root)).state, 'matched');
        const old = {pid: child.pid, version: '0.0.1', server: path.join(__dirname, 'mcp_server.py')};
        await fs.writeFile(path.join(root, 'mcp-runtime.json'), JSON.stringify(old), 'utf8');
        assert.equal((await version.inspect(root)).state, 'mismatch');
        assert.equal((await version.inspect(root, () => false)).state, 'unknown');
        child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'}) + '\n');
        await lines.next();
        assert.equal((await version.inspect(root)).state, 'matched');
    } finally {
        const closed = once(child, 'close'); child.stdin.end(); await closed;
    }
    assert.equal(stderr, '');
    assert.equal((await version.inspect(root)).state, 'unknown');
});

test('hourly release checks are throttled across activation, honor disablement and keep manual checks available', async () => {
    const {activate, newer} = require('./updates');
    const state = new Map(), subscriptions = [], notices = [], errors = [];
    let callback, interval, enabled = true, requests = 0, cleared = false, failure = false, prerelease = false;
    const ctx = {subscriptions, globalState: {get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value)}};
    const vscode = {workspace: {getConfiguration: () => ({get: () => enabled})},
        commands: {registerCommand: () => ({dispose() {}})},
        window: {showInformationMessage: (text, ...actions) => {notices.push({text, actions});}, showErrorMessage: text => errors.push(text)}};
    const ui = activate(ctx, vscode, {fetchRelease: async () => {requests++; if (failure) throw Error('HTTP 429'); return {tag_name: 'v99.0.0', html_url: 'https://github.com/zlinkw/texscholar/releases/tag/v99.0.0', draft: false, prerelease};},
        setInterval: (fn, ms) => {callback = fn; interval = ms; return 1;}, clearInterval: () => {cleared = true;}});
    await ui.ready;
    assert.equal(interval, 3600000); assert.equal(requests, 1);
    assert.deepEqual(notices[0].actions, ['下载并安装', '打开发布页']);
    assert.equal(newer('v0.10.0', '0.9.31'), true); assert.equal(newer('v0.9.31', '0.9.31'), false);
    await callback(); assert.equal(requests, 1, 'no duplicate request within the hour');
    state.set('releaseCheckAt', 0); await callback(); assert.equal(requests, 2); assert.equal(notices.length, 1, 'same release notification is not repeated');
    enabled = false; state.set('releaseCheckAt', 0); await callback(); assert.equal(requests, 2);
    await ui.check(true); assert.equal(requests, 3, 'manual check works while hourly checks disabled');
    failure = true; enabled = true; state.set('releaseCheckAt', 0); await callback();
    assert.equal(errors.length, 1); assert(errors[0].includes('429'));
    await callback(); assert.equal(requests, 4, 'failed checks do not immediately retry');
    failure = false; prerelease = true; await ui.check(true); assert.equal(notices.length, 2); assert.equal(errors.length, 2);
    for (const sub of subscriptions) sub.dispose(); assert.equal(cleared, true);
});

test('update buttons verify the downloaded bytes, invoke VS Code install and offer MCP reload; failures never install', async () => {
    const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
    for (const mode of ['success', 'changed', 'download-failed', 'install-failed']) {
        const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'updater-'));
        const calls = [], errors = [], state = new Map();
        let complete; const finished = new Promise(resolve => {complete = resolve;});
        const context = {subscriptions: [], globalStorageUri: {fsPath: root}, globalState: {get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value)}};
        const vscode = {workspace: {getConfiguration: () => ({get: () => true})}, ProgressLocation: {Notification: 15}, Uri: {file: fsPath => ({fsPath})},
            window: {withProgress: async (_, fn) => fn(), showInformationMessage: async (text, ...actions) => actions.includes('下载并安装') ? '下载并安装' : '保存文件并重载 VS Code', showErrorMessage: text => {errors.push(text); complete();}},
            commands: {registerCommand: () => ({dispose() {}}), executeCommand: async (...args) => {calls.push(args); if (args[0] === 'workbench.extensions.installExtension' && mode === 'install-failed') throw Error('installer refused'); if (args[0] === 'localLatex.reloadForMCP') complete();}}};
        const ui = require('./updates').activate(context, vscode, {
            fetchRelease: async () => ({tag_name: 'v99.0.0', html_url: 'https://github.com/zlinkw/texscholar/releases/tag/v99.0.0', draft: false, prerelease: false}),
            downloadRelease: async (_, folder) => {if (mode === 'download-failed') throw Error('download failed'); const file = path.join(folder, 'pending.vsix'), raw = Buffer.from('verified fixture'); await fs.writeFile(file, mode === 'changed' ? 'changed' : raw); return {path: file, version: '99.0.0', sha256: crypto.createHash('sha256').update(raw).digest('hex')};},
            setInterval: () => 1, clearInterval: () => {}});
        await ui.ready; await finished;
        if (mode === 'success') {
            assert.deepEqual(calls.map(c => c[0]), ['workbench.extensions.installExtension', 'localLatex.reloadForMCP']);
            assert.equal(calls[0][1].fsPath, path.join(root, 'update-download', 'pending.vsix')); assert.equal(errors.length, 0);
        } else {assert.equal(errors.length, 1); assert(!calls.some(c => c[0] === 'localLatex.reloadForMCP')); if (mode !== 'install-failed') assert.equal(calls.length, 0);}
        for (const sub of context.subscriptions) sub.dispose();
    }
});
test('writing context delegates one precise source scope to the current Codex chat', async () => {
    const handlers = new Map(), calls = [], messages = [];
    const source = {scheme: 'file', fsPath: '/paper/new-paper.tex'};
    const vscode = {Uri: {file: file => ({scheme: 'file', fsPath: file})}, extensions: {onDidChange: () => ({dispose() {}})}, workspace: {onDidChangeConfiguration: () => ({dispose() {}}), isTrusted: true, findFiles: async () => [],
        getWorkspaceFolder: () => ({uri: {fsPath: '/paper'}}),
        createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}})}), onDidChangeWorkspaceFolders: () => ({dispose() {}})},
        window: {onDidChangeWindowState: () => ({dispose() {}}), activeTextEditor: {selection: {start: 0, end: 5}, document: {uri: source, languageId: 'latex', getText: () => 'First sentence.', offsetAt: x => x}},
            showInformationMessage: text => messages.push(text), showErrorMessage: text => {throw new Error(text);}},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};},
            getCommands: async () => ['chatgpt.addFileToThread'], executeCommand: async (...args) => calls.push(args)}};
    await activate({subscriptions: [], globalState: {get: (_, fallback) => fallback}}, vscode).ready;
    await handlers.get('localLatex.addWritingContext')();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'localLatex.startPaperTask');
    assert.equal(calls[0][1].keepCurrentChat, true);
    assert.deepEqual(calls[0][1].readRequest.scopes, [{file: 'new-paper.tex', quote: 'First', left: '', right: ' sentence.'}]);
});

test('selected source omits machine state, preserves Unicode and rejects dirty or ledger selections', () => {
    const {selectedScope} = require('./writing');
    const state = '% CODEX-REVIEW-STATE-BEGIN\r\n% CODEX-REVIEW-DATA private fixture\r\n% CODEX-REVIEW-STATE-END\r\n';
    const text = state + '中文😀 selected text.';
    const editor = {document: {uri: {fsPath: '/paper/main.tex'}, getText: () => text, offsetAt: x => x},
        selection: {start: state.length, end: state.length + 4}};
    const folder = {uri: {fsPath: '/paper'}};
    assert.equal(selectedScope(editor, folder).scopes[0].quote, '中文😀');
    assert(!JSON.stringify(selectedScope(editor, folder)).includes('CODEX-REVIEW-DATA'));
    editor.selection.end = editor.selection.start;
    assert.equal(selectedScope(editor, folder).scopes[0].quote, '');
    editor.selection.start = editor.selection.end = 5;
    assert.throws(() => selectedScope(editor, folder), /状态记录/);
    editor.document.isDirty = true;
    assert.throws(() => selectedScope(editor, folder), /先保存/);
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
        workspace: {isTrusted: true, workspaceFolders: [folder], textDocuments: [], saveAll: async () => true, findFiles: async () => [path.join(paper, 'paper.tex')],
            getConfiguration: () => ({get: (key, fallback) => key === 'pythonPath' ? python : fallback}),
            createFileSystemWatcher: () => ({dispose() {}, onDidCreate: () => ({dispose() {}}), onDidChange: () => ({dispose() {}}), onDidDelete: () => ({dispose() {}})}),
            onDidChangeWorkspaceFolders: () => ({dispose() {}})},
        env: {clipboard: {writeText: async text => copied.push(text)}},
        window: {showInputBox: async () => goal, showInformationMessage: text => notices.push(text),
            showWarningMessage: async text => {notices.push(text); return copyChoice;},
            showErrorMessage: text => {throw new Error(text);}},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};},
            getCommands: async () => available, executeCommand: async (...args) => calls.push(args)}};
    const context = {subscriptions: [], globalStorageUri: {fsPath: storage},
        globalState: {get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value)},
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
        const runtimeFile = path.join(storage, 'mcp-runtime.json');
        await fs.writeFile(runtimeFile, JSON.stringify({pid: process.pid, version: '0.0.1', server: path.join(__dirname, 'mcp_server.py')}), 'utf8');
        copyChoice = undefined;
        assert.equal((await handlers.get('localLatex.checkMCPVersion')(false)).state, 'mismatch');
        await Promise.resolve();
        assert.equal(copied.length, 0, 'MCP recovery uses plugin buttons, not copied prompts');
        const warned = notices.length;
        await handlers.get('localLatex.checkMCPVersion')(false);
        assert.equal(notices.length, warned, 'unchanged stale process does not repeat its notice');
        copied.length = 0; copyChoice = undefined;
        await fs.writeFile(runtimeFile, JSON.stringify({pid: process.pid, version: require('../package.json').version, server: path.join(__dirname, 'mcp_server.py')}), 'utf8');
        assert.equal((await handlers.get('localLatex.checkMCPVersion')(false)).state, 'matched');
        if (process.platform === 'win32') {
            await fs.writeFile(runtimeFile, JSON.stringify({pid: process.pid, version: require('../package.json').version, server: path.join(__dirname, 'mcp_server.py').toUpperCase()}), 'utf8');
            assert.equal((await handlers.get('localLatex.checkMCPVersion')(false)).state, 'matched', 'Windows path case must not report a false version mismatch');
        }
        calls.length = 0;
        vscode.workspace.saveAll = async () => {calls.push(['saveAll']); return false;};
        await assert.rejects(handlers.get('localLatex.reloadForMCP')(), /未保存文件/);
        assert(!calls.some(c => c[0] === 'workbench.action.reloadWindow'));
        calls.length = 0;
        vscode.workspace.saveAll = async () => {calls.push(['saveAll']); return true;};
        vscode.workspace.textDocuments = [{isDirty: true}];
        await assert.rejects(handlers.get('localLatex.reloadForMCP')(), /未保存文件/);
        assert(!calls.some(c => c[0] === 'workbench.action.reloadWindow'));
        vscode.workspace.textDocuments = [];
        calls.length = 0; await handlers.get('localLatex.reloadForMCP')();
        assert(calls.findIndex(c => c[0] === 'saveAll') < calls.findIndex(c => c[0] === 'workbench.action.reloadWindow'));
        state.set('aiSetupConfigured', true); calls.length = 0; notices.length = 0;
        goal = '修改回复信'; await start();
        const everyday = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(everyday.includes(goal)); assert(everyday.includes('A/B/C')); assert(!everyday.includes('\n40. '));
        assert(everyday.includes('rules_receipt'));
        assert(!everyday.includes('工具升级后读取同目录 source_review.py 的 --help'));
        assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), configured, 'repeat setup is idempotent');
        assert(!notices.at(-1).includes('首次连接'));
        calls.length = 0;
        const readRequest = {project: paper, scopes: [{file: 'paper.tex', quote: 'Original paper stays unchanged.'}]};
        await start({readRequest, goal: '读取当前选区', keepCurrentChat: true});
        assert(!calls.some(c => c[0] === 'chatgpt.newChat'));
        assert.equal(calls.filter(c => c[0] === 'chatgpt.addFileToThread').length, 1);
        const selected = await fs.readFile(calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
        assert(selected.includes(JSON.stringify({...readRequest, expected_plugin_version: require('../package.json').version})));
        assert(!selected.includes('\\documentclass{article}'));
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
