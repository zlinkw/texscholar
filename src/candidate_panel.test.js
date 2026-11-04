'use strict';
// Webview DOM/message lifecycle is isolated from native comment/editor fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createCandidatePanel, selection} = require('./candidate_panel');

test('candidate selection keeps exact CRLF, repeated words and Unicode code-point offsets', () => {
    const raw = '% 注释\r\n😀 reliable and reliable.\r\n';
    const value = raw.replace(/\r\n/g, '\n');
    const start = value.lastIndexOf('reliable');
    const selected = selection(raw, value, start, start + 8);
    assert.equal(Array.from(raw).slice(selected.start, selected.end).join(''), 'reliable');
    assert.equal(selected.start, Array.from(raw.slice(0, raw.lastIndexOf('reliable'))).length);
    const a = value.indexOf('\n');
    assert.equal(selection(raw, value, a, a + 3).quote, '\r\n😀');
    assert.throws(() => selection(raw, value, a + 2, a + 3), /Unicode/);
    assert.throws(() => selection(raw, value + 'unsaved', start, start + 8), /先保存/);
    assert.throws(() => selection(raw, value, start, start), /选中/);
});

test('the shared candidate panel edits pending text and posts exact notes without replacing its DOM', async () => {
    const events = [], messages = [], elements = new Map();
    let receive, dispose, htmlWrites = 0, savedFailure = true, disposed = false;
    const data = {version: 'v1', original: 'Original words.', candidate: '😀 Candidate words.\r\n', edit: {file: 'reply.tex', versions: ['v1']}};
    const originalSource = data.original;
    const view = {webview: {
        set html(value) {htmlWrites++; this.source = value;},
        postMessage(message) {messages.push(message); browserMessage({data: message}); return Promise.resolve(true);},
        onDidReceiveMessage(handler) {receive = handler;}
    }, onDidDispose(handler) {dispose = handler;}, dispose() {disposed = true; dispose();}};
    const vscode = {ViewColumn: {Beside: 2}, window: {createWebviewPanel(type, title, column, options) {
        assert.equal(options.localResourceRoots.length, 0); assert(options.enableScripts);
        events.push(['open', type, title, column]); return view;
    }}};
    const services = {
        read: async c => {assert.equal(c.version, data.version); return structuredClone(data);},
        save: async (c, after) => {
            assert.equal(c.version, data.version);
            if (savedFailure) throw new Error('Concurrent owner update');
            data.version = 'v2'; data.edit.versions.push('v2'); data.candidate = after;
            events.push(['save', c.id, after]); return structuredClone(data);
        },
        note: async (c, selected, text) => {assert.equal(c.version, data.version); events.push(['note', c.id, selected, text]);},
        back: async c => events.push(['back', c.id])
    };
    const panel = createCandidatePanel(vscode, {subscriptions: []}, services);
    await panel.show({id: 'a', version: 'v1'});
    let browserMessage;
    const queue = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, {textContent: '', disabled: false, selectionStart: 0, selectionEnd: 0, handlers: {},
            _value: '', set value(text) {this._value = String(text).replace(/\r\n/g, '\n');}, get value() {return this._value;},
            addEventListener(type, handler) {this.handlers[type] = handler;}});
        return elements.get(id);
    };
    const script = /<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/.exec(view.webview.source)[1];
    vm.runInNewContext(script, {document: {getElementById: element}, window: {addEventListener(type, handler) {browserMessage = handler;}},
        acquireVsCodeApi: () => ({postMessage(message) {queue.push(receive(message));}})});
    await Promise.all(queue.splice(0));
    const candidate = element('candidate'), note = element('note');
    assert.equal(candidate.value, data.candidate.replace(/\r\n/g, '\n'));
    note.value = '针对整项原文的返修要求。'; note.handlers.input();
    assert.equal(element('annotate').disabled, false, 'no mouse selection is required');
    element('annotate').handlers.click(); await Promise.all(queue.splice(0));
    const whole = events.find(event => event[0] === 'note')[2];
    assert.deepEqual(whole, {side: 'original', start: 0, end: Array.from(data.original).length, quote: data.original});
    candidate.value = '😀 Revised candidate words.\n'; candidate.handlers.input();
    element('save').handlers.click(); await Promise.all(queue.splice(0));
    assert.equal(candidate.value, '😀 Revised candidate words.\n', 'a conflict preserves unsaved text');
    assert.match(element('status').textContent, /Concurrent/);
    assert.equal(data.version, 'v1');
    savedFailure = false;
    element('save').handlers.click(); await Promise.all(queue.splice(0));
    assert.equal(data.version, 'v2');
    assert.equal(data.candidate, '😀 Revised candidate words.\r\n');
    candidate.selectionStart = candidate.value.indexOf('candidate'); candidate.selectionEnd = candidate.selectionStart + 9;
    candidate.handlers.select();
    note.value = '这里只改候选。'; note.handlers.input();
    assert.equal(element('annotate').disabled, false);
    element('annotate').handlers.click(); await Promise.all(queue.splice(0));
    const saved = events.filter(event => event[0] === 'note').at(-1);
    assert.equal(saved[2].quote, 'candidate');
    assert.equal(saved[2].side, 'candidate');
    assert.equal(Array.from(data.candidate).slice(saved[2].start, saved[2].end).join(''), 'candidate');
    assert.equal(note.value, '');
    candidate.selectionStart = candidate.selectionEnd; candidate.handlers.mouseup();
    assert.match(element('scope').textContent, /整项原文/);
    assert.equal(data.original, originalSource, 'editing a candidate never applies it to the manuscript');
    assert.equal(htmlWrites, 1, 'save/note operations update controls, not the whole webview DOM');
    assert.equal(disposed, false);
    element('back').handlers.click(); await Promise.all(queue.splice(0));
    assert(events.some(event => event[0] === 'back'));
});
