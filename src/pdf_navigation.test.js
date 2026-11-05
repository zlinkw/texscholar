'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseSync, reviewPath} = require('./pdf_navigation');
test('floating PDF opening shares the source workbench and refuses to move an unrelated editor', async () => {
    const fs = require('node:fs/promises'), path = require('node:path');
    const {openFloating} = require('./pdf_navigation');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'floating-pdf-'));
    const file = path.join(root, 'review.pdf'); await fs.writeFile(file, 'isolated PDF fixture', 'utf8');
    const uri = {scheme: 'file', fsPath: file}, group = {tabs: [], viewColumn: 2}, calls = [];
    let supported = true, activate = true;
    const vscode = {workspace: {isTrusted: true}, ViewColumn: {Beside: -2}, window: {tabGroups: {all: [group], activeTabGroup: group}},
        commands: {getCommands: async () => supported ? ['workbench.action.moveEditorToNewWindow'] : [],
            executeCommand: async (...args) => {calls.push(args); if (args[0] === 'vscode.openWith' && activate) {
                const tab = {input: {uri}, group}; group.tabs.push(tab); group.activeTab = tab;
            }}}};
    supported = false; await assert.rejects(openFloating(vscode, uri), /不支持浮动/); assert.equal(calls.length, 0);
    supported = true; activate = false;
    group.activeTab = {input: {uri: {scheme: 'file', fsPath: path.join(root, 'main.tex')}}};
    await assert.rejects(openFloating(vscode, uri), /未移动其他/);
    assert(!calls.some(x => x[0] === 'workbench.action.moveEditorToNewWindow'));
    activate = true; await openFloating(vscode, uri);
    assert.equal(calls.filter(x => x[0] === 'workbench.action.moveEditorToNewWindow').length, 1);
    await openFloating(vscode, uri);
    assert.equal(calls.filter(x => x[0] === 'workbench.action.moveEditorToNewWindow').length, 1, 'reopening focuses an existing PDF, not another window');
    assert.equal(calls.at(-1)[3].viewColumn, 2);
    await openFloating(vscode, uri, true);
    assert.equal(calls.filter(x => x[0] === 'workbench.action.moveEditorToNewWindow').length, 2, 'explicit detach also moves a PDF already open in the source workbench');
});
test('two PDF tabs route review snapshots and normal replies to the original source window', async () => {
    const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
    const {activate, handleSourceUri, sourcePosition} = require('./pdf_navigation');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'two-pdf-'));
    const manuscript = path.join(root, 'main.tex'), reply = path.join(root, 'reply.tex');
    const text = '% CODEX-REVIEW-STATE-BEGIN\n% disposable state\n% CODEX-REVIEW-STATE-END\nFirst sentence.\nTarget sentence.\n';
    await fs.writeFile(manuscript, text, 'utf8'); await fs.writeFile(reply, 'Reply opening.\nReply target.\n', 'utf8');
    const sourceContext = {extension: {id: 'local-research.latex-writing-tools'}, subscriptions: []};
    const viewerContext = {extension: sourceContext.extension, subscriptions: []};
    class URI {
        constructor(value) {const u = new URL(value); this.value = value; this.scheme = u.protocol.slice(0, -1); this.authority = u.host; this.path = u.pathname; this.query = u.search.slice(1);}
        with({query}) {const u = new URL(this.value); u.search = query; return new URI(u.toString());}
        toString() {return this.value;}
    }
    const uri = file => ({scheme: 'file', fsPath: file});
    const disposable = () => ({dispose() {}});
    const targets = [], closed = [], errors = [], external = [];
    function host(name, workspaceFolders) {
        const handlers = {}, tabs = [], group = {tabs, viewColumn: 1};
        const vscode = {Uri: {parse: value => new URI(value), file: uri}, RelativePattern: class {},
            Position: class {constructor(line, character) {Object.assign(this, {line, character});}},
            Selection: class {constructor(active) {this.active = active;}}, Range: class {}, ViewColumn: {One: 1}, TextEditorRevealType: {InCenterIfOutsideViewport: 1},
            TextEditorSelectionChangeKind: {Mouse: 2, Keyboard: 1, Command: 3},
            env: {uriScheme: 'vscode', asExternalUri: async value => value.with({query: value.query + '&windowId=' + name}),
                openExternal: async value => {external.push(value); await handleSourceUri(sourceVS, sourceContext, value); return true;}},
            workspace: {isTrusted: true, workspaceFolders, findFiles: async () => [uri(manuscript)], openTextDocument: async value => {
                const valueText = await fs.readFile(value.fsPath, 'utf8');
                return {uri: value, isDirty: false, lineCount: valueText.split('\n').length, getText: () => valueText,
                    positionAt: offset => ({line: valueText.slice(0, offset).split('\n').length - 1, character: 0})};}},
            window: {tabGroups: {all: [group], activeTabGroup: group, onDidChangeTabs: fn => {handlers.tabs = fn; return disposable();},
                onDidChangeTabGroups: fn => {handlers.groups = fn; return disposable();}, close: async tab => {closed.push(tab); tabs.splice(tabs.indexOf(tab), 1); return true;}},
                onDidChangeTextEditorSelection: fn => {handlers.selection = fn; return disposable();}, showErrorMessage: value => errors.push(value),
                showTextDocument: async (document, options) => {const editor = {document, revealRange() {}}; targets.push({document, options, editor}); return editor;}}};
        return {vscode, handlers, group};
    }
    const source = host('source', [{uri: uri(root)}]), sourceVS = source.vscode;
    await activate(sourceContext, sourceVS).ready;
    const folder = path.join(root, '.latex-build', 'review-diff', 'current'); await fs.mkdir(folder, {recursive: true});
    const pdf = path.join(folder, 'main-review.pdf'), normalPDF = path.join(root, 'reply.pdf'), snapshot = path.join(root, '.latex-build', 'snapshot.tex');
    await fs.writeFile(pdf, 'synthetic PDF bytes', 'utf8');
    const sourceDigest = crypto.createHash('sha256').update('First sentence.\nTarget sentence.\n').digest('hex');
    await fs.writeFile(pdf.replace('.pdf', '.json'), JSON.stringify({pdf, pdf_digest: crypto.createHash('sha256').update(await fs.readFile(pdf)).digest('hex'),
        reverse: {[snapshot]: {file: manuscript, source_digest: sourceDigest, lines: [1, 2]}}}), 'utf8');
    const viewer = host('viewer', []), {vscode, handlers, group} = viewer;
    const reviewTab = {input: {uri: uri(pdf)}, group}, replyTab = {input: {uri: uri(normalPDF)}, group};
    group.tabs.push(reviewTab, replyTab); group.activeTab = reviewTab;
    await activate(viewerContext, vscode).ready;
    async function reverse(file, line, dirty = false) {
        const document = {uri: uri(file), isDirty: dirty};
        const editor = {document, selection: {active: {line, character: 0}}};
        const tab = {input: {uri: uri(file)}, group}; group.tabs.push(tab);
        handlers.tabs({opened: [tab], closed: [], changed: []});
        vscode.window.activeTextEditor = editor;
        await handlers.selection({textEditor: editor, kind: 3});
        return tab;
    }
    const first = await reverse(snapshot, 1);
    assert.equal(targets.at(-1).document.uri.fsPath, manuscript);
    assert.equal(targets.at(-1).editor.selection.active.line, 4, 'machine state lines are restored to the live source coordinate');
    assert(closed.includes(first));
    group.activeTab = replyTab; handlers.tabs({opened: [], closed: [], changed: [replyTab]});
    const second = await reverse(reply, 1);
    assert.equal(targets.at(-1).document.uri.fsPath, reply); assert.equal(targets.at(-1).editor.selection.active.line, 1);
    assert(closed.includes(second));
    const dirty = await reverse(reply, 0, true); assert(!closed.includes(dirty), 'never close an edited source tab');
    assert(external.every(value => new URLSearchParams(value.query).get('windowId') === 'source'));
    assert.deepEqual(errors, []);
    const localPDF = {input: {uri: uri(pdf)}, group: source.group};
    source.group.tabs.push(localPDF); source.group.activeTab = localPDF;
    source.handlers.tabs({opened: [localPDF], closed: [], changed: []});
    const localEditor = {document: {uri: uri(snapshot), isDirty: false}, selection: {active: {line: 1, character: 0}}};
    sourceVS.window.activeTextEditor = localEditor;
    const calls = external.length;
    await source.handlers.selection({textEditor: localEditor, kind: 3});
    assert.equal(targets.at(-1).document.uri.fsPath, manuscript);
    assert.equal(external.length, calls, 'review PDF in its source window maps locally without opening another window');
    const stale = text.replace('Target sentence.', 'Manual edit.');
    assert.throws(() => sourcePosition(stale, 2, sourceDigest), /源码已/);
    const shifted = text.replace('% disposable state', '% longer state\n% another record');
    assert.equal(shifted.slice(sourcePosition(shifted, 2, sourceDigest)), 'Target sentence.\n');
    const bad = external[0].with({query: external[0].query.replace(/token=[^&]+/, 'token=wrong')});
    await assert.rejects(handleSourceUri(sourceVS, sourceContext, bad), /不属于本窗口/);
    assert.equal(await fs.readFile(manuscript, 'utf8'), text);
});
test('review navigation uses actual SyncTeX coordinates and recognizes only stable review PDFs', () => {
    assert.deepEqual(parseSync('SyncTeX result begin\nPage:3\nx:123.5\ny:245.25\nSyncTeX result end'),
        {page: 3, x: 123.5, y: 245.25, indicator: true});
    assert.throws(() => parseSync('No result'), /SyncTeX/);
    assert.throws(() => parseSync('SyncTeX result begin\nPage:NaN\nx:0\ny:0\nSyncTeX result end'), /坐标/);
    assert(reviewPath('/paper/.latex-build/review-diff/current/main-review.pdf'));
    assert(reviewPath('D:\\paper\\.latex-build\\review-diff\\current\\reply-review.pdf'));
    assert(!reviewPath('/paper/main.pdf'));
    assert(!reviewPath('/paper/.latex-build/review-diff/old.pdf'));
});
test('navigation refuses stale PDF bytes and untrusted callback addresses before launching any viewer', async () => {
    const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
    const {locate} = require('./pdf_navigation');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'navigation-'));
    const folder = path.join(root, '.latex-build', 'review-diff', 'current');
    await fs.mkdir(folder, {recursive: true});
    const pdf = path.join(folder, 'main-review.pdf'), metaFile = path.join(folder, 'main-review.json');
    await fs.writeFile(pdf, 'isolated version fixture', 'utf8');
    const metadata = {pdf, compiled_pdf: pdf, targets: {'1': {file: path.join(root, 'derived.tex'), line: 1}}, versions: {'1': 'v1'}, pdf_digest: 'stale'};
    await fs.writeFile(metaFile, JSON.stringify(metadata), 'utf8');
    const vscode = {env: {uriScheme: 'vscode'}, Uri: {parse: value => {const u = new URL(value); return {scheme: u.protocol.slice(0, -1), authority: u.host, path: u.pathname};}}};
    const context = {extension: {id: 'local-research.latex-writing-tools'}}, c = {repo: root, id: '1', version: 'v1'};
    await assert.rejects(locate(vscode, context, metaFile, c), /版本不一致/);
    metadata.pdf_digest = crypto.createHash('sha256').update(await fs.readFile(pdf)).digest('hex');
    await fs.writeFile(metaFile, JSON.stringify(metadata), 'utf8');
    await fs.writeFile(metaFile.replace('.json', '.viewer.json'), JSON.stringify({pdf, viewer_uri: 'https://example.invalid/command'}), 'utf8');
    await assert.rejects(locate(vscode, context, metaFile, c), /地址无效/);
});
