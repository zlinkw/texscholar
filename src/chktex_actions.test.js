'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const chktex = process.env.LOCAL_LATEX_CHKTEX || 'chktex';
const workshop = process.env.LOCAL_LATEX_WORKSHOP;
assert(workshop, 'Set LOCAL_LATEX_WORKSHOP to the installed Workshop out/src/lint/latex-code-actions.js');
class Position {constructor(line, character) {Object.assign(this, {line, character});} translate(l, c) {return new Position(this.line + l, this.character + c);}}
class Range {
    constructor(a, b, c, d) {this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b;}
    contains(p) {return (p.line > this.start.line || p.line === this.start.line && p.character >= this.start.character)
        && (p.line < this.end.line || p.line === this.end.line && p.character <= this.end.character);}
    intersection(r) {return this.contains(r.start) || r.contains(this.start) ? this : undefined;}
    with(start, end = this.end) {return new Range(start, end);}
}
function fixture(source) {
    let text = source, provider, hover, native;
    const commands = {}, calls = [], errors = [], edits = [];
    const uri = {scheme: 'file', toString: () => 'file:///fixture.tex'};
    const document = {uri, version: 1, languageId: 'latex',
        get lineCount() {return text.split(/\r?\n/).length;},
        get eol() {return text.includes('\r\n') ? 2 : 1;},
        lineAt(i) {const line = text.split(/\r?\n/)[i]; return {lineNumber: i, text: line, range: new Range(i, 0, i, line.length)};},
        offsetAt(p) {const lines = text.split('\n'); return lines.slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.character;},
        getText(r) {return r ? text.slice(this.offsetAt(r.start), this.offsetAt(r.end)) : text;}};
    const diagnostics = [];
    const editor = {document};
    const api = {Position, Range, Selection: Range, EndOfLine: {CRLF: 2},
        Uri: {parse: () => uri},
        CodeActionKind: {QuickFix: 'quickfix'},
        CodeAction: class {constructor(title, kind) {Object.assign(this, {title, kind});}},
        WorkspaceEdit: class {constructor() {this.edits = [];} insert(uri, p, s) {this.replace(uri, new Range(p, p), s);} replace(uri, range, text) {this.edits.push({range, text});}},
        MarkdownString: class {constructor() {this.value = '';} appendText(s) {this.value += s;} appendMarkdown(s) {this.value += s;}},
        Hover: class {constructor(contents, range) {Object.assign(this, {contents, range});}},
        workspace: {isTrusted: true, openTextDocument: async () => document, async applyEdit(edit) {
            edits.push(edit);
            for (const e of edit.edits.sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start))) {
                text = text.slice(0, document.offsetAt(e.range.start)) + e.text + text.slice(document.offsetAt(e.range.end));
            }
            document.version++; return true;
        }},
        window: {showErrorMessage: e => errors.push(e), showInformationMessage() {}, showTextDocument: async () => editor},
        languages: {
            getDiagnostics: () => diagnostics,
            registerCodeActionsProvider(s, p, metadata) {assert.equal(metadata.providedCodeActionKinds[0], 'quickfix'); provider = p; return {};},
            registerHoverProvider(s, p) {hover = p; return {};}
        },
        extensions: {getExtension: () => ({activate: async () => {}})},
        commands: {registerCommand(id, fn) {commands[id] = fn; return {};}, async executeCommand(id, ...args) {
            calls.push([id, ...args]);
            if (id === 'latex-workshop.code-action') return native(...args);
        }}
    };
    function load(file, extra = {}) {
        const sandbox = {exports: {}, module: {exports: {}}, require: id => id === 'vscode' ? api : extra[id] ?? require(id)};
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, {filename: file});
        return sandbox;
    }
    native = load(workshop, {'../lw': {lw: {}}}).exports.action;
    load(path.join(__dirname, 'chktex_actions.js')).module.exports.activate({subscriptions: []});
    return {document, diagnostics, calls, errors, edits, editor, api,
        add(code, line, start, end, message = 'Warning') {
            const d = {source: 'ChkTeX', code, range: new Range(line, start, line, end), message}; diagnostics.push(d); return d;
        },
        actions(d) {return provider.provideCodeActions(document, d.range, {diagnostics});},
        action(d, mode) {return this.actions(d).find(a => a.command.arguments[0] === mode);},
        run(action) {return commands[action.command.command](...action.command.arguments);},
        hover(p) {return hover.provideHover(document, p);},
        commands};
}
function lint(text) {
    const result = cp.spawnSync(chktex, ['-I0', '-q', '-w46', '-w41', '-f%n:%l\n'], {input: text, encoding: 'utf8', windowsHide: true});
    assert.ifError(result.error);
    assert([0, 1, 2, 3].includes(result.status), `${result.status}: ${result.stderr}`);
    assert(!/ChkTeX ERROR/.test(result.stderr), result.stderr);
    return result.stdout.trim().split('\n').filter(Boolean).map(s => s.trim());
}
const header = '\\documentclass{article}\n\\begin{document}\n';
const tail = '\n\\end{document}\n';

test('native Quick Fix exposes four Chinese operations, with no automatic action or fake fix for 41', () => {
    const f = fixture('\\vskip1mm'); const d = f.add({value: '41'}, 0, 0, 6);
    const actions = f.actions(d);
    assert.deepEqual(Array.from(actions, a => a.title), ['接受建议', '接受全文此类建议', '忽略本行警告', '忽略全文此类警告']);
    assert.match(actions[0].disabled.reason, /没有可靠/);
    assert.match(actions[1].disabled.reason, /没有可靠/);
    assert(actions.every(a => a.kind === 'quickfix' && !a.isPreferred));
    f.diagnostics[0].source = 'LTeX'; assert.equal(f.actions(d).length, 0);
});
test('accept delegates actual installed Workshop fixes, including string warning numbers', async () => {
    const f = fixture(header + '$x$\n\\vskip1mm' + tail); const d = f.add('46', 2, 0, 3);
    await f.run(f.actions(d)[0]);
    assert.match(f.document.getText(), /\\\(x\\\)/);
    assert(!lint(f.document.getText()).some(s => s.startsWith('46:')));
    assert(lint(f.document.getText()).some(s => s.startsWith('41:')));
    assert.deepEqual(f.calls.map(c => c[0]), ['latex-workshop.code-action']);
    assert.equal(f.calls[0][3], 46);
    const one = fixture('\\today text'); const d1 = one.add(1, 0, 0, 7);
    await one.run(one.actions(d1)[0]); assert.equal(one.document.getText(), '\\today{} text');
    assert.equal(f.errors.length, 0);
});
test('line suppression preserves existing Chinese comments, escaped percent, other lines and other warning codes', async () => {
    for (const suffix of ['', ' % 作者原注释', ' \\%', ' % chktex 1']) {
        for (const eol of ['\n', '\r\n']) {
            const source = (header + '$x$' + suffix + '\n$x$\n\\vskip1mm' + tail).replaceAll('\n', eol);
            const f = fixture(source); const d = f.add(46, 2, 0, 3);
            await f.run(f.action(d, 'line'));
            assert(f.document.getText().includes('$x$' + suffix + ' % chktex 46' + eol));
            const warnings = lint(f.document.getText());
            assert(!warnings.includes('46:3')); assert(warnings.includes('46:4')); assert(warnings.includes('41:5'));
            assert.equal(f.calls.length, 0); assert.equal(f.errors.length, 0);
        }
    }
});
test('file suppression preserves BOM/editor directives/EOL and does not suppress other codes or other files', async () => {
    const source = '\uFEFF%!TeX root = draft.tex\r\n' + (header + '$x$\n$x$\n\\vskip1mm' + tail).replaceAll('\n', '\r\n');
    const f = fixture(source); const d = f.add(46, 3, 0, 3);
    await f.run(f.action(d, 'file'));
    assert(f.document.getText().startsWith('\uFEFF%!TeX root = draft.tex\r\n% chktex-file 46\r\n'));
    assert(!lint(f.document.getText()).some(s => s.startsWith('46:')));
    assert(lint(f.document.getText()).some(s => s.startsWith('41:')));
    assert(lint(header + '$x$' + tail).includes('46:3'));
    const empty = fixture(''); const at = empty.add(46, 0, 0, 0);
    await empty.run(empty.action(at, 'file')); assert.equal(empty.document.getText(), '% chktex-file 46\n');
});
test('stale actions and unsupported fixes never edit source or silently suppress a warning', async () => {
    const f = fixture('$x$'); const d = f.add(46, 0, 0, 3); const action = f.action(d, 'line');
    f.document.version++; await f.run(action); assert.match(f.errors.at(-1), /文件已变化/); assert.equal(f.edits.length, 0);
    const unsupported = fixture('\\vskip1mm'); const u = unsupported.add(41, 0, 0, 6);
    await unsupported.run(unsupported.actions(u)[0]); assert.equal(unsupported.edits.length, 0); assert.match(unsupported.errors[0], /没有可靠/);
    const missing = fixture('$x$'); const m = missing.add(46, 0, 0, 3); const old = missing.action(m, 'file');
    missing.diagnostics.length = 0; await missing.run(old); assert.match(missing.errors[0], /警告已更新/); assert.equal(missing.edits.length, 0);
});
test('hover both on and outside the squiggle exposes direct Chinese links, with no intermediate menu or fake diagnostics', async () => {
    const f = fixture('Prefix text $x$ trailing text'); f.add(46, 0, 12, 15);
    for (const column of [2, 13, 26]) {
        const result = f.hover(new Position(0, column));
        assert.equal(result.range.end.character, f.document.getText().length);
        assert.deepEqual(Array.from(result.contents.isTrusted.enabledCommands), ['localLatex.chktexAction']);
        const links = Array.from(result.contents.value.matchAll(/\[([^\]]+)\]\(command:localLatex.chktexAction\?([^)]*)\)/g));
        assert.deepEqual(links.map(m => m[1]), ['接受建议', '接受全文此类建议', '忽略本行警告', '忽略全文此类警告']);
        assert.deepEqual(links.map(m => JSON.parse(decodeURIComponent(m[2]))[0]), ['accept', 'acceptAll', 'line', 'file']);
    }
    assert.equal(f.calls.length, 0, 'hovering itself must not execute an action');
    f.diagnostics.length = 0; assert.equal(f.hover(new Position(0, 2)), undefined);
    assert.equal(f.edits.length, 0);
});
test('direct hover links execute the intended fix/suppression immediately and keep unsupported acceptance unclickable', async () => {
    for (const mode of ['accept', 'line', 'file']) {
        const f = fixture(header + '$x$\n$x$\n\\vskip1mm' + tail); f.add(46, 2, 0, 3);
        const hover = f.hover(new Position(2, 1));
        const args = Array.from(hover.contents.value.matchAll(/command:localLatex.chktexAction\?([^)]*)/g))
            .map(m => JSON.parse(decodeURIComponent(m[1]))).find(args => args[0] === mode);
        await f.commands['localLatex.chktexAction'](...args);
        assert.equal(f.errors.length, 0);
        assert(!lint(f.document.getText()).includes('46:3'));
        if (mode === 'file') assert(!lint(f.document.getText()).some(s => s.startsWith('46:')));
        else assert(lint(f.document.getText()).includes('46:4'));
        assert(lint(f.document.getText()).some(s => s.startsWith('41:')));
        assert(!f.calls.some(c => c[0] === 'editor.action.quickFix'));
    }
    const unsupported = fixture('\\vskip1mm'); unsupported.add(41, 0, 0, 6);
    const hover = unsupported.hover(new Position(0, 1));
    assert.match(hover.contents.value, /接受建议（不可自动修复）/);
    const links = Array.from(hover.contents.value.matchAll(/command:localLatex.chktexAction\?([^)]*)/g));
    assert.deepEqual(links.map(m => JSON.parse(decodeURIComponent(m[1]))[0]), ['line', 'file']);
});

test('full-file acceptance fixes same-code occurrences once, including two on one line, with other warnings unchanged', async () => {
    const f = fixture(header + '$x$ and $y$\n$z$\n\\vskip1mm' + tail);
    const d = f.add(46, 2, 0, 3); f.add('46', 2, 8, 11); f.add({value: 46}, 3, 0, 3); f.add(41, 4, 0, 6);
    const result = f.hover(new Position(2, 1));
    const args = Array.from(result.contents.value.matchAll(/command:localLatex.chktexAction\?([^)]*)/g))
        .map(m => JSON.parse(decodeURIComponent(m[1]))).find(a => a[0] === 'acceptAll');
    await f.commands['localLatex.chktexAction'](...args);
    assert.equal(f.errors.length, 0); assert.equal(f.edits.length, 1, 'one edit transaction, not sequential native commands');
    assert.equal(f.document.getText(), header + '\\(x\\) and \\(y\\)\n\\(z\\)\n\\vskip1mm' + tail);
    assert(!lint(f.document.getText()).some(s => s.startsWith('46:')));
    assert(lint(f.document.getText()).some(s => s.startsWith('41:')));
    assert.equal(f.calls.length, 0, 'no menu, save, build or native asynchronous fix commands');
    assert.equal(f.actions(d).length, 4);
});
test('batch transformations match the installed native fixer for every supported complete-range case', async () => {
    const cases = [
        [1, '\\today text', 0, 7], [2, 'Fig. 2', 3, 5], [4, 'a\\/b', 1, 3],
        [5, 'a\\/b', 1, 3], [6, 'italic text', 0, 7], [11, 'a... b', 1, 4, 'Use \\ldots.'],
        [12, 'A. B', 1, 3], [13, 'A. B', 0, 3], [18, '"word"', 0, 1],
        [24, 'a  b', 1, 3], [26, 'a  b', 1, 3], [28, 'a\\/b', 1, 3],
        [32, '"word', 0, 1], [33, 'word"', 4, 5], [34, '"word', 0, 1],
        [35, '\\bf text', 0, 3, "Use `\\textbf' instead."],
        [39, 'a  b', 1, 3], [42, 'a  b', 1, 3], [45, '$$x+y$$', 0, 7], [46, '$x$', 0, 3]
    ];
    for (const [code, source, start, end, message] of cases) {
        const native = fixture(source), batch = fixture(source);
        const dn = native.add(code, 0, start, end, message), db = batch.add(code, 0, start, end, message);
        await native.run(native.action(dn, 'accept'));
        await batch.run(batch.action(db, 'acceptAll'));
        assert.deepEqual(batch.errors, [], `code ${code}`);
        assert.equal(batch.document.getText(), native.document.getText(), `code ${code}`);
        assert.equal(batch.edits.length, 1, `code ${code}`);
    }
});
test('code 1 at a physical line ending is repaired without joining lines or changing the macro definition', async () => {
    const source = '\\newcommand{\\Qmixed}{\\bfseries}\n{\\Qmixed\nText.}\n{\\Qmixed \nOther.}\n';
    const f = fixture(source); const d = f.add(1, 1, 8, 9); f.add(1, 3, 8, 9);
    await f.run(f.action(d, 'acceptAll'));
    assert.deepEqual(f.errors, []);
    assert.equal(f.document.getText(), '\\newcommand{\\Qmixed}{\\bfseries}\n{\\Qmixed{}\nText.}\n{\\Qmixed{} \nOther.}\n');
    assert.equal(f.edits.length, 1);
    assert(!lint(header + f.document.getText() + tail).some(s => s.startsWith('1:')));
});
test('full-file acceptance rejects overlapping, stale or incomplete changes without a partial source edit', async () => {
    const overlap = fixture('$x$'); const d = overlap.add(46, 0, 0, 3); overlap.add(46, 0, 0, 3, 'Duplicate range');
    await overlap.run(overlap.action(d, 'acceptAll'));
    assert.equal(overlap.errors.length, 0, 'identical replacement ranges are deduplicated'); assert.equal(overlap.edits.length, 1);
    const conflict = fixture('abcdef'); const c = conflict.add(4, 0, 0, 3); conflict.add(4, 0, 2, 4);
    await conflict.run(conflict.action(c, 'acceptAll'));
    assert.match(conflict.errors[0], /重叠/); assert.equal(conflict.edits.length, 0);
    const incomplete = fixture('$x$ and $\ny$'); const one = incomplete.add(46, 0, 0, 3); incomplete.add(46, 0, 8, 9);
    await incomplete.run(incomplete.action(one, 'acceptAll'));
    assert.equal(incomplete.edits.length, 0); assert.equal(incomplete.document.getText(), '$x$ and $\ny$');
    const stale = fixture('$x$'); const ds = stale.add(46, 0, 0, 3); const action = stale.action(ds, 'acceptAll');
    stale.document.version++; await stale.run(action); assert.equal(stale.edits.length, 0);
    const failed = fixture('$x$'); const df = failed.add(46, 0, 0, 3);
    failed.api.workspace.applyEdit = async () => false;
    await failed.run(failed.action(df, 'acceptAll')); assert.match(failed.errors[0], /未应用全文建议/);
});

test('standard warning hovers show their number, Chinese cause and recommendation without changing diagnostic messages', () => {
    const f = fixture('Text here');
    for (let code = 1; code <= 49; code++) {
        f.diagnostics.length = 0;
        const message = `${code}: Original checker message.`;
        const d = f.add(code, 0, 0, 4, message);
        const value = f.hover(new Position(0, 1)).contents.value;
        assert(value.startsWith(`ChkTeX ${code}：`));
        assert.match(value, /原因：.+/); assert.match(value, /推荐：.+/);
        assert(!value.includes('Original checker message.'));
        assert(!value.includes('尚未收录'));
        assert.equal(d.message, message, 'display translation must not rewrite the linter diagnostic');
    }
    assert.equal(f.edits.length, 0); assert.equal(f.calls.length, 0);
});
test('warning 13 distinguishes a title colon from actual sentence-ending spacing', () => {
    const f = fixture('GMAP: Gaussian model.');
    const message = "13: Intersentence spacing (`\\@') should perhaps be used.";
    f.add(13, 0, 4, 5, message);
    const colon = f.hover(new Position(0, 4)).contents.value;
    assert.match(colon, /冒号或分号/); assert.match(colon, /通常忽略本行/); assert.match(colon, /不要.*批量/);
    // Command URI payloads intentionally retain the original diagnostic for the
    // native fixer; they are not text rendered in the hover.
    const visible = colon.replace(/\]\(command:[^)]*\)/g, ']');
    assert(!visible.includes('Intersentence')); assert(!visible.includes('13：13:'));
    const sentence = fixture('USA. Next sentence.'); sentence.add(13, 0, 3, 4, message);
    const normal = sentence.hover(new Position(0, 3)).contents.value;
    assert.match(normal, /确为句末/); assert.match(normal, /大写字母/);
    assert.equal(sentence.edits.length, 0);
});
test('suggested command details remain usable by native fixes; unknown warnings show Chinese guidance without repeating English', async () => {
    const f = fixture('sin x'); const d = f.add(35, 0, 0, 3, "35: You should perhaps use `\\sin' instead.");
    const value = f.hover(new Position(0, 1)).contents.value;
    assert.match(value, /本处建议：\\sin/); assert(!value.includes('You should perhaps'));
    await f.run(f.action(d, 'accept')); assert.equal(f.document.getText(), '\\sin x');
    const unknown = fixture('Text'); unknown.add(900, 0, 0, 4, 'New plugin-specific warning.');
    const untranslated = unknown.hover(new Position(0, 1)).contents.value;
    assert.match(untranslated, /ChkTeX 900/); assert.match(untranslated, /尚未收录/);
    const visible = untranslated.replace(/\]\(command:[^)]*\)/g, ']');
    assert(!visible.includes('New plugin-specific warning'));
    assert(!visible.includes('原始诊断（未翻译）'));
    assert.match(visible, /“问题”面板/);
    assert.match(untranslated, /不要直接全文接受/);
    assert.equal(unknown.diagnostics[0].message, 'New plugin-specific warning.', 'original diagnostic remains available to checking and fix consumers');
});

test('real ChkTeX adapter excludes only complete comment-only machine ledgers and preserves normal diagnostics and source bytes', () => {
    const python = process.env.LOCAL_LATEX_PYTHON || 'python3';
    const format = '-f%f:%l:%c:%d:%k:%n:%m\n';
    const flags = ['-wall', '-w46', '-w41', '-q'];
    const adapter = path.join(__dirname, 'chktex_filter.py');
    const checked = (args, input, cwd) => {
        const result = cp.spawnSync(python, ['-X', 'utf8', adapter, '--chktex', chktex, '--', ...flags, ...args],
            {input, cwd, windowsHide: true});
        assert.ifError(result.error);
        assert(!result.stderr.toString('utf8').includes('Traceback'), result.stderr.toString('utf8'));
        return result;
    };
    const records = raw => raw.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    for (const eol of ['\n', '\r\n']) {
        const ledger = ['% CODEX-REVIEW-STATE-BEGIN', '% 交接状态，保留原样。', '% CODEX-REVIEW-NEXT manuscript=79 response=ao',
            '% CODEX-REVIEW-DATA {"quote":"$x$", "status":"handoff"}', '% CODEX-REVIEW-STATE-END'].join(eol);
        const source = (header + ledger + '\n% Ordinary author logic remains checked.\n$x$\n\\vskip1mm' + tail).replace(/\r?\n/g, eol);
        const native = cp.spawnSync(chktex, [...flags, '-I0', format], {input: source, windowsHide: true});
        assert.ifError(native.error);
        const normal = records(native.stdout).filter(line => {const number = Number(/^[^]*?:(\d+):/.exec(line)[1]); return number < 3 || number > 7;});
        assert(records(native.stdout).length > normal.length, 'baseline checker reports machine comment warnings');
        const actual = checked(['-I0', format], source);
        assert.deepEqual(records(actual.stdout), normal);
        assert(records(actual.stdout).some(line => /:46:/.test(line)), 'normal body warning is retained');
        assert(records(actual.stdout).some(line => /:41:/.test(line)), 'a different normal warning is retained');
        assert(records(actual.stdout).some(line => /^stdin:8:.*:22:/.test(line)), 'ordinary author comments are not globally suppressed');
        const named = checked(['-p', 'editor-buffer.tex', '-I0', format], source);
        assert.deepEqual(records(named.stdout), normal.map(line => line.replace(/^stdin:/, 'editor-buffer.tex:')), 'the configured pseudoname does not require an on-disk source for stdin checks');
        for (const malformed of [source.replace('% CODEX-REVIEW-STATE-END', '% incomplete end'),
            source.replace('% 交接状态，保留原样。', '$y$')]) {
            const original = cp.spawnSync(chktex, [...flags, '-I0', format], {input: malformed, windowsHide: true});
            assert.deepEqual(checked(['-I0', format], malformed).stdout, original.stdout, 'malformed markers or real TeX never mask prose');
        }
    }
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'chktex-交接 ledger-'));
    const child = '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA {"note":"handoff"}\n% CODEX-REVIEW-STATE-END\n$x$\n';
    const main = header + '\\input{child}\n$x$' + tail;
    fs.writeFileSync(path.join(root, 'main.tex'), main, 'utf8'); fs.writeFileSync(path.join(root, 'child.tex'), child, 'utf8');
    const native = cp.spawnSync(chktex, [...flags, format, path.join(root, 'main.tex')], {cwd: root, windowsHide: true});
    assert.ifError(native.error);
    const normal = records(native.stdout).filter(line => !/child\.tex:[1-3]:/.test(line));
    const result = checked([format, path.join(root, 'main.tex')], undefined, root);
    assert.deepEqual(records(result.stdout), normal, 'root and included file warnings are filtered by their own file and line');
    assert.equal(result.status, native.status, 'root-check exit status is propagated');
    assert.equal(fs.readFileSync(path.join(root, 'main.tex'), 'utf8'), main);
    assert.equal(fs.readFileSync(path.join(root, 'child.tex'), 'utf8'), child);
    const invalid = cp.spawnSync(python, ['-X', 'utf8', adapter, '--chktex', chktex, '--', '--invalid-checker-option', format],
        {input: '$x$', windowsHide: true});
    const originalFailure = cp.spawnSync(chktex, ['--invalid-checker-option', format], {input: '$x$', windowsHide: true});
    assert.equal(invalid.status, originalFailure.status);
    assert.deepEqual(invalid.stderr, originalFailure.stderr, 'checker failures are not swallowed');
});
