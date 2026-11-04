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
});
