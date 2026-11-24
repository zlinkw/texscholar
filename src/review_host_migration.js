'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {regular,decode,utf8,sha} = require('./review_host_transaction');
const {ownerParts} = require('./review_host_legacy');
const {samePath} = require('./tools');
const {applyHostEdit} = require('./review_host_edit');

function object(root, id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('迁移对象身份无效。');
    const raw = fs.readFileSync(regular(root,'.codex-review/objects/' + id + '.json','.json'));
    if (sha(raw) !== id) throw new Error('迁移对象完整性不匹配。');
    const files = JSON.parse(raw.toString('utf8')).files;
    return Object.fromEntries(Object.entries(files).map(([key,value]) => [key,decode(value)]));
}

function migrationPlan(root, id) {
    root = fs.realpathSync(root);
    const plan = JSON.parse(utf8(object(root,id)['migration-plan']));
    if (plan.kind !== 'legacy-migration' || !Array.isArray(plan.files)) throw new Error('迁移计划无效。');
    const saved = object(root,plan.commit), meta = JSON.parse(utf8(saved['migration.json']));
    if (meta.kind !== plan.kind || meta.owner !== plan.owner || !isDeepStrictEqual(meta.files,plan.files.map(item=>item.file))) throw new Error('迁移恢复对象与计划不一致。');
    const owner = {relative:plan.owner,file:regular(root,plan.owner,'.tex'),before:decode(plan.owner_before),intent:decode(plan.owner_intent),after:decode(plan.owner_after)};
    const pending = decode(plan.state_pending), final = decode(plan.state_final);
    if (!saved['owner-old'].equals(owner.before) || !saved['owner-new'].equals(owner.after) || !saved['state-final'].equals(final)) throw new Error('迁移目标与恢复对象不一致。');
    const old = ownerParts(owner.before), intent = ownerParts(owner.intent), after = ownerParts(owner.after);
    const pendingState = JSON.parse(utf8(pending)), finalState = JSON.parse(utf8(final));
    const tr = intent.state?.transaction, expectedOld = {...intent.state}; delete expectedOld.transaction;
    const expectedFinal = {...pendingState}; delete expectedFinal.transaction;
    if (!tr || tr.kind !== 'migration' || tr.commit !== plan.commit || tr.owner !== plan.owner || !isDeepStrictEqual(tr.files,meta.files) ||
        !isDeepStrictEqual(tr,pendingState.transaction) || !isDeepStrictEqual(expectedOld,old.state) || !isDeepStrictEqual(expectedFinal,finalState) ||
        finalState.schema !== 3 || after.state || old.header !== intent.header || old.body !== intent.body || old.counter !== intent.counter)
        throw new Error('迁移意图或最终状态不一致。');
    const files = plan.files.map((item,index) => {
        const entry = {relative:item.file,file:regular(root,item.file,'.tex'),before:decode(item.before),after:decode(item.after)};
        if (!saved[index+'-old'].equals(entry.before) || !saved[index+'-new'].equals(entry.after)) throw new Error('迁移文件与恢复对象不一致。');
        return entry;
    });
    const ids = [owner,...files].map(item=>process.platform === 'win32' ? item.file.toLowerCase() : item.file);
    if (new Set(ids).size !== ids.length) throw new Error('迁移文件重复。');
    for (const item of [owner,...files]) {
        const bom = value=>value.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]));
        if (bom(item.before) !== bom(item.after) || item.intent && bom(item.before) !== bom(item.intent)) throw new Error('迁移不能改变 BOM：' + item.relative);
        item.beforeText = utf8(item.before); item.afterText = utf8(item.after);
        if (item.intent) item.intentText = utf8(item.intent);
    }
    const directory = path.join(root,'.codex-review');
    if (!fs.statSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('审核状态目录无效。');
    return {root,owner,files,pending,final,statePath:path.join(directory,'state.json')};
}

async function applyMigration(vscode, registry, root, generation, id, recover = false) {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任论文工作区。');
    root = fs.realpathSync(root);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (!folder || !samePath(fs.realpathSync(folder.uri.fsPath),root)) throw new Error('迁移不属于当前受信任论文工作区。');
    const {owner,files,pending,final,statePath} = migrationPlan(root,id), all = [owner,...files];
    let state = null;
    if (fs.existsSync(statePath)) {
        if (fs.lstatSync(statePath).isSymbolicLink() || !fs.statSync(statePath).isFile()) throw new Error('外置状态不是普通文件。');
        state = fs.readFileSync(statePath);
        if (!recover || !(state.equals(pending) || state.equals(final) || state.length < pending.length && pending.subarray(0,state.length).equals(state)))
            throw new Error('外置状态已存在或不属于此迁移。');
    }
    for (const item of all) {
        item.current = fs.readFileSync(item.file);
        const allowed = [item.before,...(recover ? [item.after,...(item.intent ? [item.intent] : [])] : [])];
        if (!allowed.some(raw=>raw.equals(item.current))) throw new Error('迁移文件已变化：' + item.relative);
        item.currentText = utf8(item.current);
        const open = vscode.workspace.textDocuments.find(doc=>doc.uri.scheme === 'file' && samePath(doc.uri.fsPath,item.file));
        if (open?.isDirty) throw new Error('迁移文件存在未保存编辑：' + item.relative);
    }
    if (state && owner.current.equals(owner.before) || owner.current.equals(owner.after) && (!state || !state.equals(pending) && !state.equals(final)) ||
        state?.equals(final) && (!owner.current.equals(owner.after) || files.some(item=>!item.current.equals(item.after)))) throw new Error('迁移阶段不一致；请保留现场核对。');
    if (state && state.length < pending.length && !owner.current.equals(owner.intent)) throw new Error('不完整外置状态与迁移阶段不一致。');
    for (const item of all) {
        item.document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.file));
        if (item.document.isDirty || item.document.getText() !== item.currentText) throw new Error('编辑器内容已变化：' + item.relative);
        item.version = item.document.version;
        const eol = item.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        for (const text of [item.afterText,...(item.intentText ? [item.intentText] : [])])
            if ((text.match(/\r\n|\r|\n/g) || []).some(value=>value !== eol)) throw new Error('迁移换行与编辑器不一致：' + item.relative);
    }
    const authority = () => {const value = registry.state(root);return !!value?.eligible && value.generation === generation;};
    const verify = () => {
        for (const item of all) if (!fs.readFileSync(item.file).equals(item.current) || item.document.isDirty || item.document.version !== item.version || item.document.getText() !== item.currentText)
            throw new Error('迁移期间文件已变化：' + item.relative);
        if (state === null ? fs.existsSync(statePath) : !fs.existsSync(statePath) || !fs.readFileSync(statePath).equals(state)) throw new Error('迁移期间外置状态已变化。');
    };
    const write = async (item, next, nextText) => {
        await registry.check(root,generation); verify();
        if (item.current.equals(next)) return;
        await registry.check(root,generation); verify();
        await applyHostEdit(vscode,item.document,{version:item.version,text:item.currentText},nextText,authority);
        if (!fs.readFileSync(item.file).equals(next)) throw new Error('迁移文件保存后不一致：' + item.relative);
        item.current = next; item.currentText = nextText; item.version = item.document.version;
    };
    if (state?.equals(final)) {await registry.check(root,generation); verify(); return {complete:true};}
    if (owner.current.equals(owner.before)) await write(owner,owner.intent,owner.intentText);
    for (const item of files) if (item.current.equals(item.before)) await write(item,item.after,item.afterText);
    await registry.check(root,generation); verify();
    if (!state || !state.equals(pending)) {
        const fd = fs.openSync(statePath,state === null ? 'wx' : 'r+');
        try {const offset = state?.length || 0; fs.writeSync(fd,pending,offset,pending.length-offset,offset); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
        state = pending;
        if (!fs.readFileSync(statePath).equals(pending)) throw new Error('迁移待完成状态写入不完整。');
    }
    if (owner.current.equals(owner.intent)) await write(owner,owner.after,owner.afterText);
    await registry.check(root,generation); verify();
    if (!owner.current.equals(owner.after) || files.some(item=>!item.current.equals(item.after))) throw new Error('迁移目标尚未全部完成。');
    const temporary = statePath + '.write-' + crypto.randomUUID();
    const fd = fs.openSync(temporary,'wx');
    try {fs.writeFileSync(fd,final); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temporary,statePath); state = final;
    return {complete:true};
}

module.exports = {migrationPlan,applyMigration};
