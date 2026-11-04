'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('native unused-citation check resolves output placeholders, preserves files and refuses stale/child documents', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'latex-citations-'));
    const file = path.join(root, 'draft.tex'), out = path.join(root, '.latex-build', 'draft');
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(file, '\\documentclass{article}\n\\begin{document}Text.\\end{document}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'refs.bib'), '@article{used,\n title={Used},\n author={A, B},\n year={2024}\n}\n@article{unused,\n title={Unused},\n author={C, D},\n year={2025}\n}\n', 'utf8');
    const aux = path.join(out, 'draft.aux');
    fs.writeFileSync(aux, '\\relax\n\\citation{used}\n\\bibdata{refs}\n', 'utf8');
    fs.utimesSync(file, new Date(1000000), new Date(1000000));
    const original = fs.readFileSync(file), commands = {}, errors = [], picks = [];
    const document = {languageId: 'latex', uri: {scheme: 'file', fsPath: file}, isDirty: false, getText: () => fs.readFileSync(file, 'utf8')};
    const api = {
        window: {activeTextEditor: {document}, showErrorMessage: x => errors.push(x), showInformationMessage() {}, showQuickPick: async x => {picks.push(Array.from(x));}},
        workspace: {isTrusted: true, getWorkspaceFolder: () => ({uri: {fsPath: root}}), getConfiguration: name => ({get: key => name === 'latex-workshop' ? '%DIR%/.latex-build/%DOCFILE%' : process.env.LOCAL_LATEX_CHECKCITES || 'checkcites'})},
        languages: {registerFoldingRangeProvider() {return {dispose() {}};}},
        commands: {registerCommand(id, fn) {commands[id] = fn; return {dispose() {}};}}
    };
    const sandbox = {module: {exports: {}}, process, require: id => id === 'vscode' ? api : require(id)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'navigation.js'), 'utf8'), sandbox);
    sandbox.module.exports.activate({subscriptions: []});
    await commands['localLatex.checkUnusedCitations']();
    assert.deepEqual(errors, []);
    assert.deepEqual(picks, [['unused']]);
    assert.deepEqual(fs.readFileSync(file), original);
    fs.writeFileSync(aux, '\\relax\n\\citation{used}\n\\bibdata{missing-file}\n', 'utf8');
    await commands['localLatex.checkUnusedCitations']();
    assert.equal(errors.length, 1, 'exit 1 without a valid report must remain an error');
    assert.equal(picks.length, 1);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 10000));
    await commands['localLatex.checkUnusedCitations']();
    assert.match(errors.at(-1), /重新编译/);
    document.getText = () => 'A child section.';
    await commands['localLatex.checkUnusedCitations']();
    assert.match(errors.at(-1), /主文档/);
});
test('existing CODEX blocks fold without inserting source comments or changing the document', async () => {
    const source = ['% CODEX-RULES-BEGIN', '% 中文规则', '% CODEX-RULES-END', '\\section{Method}',
        '% CODEX-PARAGRAPH-PLAN-BEGIN', '% paragraph plan', '% CODEX-PARAGRAPH-PLAN-END', 'Text.'];
    const original = source.join('\n');
    let provider; const commands = {}, calls = [];
    const document = {languageId: 'latex', lineCount: source.length, lineAt: i => ({text: source[i]})};
    const api = {
        window: {activeTextEditor: {document}},
        languages: {registerFoldingRangeProvider(selector, value) {provider = value; return {dispose() {}};}},
        FoldingRange: class {constructor(start, end, kind) {Object.assign(this, {start, end, kind});}},
        FoldingRangeKind: {Comment: 'comment'},
        commands: {
            registerCommand(id, fn) {commands[id] = fn; return {dispose() {}};},
            async executeCommand(...args) {calls.push(args);}
        }
    };
    const sandbox = {module: {exports: {}}, require: id => id === 'vscode' ? api : require(id)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'navigation.js'), 'utf8'), sandbox);
    sandbox.module.exports.activate({subscriptions: []});
    const ranges = provider.provideFoldingRanges(document);
    assert.deepEqual(Array.from(ranges, r => [r.start, r.end]), [[0, 2], [4, 6]]);
    await commands['localLatex.foldReviewComments']();
    assert.equal(calls[0][0], 'editor.fold');
    assert.deepEqual(Array.from(calls[0][1].selectionLines), [0, 4]);
    assert.equal(source.join('\n'), original);
    assert.equal(commands['localLatex.compareHistory'], undefined);
});
test('visual shortcuts pass the active custom-tab URI and never format another document', async () => {
    const uri = {scheme: 'file', path: '/paper/draft.tex', toString: () => 'file:///paper/draft.tex'};
    const commands = {}, calls = [];
    let switchCorrectly = false;
    const api = {
        window: {tabGroups: {activeTabGroup: {activeTab: {input: {uri}}}}},
        workspace: {isTrusted: true},
        languages: {registerFoldingRangeProvider() {return {dispose() {}};}},
        commands: {
            registerCommand(id, fn) {commands[id] = fn; return {dispose() {}};},
            async executeCommand(id, target) {
                calls.push([id, target]);
                if (id === 'latexVisualEditor.openSource' && switchCorrectly) api.window.activeTextEditor = {document: {uri}};
            }
        }
    };
    const sandbox = {module: {exports: {}}, require: id => id === 'vscode' ? api : require(id)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'navigation.js'), 'utf8'), sandbox);
    sandbox.module.exports.activate({subscriptions: []});
    await commands['localLatex.toggleVisual']();
    assert.equal(calls[0][1], uri);
    await commands['localLatex.formatFromVisual']();
    assert(!calls.some(x => x[0] === 'localLatex.formatOnly'));
    switchCorrectly = true;
    await commands['localLatex.formatFromVisual']();
    assert.equal(calls.at(-1)[0], 'localLatex.formatOnly');
});
