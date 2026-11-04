'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const core = require('./core');
const GIT = process.env.LOCAL_LATEX_GIT || 'git';
const FMT = process.env.LOCAL_LATEX_FORMATTER || 'tex-fmt';
const parent = path.resolve(process.env.LOCAL_LATEX_TEST_ROOT);
assert(parent.includes('latex-writing-checks'));
const env = {...process.env};
for (const k of Object.keys(env)) if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES)$/i.test(k)) delete env[k];
function git(root, args) {
    const r = cp.spawnSync(GIT, args, {cwd: root, env, encoding: 'utf8', windowsHide: true});
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
}
function editorFixture(name, useGit = true) {
    fs.mkdirSync(parent, {recursive: true});
    const root = fs.mkdtempSync(path.join(parent, name + '-'));
    if (useGit) {
    git(root, ['init', '-b', 'master']);
    assert.equal(fs.realpathSync(git(root, ['rev-parse', '--show-toplevel'])).toLowerCase(), fs.realpathSync(root).toLowerCase());
    git(root, ['config', 'user.name', 'Local editor test']);
    git(root, ['config', 'user.email', 'editor-test@example.invalid']);
    git(root, ['config', 'core.autocrlf', 'false']);
    }
    const file = path.join(root, 'main.tex');
    let value = '\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item 中文注释外的测试。\n\\end{itemize}\n\\end{document}\n';
    fs.writeFileSync(file, value, 'utf8');
    if (useGit) {git(root, ['add', '--', 'main.tex']); git(root, ['commit', '-m', 'baseline']);}
    const notifications = [];
    const callbacks = new Map();
    const document = {
        uri: {scheme: 'file', fsPath: file}, languageId: 'latex',
        version: 1, isDirty: false, isClosed: false,
        getText: () => value, positionAt: x => x,
        async save() { fs.writeFileSync(file, value, 'utf8'); this.isDirty = false; return true; }
    };
    const api = {
        Range: class {constructor(start, end) {this.start = start; this.end = end;}},
        workspace: {isTrusted: true, getConfiguration: () => ({get: k => k === 'gitPath' ? GIT : FMT})},
        window: {
            activeTextEditor: {
                document,
                async edit(build) {
                    build({replace(range, text) {assert.equal(range.start, 0); value = text;}});
                    document.version++; document.isDirty = true; return true;
                }
            },
            showWarningMessage: x => notifications.push(['warning', x]),
            showInformationMessage: x => notifications.push(['info', x]),
            showErrorMessage: x => notifications.push(['error', x])
        },
        commands: {registerCommand(id, fn) {callbacks.set(id, fn); return {dispose() {}};}}
    };
    function load(backend = core, command = 'localLatex.formatOnly') {
        const sandbox = {exports: {}, require: id => id === 'vscode' ? api : id === './core' ? backend : require(id)};
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8'), sandbox, {filename: 'extension.js'});
        sandbox.exports.activate({subscriptions: []});
        assert.equal(callbacks.has('localLatex.formatAndCommit'), false);
        return callbacks.get(command);
    }
    function authorEdit(text) { value = text; document.isDirty = true; document.version++; }
    return {root, file, document, load, notifications, authorEdit};
}
test('manual formatting saves indentation without any Git repository', async () => {
    const f = editorFixture('editor-no-git', false), original = f.document.getText();
    await f.load({formatText: core.formatText})();
    assert(!f.notifications.some(([kind]) => kind === 'error'), JSON.stringify(f.notifications));
    const saved = fs.readFileSync(f.file, 'utf8');
    assert(saved.includes('  \\item '));
    assert.equal(saved.replace(/^[ \t]*/gm, ''), original.replace(/^[ \t]*/gm, ''));
    assert(!fs.existsSync(path.join(f.root, '.git')));
});
test('save/build compiles only after a successful LaTeX save and never handles Typst', async () => {
    const f = editorFixture('save-build', false), command = f.load(core, 'localLatex.saveBuild');
    // This small command fixture uses the same native save contract; no TeX
    // compilation is needed to check the failure/ordering boundary.
    f.document.save = async () => false;
    await command();
    assert(f.notifications.some(([kind, message]) => kind === 'error' && message.includes('保存失败')));
    f.document.languageId = 'typst';
    f.document.save = async () => {throw new Error('Typst save must stay with its own provider');};
    await command();
});
test('formatting saves only indentation and repeated use never creates a Git commit', async () => {
    const f = editorFixture('editor-command'), head = git(f.root, ['rev-parse', 'HEAD']);
    await f.load()();
    assert(fs.readFileSync(f.file, 'utf8').includes('  \\item '));
    assert.equal(f.document.isDirty, false);
    assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
    await f.load()();
    assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
});
test('unsaved prose can be formatted while current-file partial staging and other staged work remain exact', async () => {
    const f = editorFixture('editor-staging'), original = f.document.getText();
    fs.writeFileSync(f.file, original.replace('测试。', '部分暂存。'), 'utf8');
    git(f.root, ['add', '--', 'main.tex']);
    f.authorEdit(original.replace('测试。', '正文修改。'));
    fs.writeFileSync(path.join(f.root, 'other.txt'), 'staged author work\n', 'utf8');
    git(f.root, ['add', '--', 'other.txt']);
    const index = fs.readFileSync(path.join(f.root,'.git/index')), head = git(f.root,['rev-parse','HEAD']);
    await f.load()();
    assert(!f.notifications.some(([kind]) => kind === 'error'), JSON.stringify(f.notifications));
    assert(fs.readFileSync(path.join(f.root,'.git/index')).equals(index));
    assert.equal(git(f.root,['rev-parse','HEAD']),head);
    assert(fs.readFileSync(f.file,'utf8').includes('正文修改。'));
});
test('inline environments and original source line structure survive independent manual formatting', async () => {
    const f = editorFixture('editor-layout');
    const edited = f.document.getText().replace('\\begin{document}\n', '\\begin{document}\n\\begin{enumerate}\\item Compact text.\\end{enumerate}\n');
    f.authorEdit(edited); await f.load()();
    const saved = fs.readFileSync(f.file,'utf8');
    assert.equal(saved.replace(/^[ \t]*/gm,''),edited.replace(/^[ \t]*/gm,''));
    assert(!f.notifications.some(([kind]) => kind === 'error'));
});
test('editing while the formatter runs never overwrites the newer author buffer', async () => {
    const f = editorFixture('editor-race'), bytes = fs.readFileSync(f.file);
    const backend = {...core, async formatText(...args) {
        const result = await core.formatText(...args);
        f.authorEdit('Author changed the buffer during formatting.');
        return result;
    }};
    await f.load(backend)();
    assert(f.notifications.some(([kind,text]) => kind === 'error' && text.includes('新编辑')));
    assert(fs.readFileSync(f.file).equals(bytes));
    assert.equal(f.document.getText(),'Author changed the buffer during formatting.');
});
test('save failure remains visible and does not run Git hooks or create a commit', async () => {
    const f = editorFixture('editor-save-failure'), head = git(f.root,['rev-parse','HEAD']);
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\nexit 1\n','utf8');
    f.document.save = async () => false;
    await f.load()();
    assert(f.notifications.some(([kind,text]) => kind === 'error' && text.includes('保存失败')));
    assert.equal(git(f.root,['rev-parse','HEAD']),head);
    assert.equal(f.document.isDirty,true);
});
test('already-indented unsaved prose is saved without a content or formatting Git commit', async () => {
    const f = editorFixture('editor-no-op'), head = git(f.root,['rev-parse','HEAD']);
    const text = f.document.getText().replace('\\item ','  \\item ').replace('测试。','无需调整。');
    f.authorEdit(text); await f.load()();
    assert.equal(fs.readFileSync(f.file,'utf8'),text);
    assert.equal(f.document.isDirty,false);
    assert.equal(git(f.root,['rev-parse','HEAD']),head);
});
test('formatter failure preserves source, unsaved author work and Git history', async () => {
    const f = editorFixture('editor-formatter-failure'), bytes = fs.readFileSync(f.file);
    const text = f.document.getText()+'% unsaved author note\n';
    f.authorEdit(text);
    const head = git(f.root,['rev-parse','HEAD']);
    await f.load({formatText: async () => {throw new Error('fixture-formatter-refused');}})();
    assert(f.notifications.some(([kind,message]) => kind === 'error' && message.includes('fixture-formatter-refused')));
    assert.equal(f.document.getText(),text);
    assert(fs.readFileSync(f.file).equals(bytes));
    assert.equal(git(f.root,['rev-parse','HEAD']),head);
});
