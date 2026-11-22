'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Chinese menu aliases retain original targets, URI arguments, results and failures', async () => {
    const handlers = new Map(), disposables = [], calls = [];
    let failure;
    const result = {unchanged: true};
    const api = {commands: {
        registerCommand(id, fn) {handlers.set(id, fn); return {dispose() {}};},
        async executeCommand(...args) {calls.push(args); if (failure) throw failure; return result;}
    }};
    const sandbox = {module: {exports: {}}, require: id => {assert.equal(id, 'vscode'); return api;}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'menu_commands.js'), 'utf8'), sandbox);
    const {activate, TARGETS} = sandbox.module.exports;
    activate({subscriptions: disposables});
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const definitions = new Map(pkg.contributes.commands.map(x => [x.command, x]));
    assert(![...definitions.keys()].some(id => /bookmark/i.test(id)));
    assert(!pkg.contributes.keybindings.some(item => /bookmark/i.test(item.command)));
    assert.equal(pkg.contributes.menus['bookmarks.editor.context'], undefined);
    const uri = {scheme: 'file', fsPath: 'C:/fixture/含空格的稿件.tex'};
    const extra = {position: 12};
    for (const [name, target] of Object.entries(TARGETS)) {
        const id = 'localLatex.menu.' + name;
        assert(definitions.has(id), 'missing visible command: ' + id);
        assert(/\p{Script=Han}/u.test(definitions.get(id).title));
        assert.equal(await handlers.get(id)(uri, extra), result);
        assert.deepEqual(calls.at(-1), [target, uri, extra]);
    }
    assert.equal(disposables.length, Object.keys(TARGETS).length);
    failure = new Error('original command failure');
    await assert.rejects(handlers.get('localLatex.menu.forwardSync')(uri), error => error === failure);
    const context = pkg.contributes.menus['editor/context'];
    assert.equal(context.filter(x => x.command === 'localLatex.menu.forwardSync').length, 1);
    assert(!context.some(x => x.command === 'latex-workshop.synctex'));
    assert(!context.some(x => /^.*copilot/i.test(x.command || '')));
    for (const item of pkg.contributes.menus['localLatex.sectionActions']) assert(definitions.has(item.command));
    assert(definitions.get('localLatex.startPaperTask').title.includes('选择写作任务'));
    assert(!definitions.get('localLatex.startPaperTask').title.includes('配置与任务合一'));
    assert(pkg.contributes.menus['localLatex.reviewActions'].some(item => item.submenu === 'localLatex.reviewAdvanced'));
    const hidden = new Set(pkg.contributes.menus.commandPalette.filter(item => item.when === 'false').map(item => item.command));
    for (const id of ['localLatex.prepareReviewBlock','localLatex.resolveReviewHost','localLatex.migrateReviewState','localLatex.recoverReviewMigration']) {
        assert(hidden.has(id) && definitions.has(id));
        assert(pkg.contributes.menus['localLatex.reviewAdvanced'].some(item => item.command === id));
    }
    for (const id of ['localLatex.inlineEditCandidate','localLatex.inlineTranslate','localLatex.inlineQuestions']) assert(hidden.has(id) && definitions.has(id));
    assert(definitions.has('localLatex.reviewWorkbench'));
});
