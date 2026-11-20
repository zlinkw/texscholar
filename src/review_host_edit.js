'use strict';

// Apply a prevalidated transaction through the live editor, never by blind disk write.
async function applyHostEdit(vscode, editor, expected, replacement, hasAuthority) {
    const doc = editor.document;
    function checkOriginal() {
        if (!hasAuthority()) throw new Error('审核宿主资格已失效；没有覆盖正文。');
        if (doc.isClosed || doc.isDirty || doc.version !== expected.version || doc.getText() !== expected.text)
            throw new Error('正文缓冲已变化；没有覆盖作者编辑。');
    }
    checkOriginal();
    const range = new vscode.Range(doc.positionAt(0), doc.positionAt(expected.text.length));
    const applied = await editor.edit(builder => {
        checkOriginal();
        builder.replace(range, replacement);
    }, {undoStopBefore: true, undoStopAfter: true});
    if (!applied) throw new Error('编辑器拒绝了过期事务；没有覆盖作者编辑。');
    const version = doc.version;
    if (version <= expected.version) throw new Error('编辑器没有报告正文变更；请核对尚未完成的编辑事务。');
    function checkApplied() {
        if (!hasAuthority()) throw new Error('审核宿主资格已失效；请核对尚未完成的编辑事务。');
        if (doc.isClosed || doc.version !== version || doc.getText() !== replacement)
            throw new Error('编辑期间正文发生变化；请核对尚未完成的编辑事务。');
    }
    checkApplied();
    if (!await doc.save()) throw new Error('编辑器保存失败；请核对尚未完成的编辑事务。');
    checkApplied();
    if (doc.isDirty) throw new Error('保存后正文仍有未保存修改；请核对尚未完成的编辑事务。');
}

module.exports = {applyHostEdit};
