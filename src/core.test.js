'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const core = require('./core');
const GIT = process.env.LOCAL_LATEX_GIT || 'git';
const FMT = process.env.LOCAL_LATEX_FORMATTER || 'tex-fmt';
const parent = path.resolve(process.env.LOCAL_LATEX_TEST_ROOT);
assert(parent.includes('latex-writing-checks'));
fs.mkdirSync(parent, {recursive: true});
const env = {...process.env};
for (const k of Object.keys(env)) if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES)$/i.test(k)) delete env[k];
function git(root, args) {
    const r = cp.spawnSync(GIT, args, {cwd: root, env, encoding: 'utf8', windowsHide: true});
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
}
const source = '% 中文注释\n\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item First result.\n\\item Second result.\n\\end{itemize}\n\\end{document}\n';
function fixture(name, text = source) {
    const root = fs.mkdtempSync(path.join(parent, name + '-'));
    git(root, ['init', '-b', 'master']);
    const actual = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
    assert.equal(actual.toLowerCase(), fs.realpathSync(root).toLowerCase());
    for (const key of ['--absolute-git-dir']) assert(fs.realpathSync(git(root, ['rev-parse', key]).trim()).startsWith(root));
    git(root, ['config', 'user.name', 'Local formatter test']);
    git(root, ['config', 'user.email', 'formatter-test@example.invalid']);
    git(root, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(root, '稿件.tex'), text, 'utf8');
    fs.writeFileSync(path.join(root, 'other.txt'), 'original\n', 'utf8');
    git(root, ['add', '--', '稿件.tex', 'other.txt']);
    git(root, ['commit', '-m', 'fixture baseline']);
    return {root, file: path.join(root, '稿件.tex')};
}
test('real formatter and Git produce one content-preserving commit; unrelated work survives', async () => {
    const f = fixture('success');
    fs.writeFileSync(path.join(f.root, 'other.txt'), 'author edit\n', 'utf8');
    fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'private work\n', 'utf8');
    const state = await core.prepare(f.file, {git: GIT, formatter: FMT});
    assert.notEqual(state.formatted, state.text);
    fs.writeFileSync(f.file, state.formatted, 'utf8');
    const commit = await core.commit(state);
    assert.equal(git(f.root, ['log', '-1', '--format=%s']).trim(), core.MESSAGE);
    assert.equal(git(f.root, ['rev-parse', 'HEAD']).trim(), commit);
    assert.deepEqual(git(f.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']).split('\0').filter(Boolean), ['稿件.tex']);
    assert.equal(fs.readFileSync(path.join(f.root, 'other.txt'), 'utf8'), 'author edit\n');
    assert.equal(fs.readFileSync(path.join(f.root, 'untracked.txt'), 'utf8'), 'private work\n');
    assert.equal(git(f.root, ['diff', '--cached', '--name-only']), '');
    const again = await core.prepare(f.file, {git: GIT, formatter: FMT});
    assert.equal(again.formatted, again.text, 'Second use is a no-op, not an empty commit');
});
test('formatter line splitting and trailing-blank removal preserve original lines while aligned indentation is committed', async () => {
    const text = '% 中文注释\n\\documentclass{article}\n\\begin{document}\n'
        + '\\begin{itemize}\\item Same-line environment.\\end{itemize}\n'
        + '\\begin{enumerate}\n\\item A separate sentence.\n\\end{enumerate}\n'
        + '\\begin{verbatim}\n    literal indentation\n\\end{verbatim}\n\\end{document}\n\n\n';
    const f = fixture('formatter-layout', text);
    const head = git(f.root, ['rev-parse', 'HEAD']);
    const state = await core.prepare(f.file, {git: GIT, formatter: FMT});
    assert.notEqual(state.formatted, text);
    assert.equal(state.formatted.replace(/^[ \t]*/gm, ''), text.replace(/^[ \t]*/gm, ''));
    assert(state.formatted.includes('\\begin{itemize}\\item Same-line environment.\\end{itemize}\n'));
    assert(state.formatted.includes('  \\item A separate sentence.\n'));
    assert(state.formatted.includes('    literal indentation\n'));
    assert(state.formatted.endsWith('\n\n\n'));
    assert.equal(fs.readFileSync(f.file, 'utf8'), text, 'preparing must not change the source');
    assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
    fs.writeFileSync(f.file, state.formatted, 'utf8');
    await core.commit(state);
    assert.equal(git(f.root, ['log', '-1', '--format=%s']).trim(), core.MESSAGE);
    const again = await core.prepare(f.file, {git: GIT, formatter: FMT});
    assert.equal(again.formatted, again.text);
});
test('formatter-added final newline does not add a newline to the source', () => {
    const original = '\\begin{itemize}\r\n\\item Text.\r\n\\end{itemize}';
    const proposed = '\\begin{itemize}\n  \\item Text.\n\\end{itemize}\n';
    assert.equal(core.conservativeIndent(original, proposed), '\\begin{itemize}\r\n  \\item Text.\r\n\\end{itemize}');
});
test('expanded formatter lines are not applied and do not shift the indentation of later original lines', () => {
    const original = '\\begin{itemize}\\item Compact.\\end{itemize}\n\\begin{enumerate}\n\\item Separate.\n\\end{enumerate}\n';
    const proposed = '\\begin{itemize}\n  \\item Compact.\n\\end{itemize}\n\\begin{enumerate}\n  \\item Separate.\n\\end{enumerate}\n';
    assert.equal(core.conservativeIndent(original, proposed), original.replace('\\item Separate.', '  \\item Separate.'));
});
test('dirty active file and staged changes block before formatting', async () => {
    const f = fixture('dirty');
    const head = git(f.root, ['rev-parse', 'HEAD']);
    fs.appendFileSync(f.file, '% author text\n', 'utf8');
    await assert.rejects(core.prepare(f.file, {git: GIT, formatter: FMT}), /未提交/);
    assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
    const g = fixture('staged');
    fs.writeFileSync(path.join(g.root, 'other.txt'), 'staged text\n', 'utf8');
    git(g.root, ['add', '--', 'other.txt']);
    const index = git(g.root, ['diff', '--cached', '--binary']);
    await assert.rejects(core.prepare(g.file, {git: GIT, formatter: FMT}), /暂存区/);
    assert.equal(git(g.root, ['diff', '--cached', '--binary']), index);
    assert.equal(fs.readFileSync(g.file, 'utf8'), source);
});
test('Chinese comments, BOM, CRLF, literal text and blank lines are preserved', () => {
    const a = '\uFEFF% 中文规则\r\n\\begin{document}\r\n\\begin{verbatim}\r\n  literal  spaces\r\n\\end{verbatim}\r\n\r\nText.\r\n\\end{document}\r\n';
    const proposed = a.replace(/\r\n/g, '\n').replace('  literal  spaces', 'literal  spaces').replace('Text.', '  Text.');
    const b = core.conservativeIndent(a, proposed);
    assert(b.startsWith('\uFEFF% 中文规则\r\n'));
    assert(b.includes('  literal  spaces\r\n'));
    assert(b.includes('\r\n\r\n  Text.\r\n'));
    assert.throws(() => core.conservativeIndent('\\catcode x\n', '  \\catcode x\n'), /敏感/);
    assert.equal(core.conservativeIndent('one\ntwo\n', 'one two\n'), 'one\ntwo\n', 'formatter merging must not merge source lines');
    assert.equal(core.conservativeIndent('  a + b\n', 'c + d\n'), '  a + b\n');
});
test('concurrent edits block the commit without discarding the edit', async () => {
    const f = fixture('concurrent');
    const state = await core.prepare(f.file, {git: GIT, formatter: FMT});
    fs.writeFileSync(f.file, state.formatted + '% concurrent\n', 'utf8');
    await assert.rejects(core.commit(state), /其他操作/);
    assert.equal(git(f.root, ['rev-parse', 'HEAD']).trim(), state.head);
    assert(fs.readFileSync(f.file, 'utf8').endsWith('% concurrent\n'));
});
test('Git hooks are respected and a rejected commit is reported as failure', async () => {
    const f = fixture('hook');
    const state = await core.prepare(f.file, {git: GIT, formatter: FMT});
    fs.writeFileSync(f.file, state.formatted, 'utf8');
    fs.writeFileSync(path.join(f.root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho fixture-hook-refused >&2\nexit 1\n', 'utf8');
    await assert.rejects(core.commit(state), /fixture-hook-refused/);
    assert.equal(git(f.root, ['rev-parse', 'HEAD']).trim(), state.head);
    assert.equal(fs.readFileSync(f.file, 'utf8'), state.formatted);
});
test('untracked documents and detached HEAD are not formatted', async () => {
    const f = fixture('untracked');
    const other = path.join(f.root, 'new.tex');
    fs.writeFileSync(other, source, 'utf8');
    await assert.rejects(core.prepare(other, {git: GIT, formatter: FMT}), /未提交/);
    git(f.root, ['checkout', '--detach']);
    await assert.rejects(core.prepare(f.file, {git: GIT, formatter: FMT}));
    assert.equal(fs.readFileSync(f.file, 'utf8'), source);
});
