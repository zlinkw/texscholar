'use strict';
// Host boundary for the bottom ID list and the single review page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createInlineReview, markedWords, displayText, summary, deletionPreview} = require('./inline_review');
const disposable = () => ({dispose() {}});
const fileWatcher = () => ({dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable});
const {view, locateDisplay} = require('./review_positions');

function hostFixture({tex = true, state = true, autoPDF = true} = {}) {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'review-list-'));
    const file = path.join(root, tex ? 'paper.tex' : 'main.js'), owner = path.join(root, 'reply.tex');
    let value = tex ? '\\documentclass{article}\n😀 First sentence. Second sentence.' : 'const x = 1;';
    fs.writeFileSync(file, value, 'utf8');
    if (state) fs.writeFileSync(owner, '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA fixture\n% CODEX-REVIEW-STATE-END', 'utf8');
    const calls = [], notices = [], backendCalls = [], handlers = new Map(), packets = [], trees = [];
    let receive, panels = 0, provider, fileChanged, configurationChanged, selectionHandler;
    const original = value, edit = {file: path.basename(file), kind: 'manuscript', deferred: true, status: 'pending', versions: ['v1'], requests: [], questions: []};
    const start = Array.from(original.slice(0, original.indexOf('First'))).length;
    const data = {version: 'v1', edit, original: 'First sentence.', candidate: 'Better sentence.', options: [
        {label: 'A', after: 'Better sentence.', reason: 'Direct', changes: []},
        {label: 'B', after: 'Clearer sentence.', reason: 'Precise', changes: []},
        {label: 'C', after: 'Short sentence.', reason: 'Short', changes: []}],
        source_match: true, source: {text: original, start, end: start + 15, side: 'original'}, changes: [], sha256: 'fresh'};
    class Range {constructor(start, end) {Object.assign(this, {start, end});}}
    const uri = p => ({scheme: 'file', fsPath: p});
    const document = {uri: uri(file), languageId: tex ? 'latex' : 'javascript', isDirty: false,
        getText: r => r ? value.slice(r.start, r.end) : value, positionAt: x => x, offsetAt: x => x};
    const editor = {document, selection: {start: 0, end: 0, isEmpty: true}, setDecorations() {}, revealRange() {}};
    const pdfGroup = {tabs: [], viewColumn: 2};
    const vscode = {
        Range, Selection: Range, Uri: {file: uri}, RelativePattern: class {}, ViewColumn: {One: 1, Beside: -2},
        TreeItem: class {constructor(label, collapsibleState) {Object.assign(this, {label, collapsibleState});}},
        TreeItemCollapsibleState: {None: 0, Expanded: 2},
        EventEmitter: class {event = () => disposable(); fire() {} dispose() {}},
        // Accessing native comments is a regression: old inline boxes must never be registered.
        get comments() {throw new Error('Retired native comments must not be created');},
        TextEditorRevealType: {InCenterIfOutsideViewport: 1}, ProgressLocation: {Notification: 15},
        window: {activeTextEditor: editor, visibleTextEditors: [editor], tabGroups: {all: [pdfGroup], activeTabGroup: pdfGroup},
            createTreeView(id, options) {provider = options.treeDataProvider; trees.push(id); return {dispose() {}, message: ''};},
            createWebviewPanel() {panels++; return {visible: true, onDidChangeViewState: disposable, webview: {html: '', cspSource: 'vscode-webview:', asWebviewUri: uri => ({toString: () => 'vscode-resource:' + uri.fsPath}), postMessage: m => packets.push(m), onDidReceiveMessage: f => {receive = f;}}, reveal() {}, onDidDispose() {}, dispose() {}};},
            createTextEditorDecorationType: disposable, registerUriHandler: disposable, onDidChangeActiveTextEditor: disposable,
            onDidChangeTextEditorSelection: f => {selectionHandler = f; return disposable();},
            async showTextDocument(target, options) {calls.push(['showTextDocument', target, options]); return editor;},
            withProgress: async (_, action) => action(), showInformationMessage: m => notices.push(m),
            showWarningMessage: async m => {notices.push(m);}, showErrorMessage: m => notices.push(m)},
        workspace: {isTrusted: true, workspaceFolders: [{uri: uri(root)}], textDocuments: [document],
            getWorkspaceFolder: () => ({uri: uri(root)}),
            findFiles: async () => tex ? [uri(file), ...(state ? [uri(owner)] : [])] : [],
            getConfiguration: () => ({get: (key, fallback) => key === 'translation.autoTranslate' ? false : key === 'reviewPDF.autoUpdateAfterAccept' ? autoPDF : fallback}),
            openTextDocument: async () => document, onDidChangeTextDocument: disposable, onDidSaveTextDocument: disposable,
            onDidChangeConfiguration: f => {configurationChanged = f; return disposable();},
            createFileSystemWatcher: () => ({dispose() {}, onDidChange: f => {fileChanged = f; return disposable();}, onDidCreate: disposable, onDidDelete: disposable})},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return disposable();}, getCommands: async () => ['chatgpt.addFileToThread', 'workbench.action.moveEditorToNewWindow'],
            async executeCommand(...args) {calls.push(args); if (args[0] === 'vscode.openWith') {
                const tab = {input: {uri: args[1]}, group: pdfGroup}; pdfGroup.tabs.push(tab); pdfGroup.activeTab = tab;
            }}},
    };
    const allCards = {'1': data};
    const backend = async (_, args, cwd, input) => {
        backendCalls.push({args, input});
        if (args.some(x => String(x).endsWith('document_roles.py'))) return JSON.stringify({status: 'unconfirmed'});
        if (args.includes('cards')) return JSON.stringify({session: 'batch', sha256: 'fresh', edits: Object.fromEntries(Object.entries(allCards).map(([id, item]) => [id, item.edit])),
            cards: Object.fromEntries(Object.entries(allCards).filter(([, item]) => ['pending', 'rework'].includes(item.edit.status))), sources: {[path.basename(file)]: value}});
        if (args.includes('inspect')) return JSON.stringify(allCards[args[args.indexOf('--id') + 1]]);
        if (args.includes('feedback')) {edit.requests.push({...input, status: 'open'}); return JSON.stringify({card: data, owner_text: 'fixture owner'});}
        if (args.includes('feedback-context')) return JSON.stringify({items: [
            {id: '1', file: edit.file, version: 'v1', current_version: 'v1', original: data.original, candidate: data.candidate, options: data.options, requests: edit.requests},
            {id: '1', file: edit.file, version: 'v1', current_version: 'v1', original: data.original, candidate: data.options[1].after, options: data.options,
                requests: [{option: 'B', side: 'candidate', quote: 'Clearer', text: '同一版本另一个方案的要求'}]},
            {id: 'other', file: edit.file, version: 'v9', current_version: 'v9', original: 'Other original', candidate: 'Other candidate', requests: [{text: 'other item'}]}],
            known_feedback: [{id: '1', version: 'v1', fingerprint: 'first-receipt'}, {id: 'other', version: 'v9', fingerprint: 'other-receipt'}]});
        if (args.includes('decide')) {edit.status = args.includes('--accept') ? 'accepted' : 'rejected';
            if (edit.status === 'accepted') value = value.replace(data.original, data.options.find(o => o.label === args.at(-1)).after);
            return '{}';}
        if (args.some(x => String(x).endsWith('review_pdf.py'))) {
            const navigation = path.join(root, 'review.json'), pdf = path.join(root, 'review.pdf');
            fs.writeFileSync(navigation, JSON.stringify({document: file}), 'utf8'); fs.writeFileSync(pdf, 'viewer fixture', 'utf8');
            return JSON.stringify({pdf, navigation, shown_ids: ['1']});
        }
        throw new Error('Unexpected backend operation: ' + args.join(' '));
    };
    const ui = createInlineReview(vscode, {subscriptions: []}, backend);
    return {root, file, original, editor, document, vscode, data, edit, allCards, calls, notices, backendCalls, handlers, packets, trees, ui,
        get value() {return value;}, set value(text) {value = text;},
        rows: () => provider.getChildren(), receive: m => receive(m),
        config: (changed = 'localLatex.reviewStyle.removedColor') => configurationChanged({affectsConfiguration: key => changed === key || changed.startsWith(key + '.')}),
        changed: () => fileChanged(uri(owner)), get selectionHandler() {return selectionHandler;}, get panels() {return panels;}};
}

for (const decision of ['accept', 'reject']) for (const autoPDF of [true, false]) test(`fixed review ${decision}, auto PDF ${autoPDF}, exact notes and handoff without native boxes`, async () => {
    const f = hostFixture({autoPDF}); await f.ui.ready;
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.trees, ['texscholar.reviewList']);
    assert(f.calls.some(c => c[0] === 'texscholar.reviewList.focus'));
    assert(!f.calls.some(c => c[0] === 'showTextDocument'));
    const row = f.rows()[0].children[0], c = row.command.arguments[0];
    assert.match(row.label, /^1 ·/);
    await f.handlers.get(row.command.command)(c); await f.receive({type: 'ready'});
    await f.handlers.get('localLatex.inlineReviewAt')(c);
    assert.equal(f.panels, 1, 'legacy entry opens the same fixed page, not an inline box');
    assert.equal(f.selectionHandler, undefined, 'tree commands do not bounce through a source-editor selection');
    const at = f.original.indexOf('First');
    f.editor.selection = {start: at, end: at + 5, isEmpty: false};
    await f.ui.annotate(c);
    const selection = f.packets.findLast(m => m.type === 'sourceSelection').selection;
    assert.equal(selection.value.slice(selection.start, selection.end), 'First');
    await f.receive({type: 'note', id: '1', version: 'v1', ...selection, text: '请更准确。'});
    assert.equal(f.edit.requests[0].quote, 'First');
    assert.equal(f.edit.requests[0].side, 'original');
    const before = f.backendCalls.length;
    await f.ui.addRequests();
    assert(f.calls.some(c => c[0] === 'chatgpt.addFileToThread'));
    assert(!f.calls.some(c => /send|submit|paste/i.test(c[0])));
    const attachment = f.calls.find(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath;
    assert(fs.readFileSync(attachment, 'utf8').includes('请更准确。'));
    const content = fs.readFileSync(attachment, 'utf8');
    assert.equal(content.split('"after": "Better sentence."').length - 1, 1, 'same generation options appear once');
    assert(content.includes('other item'));
    await f.ui.addRequests(c);
    const scoped = fs.readFileSync(f.calls.findLast(c => c[0] === 'chatgpt.addFileToThread')[1].fsPath, 'utf8');
    assert(scoped.includes('请更准确。') && scoped.includes('同一版本另一个方案的要求'));
    assert(!scoped.includes('other item'), 'combined action must not export another item');
    assert(scoped.includes('"known_feedback":[{"id":"1","version":"v1","fingerprint":"first-receipt"}]'));
    assert(!scoped.includes('other-receipt'), 'reuse receipts must not claim unseen attachment content');
    assert(scoped.includes('成功返修默认替换旧批注'));
    const sent = f.calls.filter(c => c[0] === 'chatgpt.addFileToThread').length;
    await assert.rejects(f.ui.addRequests({...c, version: 'outdated'}), /候选已更新/);
    assert.equal(f.calls.filter(c => c[0] === 'chatgpt.addFileToThread').length, sent);
    assert(!f.backendCalls.slice(0, before).some(c => c.args.some(a => String(a).endsWith('review_pdf.py'))));
    await f.ui.preview(c); await f.ui.preview(c);
    assert.equal(f.calls.filter(c => c[0] === 'workbench.action.moveEditorToNewWindow').length, 1);
    f.document.isDirty = true; await assert.rejects(f.ui.accept({...c, option: 'B'}), /未保存/); f.document.isDirty = false;
    f.value += 'manual'; await assert.rejects(f.ui.accept({...c, option: 'B'}), /同步/); f.value = f.original;
    await f.receive({type: decision, id: '1', version: 'v1', option: 'B'}); await f.ui.whenPDFIdle();
    assert.equal(f.edit.status, decision === 'accept' ? 'accepted' : 'rejected');
    assert.equal(f.value, decision === 'accept' ? f.original.replace('First sentence.', 'Clearer sentence.') : f.original);
    assert.equal(f.rows().length, 0);
    assert.equal(f.backendCalls.filter(c => c.args.includes('decide')).length, 1);
    assert.equal(f.backendCalls.filter(c => c.args.some(a => String(a).endsWith('review_pdf.py'))).length, 2 + Number(decision === 'accept' && autoPDF));
    assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
    assert(!f.calls.some(c => c[0] === 'workbench.action.focusCommentsPanel'));
});

test('TeX discovery exposes only the new bottom list, code projects and source stay untouched', async () => {
    for (const tex of [false, true]) {
        const f = hostFixture({tex, state: false}); await f.ui.ready;
        assert.deepEqual(f.notices, []);
        assert.equal(f.calls.some(c => c[0] === 'texscholar.reviewList.focus'), tex);
        assert.equal(f.backendCalls.length, 0);
        assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
        assert.deepEqual(fs.readdirSync(f.root), [path.basename(f.file)]);
    }
});

test('new bottom panel is declared and no native comment toolbar remains', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(manifest.contributes.viewsContainers.panel[0].id, 'texscholarReviews');
    assert.equal(manifest.contributes.views.texscholarReviews[0].id, 'texscholar.reviewList');
    assert(!manifest.contributes.menus['comments/commentThread/title']);
    assert(!manifest.contributes.menus['comments/commentThread/context']);
    assert(!manifest.contributes.commands.some(c => /inline(Post|Cancel)Comment$/.test(c.command)));
    assert(manifest.contributes.keybindings.some(b => b.command === 'localLatex.inlinePreview' && b.key === 'ctrl+alt+d'));
});

test('same-line items have separate IDs and event-driven versions switch one page without source navigation', async () => {
    const f = hostFixture(); await f.ui.ready;
    const second = structuredClone(f.data);
    second.original = 'Second sentence.'; second.candidate = 'Updated second sentence.';
    second.source.start = Array.from(f.original.slice(0, f.original.indexOf('Second'))).length;
    second.source.end = second.source.start + second.original.length;
    f.allCards['2'] = second;
    await f.ui.refresh({repo: f.root, owner: 'reply.tex'});
    assert.deepEqual(f.rows()[0].children.map(row => row.command.arguments[0].id), ['1', '2']);
    for (const id of ['2', '1', '2']) {
        const row = f.rows()[0].children.find(r => r.command.arguments[0].id === id);
        await f.handlers.get(row.command.command)(row.command.arguments[0]);
        assert.equal(f.ui.workbench.active.id, id);
    }
    second.version = 'v2'; second.edit.versions.push('v2');
    await f.changed();
    assert.equal(f.ui.workbench.active.version, 'v2');
    assert.equal(f.panels, 1);
    assert(!f.calls.some(c => c[0] === 'showTextDocument'));
    assert(!f.backendCalls.some(c => c.args.some(a => String(a).endsWith('review_pdf.py'))));
});

test('review positions exclude the mechanical ledger and follow unsaved header edits without changing source', () => {
    const {nativeOffset, codePointOffset} = require('./review_positions');
    const unicode = '中文\r\nA😀B\ud800X\udc00';
    for (let i = 0; i <= Array.from(unicode).length + 1; i++)
        assert.equal(nativeOffset(unicode, i), Array.from(unicode).slice(0, i).join('').length);
    for (let i = 0; i <= unicode.length; i++)
        assert.equal(codePointOffset(unicode, i), Array.from(unicode.slice(0, i)).length);
    for (const eol of ['\n', '\r\n']) {
        const state = value => ['% CODEX-REVIEW-STATE-BEGIN', '% 交接状态', '% CODEX-REVIEW-DATA ' + JSON.stringify({quote: 'Actual original sentence.', value}), '% CODEX-REVIEW-STATE-END', ''].join(eol);
        const prefix = '% 中文科研规则 😀' + eol, tail = '\\begin{document}' + eol + 'Actual original sentence.' + eol + '\\end{document}';
        const old = prefix + state(1) + tail;
        const start = old.lastIndexOf('Actual original sentence.'), end = start + 'Actual original sentence.'.length;
        const data = {original: 'Actual original sentence.', candidate: 'New sentence.', source: {text: old, side: 'original', start: Array.from(old.slice(0, start)).length, end: Array.from(old.slice(0, end)).length}};
        const updated = prefix + state('longer state record'.repeat(40)).replace('% 交接状态', '% 交接状态' + eol + '% 更多工作记录') + tail;
        const at = locateDisplay(data, view(updated));
        assert.equal(updated.slice(at.start, at.end), data.original);
        assert(at.start > updated.indexOf('% CODEX-REVIEW-STATE-END'));
        const insertion = {...data, original: '', source: {...data.source, end: data.source.start}};
        assert.equal(locateDisplay(insertion, view(updated)).start, at.start, 'addition-only anchor is not paired with its quote in state JSON');
        assert.equal(locateDisplay(data, view(updated.replace('Actual original sentence.' + eol, 'Manually rewritten sentence.' + eol))), undefined, 'manual content changes cannot be fuzzily relocated');
        assert.equal(locateDisplay(data, view(updated.replace('% CODEX-REVIEW-STATE-END', '% incomplete state marker'))), undefined);
        const bad = {...data, source: {...data.source, start: Array.from(old.slice(0, old.indexOf('Actual original sentence.'))).length, end: Array.from(old.slice(0, old.indexOf('Actual original sentence.') + data.original.length)).length}};
        assert.equal(locateDisplay(bad, view(updated)), undefined, 'mechanical JSON quotes never become review locations');
    }
});

test('prose display preserves escaped percent and inline verbatim; comments remain in source', () => {
    const original = 'At 90\\%, \\verb|a% b| remains. % hidden note\nNext sentence.';
    const rendered = markedWords({original, changes: []}, 'original');
    assert(rendered.includes('90\\%'));
    assert(rendered.includes('a% b'));
    assert(!rendered.includes('hidden note'));
    assert(original.includes('hidden note'));
});

test('review style changes only display markup and validates colors before embedding HTML', () => {
    const styling = require('./review_style');
    const style = styling.read({get: (key, fallback) => ({'reviewStyle.removedColor': '#884400', 'reviewStyle.addedColor': '#008844',
        'reviewStyle.strikeDeleted': false}[key] ?? fallback)});
    const data = {original: 'The old word stays.', candidate: 'The new word stays.',
        changes: [{old_start: 4, old_end: 7, new_start: 4, new_end: 7}]};
    const saved = JSON.stringify(data);
    assert(markedWords(data, 'original', style).includes('color:#884400;">old</span>'));
    assert(!markedWords(data, 'original', style).includes('<del>'));
    assert(markedWords(data, 'candidate', style).includes('color:#008844;">new</span>'));
    assert(!markedWords(data, 'candidate', style).includes('>stays.</span>'));
    assert.equal(JSON.stringify(data), saved);
    assert.throws(() => styling.read({get: (key, fallback) => key === 'reviewStyle.removedColor' ? 'red; bad html' : fallback}), /RRGGBB/);
});

test('screen typography updates the workbench without invalidating PDF; shared colors still invalidate it', async () => {
    const f = hostFixture(); await f.ui.ready;
    const c = f.rows()[0].children[0].command.arguments[0];
    await f.ui.open(c); await f.receive({type: 'ready'});
    f.packets.length = 0;
    f.config('localLatex.reviewStyle.controlFontSize');
    assert(f.packets.some(m => m.type === 'style'));
    assert(!f.packets.some(m => m.type === 'pdfStatus'));
    f.config('localLatex.reviewStyle.addedColor');
    assert(f.packets.some(m => m.type === 'pdfStatus' && m.message.includes('样式已变更')));
    assert(!f.backendCalls.some(c => c.args.some(a => String(a).endsWith('review_pdf.py'))));
});

test('hidden full-line plans leave no blank placeholders; complete deletion results and surviving words remain visible', () => {
    const plan = '  % CODEX-PARAGRAPH-PLAN-BEGIN\r\n% 中文逻辑。\r\n% CODEX-PARAGRAPH-PLAN-END\r\n';
    const candidate = plan + 'The mean is $p=0.5$.\n\nA real paragraph.';
    assert.equal(displayText(candidate), 'The mean is $p=0.5$.\n\nA real paragraph.');
    const original = 'The old mean is $p=0.5$.';
    const data = {original, candidate: 'The mean is $p=0.5$.', changes: [{old_start: 4, old_end: 8, new_start: 4, new_end: 4}]};
    assert.equal(markedWords(data, 'candidate'), 'The mean is $p=0.5$.');
    assert.equal(summary(data, '46'), '46｜修改后：The mean is $p=0.5$.');
    const text = 'Before stays. Remove this sentence. After stays.';
    data.source = {text, start: 14, end: 35};
    assert.equal(deletionPreview(data).replace(/[ \t]+/g, ' '), 'Before stays. After stays.');
    assert.equal(markedWords({original, candidate, changes: []}, 'candidate').trim(), 'The mean is $p=0.5$.<br><br>A real paragraph.');
    const long = 'x'.repeat(150);
    const rendered = markedWords({candidate: long, changes: []}, 'candidate');
    assert(rendered.includes('\u200b'));
    assert.equal(rendered.replaceAll('\u200b', ''), long, 'wrap opportunities preserve the complete display content');
    for (const side of ['original', 'candidate']) {
        const text = '\n\n' + plan + 'A reply with unchanged words.\n';
        const rendered = markedWords({[side]: text, changes: [{old_start: 0, old_end: Array.from(text).length, new_start: 0, new_end: Array.from(text).length}]}, side);
        assert(!rendered.includes('<br>'), 'leading/trailing blank lines and hidden plans do not become HTML line breaks in either document');
        assert(rendered.replace(/<[^>]+>/g, '').includes('A reply with unchanged words.'));
    }
    for (const side of ['original', 'candidate']) {
        const text = 'A fully changed sentence with many ordinary words and ' + 'x'.repeat(90) + '.';
        const data = {[side]: text, changes: [{old_start: 0, old_end: text.length, new_start: 0, new_end: text.length}]};
        const html = markedWords(data, side);
        const spans = [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)];
        assert(spans.length > 1);
        assert(spans.every(match => !/\s|\u200b/u.test(match[1])), 'native preformatted spans cannot contain the inter-word spaces or break opportunities');
        assert.equal(html.replace(/<[^>]+>/g, '').replaceAll('\u200b', ''), text, 'display wrapping preserves every original/proposed word');
    }
});
