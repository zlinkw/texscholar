'use strict';
// Native comment/editor APIs require their own host fixture; backend writes are covered by native_review_test.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createInlineReview, markedWords, displayText, summary, deletionPreview} = require('./inline_review');

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
            onDidChangeTextDocument: () => ({dispose() {}})},
        languages: {registerCodeLensProvider(selector, provider) {lensProvider = provider; return {dispose() {}};}},
        window: {activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: () => ({dispose() {}}),
            async showTextDocument(target, options) {calls.push(['showTextDocument', target, options]); return editor;},
            async withProgress(options, action) {return action();}, registerUriHandler: () => ({dispose() {}}), onDidChangeActiveTextEditor: () => ({dispose() {}}),
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
        if (args.includes('feedback')) {edit.requests.push({...input, status: 'open'}); return '{}';}
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
    assert.deepEqual(card.isTrusted, {enabledCommands: ['localLatex.inlineQuestions', 'localLatex.jumpQuestion', 'localLatex.inlineToggleSource']});
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
    await ui.post({thread: draft, text: '保留 fast，只调整选中的词。'});
    assert.equal(edit.requests[0].quote, 'strong');
    assert.equal(edit.requests[0].start, oldStart);
    assert.equal(value, original);
    await handlers.get('localLatex.inlineAddRequests')(threads.at(-1));
    const handoff = calls.find(x => x[0] === 'chatgpt.addFileToThread');
    assert(handoff);
    assert(fs.readFileSync(handoff[1].fsPath, 'utf8').includes('保留 fast，只调整选中的词。'));
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
                registerUriHandler: () => disposable, onDidChangeActiveTextEditor: () => disposable,
                showErrorMessage: x => errors.push(x)},
            workspace: {isTrusted: true, workspaceFolders: [folder], findFiles: async () => tex ? [{fsPath: file}] : [],
                getConfiguration: () => ({get: (_, fallback) => fallback}), onDidChangeTextDocument: () => disposable},
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
