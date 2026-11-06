'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const {activate, confirmedRoot, structuralText} = require('./document_roles');
const {run} = require('./backup');
const dispose = () => ({dispose() {}});

async function fixture(tex = true) {
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'role-ui-'));
    const file = path.join(root, tex ? 'arbitrary.tex' : 'draft.typ');
    const text = tex ? '% !TeX program = pdflatex\n\\documentclass{article}\n\\begin{document}\nOriginal sentence.\n\\end{document}\n' : '= Typst stays unchanged\n';
    await fs.writeFile(file, text, 'utf8');
    const notices = [], calls = [], handlers = new Map();
    let changed, action = '确认并保存', modalHook;
    const uri = p => ({scheme: 'file', fsPath: p});
    const document = {isDirty: false, uri: uri(file)};
    const folder = {uri: uri(root)};
    const vscode = {RelativePattern: class {}, workspace: {isTrusted: true, workspaceFolders: [folder], textDocuments: [document],
        getConfiguration: () => ({get: key => key === 'pythonPath' ? process.env.LOCAL_LATEX_PYTHON || 'python' : undefined}),
        getWorkspaceFolder: () => folder, findFiles: async () => tex ? [uri(file)] : [],
        createFileSystemWatcher: () => ({dispose() {}, onDidChange: f => {changed = f; return dispose();}, onDidCreate: dispose, onDidDelete: dispose}),
        onDidChangeWorkspaceFolders: dispose},
        window: {async showInformationMessage(message, ...buttons) {notices.push({message, buttons});
            if (buttons[0]?.modal) {if (modalHook) await modalHook(); return action;}
        }, showErrorMessage: message => notices.push({error: message}), showQuickPick: async () => undefined},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return dispose();}}};
    const execute = (...args) => {calls.push(args); return run(...args);};
    const ui = activate({subscriptions: []}, vscode, execute);
    await ui.ready;
    return {root, file, text, notices, calls, handlers, document, vscode, ui, execute,
        change: () => changed(uri(file)), set action(value) {action = value;}, set modalHook(value) {modalHook = value;}};
}

test('first confirmation persists one top comment map; only structural changes request confirmation again', async () => {
    const f = await fixture();
    assert.equal(f.notices.length, 1);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.text, 'startup only proposes roles');
    assert.equal(f.calls.length, 1);
    await f.ui.confirm(f.root);
    const saved = await fs.readFile(f.file, 'utf8');
    assert(saved.startsWith('% !TeX program = pdflatex\n% CODEX-FILE-ROLES-BEGIN\n'));
    assert(saved.endsWith(f.text.slice(f.text.indexOf('\\documentclass'))));
    assert(!saved.includes('CODEX-REVIEW-DATA'));
    assert(!saved.includes('CODEX-REVIEW-STATE-BEGIN'));
    assert.equal(await confirmedRoot(f.vscode, f.root, f.file, f.execute), f.file);
    await f.change();
    const count = f.calls.length, notices = f.notices.length;
    await fs.writeFile(f.file, saved.replace('Original sentence.', 'Revised sentence.'), 'utf8');
    await f.change();
    assert.equal(f.calls.length, count, 'ordinary prose does not invoke another full role scan');
    assert.equal(f.notices.length, notices);
    await fs.writeFile(f.file, saved + '\n\\input{new-section}\n', 'utf8');
    await f.change();
    assert(f.notices.at(-1).message.includes('需要重新确认'));
    await assert.rejects(confirmedRoot(f.vscode, f.root, f.file, f.execute), /文件或编译关系已变化/);
    const before = f.notices.length;
    await f.change();
    assert.equal(f.notices.length, before, 'identical change is not announced twice');
    assert.equal((await fs.readdir(f.root)).some(n => n.endsWith('.md')), false);
});

test('cancel, dirty author buffers and stale confirmation never overwrite source', async () => {
    const f = await fixture(); f.action = undefined;
    await f.ui.confirm(f.root);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
    assert.deepEqual(await fs.readdir(f.root), ['arbitrary.tex']);
    f.document.isDirty = true;
    await assert.rejects(f.ui.confirm(f.root), /请先保存/);
    f.document.isDirty = false; f.action = '确认并保存';
    f.modalHook = () => fs.writeFile(f.file, f.text + '\\input{added}\n', 'utf8');
    await assert.rejects(f.ui.confirm(f.root), /文件或编译关系变化/);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.text + '\\input{added}\n');
});

test('Typst/code-only and untrusted projects are not scanned or written', async () => {
    const f = await fixture(false);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.notices, []);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
    f.vscode.workspace.isTrusted = false;
    await assert.rejects(f.ui.confirm(f.root), /先信任/);
    assert.deepEqual(f.calls, []);
});

test('the event key ignores review ledgers but detects includes, classes, root directives and role-map edits', () => {
    const source = '\\documentclass{article}\n\\input{part}\n% !TeX root = paper.tex\nText.';
    assert.equal(structuralText(source), structuralText('% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA {"text":"\\\\input{fake}"}\n% CODEX-REVIEW-STATE-END\n' + source.replace('Text.', 'Other text.')));
    for (const changed of [source.replace('article', 'letter'), source.replace('{part}', '{other}'), source.replace('paper.tex', 'other.tex'),
        '% CODEX-FILE-ROLES-BEGIN\n% {"schema":1}\n% CODEX-FILE-ROLES-END\n' + source]) assert.notEqual(structuralText(source), structuralText(changed));
});
