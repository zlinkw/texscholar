'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {links, validateTarget, jump} = require('./questions');
test('AI-authored explicit question markers are recognized without guessing question numbering', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'questions-'));
    const q = {id: 'Reviewer 2, Comment 3', file: '原始意见.txt', quote: 'Please clarify the selection rule.'};
    const text = '% CODEX-QUESTION ' + JSON.stringify(q) + '\n\\textbf{Comment 3}\nResponse text.';
    assert.deepEqual(links(text)[0].question, q);
    assert.deepEqual(links('Comment 3 without any explicit source mapping'), []);
    assert.throws(() => validateTarget(root, {...q, file: '../outside.txt'}), /当前论文/);
    const file = path.join(root, q.file), source = 'Reviewer 2\n' + q.quote + '\n';
    fs.writeFileSync(file, source, 'utf8');
    const doc = {getText: () => source, positionAt: offset => offset};
    const editor = {revealRange() {}};
    const warnings = [];
    const api = {Uri: {file: file => file}, Selection: class {constructor(start, end) {Object.assign(this, {start, end});}},
        TextEditorRevealType: {InCenterIfOutsideViewport: 1}, workspace: {openTextDocument: async target => {assert.equal(target, file); return doc;}},
        window: {showTextDocument: async () => editor, showWarningMessage: value => warnings.push(value)}};
    await jump(api, root, q);
    assert.equal(editor.selection.start, source.indexOf(q.quote));
    assert.equal(editor.selection.end - editor.selection.start, q.quote.length);
    doc.getText = () => 'Author changed the reviewer source.';
    await jump(api, root, q);
    assert.equal(warnings.length, 1, 'a stale quote opens the source without inventing a new exact position');
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    const embedded = '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA ' + JSON.stringify({questions: [q]})
        + '\n% CODEX-REVIEW-STATE-END\n% CODEX-QUESTION ' + JSON.stringify(q) + '\nReviewer 2\n' + q.quote + '\n';
    doc.getText = () => embedded;
    await jump(api, root, q);
    assert.equal(editor.selection.start, embedded.lastIndexOf(q.quote), 'select the original, not its stored metadata copy');
    doc.getText = () => embedded + q.quote;
    await jump(api, root, q);
    assert.equal(warnings.length, 2, 'two real original matches remain ambiguous');
});
