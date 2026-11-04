'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {apply, restore, overlay, activate, configureChktex} = require('./setup');
const path = require('node:path');
const tools = require('./tools');
function fixture(initial = {}) {
    const values = new Map(Object.entries(initial)), state = new Map(), writes = [];
    const vscode = {ConfigurationTarget: {Global: 1}, workspace: {getConfiguration(_, scope) {
        const prefix = scope?.languageId || '';
        return {get(key, fallback) {return values.has(prefix + ':' + key) ? values.get(prefix + ':' + key) : fallback;},
            inspect(key) {return key === 'missing.provider' ? {key} : {defaultValue: null, [prefix ? 'globalLanguageValue' : 'globalValue']: values.get(prefix + ':' + key)};},
            async update(key, value, target, language) {
                assert.equal(target, 1); assert.equal(language, !!prefix);
                values.set(prefix + ':' + key, structuredClone(value)); writes.push(key);
            }};
    }}};
    const context = {globalState: {get: (k, fallback) => state.has(k) ? structuredClone(state.get(k)) : fallback, update: async (k, v) => state.set(k, structuredClone(v))}};
    return {vscode, context, values, writes};
}
test('clean import, repeat import, language scope and selective restore preserve unrelated settings', async () => {
    const f = fixture({':tinymist.exportPdf': 'onSave', ':http.proxy': 'private-user-choice', ':editor.fontSize': 18});
    const rows = [{key: 'editor.fontSize', language: 'latex', value: 16}, {key: 'latex-workshop.view.pdf.zoom', value: 'page-width'},
        {key: 'missing.provider', value: true}];
    const result = await apply(f.vscode, f.context, rows);
    assert.equal(result.applied.length, 2); assert.deepEqual(result.unavailable, ['missing.provider']);
    assert.equal(f.values.get('latex:editor.fontSize'), 16);
    assert.equal((await apply(f.vscode, f.context, rows)).applied.length, 0);
    f.values.set('latex:editor.fontSize', 20);
    const restored = await restore(f.vscode, f.context);
    assert.deepEqual(restored.changed, ['editor.fontSize']);
    assert.equal(f.values.get('latex:editor.fontSize'), 20);
    assert.equal(f.values.get(':latex-workshop.view.pdf.zoom'), undefined);
    assert.equal(f.values.get(':tinymist.exportPdf'), 'onSave');
    assert.equal(f.values.get(':http.proxy'), 'private-user-choice');
    assert.equal(f.values.get(':editor.fontSize'), 18);
});
test('scalar conflicts are retained; explicit preset replacement preserves other PDF and Typst associations', async () => {
    const f = fixture({':latex-workshop.view.pdf.zoom': 'auto', ':workbench.editorAssociations': {'*.typ': 'typst-viewer', '*.pdf': 'other'}});
    const rows = [{key: 'latex-workshop.view.pdf.zoom', value: 'page-width'},
        {key: 'workbench.editorAssociations', value: {'*.pdf': 'latex-workshop-pdf-hook'}}];
    assert.equal((await apply(f.vscode, f.context, rows)).conflicts.length, 2);
    await apply(f.vscode, f.context, rows, true);
    assert.equal(f.values.get(':workbench.editorAssociations')['*.typ'], 'typst-viewer');
    assert.equal(f.values.get(':workbench.editorAssociations')['*.pdf'], 'latex-workshop-pdf-hook');
    await restore(f.vscode, f.context);
    assert.equal(f.values.get(':latex-workshop.view.pdf.zoom'), 'auto');
});
test('owned tool recipes update by name rather than duplicating or erasing other recipes', async () => {
    const f = fixture({':latex-workshop.latex.tools': [{name: 'author-xelatex', command: 'xelatex'}]});
    const row = {key: 'latex-workshop.latex.tools', value: [{name: 'local-paper-pdf', command: '/first/latexmk'}]};
    await apply(f.vscode, f.context, [row]);
    row.value[0].command = '/second/latexmk';
    await apply(f.vscode, f.context, [row]);
    const values = f.values.get(':' + row.key);
    assert.equal(values.length, 2); assert.equal(values[1].command, '/second/latexmk');
    assert.equal(overlay({'*.typ': 'keep'}, {'*.pdf': 'workshop'})['*.typ'], 'keep');
});
test('platform discovery uses Windows executables and macOS TeX/Homebrew paths without case folding Mac files', () => {
    const winDirs = tools.searchDirectories('win32', {PATH: 'D:\\Bin', LOCALAPPDATA: 'C:\\Local'}, 'C:\\User');
    assert(winDirs.includes('C:\\Local\\Programs\\TinyTeX\\bin\\windows'));
    assert.equal(tools.findExecutable(['git'], winDirs, 'win32', x => x === 'D:\\Bin\\git.exe'), 'D:\\Bin\\git.exe');
    const macDirs = tools.searchDirectories('darwin', {PATH: '/usr/bin'}, '/Users/author');
    assert(macDirs.includes('/Library/TeX/texbin')); assert(macDirs.includes('/opt/homebrew/bin'));
    assert.equal(tools.findExecutable(['latexmk'], macDirs, 'darwin', x => x === '/Library/TeX/texbin/latexmk'), '/Library/TeX/texbin/latexmk');
    assert.equal(tools.samePath('/paper/A.tex', '/paper/a.tex', 'darwin'), false);
    assert.equal(tools.samePath('C:\\Paper\\A.tex', 'c:\\paper\\a.tex', 'win32'), true);
});
test('ChkTeX adapter preserves the configured checker/flags, upgrades without nesting and restores original settings', async () => {
    const executable = 'latex-workshop.linting.chktex.exec.path', args = 'latex-workshop.linting.chktex.exec.args';
    const flags = ['-wall', '-n22', '-n30', '-e16', '-q', '-l', '/author settings/chktexrc'];
    const f = fixture({[':' + executable]: '/author tools/chktex', [':' + args]: flags,
        ':latex-workshop.linting.chktex.enabled': true, ':tinymist.exportPdf': 'onSave'});
    const found = {pythonPath: '/python tools/python3', chktexPath: '/discovered/chktex'};
    await configureChktex(f.vscode, f.context, found);
    const wrapped = f.values.get(':' + args);
    assert.deepEqual(wrapped, ['-X', 'utf8', path.join(__dirname, 'chktex_filter.py'), '--chktex', '/author tools/chktex', '--', ...flags]);
    assert.equal(f.values.get(':' + executable), found.pythonPath);
    const writes = f.writes.length;
    await configureChktex(f.vscode, f.context, found);
    assert.equal(f.writes.length, writes, 'repeat activation makes no settings writes');
    f.values.set(':' + args, [...wrapped.slice(0, 2), path.join('/old extension version', 'chktex_filter.py'), ...wrapped.slice(3)]);
    await configureChktex(f.vscode, f.context, found);
    assert.deepEqual(f.values.get(':' + args), wrapped, 'upgrade changes only the adapter path, not checker flags');
    await restore(f.vscode, f.context);
    assert.equal(f.values.get(':' + executable), '/author tools/chktex');
    assert.deepEqual(f.values.get(':' + args), flags);
    assert.equal(f.values.get(':latex-workshop.linting.chktex.enabled'), true);
    assert.equal(f.values.get(':tinymist.exportPdf'), 'onSave');
    const missing = fixture({[':' + executable]: '/native/chktex'});
    await configureChktex(missing.vscode, missing.context, {});
    assert.deepEqual(missing.writes, [], 'missing Python must not disable the native checker');
});
test('activating in a code-only or untrusted project applies no user settings', async () => {
    for (const trusted of [true, false]) {
        const f = fixture();
        f.context.subscriptions = [];
        f.vscode.window = {createOutputChannel: () => ({appendLine() {}, dispose() {}})};
        f.vscode.commands = {registerCommand: () => ({dispose() {}})};
        f.vscode.extensions = {onDidChange: () => ({dispose() {}})};
        Object.assign(f.vscode.workspace, {isTrusted: trusted, workspaceFolders: [{}], findFiles: async () => []});
        await activate(f.context, f.vscode);
        assert.deepEqual(f.writes, []);
    }
});
