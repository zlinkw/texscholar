'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {activate} = require('./writing');
test('writing context uses installed guide and current source, adds both to Codex without sending or creating files', async () => {
    const handlers = new Map(), calls = [], messages = [];
    const source = {scheme: 'file', fsPath: '/paper/new-paper.tex'};
    const vscode = {Uri: {file: file => ({scheme: 'file', fsPath: file})}, workspace: {isTrusted: true},
        window: {activeTextEditor: {document: {uri: source, languageId: 'latex'}},
            showInformationMessage: text => messages.push(text), showErrorMessage: text => {throw new Error(text);}},
        commands: {registerCommand: (id, handler) => {handlers.set(id, handler); return {dispose() {}};},
            getCommands: async () => ['chatgpt.addFileToThread'], executeCommand: async (...args) => calls.push(args)}};
    activate({subscriptions: []}, vscode);
    await handlers.get('localLatex.addWritingContext')();
    assert.equal(calls.length, 2);
    assert(calls.every(x => x[0] === 'chatgpt.addFileToThread'));
    assert(calls[0][1].fsPath.endsWith('writing-guide.md'));
    assert.equal(calls[1][1], source);
    assert(messages[0].includes('自行发送'));
});
