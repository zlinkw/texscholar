'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createWorkbench, html, filterItems} = require('./review_workbench');
test('fixed workbench reuses one tab, retains precise B notes, unsaved drafts and next acceptance', async () => {
    let receive, creations = 0, htmlWrites = 0, confirmation, disposed, panel, changed;
    const messages = [], events = [], original = 'The model is strong.';
    const make = id => ({c: {repo: '/fixture', owner: 'reply.tex', id, version: 'v1'}, data: {version: 'v1', original,
        candidate: 'The model is reliable.', fewer_options_reason: 'fixture explanation', source: {text: 'private full source with machine state'}, edit: {file: 'main.tex', kind: 'manuscript', versions: ['v1'], requests: []},
        options: [...'ABC'].map((label, i) => ({label, after: ['The model is reliable.', 'The model is compact.', 'The model is efficient.'][i], reason: label, changes: []}))}});
    const records = new Map(['1', '2', 'a'].map(id => [id, make(id)]));
    const vscode = {commands: {executeCommand: async command => {assert.equal(command, 'localLatex.checkForUpdates'); events.push({type: 'checkUpdates'});}}, Uri: {file: fsPath => ({fsPath})}, ViewColumn: {One: 1}, window: {showWarningMessage: async () => confirmation,
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
        source: async c => events.push({type: 'source', c}),
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
    await send('source');
    assert.deepEqual(events.pop(), {type: 'source', c: view.active}, 'source navigation remains read-only with unsaved candidate and note inputs');
    assert.equal(view.active.id, '1'); assert.equal(view.active.version, 'v1');
    await send('checkUpdates'); assert.equal(events.pop().type, 'checkUpdates', 'manual update check remains usable with unsaved review inputs');
    await send('switch', {target: 'a'}); assert.equal(view.active.id, '1', 'unconfirmed draft cannot disappear');
    await send('dirty', {dirty: false, noteDirty: false});
    await send('save', {option: 'B', value: 'The model is compact and fast.'});
    assert.equal(view.active.version, 'v2');
    const previous = {version: 'v1', requests: [{id: 'old-note', version: 'v1', text: '保留旧版返修要求'}]};
    records.get('1').data.edit.previous_feedback = previous;
    view.sync(records, view.active);
    assert.deepEqual(messages.findLast(m => m.type === 'notes').previous_feedback, previous, 'same-version updates retain the read-only comparison round');
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
    assert(page.includes('data-action="checkUpdates"'));
    const header = page.slice(page.indexOf('<header>'), page.indexOf('</header>'));
    assert(header.split('<details class="more">')[0].includes('id="sourceLocation" data-action="source"'), 'real source navigation has a direct top toolbar entry');
    assert.equal((header.match(/data-action="source"/g) || []).length, 1, 'one source button moves into the overflow menu on narrow windows');
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
    assert.throws(() => view.assertReloadSafe(), /正在进行/, 'running writes block window reload');
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

    // Combined actions preserve ordering, version checks, drafts and failure recovery.
    services.note = originalNote; services.save = originalSave;
    await send('dirty', {dirty: false, noteDirty: false, state: {c: view.active, drafts: {}}});
    await send('latest');
    const realHandoff = services.handoff;
    services.handoff = async c => {events.push({type: 'scoped-handoff', c});};
    await send('note', {text: '仅交接本项', handoff: true});
    assert.equal(events.at(-1).type, 'scoped-handoff'); assert.equal(events.at(-1).c.id, 'a');
    assert.equal(events.at(-2).type, 'note');
    const realNote = services.note;
    services.note = async () => {throw new Error('fixture save failed');};
    const eventCount = events.length;
    await send('note', {text: 'cannot save', handoff: true});
    assert.equal(events.length, eventCount, 'failed save cannot hand off');
    services.note = realNote;
    services.handoff = async () => {throw new Error('fixture Codex unavailable');};
    await send('note', {text: '保存成功但无法交接', handoff: true});
    assert(messages.findLast(m => m.type === 'result').message.includes('批注已保存，但加入 Codex 失败'));
    assert.equal(records.get('a').data.edit.requests.at(-1).text, '保存成功但无法交接');
    assert(messages.findLast(m => m.type === 'handoffRetry').available);
    const countNotes = records.get('a').data.edit.requests.length;
    services.handoff = async c => {events.push({type: 'retry-handoff', c});};
    await send('retryHandoff');
    assert.equal(events.at(-1).c.id, 'a');
    assert.equal(events.at(-1).type, 'retry-handoff');
    assert.equal(records.get('a').data.edit.requests.length, countNotes, 'retry never saves the note again');
    assert.equal(messages.findLast(m => m.type === 'handoffRetry').available, false);
    const eventsAfterRetry = events.length;
    await send('retryHandoff');
    assert.equal(events.length, eventsAfterRetry, 'successful retry clears the target');
    services.handoff = realHandoff;
    await send('dirty', {dirty: true, noteDirty: false, state: {c: view.active, drafts: {A: 'keep other draft', B: 'edit B'}}});
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.match(messages.findLast(m => m.type === 'result').message, /其他方案草稿/);
    await send('dirty', {dirty: true, noteDirty: false, state: {c: view.active, drafts: {B: 'edit B'}}});
    services.save = async () => {throw new Error('fixture save failed');};
    const acceptCount = events.filter(e => e.type === 'accept').length;
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.equal(events.filter(e => e.type === 'accept').length, acceptCount);
    services.save = originalSave;
    const realAccept = services.accept;
    services.accept = async () => {throw new Error('fixture concurrent update');};
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.match(messages.findLast(m => m.type === 'result').message, /接收或跳转返回错误/);
    assert.equal(records.get('a').data.options[1].after, 'edit B');
    assert.equal(view.active.version, 'v2');
    services.accept = realAccept;
    await send('dirty', {dirty: false, noteDirty: false, state: {c: view.active, drafts: {}}});
    services.save = async () => {throw new Error('unchanged text must not create a version');};
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.equal(events.at(-1).type, 'accept'); assert.equal(events.at(-1).c.option, 'B');
    assert.equal(view.active.id, '2');
    assert(page.includes('data-action="noteHandoff"'));
    assert(page.includes('data-action="saveAccept"'));
    assert(page.includes('data-action="retryHandoff"'));
    assert(page.includes('id="comparisonChoice"'));

    // Lightweight view patches retain the draft payload; save-and-switch never accepts it.
    services.save = originalSave;
    await send('dirty', {dirty: true, noteDirty: true, state: {c: {...view.active}, drafts: {A: 'Saved before switch'},
        note: '先保留这个要求', scope: 'group', scrollTop: 10, composer: true}});
    await send('viewStatePatch', {patch: {scrollTop: 222, focus: 'note', textareas: {note: {start: 1, end: 1}}}});
    panel.visible = false; changed({webviewPanel: panel});
    await view.show(view.active); await receive({type: 'ready', instance: 'patch-restored'});
    restored = messages.findLast(m => m.type === 'content');
    assert.equal(restored.resume.scrollTop, 222);
    assert.equal(restored.resume.drafts.A, 'Saved before switch');
    confirmation = '保存并切换';
    const nextItem = make('3'); records.set('3', nextItem); view.setRecords(records);
    const acceptedBeforeSwitch = events.filter(e => e.type === 'accept').length;
    await send('switch', {target: '3'});
    assert.equal(view.active.id, '3');
    assert.equal(records.get('2').data.options[0].after, 'Saved before switch');
    assert.equal(records.get('2').data.edit.requests.at(-1).text, '先保留这个要求');
    assert.equal(events.filter(e => e.type === 'accept').length, acceptedBeforeSwitch);
    await send('dirty', {dirty: true, noteDirty: false, state: {c: {...view.active}, drafts: {B: 'Must survive failed save'}, note: ''}});
    services.save = async () => {throw new Error('fixture failed switch save');};
    await send('switch', {target: '2'});
    assert.equal(view.active.id, '3');
    assert.match(messages.findLast(m => m.type === 'result').message, /未切换/);
    await send('dirty', {dirty: false, noteDirty: false, state: {c: {...view.active}, drafts: {}, note: ''}});
    let finishHandoff;
    services.handoff = async () => new Promise(resolve => {finishHandoff = resolve;});
    const handoffRun = send('handoff');
    await send('note', {text: '交接期间仍可保存新要求'});
    assert.equal(records.get('3').data.edit.requests.at(-1).text, '交接期间仍可保存新要求');
    finishHandoff(); await handoffRun;
});

test('filtered navigation and own saves preserve exact note bindings without accepting or guessing', async () => {
    let receive, version = 1;
    const messages = [], writes = [];
    const records = new Map(['1', '2', 'a', 'b'].map(id => [id, {c: {repo: '/fixture', owner: 'reply.tex', id, version: 'v1'},
        data: {version: 'v1', original: 'Same original.', edit: {kind: /^\d/.test(id) ? 'manuscript' : 'response', file: 'paper.tex', versions: ['v1'], requests: [],
            questions: [{id: id === '2' ? 'R1-Q30' : 'R1-Q3', file: 'reply.tex', quote: 'Question'}]},
        options: [...'ABC'].map(label => ({label, after: label + ' text.', changes: [], reason: label}))}}]));
    const services = {read: async c => structuredClone(records.get(c.id).data), style: () => require('./review_style').defaults,
        selection: () => 'A', pdfStatus: () => '', autoTranslate: () => false,
        directory: () => [...records.values()].map(r => ({id: r.c.id, kind: r.data.edit.kind, questions: r.data.edit.questions.map(q => q.id), requests: 0})),
        save: async (c, label, after) => {writes.push('save'); const r = records.get(c.id); r.data.options.find(o => o.label === label).after = after;
            r.c.version = r.data.version = 'v' + ++version; r.data.edit.versions.push(r.c.version); view.sync(records, c); return structuredClone(r.data);}, saved() {},
        accept: async c => {writes.push('accept'); records.delete(c.id); view.sync(records, c);}};
    const vscode = {Uri: {file: fsPath => ({fsPath})}, ViewColumn: {One: 1}, window: {createWebviewPanel: () => ({visible: true, reveal() {}, dispose() {},
        onDidDispose() {}, onDidChangeViewState() {}, webview: {asWebviewUri: uri => uri.fsPath, onDidReceiveMessage: fn => {receive = fn;}, postMessage: m => messages.push(m)}})}};
    const view = createWorkbench(vscode, {subscriptions: []}, services);
    view.setRecords(records); await view.show(records.get('1').c); await receive({type: 'ready'});
    const send = (type, extra = {}) => receive({type, id: view.active.id, version: view.active.version, ...extra});
    await send('dirty', {dirty: true, noteDirty: true, state: {drafts: {B: 'B changed.'}, note: 'Keep C exact', scope: 'C',
        selected: {side: 'candidate', option: 'C', value: 'C text.', start: 2, end: 6}}});
    await send('save', {option: 'B', value: 'B changed.'});
    let resume = messages.findLast(m => m.type === 'saved').resume;
    assert.equal(resume.selected.option, 'C'); assert.equal(resume.selectionStale, false); assert.equal(resume.scope, 'C');
    await send('save', {option: 'C', value: 'Different C.'});
    resume = messages.findLast(m => m.type === 'saved').resume;
    assert.equal(resume.selectionStale, true); assert.equal(resume.selected.value, 'C text.'); assert.equal(resume.note, 'Keep C exact');
    const saves = writes.length;
    await send('save', {option: 'C', value: 'Different C.'}); assert.equal(writes.length, saves, 'unchanged saves do not create versions');
    await send('save', {option: 'C', value: ''}); assert.equal(records.get('1').data.options[2].after, '', 'deleting all candidate text is valid');
    await send('dirty', {dirty: false, noteDirty: false});
    await send('filter', {filter: {query: 'R1-Q3', kind: 'response', notes: false}});
    await send('next'); assert.equal(view.active.id, 'a');
    await send('next'); assert.equal(view.active.id, 'b');
    await send('previous'); assert.equal(view.active.id, 'a');
    await send('viewState', {state: {c: view.active, drafts: {}, note: '', scrollTop: 321, anchor: {id: 'text-C', top: -20}, focused: 'C', comparison: 'A:C'}});
    services.related = async () => view.show(records.get('1').c);
    await send('related', {index: 0}); assert.equal(view.active.id, '1');
    assert.equal(messages.findLast(m => m.type === 'relatedReturn').id, 'a');
    // The origin can receive an AI update while we inspect another item.
    records.get('a').c.version = records.get('a').data.version = 'returned-v2';
    await send('backRelated'); assert.equal(view.active.id, 'a'); assert.equal(view.active.version, 'returned-v2');
    const returned = messages.findLast(m => m.type === 'content');
    assert.equal(returned.resume.scrollTop, 321); assert.equal(returned.resume.comparison, 'A:C');
    assert.deepEqual(returned.resume.drafts, {}); assert.equal(returned.navigationFilter.kind, 'response');
    await send('viewState', {state: {c: view.active, drafts: {}, note: '', scrollTop: 400, focused: 'C', comparison: 'A:C',
        selected: {value: 'Disposable selection'}, composer: true}});
    records.get('a').c.version = records.get('a').data.version = 'ai-v3'; view.sync(records, view.active);
    const updated = messages.findLast(m => m.type === 'content');
    assert.equal(updated.c.version, 'ai-v3'); assert.equal(updated.resume.scrollTop, 400);
    assert.equal(updated.resume.focused, 'C'); assert.equal(updated.resume.selected, undefined); assert.equal(updated.resume.composer, false);
    await send('accept', {option: 'A'}); assert.equal(view.active.id, 'b');
    await send('related', {index: 0}); assert.equal(view.active.id, '1');
    records.delete('b'); view.setRecords(records);
    await send('backRelated'); assert.equal(view.active.id, '1');
    assert.match(messages.findLast(m => m.type === 'result').message, /不再可用/);
    records.set('b', {c: {repo: '/fixture', owner: 'reply.tex', id: 'b', version: 'v1'}, data: structuredClone(records.get('1').data)});
    records.get('b').data.edit.kind = 'response';
    await send('switch', {target: 'b'});
    await send('accept', {option: 'A'}); assert.equal(view.active.id, 'b', 'do not escape filter after its last item');
    await send('filter', {filter: {query: '', kind: '', notes: false}});
    await send('next'); assert.equal(view.active.id, '1');
    assert.deepEqual(filterItems(services.directory(), {query: 'R1-Q3', kind: '', notes: false}).map(i => i.id), ['1']);
    assert.deepEqual(filterItems(services.directory(), {query: '', kind: '', notes: true}), []);
    assert.equal(records.get('1').data.original, 'Same original.');
});
