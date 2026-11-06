'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createWorkbench, html} = require('./review_workbench');
test('fixed workbench reuses one tab, retains precise B notes, unsaved drafts and next acceptance', async () => {
    let receive, creations = 0, htmlWrites = 0, confirmation, disposed, panel, changed;
    const messages = [], events = [], original = 'The model is strong.';
    const make = id => ({c: {repo: '/fixture', owner: 'reply.tex', id, version: 'v1'}, data: {version: 'v1', original,
        candidate: 'The model is reliable.', fewer_options_reason: 'fixture explanation', source: {text: 'private full source with machine state'}, edit: {file: 'main.tex', kind: 'manuscript', versions: ['v1'], requests: []},
        options: [...'ABC'].map((label, i) => ({label, after: ['The model is reliable.', 'The model is compact.', 'The model is efficient.'][i], reason: label, changes: []}))}});
    const records = new Map(['1', '2', 'a'].map(id => [id, make(id)]));
    const vscode = {Uri: {file: fsPath => ({fsPath})}, ViewColumn: {One: 1}, window: {showWarningMessage: async () => confirmation,
        createWebviewPanel: (_, __, ___, settings) => {creations++; assert.equal(settings.retainContextWhenHidden, false); return panel = {visible: true,
            reveal() {panel.visible = true;}, onDidChangeViewState(fn) {changed = fn;}, dispose() {}, onDidDispose(fn) {disposed = fn;}, webview: {
            cspSource: 'vscode-webview:', asWebviewUri: uri => ({toString: () => 'vscode-resource:' + uri.fsPath}),
            set html(value) {htmlWrites++; assert(value.includes('Content-Security-Policy'));},
            onDidReceiveMessage: fn => {receive = fn;}, postMessage: async value => messages.push(value)}};}}};
    const services = {read: async c => {const record = records.get(c.id); assert.equal(c.version, record.c.version); return structuredClone(record.data);},
        style: () => require('./review_style').defaults, selection: () => 'A', pdfStatus: () => '待更新', autoTranslate: () => false,
        directory: () => [...records.values()].map(r => ({id: r.c.id, ...r.data.edit})),
        note: async (c, selection, text) => {events.push({type: 'note', c, selection, text}); const record = records.get(c.id);
            record.data.edit.requests.push({id: 'note-1', version: c.version, status: 'open', ...selection, text}); view.sync(records, c);},
        editNote: async (c, note, text, previous) => {assert.equal(note.text, previous); const record = records.get(c.id);
            record.data.edit.requests[0].text = text; view.sync(records, c);},
        save: async (c, label, after) => {const r = records.get(c.id); r.data.options.find(o => o.label === label).after = after;
            r.c.version = r.data.version = 'v2'; r.data.edit.versions.push('v2'); view.sync(records, c); return structuredClone(r.data);},
        saved() {}, accept: async c => {events.push({type: 'accept', c}); records.delete(c.id); view.sync(records, c);},
        reopen: async () => events.push({type: 'reopen'}), start: async () => events.push({type: 'start'}), copy: async () => events.push({type: 'copy'}), handoff: async () => events.push({type: 'handoff'}), finish() {}};
    const view = createWorkbench(vscode, {subscriptions: []}, services);
    view.setRecords(records); await view.show(records.get('1').c); await receive({type: 'ready'});
    const content = messages.find(m => m.type === 'content');
    assert(!('source' in content.data)); assert(!('options' in content.data));
    assert.equal(content.options.length, 3);
    assert.equal(content.data.fewer_options_reason, 'fixture explanation', 'the existing reader receives the explanation in data');
    const count = messages.length;
    view.status({...view.active, version: 'old'}, 'PDF 最新');
    view.status({...view.active, id: 'a'}, 'PDF 最新');
    assert.equal(messages.length, count, 'another document or stale version cannot label the current PDF latest');
    const send = (type, extra = {}) => receive({type, id: view.active.id, version: view.active.version, ...extra});
    await send('reopen');
    assert.equal(events.pop().type, 'reopen', 'top button opens an existing PDF without invoking compile/preview');
    await send('start'); assert.equal(events.pop().type, 'start');
    await send('handoff'); assert.equal(events.pop().type, 'handoff');
    assert(html('test').includes('data-action="reopen"'));
    await send('note', {option: 'B', side: 'candidate', value: 'The model is compact.', start: 13, end: 20, text: '限定这个词'});
    assert.deepEqual(events[0].selection, {side: 'candidate', option: 'B', start: 13, end: 20, quote: 'compact'});
    assert(messages.some(m => m.type === 'notes'));
    await send('editNote', {request: 'note-1', text: '修正后的要求', previousText: '限定这个词'});
    assert.equal(records.get('1').data.edit.requests.length, 1);
    assert.equal(records.get('1').data.edit.requests[0].text, '修正后的要求');
    assert(messages.some(m => m.type === 'noteEdited'));
    await send('dirty', {dirty: true, noteDirty: true});
    await send('switch', {target: 'a'}); assert.equal(view.active.id, '1', 'unconfirmed draft cannot disappear');
    await send('dirty', {dirty: false, noteDirty: false});
    await send('save', {option: 'B', value: 'The model is compact and fast.'});
    assert.equal(view.active.version, 'v2');
    assert.equal(records.get('1').data.options[0].after, 'The model is reliable.');
    await send('accept', {option: 'B'});
    assert.equal(events.at(-1).c.option, 'B'); assert.equal(view.active.id, '2');
    await send('switch', {target: 'a'}); assert.equal(view.active.id, 'a');
    assert.equal(creations, 1); assert.equal(htmlWrites, 1, 'switch/save/note never replace webview HTML');
    const notesBefore = events.length;
    await receive({type: 'note', id: '1', version: 'v1', text: 'Stale request'});
    assert.equal(events.length, notesBefore); assert(messages.findLast(m => m.type === 'result').error);
    assert.equal(records.get('a').data.original, original);
    assert(!html('test').includes('http://'), 'network runs in existing backend, not untrusted webview');
    const page = html('nonce-test', {source: 'vscode-webview:', css: 'vscode-resource:/katex.min.css', script: 'vscode-resource:/katex.min.js'});
    assert(page.includes("connect-src 'none'"));
    assert(page.includes('nonce="nonce-test" src="vscode-resource:/katex.min.js"'));
    assert(page.includes('href="vscode-resource:/katex.min.css"'));
    assert(page.includes('id="mathMode"'));
    assert(!page.includes('id="originalSource"'), 'full source is available through the mode button, not a second source block');
    assert(page.includes('data-action="start">AI 论文助手'));
    assert(page.includes('id="configuration"'));
    const header = page.slice(page.indexOf('<header>'), page.indexOf('</header>'));
    assert(header.split('<details class="more">')[0].includes('data-action="handoff"'));
    assert(!header.split('<details class="more">')[1].includes('data-action="handoff"'));
    assert(!page.includes('data-action="connect"')); assert(!page.includes('data-action="copy"'));
    let translations = 0;
    services.autoTranslate = () => true; services.provider = () => 'fixture';
    services.translate = async text => {translations++; return '中文 ' + text;};
    await send('translate'); await view.whenTranslationIdle(); const once = translations;
    await send('translate'); await view.whenTranslationIdle(); assert.equal(translations, once, 'reachable translations are reused');
    disposed(); assert.equal(view.active, undefined);
    view.setRecords(records); await view.show(records.get('a').c); await receive({type: 'ready'}); await view.whenTranslationIdle();
    assert.equal(translations, once * 2, 'closing releases translations; reopening reads current content');
    services.autoTranslate = () => false;
    const state = {c: {...view.active}, drafts: {A: 'Draft A', B: 'Draft B'}, note: '保留未保存要求', composer: true,
        selected: {side: 'candidate', option: 'B', value: 'The model is compact.', start: 13, end: 20}};
    await send('dirty', {dirty: true, noteDirty: true, state});
    const originalSave = services.save;
    let finishSave;
    services.save = async (...args) => {await new Promise(resolve => {finishSave = resolve;}); return originalSave(...args);};
    const cachedRequests = translations;
    const saving = send('save', {option: 'B', value: 'Saved B'});
    await send('reopen'); assert.equal(events.at(-1).type, 'reopen', 'PDF window remains usable during a candidate save');
    await send('accept', {option: 'A'});
    assert(messages.at(-1).error, 'a second review mutation cannot bypass the writer guard');
    panel.visible = false; changed({webviewPanel: panel}); const hiddenCount = messages.length;
    finishSave(); await saving;
    assert.equal(messages.length, hiddenCount, 'background writes update state without posting to a destroyed page');
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-1', state});
    let restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.c.version, 'v2');
    assert.deepEqual(restored.resume.drafts, {A: 'Draft A'});
    assert.equal(restored.resume.note, state.note);
    assert(messages.slice(hiddenCount).some(m => m.type === 'translation'), 'existing translations restore even when automatic translation is off');
    assert.equal(translations, cachedRequests, 'restoring cached translations makes no new service request');
    assert(!messages.slice(hiddenCount).some(m => m.type === 'conflict'), 'the acknowledged own save is not an AI version conflict');
    const readyCount = messages.length;
    await receive({type: 'ready', instance: 'restored-1', state}); assert.equal(messages.length, readyCount, 'one document handshakes only once');
    await send('dirty', {dirty: false, noteDirty: true, state: {...restored.resume, drafts: {}}});
    const originalNote = services.note;
    let finishNote;
    services.note = async (...args) => {await new Promise(resolve => {finishNote = resolve;}); return originalNote(...args);};
    const noting = send('note', {text: '保存一次要求'});
    panel.visible = false; changed({webviewPanel: panel}); finishNote(); await noting;
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-2', state});
    restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.resume.note, ''); assert.equal(restored.resume.composer, false);
    assert.equal(records.get('a').data.edit.requests.length, 1, 'background note completion is not restored as a new unsaved submission');
    await send('dirty', {dirty: true, noteDirty: false, state: {...restored.resume, drafts: {A: '旧版未保存候选'}}});
    panel.visible = false; changed({webviewPanel: panel});
    const updated = records.get('a'); updated.c.version = updated.data.version = 'v3'; updated.data.edit.versions.push('v3');
    view.sync(records, updated.c);
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-3'});
    restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.c.version, 'v2'); assert.equal(restored.resume.drafts.A, '旧版未保存候选');
    assert(messages.some(m => m.type === 'conflict'));

    const stored = new Map(), updatedSettings = [];
    vscode.ConfigurationTarget = {Global: 1, Workspace: 2, WorkspaceFolder: 3};
    vscode.workspace = {getConfiguration: () => ({get: (k, fallback) => stored.get(k) ?? fallback,
        inspect: key => key === 'reviewStyle.controlFontSize' ? {workspaceValue: 13} : {},
        update: async (key, value, target) => {stored.set(key, value); updatedSettings.push({key, value, target});}})};
    services.style = () => require('./review_style').read(vscode.workspace.getConfiguration());
    await send('appearance', {values: {candidateFontSize: 20, controlFontSize: 15, fontFamily: 'Arial, sans-serif'}});
    assert.equal(stored.get('reviewStyle.candidateFontSize'), 20);
    assert.equal(updatedSettings.find(s => s.key === 'reviewStyle.controlFontSize').target, 2, 'preserve effective workspace override');
    const countSettings = updatedSettings.length;
    await send('appearance', {values: {candidateFontSize: 24, controlFontSize: 99}});
    assert.equal(updatedSettings.length, countSettings, 'validate the complete appearance change before writing');
    assert(messages.at(-1).error);
    await send('appearance', {values: {addedColor: '#ffffff'}});
    assert.equal(updatedSettings.length, countSettings, 'screen appearance cannot change shared PDF colors');
    await send('appearance', {reset: true});
    assert.equal(stored.get('reviewStyle.candidateFontSize'), 16);
    assert.equal(records.get('a').data.original, original);
});
