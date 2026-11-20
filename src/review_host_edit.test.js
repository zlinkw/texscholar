'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {applyHostEdit} = require('./review_host_edit');

function fixture() {
    let text = 'Original.\n', authority = true, duringEdit = () => {}, duringSave = () => {};
    const doc = {version: 1, isDirty: false, isClosed: false, getText: () => text,
        positionAt: n => n, async save() {duringSave(); this.isDirty = false; return true;}};
    const editor = {document: doc, async edit(callback) {
        const before = doc.version; let next;
        callback({replace(_range, value) {next = value;}});
        duringEdit();
        if (doc.version !== before) return false;
        text = next; doc.version++; doc.isDirty = true; return true;
    }};
    return {doc, editor, vscode: {Range: class {constructor(start, end) {this.start = start; this.end = end;}}},
        authority: () => authority, setAuthority: v => {authority = v;}, setDuringEdit: v => {duringEdit = v;},
        setDuringSave: v => {duringSave = v;}, authorEdit: value => {text = value; doc.version++; doc.isDirty = true;}};
}
const original = {version: 1, text: 'Original.\n'};

test('single host applies and saves only the checked document', async () => {
    const f = fixture();
    await applyHostEdit(f.vscode, f.editor, original, 'Revised.\n', f.authority);
    assert.equal(f.doc.getText(), 'Revised.\n'); assert.equal(f.doc.isDirty, false);
});

test('an edit after the check is never replaced', async () => {
    const f = fixture(); f.setDuringEdit(() => f.authorEdit('Author edit.\n'));
    await assert.rejects(applyHostEdit(f.vscode, f.editor, original, 'Revised.\n', f.authority), /过期事务/);
    assert.equal(f.doc.getText(), 'Author edit.\n'); assert.equal(f.doc.isDirty, true);
});

test('loss of host authority before save stops and preserves the buffer', async () => {
    const f = fixture(); f.setDuringEdit(() => f.setAuthority(false));
    await assert.rejects(applyHostEdit(f.vscode, f.editor, original, 'Revised.\n', f.authority), /资格已失效/);
    assert.equal(f.doc.getText(), 'Revised.\n'); assert.equal(f.doc.isDirty, true);
});

test('an author edit while saving is not reported as a committed transaction', async () => {
    const f = fixture(); f.setDuringSave(() => f.authorEdit('Author after edit.\n'));
    await assert.rejects(applyHostEdit(f.vscode, f.editor, original, 'Revised.\n', f.authority), /正文发生变化/);
    assert.equal(f.doc.getText(), 'Author after edit.\n');
});
