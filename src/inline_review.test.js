'use strict';
// Native comment/editor APIs require their own host fixture; backend writes are covered by native_review_test.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createInlineReview, markedWords, displayText, summary, deletionPreview} = require('./inline_review');
const disposable = () => ({dispose() {}});
const fileWatcher = () => ({dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable});
const {view, locateDisplay} = require('./review_positions');

test('review positions exclude the mechanical ledger and follow unsaved header edits without changing source', () => {
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

for (const decision of ['accept', 'reject']) test(`original card toolbar can ${decision}; exact notes join Codex context without sending or diff tabs`, async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'inline-host-'));
    const file = path.join(root, 'paper.tex');
    const original = '\\documentclass{article}\n% 中文段落逻辑，完整保留。\n😀 The model is strong and fast.';
    const candidate = '\\documentclass{article}\n% 中文段落逻辑，完整保留。\n😀 The model is reliable and fast.';
    fs.writeFileSync(file, original, 'utf8');
    const automatic = decision === 'accept';
    const owner = path.join(root, 'reply.tex');
    if (automatic) fs.writeFileSync(owner, '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA fixture\n', 'utf8');
    const oldStart = Array.from(original.slice(0, original.indexOf('strong'))).length;
    const edit = {file: 'paper.tex', deferred: true, status: 'pending', versions: ['v1'], requests: [],
        questions: [{id: 'R1.1', file: 'paper.tex', quote: 'Please clarify reliability.'}]};
    const state = {schema: 2, sha256: 'fresh', edits: {'1': edit}};
    const data = {sha256: 'fresh', edit, version: 'v1', original, candidate, source_match: true,
        source: {text: original, start: 0, end: Array.from(original).length, side: 'original'},
        changes: [{old_start: oldStart, old_end: oldStart + 6, new_start: oldStart, new_end: oldStart + 8}]};
    let value = original, lensProvider, commentsRegistered = false;
    const calls = [], threads = [], notices = [], backendCalls = [], handlers = new Map();
    class Range {
        constructor(start, end) {Object.assign(this, {start, end});}
        contains(p) {return p >= this.start && p <= this.end;}
    }
    const uri = p => ({scheme: 'file', fsPath: p});
    const document = {uri: uri(file), languageId: 'latex', isDirty: false,
        getText: r => r ? value.slice(r.start, r.end) : value, positionAt: x => x, offsetAt: x => x};
    const editor = {document, selection: {start: 0, end: 0, isEmpty: true}, revealRange() {}, setDecorations() {}};
    const vscode = {
        env: {appRoot: path.join(root, 'vscode-app')},
        Range, Selection: Range, RelativePattern: class {}, Uri: {file: uri}, ViewColumn: {One: 1, Two: 2}, TextEditorRevealType: {InCenterIfOutsideViewport: 1},
        CommentMode: {Preview: 0}, CommentThreadCollapsibleState: {Expanded: 1, Collapsed: 0},
        ProgressLocation: {Notification: 1},
        EventEmitter: class {fire() {} dispose() {}},
        MarkdownString: class {constructor() {this.value = '';} appendMarkdown(t) {this.value += t;} appendText(t) {this.value += t;}},
        CodeLens: class {constructor(range, command) {Object.assign(this, {range, command});}},
        comments: {createCommentController() {return {dispose() {}, createCommentThread(uri, range, comments) {
            commentsRegistered = true;
            const thread = {uri, range, comments, dispose() {this.disposed = true;}}; threads.push(thread); return thread;
        }};}},
        workspace: {isTrusted: true, textDocuments: [document], getWorkspaceFolder: () => ({uri: uri(root)}),
            workspaceFolders: [{uri: uri(root)}], findFiles: async () => automatic ? [uri(file), uri(owner)] : [],
            getConfiguration: () => ({get: (key, fallback) => fallback}), openTextDocument: async () => document,
            onDidChangeTextDocument: disposable, onDidSaveTextDocument: disposable, createFileSystemWatcher: fileWatcher},
        languages: {registerCodeLensProvider(selector, provider) {lensProvider = provider; return {dispose() {}};}},
        window: {activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: () => ({dispose() {}}),
            async showTextDocument(target, options) {calls.push(['showTextDocument', target, options]); return editor;},
            async withProgress(options, action) {return action();}, registerUriHandler: () => ({dispose() {}}), onDidChangeActiveTextEditor: () => ({dispose() {}}), onDidChangeTextEditorSelection: () => ({dispose() {}}),
            showQuickPick: async () => {throw new Error('No ID picker should be opened');},
            showInformationMessage: x => notices.push(x), showErrorMessage: x => notices.push(x)},
        commands: {registerCommand: (name, handler) => {handlers.set(name, handler); return {dispose() {}};},
            getCommands: async () => ['chatgpt.addFileToThread', ...(commentsRegistered ? ['workbench.action.focusCommentsPanel'] : [])],
            async executeCommand(...args) {
                if (args[0] === 'workbench.action.focusCommentsPanel' && !commentsRegistered)
                    throw new Error("command 'workbench.action.focusCommentsPanel' not found");
                calls.push(args);
            }}
    };
    const backend = async (command, args, cwd, input, env) => {
        backendCalls.push({command, args, input, env});
        if (args.includes('--new-window')) return '';
        if (args.some(x => String(x).endsWith('review_pdf.py'))) return JSON.stringify({pdf: path.join(root, 'review.pdf')});
        if (args.includes('cards')) {
            const detail = JSON.parse(JSON.stringify(data));
            delete detail.source.text;
            return JSON.stringify({...state, cards: ['pending', 'rework'].includes(edit.status) ? {'1': detail} : {}, sources: {'paper.tex': original}});
        }
        if (args.includes('inspect')) return JSON.stringify(data);
        if (args.includes('status')) return JSON.stringify(state);
        if (args.includes('feedback-context')) return JSON.stringify({items: [{id: '1', file: edit.file, version: 'v1', current_version: 'v1', original, candidate, requests: edit.requests}]});
        if (args.includes('feedback')) {edit.requests.push({...input, id: 'note-' + edit.requests.length, status: 'open'});
            return JSON.stringify({card: data, owner_text: 'fixture owner'});}
        if (args.includes('decide')) {
            if (args.includes('--accept')) {value = candidate; edit.status = 'accepted';}
            else {edit.status = 'rejected';}
            return '{}';
        }
        throw new Error('Unexpected backend command');
    };
    const ui = createInlineReview(vscode, {subscriptions: []}, backend);
    await ui.ready;
    if (automatic) {
        assert.deepEqual(notices, [], 'cold startup must register native comments before trying to focus them');
        assert.equal(threads.length, 1);
        assert.equal(threads[0].collapsibleState, vscode.CommentThreadCollapsibleState.Collapsed);
        assert(calls.some(x => x[0] === 'workbench.action.focusCommentsPanel'));
        assert(!calls.some(x => x[0] === 'showTextDocument'), 'automatic startup must not navigate or open a source editor');
        assert.deepEqual(backendCalls.map(x => x.args.at(-1)), ['cards'], 'startup is read-only and does not migrate/initialize/compile');
    } else assert.equal(calls.length, 0, 'no TeX discovery means a code workspace remains untouched');
    const c = {repo: root, owner: 'reply.tex', id: '1', version: 'v1'};
    await handlers.get('localLatex.inlineReviewAt')(c);
    assert(!backendCalls.some(x => x.args.some(a => String(a).endsWith('review_pdf.py'))), 'opening a card must not compile a review PDF');
    assert.equal(backendCalls.filter(x => x.args.includes('cards')).length, automatic ? 2 : 1, 'each refresh reads all details in one backend request');
    await handlers.get('localLatex.inlineReview')();
    await handlers.get('localLatex.inlineNext')();
    assert(!backendCalls.some(x => x.args.some(a => String(a).endsWith('review_pdf.py'))), 'choosing and navigating cards must not compile either');
    assert.equal(value, original);
    assert.equal(calls.find(x => x[0] === 'showTextDocument')[1].fsPath, file);
    let card = threads.at(-1).comments[0].body;
    assert(card.value.startsWith('<div><strong>原文：</strong>'));
    assert(!card.value.includes('修改后：'));
    assert(!card.value.includes('<code>'));
    assert(!card.value.includes('<pre>'));
    assert(card.value.includes('<del>old</del>'));
    assert(card.value.includes('>new</span>'));
    assert(!card.value.includes('红色删除线'));
    assert(card.value.includes('Addition only＝无对应原句'));
    assert(!card.value.includes('中文段落逻辑'));
    assert(card.value.includes('展开完整源码（含注释）'));
    assert.deepEqual(card.isTrusted, {enabledCommands: ['localLatex.inlineQuestions', 'localLatex.jumpQuestion', 'localLatex.inlineRelatedChanges', 'localLatex.inlineToggleSource']});
    const beforeQuestion = backendCalls.length;
    await handlers.get('localLatex.inlineQuestions')(c);
    assert(threads.at(-1).comments[0].body.value.includes('Please clarify reliability.'));
    await handlers.get('localLatex.inlineQuestions')(c);
    assert.equal(backendCalls.length, beforeQuestion, 'question display uses the loaded immutable association');
    const callsBeforeToggle = backendCalls.length, existingThread = threads.at(-1);
    await handlers.get('localLatex.inlineToggleSource')(c);
    card = threads.at(-1).comments[0].body;
    assert(card.value.includes('中文段落逻辑，完整保留。'));
    assert(card.value.includes('收起完整源码'));
    await handlers.get('localLatex.inlineToggleSource')(c);
    assert(!threads.at(-1).comments[0].body.value.includes('中文段落逻辑'));
    assert.equal(value, original);
    assert.equal(backendCalls.length, callsBeforeToggle, 'display-only expansion must not reread the backend');
    assert.equal(threads.at(-1), existingThread, 'expansion updates one existing card without rebuilding other threads');
    assert(backendCalls.every(x => x.args.includes('inspect') || x.args.includes('status') || x.args.includes('cards')));
    assert.equal(lensProvider, undefined, 'review actions belong in the card, not source CodeLens text');
    const marked = markedWords(data, 'original');
    assert(marked.includes('<del>strong</del>'));
    assert(!marked.includes('<del>and</del>'));
    editor.selection = new Range(original.indexOf('strong'), original.indexOf('strong') + 6);
    editor.selection.isEmpty = false;
    const currentCard = threads.at(-1);
    const canceled = await handlers.get('localLatex.inlineAnnotate')(currentCard);
    assert.equal(canceled, currentCard, 'card toolbar opens the reply editor inside the same card');
    await handlers.get('localLatex.inlineCancelComment')({thread: canceled});
    assert.equal(currentCard.canReply, false);
    assert.equal(currentCard.disposed, undefined);
    assert.equal(currentCard.label, '1 · 原文 → 候选 v1');
    assert.equal(edit.requests.length, 0);
    const draft = await handlers.get('localLatex.inlineAnnotate')(currentCard);
    await ui.refresh(c);
    assert.equal(draft.disposed, undefined, 'refresh must preserve an unsaved draft inside its card');
    assert.equal(draft.canReply, true);
    const unchangedCandidateComment = draft.comments[0];
    const cardsBeforePost = backendCalls.filter(x => x.args.includes('cards')).length;
    await ui.post({thread: draft, text: '保留 fast，只调整选中的词。'});
    assert.equal(draft.disposed, undefined, 'saving feedback must not reopen or recreate the card');
    assert.equal(draft.comments[0], unchangedCandidateComment, 'saving feedback updates the lower note only, not the original/candidate content');
    assert.equal(backendCalls.filter(x => x.args.includes('cards')).length, cardsBeforePost, 'posting must not reread every project candidate');
    assert.equal(edit.requests[0].quote, 'strong');
    assert.equal(edit.requests[0].start, oldStart);
    assert.equal(value, original);
    await handlers.get('localLatex.inlineAddRequests')(threads.at(-1));
    const handoff = calls.find(x => x[0] === 'chatgpt.addFileToThread');
    assert(handoff);
    assert(fs.readFileSync(handoff[1].fsPath, 'utf8').includes('保留 fast，只调整选中的词。'));
    assert(fs.readFileSync(handoff[1].fsPath, 'utf8').includes('审阅框编号：1'));
    assert(fs.readFileSync(handoff[1].fsPath, 'utf8').includes(original));
    assert(fs.readFileSync(handoff[1].fsPath, 'utf8').includes(candidate));
    for (const mode of ['empty', 'unrelated-selection', 'no-active-editor']) {
        editor.selection = new Range(original.length + 10, original.length + 15);
        editor.selection.isEmpty = mode === 'empty';
        vscode.window.activeTextEditor = mode === 'no-active-editor' ? undefined : editor;
        const whole = await handlers.get('localLatex.inlineAnnotate')(currentCard);
        await ui.post({thread: whole, text: '整项原文返修：' + mode});
        assert.equal(edit.requests.at(-1).quote, original, 'card annotation defaults to its original, not an unrelated editor selection');
        assert.equal(edit.requests.at(-1).side, 'original');
    }
    vscode.window.activeTextEditor = editor;
    assert(!backendCalls.some(x => x.args.some(a => String(a).endsWith('review_pdf.py'))), 'source toggles, annotation and saved notes must not compile');
    await handlers.get('localLatex.inlinePreview')(threads.at(-1));
    const launch = backendCalls.find(x => x.args.includes('--new-window'));
    assert.deepEqual(launch.args, [path.join(vscode.env.appRoot, 'out', 'cli.js'), '--new-window', path.join(root, 'review.pdf')]);
    assert.equal(launch.command, process.execPath);
    assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(launch.input, undefined);
    assert(!calls.some(x => x[0] === 'vscode.openWith'), 'review PDF must not replace/split the source window');
    await handlers.get('localLatex.inlinePreview')(threads.at(-1));
    assert.equal(backendCalls.filter(x => x.args.includes('--new-window')).length, 1, 'updating the stable artifact must not open another window');
    document.isDirty = true;
    await assert.rejects(ui.accept(c), /未保存/);
    assert.equal(value, original);
    document.isDirty = false;
    value = original + 'author edit';
    await assert.rejects(ui.accept(c), /同步/);
    value = original;
    editor.selection = new Range(original.length + 10, original.length + 10);
    editor.selection.isEmpty = true;
    await handlers.get(decision === 'accept' ? 'localLatex.inlineAccept' : 'localLatex.inlineReject')(threads.at(-1));
    assert.equal(value, decision === 'accept' ? candidate : original, 'toolbar targets its own card, not the unrelated source caret');
    assert.equal(edit.status, decision === 'accept' ? 'accepted' : 'rejected');
    assert.equal(ui.records.size, 0);
    assert.equal(backendCalls.filter(x => x.args.includes('decide')).length, 1);
    assert(backendCalls.find(x => x.args.includes('decide')).args.includes('--' + decision));
    assert.equal(backendCalls.filter(x => x.args.some(a => String(a).endsWith('review_pdf.py'))).length, 2, 'only the two explicit PDF requests compiled, never acceptance');
    assert(!calls.some(x => /diff|send|submit|paste/i.test(x[0])));
    assert(!fs.existsSync(path.join(root, '.git')));
});

test('prose display preserves escaped percent and inline verbatim; comments remain in source', () => {
    const original = 'At 90\\%, \\verb|a% b| remains. % hidden note\nNext sentence.';
    const rendered = markedWords({original, changes: []}, 'original');
    assert(rendered.includes('90\\%'));
    assert(rendered.includes('a% b'));
    assert(!rendered.includes('hidden note'));
    assert(original.includes('hidden note'));
});

test('same-line candidates share one native card but retain independent actions and drafts', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'shared-line-'));
    const file = path.join(root, 'paper.tex'), text = 'First sentence. Second sentence.\nThird sentence.';
    fs.writeFileSync(file, text, 'utf8');
    const calls = [], threads = [], handlers = new Map(), notices = []; let selectionListener, pauseFeedback, finishFeedback, choices, batch = 'batch-1', watchChanged, watchCreated, saveDocument, changeDocument;
    const owner = path.join(root, 'reply.tex'); fs.writeFileSync(owner, 'state-1', 'utf8');
    const items = Object.fromEntries(['First sentence.', 'Second sentence.', 'Third sentence.'].map((original, index) => {
        const start = text.indexOf(original), id = String(index + 1);
        return [id, {sha256: 'fresh', edit: {file: 'paper.tex', deferred: true, status: 'pending', versions: ['v1'], requests: []},
            version: 'v1', original, candidate: original.replace('sentence', 'wording'), source_match: true,
            source: {start, end: start + original.length, side: 'original'}, changes: []}];
    }));
    class Range {constructor(start, end) {Object.assign(this, {start, end});} contains(p) {return p >= this.start && p <= this.end;}}
    const uri = fsPath => ({scheme: 'file', fsPath});
    const document = {uri: uri(file), languageId: 'latex', isDirty: false, getText: r => r ? text.slice(r.start, r.end) : text,
        positionAt: x => x, offsetAt: x => x};
    const editor = {document, selection: {start: 0, end: 0, isEmpty: true}, revealRange() {}, setDecorations() {}};
    const vscode = {
        Range, Selection: Range, RelativePattern: class {}, Uri: {file: uri}, ViewColumn: {One: 1}, TextEditorRevealType: {}, TextEditorSelectionChangeKind: {Mouse: 2},
        CommentMode: {Preview: 0}, CommentThreadCollapsibleState: {Expanded: 1, Collapsed: 0},
        MarkdownString: class {constructor() {this.value = '';} appendMarkdown(s) {this.value += s;} appendText(s) {this.value += s;}},
        comments: {createCommentController: () => ({dispose() {}, createCommentThread(uri, range, comments) {
            const thread = {uri, range, comments, dispose() {this.disposed = true;}}; threads.push(thread); return thread;
        }})},
        workspace: {isTrusted: true, textDocuments: [document], workspaceFolders: [{uri: uri(root)}],
            getWorkspaceFolder: () => ({uri: uri(root)}), findFiles: async () => [],
            getConfiguration: () => ({get: (key, fallback) => fallback}), openTextDocument: async () => document,
            onDidChangeTextDocument: fn => {changeDocument = fn; return disposable();}, onDidSaveTextDocument: fn => {saveDocument = fn; return disposable();},
            createFileSystemWatcher: () => ({dispose() {}, onDidChange(fn) {watchChanged = fn; return disposable();}, onDidCreate(fn) {watchCreated = fn; return disposable();}, onDidDelete: disposable})},
        window: {activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: () => ({dispose() {}}),
            showTextDocument: async () => editor, registerUriHandler: () => ({dispose() {}}), onDidChangeActiveTextEditor: () => ({dispose() {}}),
            onDidChangeTextEditorSelection: fn => {selectionListener = fn; return {dispose() {}};},
            showQuickPick: async items => {choices = items;},
            showInformationMessage: x => notices.push(x), showErrorMessage: x => notices.push(x), showWarningMessage: async x => {notices.push(x);}},
        commands: {registerCommand: (name, handler) => {handlers.set(name, handler); return {dispose() {}};},
            getCommands: async () => [], executeCommand: async () => {}}
    };
    const backend = async (command, args, cwd, input) => {
        calls.push({args, input});
        if (args.includes('cards')) return JSON.stringify({session: batch, sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(owner)).digest('hex'), edits: Object.fromEntries(Object.entries(items).map(([id, data]) => [id, data.edit])), cards: Object.fromEntries(Object.entries(items).filter(([, d]) => d.edit.status === 'pending')),
            sources: Object.fromEntries(Object.values(items).map(d => [d.edit.file, text]))});
        if (args.includes('inspect')) return JSON.stringify({...items[args[args.indexOf('--id') + 1]], source: {...items[args[args.indexOf('--id') + 1]].source, text}});
        if (args.includes('feedback')) {if (pauseFeedback) await pauseFeedback; items[input.id].edit.requests.push({...input, id: 'note-' + calls.length, status: 'open'});
            return JSON.stringify({card: {...items[input.id], source: {...items[input.id].source, text}}, owner_text: 'fixture owner'});}
        if (args.includes('decide')) {
            const accept = args.includes('--accept');
            items[args[args.indexOf(accept ? '--accept' : '--reject') + 1]].edit.status = accept ? 'accepted' : 'rejected'; return '{}';
        }
        throw new Error('Unexpected backend command');
    };
    const ui = createInlineReview(vscode, {subscriptions: []}, backend); await ui.ready;
    const c = {repo: root, owner: 'reply.tex'};
    await ui.refresh(c);
    const question = {id: 'R1-Q3', file: 'reply.tex', quote: 'Exact original question.'};
    items['1'].edit.questions = [question]; items['3'].edit.questions = [question];
    items['2'].edit.questions = [{...question, quote: 'A different original question.'}];
    await handlers.get('localLatex.inlineRelatedChanges')({...c, id: '1', version: 'v1'});
    assert.deepEqual(choices.map(item => item.id), ['3'], 'reverse navigation uses exact source/quote association, not adjacent IDs or reviewer labels');
    assert(choices[0].label.includes('待审'));
    const live = () => threads.filter(t => !t.disposed);
    assert.equal(live().length, 2, 'a native gutter click expands every thread ending on that line, so there must be only one');
    const shared = live()[0], separate = live()[1];
    assert(shared.comments[0].body.value.includes('inlineSelectCard'));
    assert(shared.comments[0].body.value.includes('First sentence.'));
    assert(!shared.comments[0].body.value.includes('Second sentence.'));
    const beforeSwitch = calls.length;
    await handlers.get('localLatex.inlineSelectCard')({...c, id: '2', version: 'v1'});
    assert.equal(live()[0], shared, 'switching updates the existing card');
    assert(shared.label.startsWith('2 ·'));
    assert(shared.comments[0].body.value.includes('Second sentence.'));
    assert.equal(separate.collapsibleState, 0);
    assert.equal(calls.length, beforeSwitch, 'switching uses cached candidates without a backend read or PDF compilation');
    editor.selection = {start: 16, end: 22, isEmpty: false};
    const draft = await handlers.get('localLatex.inlineAnnotate')(shared);
    assert.equal(draft, shared);
    await handlers.get('localLatex.inlineSelectCard')({...c, id: '1', version: 'v1'});
    assert(notices.some(x => /草稿/.test(x)), 'switching away requires saving/cancelling the unsaved draft');
    assert(shared.label.startsWith('2 ·'));
    await ui.refresh(c);
    assert.equal(draft.disposed, undefined);
    assert.equal(live().length, 2, 'refresh must not recreate a second same-line card beside the draft');
    await ui.post({thread: draft, text: '只改第二句。'});
    assert.equal(items['1'].edit.requests.length, 0);
    assert.equal(items['2'].edit.requests[0].quote, 'Second');
    const selected = live().find(t => t.label.startsWith('2 ·'));
    await handlers.get('localLatex.inlineReject')(selected);
    assert.equal(items['2'].edit.status, 'rejected');
    assert.equal(items['1'].edit.status, 'pending');
    assert.equal(ui.records.size, 2);
    assert.equal(live().length, 2);
    assert(live().some(t => t.label.startsWith('1 ·')));
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'display grouping never rewrites the source');
    editor.selection = {start: 0, end: 5, isEmpty: false};
    const fromEditor = await ui.annotate({...c, id: '1', version: 'v1'});
    assert.equal(live().length, 2, 'source-selection annotation must also reuse the existing shared view');
    await handlers.get('localLatex.inlineCancelComment')(fromEditor);
    const otherFile = path.join(root, 'other.tex'); fs.writeFileSync(otherFile, text, 'utf8');
    const otherDocument = {...document, uri: uri(otherFile)};
    vscode.workspace.openTextDocument = async target => target.fsPath === otherFile ? otherDocument : document;
    items['4'] = JSON.parse(JSON.stringify(items['1'])); items['4'].edit.file = 'other.tex';
    await ui.refresh(c);
    assert.equal(live().length, 3, 'identical line numbers in different files must never share a view');
    const pendingDraft = await ui.annotate({...c, id: '1', version: 'v1'});
    items['1'].edit.questions = [{id: 'R1-Q3', file: 'paper.tex', quote: 'First sentence.'}];
    fs.writeFileSync(owner, 'state-question-metadata', 'utf8');
    await watchCreated(uri(owner));
    assert.equal(pendingDraft.disposed, undefined, 'association-only updates preserve same-version drafts');
    assert(pendingDraft.comments[0].body.value.includes('R1-Q3'));
    items['1'].edit.versions.push('v2'); items['1'].version = 'v2';
    items['1'].candidate = 'First revised wording.'; items['1'].edit.requests = [];
    fs.writeFileSync(owner, 'state-new-candidate', 'utf8');
    await watchChanged(uri(owner));
    assert.equal(pendingDraft.disposed, true, 'a new AI candidate must not be hidden behind an old forced draft');
    assert.equal(ui.records.get('1').c.version, 'v2');
    assert(live().some(t => t.comments[0].body.value.includes('First revised wording.') && t.canReply === false));
    const decisions = calls.filter(call => call.args.includes('decide')).length;
    await handlers.get('localLatex.inlineAccept')({...c, id: '1', version: 'v1'});
    assert.equal(calls.filter(call => call.args.includes('decide')).length, decisions, 'refreshing a stale button never retries acceptance on a different candidate');
    assert(notices.some(message => message.includes('显示已自动更新')));
    const duplicate = calls.filter(call => call.args.includes('cards')).length;
    await watchChanged(uri(owner));
    assert.equal(calls.filter(call => call.args.includes('cards')).length, duplicate, 'duplicate OS events do not reread the backend');
    otherDocument.isDirty = true;
    items['4'].version = 'v2'; items['4'].edit.versions.push('v2');
    fs.writeFileSync(owner, 'state-dirty-file', 'utf8'); await watchChanged(uri(owner));
    assert.equal(ui.records.get('4').c.version, 'v1', 'unsaved source buffers keep their current card until save');
    otherDocument.isDirty = false; await saveDocument(otherDocument);
    assert.equal(ui.records.get('4').c.version, 'v2', 'a save event finishes deferred refresh even if source bytes stayed equal');
    items['5'] = {...JSON.parse(JSON.stringify(items['1'])), version: 'v1', original: ' ', candidate: 'Added sentence.',
        edit: {...items['1'].edit, versions: ['v1']}, source: {start: 15, end: 16, side: 'original'}};
    await ui.refresh(c);
    editor.selection = {start: 15, end: 16, isEmpty: false};
    selectionListener({kind: 2, textEditor: editor});
    assert(live().some(t => t.label.startsWith('5 ·') && t.comments[0].body.value.includes('Added sentence.')));
    const boundaryDraft = await ui.annotate();
    assert(boundaryDraft.label.startsWith('5 ·'), 'the boundary belongs to the next item, not the preceding inclusive range');
    pauseFeedback = new Promise(resolve => {finishFeedback = resolve;});
    const pendingSave = handlers.get('localLatex.inlinePostComment')({thread: boundaryDraft, text: '检查补充内容。'});
    await new Promise(setImmediate);
    const beforeDisplay = notices.length;
    await handlers.get('localLatex.inlineToggleSource')({...c, id: '5', version: 'v1'});
    assert(!notices.slice(beforeDisplay).some(message => message.includes('操作尚未结束')), 'display-only actions must not share the writer busy gate');
    items['3'].version = 'v2'; items['3'].edit.versions.push('v2'); items['3'].candidate = 'Third updated wording.';
    fs.writeFileSync(owner, 'state-during-feedback', 'utf8');
    const beforeQueued = calls.filter(call => call.args.includes('cards')).length;
    await watchChanged(uri(owner));
    assert.equal(calls.filter(call => call.args.includes('cards')).length, beforeQueued, 'a busy writer queues the event instead of running a competing refresh');
    finishFeedback(); await pendingSave;
    assert.equal(ui.records.get('3').c.version, 'v2', 'the queued event is drained immediately after the operation without polling');
    const oldThreads = live(); batch = 'batch-2';
    await ui.refresh(c);
    assert(oldThreads.every(thread => thread.disposed), 'a fresh batch cannot retain old comment/button contexts with reused 1/a labels');
    await handlers.get('localLatex.inlineAccept')({...c, id: '1', version: 'v2'});
    assert.equal(items['1'].edit.status, 'accepted');
    assert(live().some(thread => thread.label.startsWith('3 ·') && thread.collapsibleState === 1), 'acceptance skips the rejected second item and opens the next actual pending card');
    const liveDraft = await ui.annotate({...c, id: '3', version: 'v2'});
    const body = liveDraft.comments[0], beforeRelocation = calls.length;
    const prefix = '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA {"quote":"Third sentence."}\n% CODEX-REVIEW-STATE-END\n';
    document.isDirty = true;
    let unsaved = prefix + text;
    document.getText = r => r ? unsaved.slice(r.start, r.end) : unsaved;
    await changeDocument({document});
    assert.equal(ui.records.get('3').range.start, prefix.length + text.indexOf('Third sentence.'));
    assert.equal(liveDraft.range, ui.records.get('3').range);
    assert.equal(liveDraft.comments[0], body, 'reanchoring preserves the existing original/candidate display and draft');
    assert(live().filter(thread => thread.uri.fsPath === file).every(thread => thread.range.start >= prefix.length), 'no native gutter target lands in this file\'s machine ledger');
    unsaved = prefix + text.replace('Third sentence.', 'Manually rewritten source.');
    await changeDocument({document});
    assert.equal(ui.records.get('3').displayConflict, true);
    assert.equal(liveDraft.range, undefined, 'unmatched original loses its invalid gutter anchor, not its unsaved draft');
    assert.equal(liveDraft.disposed, undefined);
    unsaved = text;
    await changeDocument({document});
    assert.equal(ui.records.get('3').displayConflict, false);
    assert.equal(liveDraft.range.start, text.indexOf('Third sentence.'));
    assert.equal(calls.length, beforeRelocation, 'dirty-buffer positioning does not read/write the backend or compile');
    assert.equal(fs.readFileSync(file, 'utf8'), text);
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

test('cold TeX discovery waits for native Comments registration; code-only projects stay untouched', async () => {
    for (const tex of [false, true]) {
        const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'discovery-'));
        const file = path.join(root, tex ? 'paper.tex' : 'main.js');
        fs.writeFileSync(file, tex ? '\\documentclass{article}\n' : 'const x = 1;\n', 'utf8');
        const calls = [], errors = [], handlers = new Map();
        let commentsRegistered = false;
        const folder = {uri: {fsPath: root}}, before = fs.readFileSync(file);
        const disposable = {dispose() {}};
        const vscode = {
            RelativePattern: class {},
            comments: {createCommentController: () => ({dispose() {}, createCommentThread() {throw new Error('No state, no cards');}})},
            EventEmitter: class {fire() {} dispose() {}},
            window: {visibleTextEditors: [], createTextEditorDecorationType: () => disposable,
                registerUriHandler: () => disposable, onDidChangeActiveTextEditor: () => disposable, onDidChangeTextEditorSelection: () => disposable,
                showErrorMessage: x => errors.push(x)},
            workspace: {isTrusted: true, workspaceFolders: [folder], findFiles: async () => tex ? [{fsPath: file}] : [],
                getConfiguration: () => ({get: (_, fallback) => fallback}), onDidChangeTextDocument: () => disposable, onDidSaveTextDocument: () => disposable, createFileSystemWatcher: fileWatcher},
            languages: {registerCodeLensProvider: () => disposable},
            commands: {registerCommand: (name, handler) => {handlers.set(name, handler); return disposable;},
                getCommands: async () => commentsRegistered ? ['workbench.action.focusCommentsPanel'] : [],
                executeCommand: async name => {
                    if (name === 'workbench.action.focusCommentsPanel' && !commentsRegistered)
                        throw new Error("command 'workbench.action.focusCommentsPanel' not found");
                    calls.push(name);
                }}
        };
        const ui = createInlineReview(vscode, {subscriptions: []}, () => {throw new Error('Discovery must not run a backend without a review owner');});
        await ui.ready;
        assert.deepEqual(errors, []);
        assert.deepEqual(calls, [], 'an unregistered view must not be focused');
        if (tex) {
            commentsRegistered = true;
            await handlers.get('localLatex.inlineReview')();
            assert.deepEqual(errors, []);
            assert.deepEqual(calls, ['workbench.action.focusCommentsPanel'], 'a skipped early attempt must not mark the panel as already shown');
        }
        assert.deepEqual(fs.readFileSync(file), before);
        assert.equal(fs.readdirSync(root).length, 1, 'no review state/cache/project files were created');
    }
});

test('native review-card toolbar exposes review actions with Chinese titles and keeps draft save/cancel inside the card', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const entries = manifest.contributes.menus['comments/commentThread/title'];
    for (const command of ['inlineAccept', 'inlineReject', 'inlineAnnotate', 'inlinePreview', 'inlineNext', 'inlineAddRequests']) {
        const entry = entries.find(e => e.command === 'localLatex.' + command);
        assert(entry, command);
        assert.match(entry.group, /^navigation@/);
        assert.match(entry.when, /commentController == localLatexInlineReview/);
        assert.match(entry.when, /commentThread == localLatexInlineCard/);
        assert.match(manifest.contributes.commands.find(c => c.command === entry.command).title, /[\u4e00-\u9fff]/);
    }
    for (const command of ['inlinePostComment', 'inlineCancelComment']) {
        assert(manifest.contributes.menus['comments/commentThread/context'].some(e =>
            e.command === 'localLatex.' + command && e.when.includes('localLatexInlineDraft')));
    }
    assert(manifest.contributes.keybindings.some(b => b.command === 'localLatex.inlinePreview' && b.key === 'ctrl+alt+d'));
    assert(manifest.activationEvents.includes('workspaceContains:**/*.tex'));
});
