'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
const {regular, decode, utf8, sha} = require('./review_host_transaction');
const {applyHostEdit} = require('./review_host_edit');
const {samePath} = require('./tools');

function ownerParts(raw) {
    const text = utf8(raw), begin = '% CODEX-REVIEW-STATE-BEGIN', end = '% CODEX-REVIEW-STATE-END';
    const lines = text.split(/(?<=\n)/), starts = [], ends = [], states = [], counters = [];
    lines.forEach((line, i) => {
        const value = line.replace(/\r?\n$/, '');
        if (value === begin) starts.push(i);
        if (value === end) ends.push(i);
        if (value.startsWith('% CODEX-REVIEW-DATA ')) states.push([i,JSON.parse(value.slice('% CODEX-REVIEW-DATA '.length))]);
        if (value.startsWith('% CODEX-REVIEW-NEXT ')) counters.push([i,value]);
    });
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0] || states.length > 1 || counters.length !== 1 ||
        [...states,...counters].some(([i]) => i <= starts[0] || i >= ends[0])) throw new Error('旧审核状态头无效。');
    const body = lines.slice(0,starts[0]).join('') + lines.slice(ends[0]+1).join('');
    const header = lines.slice(starts[0],ends[0]+1).filter(line => !line.startsWith('% CODEX-REVIEW-DATA ') && !line.startsWith('% CODEX-REVIEW-NEXT ')).join('');
    return {body,header,state:states[0]?.[1],counter:counters[0][1]};
}

function roleBody(raw, required) {
    const text = utf8(raw), begin = '% CODEX-FILE-ROLES-BEGIN', end = '% CODEX-FILE-ROLES-END';
    const lines = text.split(/(?<=\n)/), starts = [], ends = [];
    lines.forEach((line,i) => {const value = line.replace(/\r?\n$/,''); if (value === begin) starts.push(i); if (value === end) ends.push(i);});
    if (!starts.length && !ends.length && !required) return text;
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) throw new Error('文件角色标记无效。');
    if (lines.slice(starts[0],ends[0]+1).some(line => !line.startsWith('%')) || lines.slice(0,starts[0]).some(line => line.trim() && !line.trimStart().startsWith('%')))
        throw new Error('文件角色登记必须位于顶部注释区，且只能包含注释。');
    return lines.slice(0,starts[0]).join('') + lines.slice(ends[0]+1).join('');
}

function profileBody(raw, names) {
    const allowed = new Set(['CODEX-FILE-ROLES','CODEX-RULES','CODEX-WRITING-PROFILE']);
    if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(name => !allowed.has(name)))
        throw new Error('待迁移注释块类型无效。');
    const lines = utf8(raw).split(/(?<=\n)/), spans = [];
    for (const name of names) {
        const starts = [], ends = [];
        lines.forEach((line,i) => {const value=line.replace(/\r?\n$/,''); if (value === '% ' + name + '-BEGIN') starts.push(i); if (value === '% ' + name + '-END') ends.push(i);});
        if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0] ||
            lines.slice(0,starts[0]).some(line => line.trim() && !line.trimStart().startsWith('%')) ||
            lines.slice(starts[0],ends[0]+1).some(line => !line.startsWith('%')))
            throw new Error('待迁移块必须是唯一、完整的顶部插件注释。');
        spans.push([starts[0],ends[0]+1]);
    }
    spans.sort((a,b)=>a[0]-b[0]);
    if (spans.some((span,i)=>i && span[0] < spans[i-1][1])) throw new Error('待迁移注释块重叠。');
    return lines.filter((_,i)=>!spans.some(([a,b])=>i>=a && i<b)).join('');
}

function legacyPlan(root, commit) {
    root = fs.realpathSync(root);
    if (!/^[a-f0-9]{64}$/.test(commit)) throw new Error('旧审核事务身份无效。');
    const raw = fs.readFileSync(regular(root,'.codex-review/objects/' + commit + '.json','.json'));
    if (sha(raw) !== commit) throw new Error('旧审核事务对象完整性不匹配。');
    const wrapper = JSON.parse(raw.toString('utf8'));
    const plan = JSON.parse(utf8(decode(wrapper.files?.['host-plan'])));
    return checkedPlan(root,plan);
}

function checkedPlan(root, plan) {
    root = fs.realpathSync(root);
    if (!['legacy-review','legacy-recovery','role-metadata','profile-metadata','profile-check'].includes(plan.kind) || !Array.isArray(plan.files) || !Array.isArray(plan.checks)) throw new Error('旧审核事务计划无效。');
    const owner = {relative:plan.owner,file:regular(root,plan.owner,'.tex'),before:decode(plan.owner_before),after:decode(plan.owner_after)};
    const old = ['role-metadata','profile-metadata','profile-check'].includes(plan.kind) ? null : ownerParts(owner.before), final = ['role-metadata','profile-metadata','profile-check'].includes(plan.kind) ? null : ownerParts(owner.after);
    if (plan.kind === 'role-metadata') {
        if (plan.owner_intent !== null || plan.files.length || roleBody(owner.before,false) !== roleBody(owner.after,true))
            throw new Error('文件角色登记不能改写正文。');
    } else if (plan.kind === 'profile-check') {
        if (plan.owner_intent !== null || plan.files.length || !owner.before.equals(owner.after))
            throw new Error('论文资料核验不能修改源文件。');
    } else if (plan.kind === 'profile-metadata') {
        if (plan.owner_intent !== null || plan.files.length || profileBody(owner.before,plan.remove) !== utf8(owner.after))
            throw new Error('论文资料迁移只能移除精确核对的顶部插件注释块。');
    } else if (old.header !== final.header || ![1,2].includes(final.state?.schema) || final.state?.transaction) throw new Error('旧审核事务改变了作者状态头或未完成最终状态。');
    else if (plan.kind === 'legacy-recovery') {
        const tr = old.state?.transaction;
        if (plan.owner_intent !== null || !tr || typeof tr.owner !== 'boolean' || (!tr.owner && old.body !== final.body) || !isDeepStrictEqual(tr.files,plan.files.map(item => item.file)) || old.counter !== final.counter)
            throw new Error('旧审核恢复意图不一致。');
        const expected = {...old.state}; delete expected.transaction;
        if (!isDeepStrictEqual(expected,final.state)) throw new Error('旧审核恢复最终状态不一致。');
    } else if (plan.owner_intent === null) {
        if (old.state?.transaction || plan.files.length || old.body !== final.body) throw new Error('旧审核元数据写入不能修改正文。');
    } else {
        owner.intent = decode(plan.owner_intent);
        const prepared = ownerParts(owner.intent), tr = prepared.state?.transaction;
        if (old.body !== prepared.body || old.header !== prepared.header || prepared.header !== final.header || prepared.counter !== final.counter ||
            old.state?.transaction || !tr || typeof tr.owner !== 'boolean' || (!tr.owner && old.body !== final.body) || !Array.isArray(tr.files) || !isDeepStrictEqual(tr.files,plan.files.map(item => item.file))) throw new Error('旧审核事务意图不一致。');
        const expected = {...prepared.state}; delete expected.transaction;
        if (!isDeepStrictEqual(expected,final.state)) throw new Error('旧审核事务最终状态不一致。');
    }
    const files = plan.files.map(item => ({relative:item.file,file:regular(root,item.file,'.tex'),before:decode(item.before),after:decode(item.after)}));
    const checks = plan.checks.map(item => ({relative:item.file,file:regular(root,item.file),before:decode(item.before)}));
    if (checks.some(item => !['.tex','.txt','.md'].includes(path.extname(item.file).toLowerCase()))) throw new Error('审核核对文件类型无效。');
    const all = [owner,...files,...checks], ids = all.map(item => process.platform === 'win32' ? item.file.toLowerCase() : item.file);
    if (new Set(ids).size !== ids.length) throw new Error('旧审核事务文件重复。');
    for (const item of all) {
        item.beforeText = utf8(item.before);
        if (item.after) {
            item.afterText = utf8(item.after);
            const hasBom = value => value.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]));
            if (hasBom(item.before) !== hasBom(item.after)) throw new Error('旧审核事务不能改变 BOM：' + item.relative);
        }
    }
    if (owner.intent) {
        const bom = value => value.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]));
        if (bom(owner.intent) !== bom(owner.before)) throw new Error('旧审核事务意图不能改变 BOM。');
        owner.intentText = utf8(owner.intent);
    }
    return {root,owner,files,checks};
}

async function applyLegacy(vscode, registry, root, generation, commit, rolePlan, context) {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任论文工作区。');
    root = fs.realpathSync(root);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (!folder || !samePath(fs.realpathSync(folder.uri.fsPath),root)) throw new Error('事务不属于当前受信任论文工作区。');
    if (rolePlan && !['role-metadata','profile-metadata','profile-check'].includes(rolePlan.kind)) throw new Error('文件角色请求无效。');
    const {owner,files,checks} = rolePlan ? checkedPlan(root,rolePlan) : legacyPlan(root,commit), all = [owner,...files,...checks];
    if (rolePlan?.kind === 'profile-metadata') {
        const cfg = vscode.workspace.getConfiguration('localLatex');
        const python = cfg.get('pythonPath') || require('./tools').discover(key => cfg.get(key)).found.pythonPath;
        if (!python || !context?.globalStorageUri?.fsPath) throw new Error('缺少可信的论文资料目录或 Python；未修改源文件。');
        await require('./backup').run(python, ['-X','utf8',path.join(__dirname,'profile_transition_check.py')], root,
            JSON.stringify({root,storage:context.globalStorageUri.fsPath,plan:rolePlan}));
    }
    for (const item of all) {
        if (!fs.readFileSync(item.file).equals(item.before)) throw new Error('审核文件已变化：' + item.relative);
        const open = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && samePath(doc.uri.fsPath,item.file));
        if (open?.isDirty) throw new Error('审核文件存在未保存编辑：' + item.relative);
    }
    for (const item of all) {
        item.document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.file));
        if (item.document.isDirty || item.document.getText() !== item.beforeText) throw new Error('编辑器内容已变化：' + item.relative);
        item.version = item.document.version;
        if (item.afterText !== undefined) {
            const eol = item.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            for (const text of [item.afterText,...(item.intentText ? [item.intentText] : [])])
                if ((text.match(/\r\n|\r|\n/g) || []).some(value => value !== eol)) throw new Error('事务换行与编辑器不一致：' + item.relative);
        }
    }
    const authority = () => {const state = registry.state(root); return !!state?.eligible && state.generation === generation;};
    const verify = () => {
        for (const item of all) if (!fs.readFileSync(item.file).equals(item.current || item.before) || item.document.isDirty || item.document.version !== item.version || item.document.getText() !== (item.currentText ?? item.beforeText))
            throw new Error('事务期间审核文件已变化：' + item.relative);
    };
    const write = async (item, next, nextText) => {
        await registry.check(root,generation); verify();
        const document = item.document, before = item.currentText ?? item.beforeText;
        if (Buffer.compare(item.current || item.before,next) === 0) return;
        const editor = vscode.window.visibleTextEditors.find(value => value.document === document) || await vscode.window.showTextDocument(document,{preview:false,preserveFocus:true});
        await registry.check(root,generation); verify();
        await applyHostEdit(vscode,editor,{version:item.version,text:before},nextText,authority);
        if (!fs.readFileSync(item.file).equals(next)) throw new Error('保存后的审核文件与事务不一致：' + item.relative);
        item.current = next; item.currentText = nextText; item.version = document.version;
    };
    if (owner.intent) await write(owner,owner.intent,owner.intentText);
    for (const item of files) await write(item,item.after,item.afterText);
    await write(owner,owner.after,owner.afterText);
    await registry.check(root,generation); verify();
    return {files:files.map(item => item.relative),owner:owner.relative};
}

module.exports = {applyLegacy,legacyPlan,ownerParts};
