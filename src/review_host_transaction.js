'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {applyHostEdit} = require('./review_host_edit');

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
function regular(root, relative, suffix) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '.' || p === '..'))
        throw new Error('事务文件路径无效。');
    let current = root;
    for (const part of relative.split(/[\\/]/)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('事务文件不能经过链接。');
    }
    const file = fs.realpathSync(current), rel = path.relative(root, file);
    if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !fs.statSync(file).isFile() || (suffix && path.extname(file).toLowerCase() !== suffix))
        throw new Error('事务文件不属于论文工作区。');
    return file;
}
function decode(value) {
    if (typeof value !== 'string') throw new Error('事务对象缺少文件内容。');
    const raw = Buffer.from(value, 'base64');
    if (raw.toString('base64') !== value) throw new Error('事务对象内容编码无效。');
    return raw;
}
function utf8(raw) {return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(raw).replace(/^\uFEFF/, '');}
function excerptResource(root, relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') ||
        relative.split('/').some(p => !p || p === '.' || p === '..') || path.posix.basename(relative) !== 'texscholar-excerpt.sty')
        throw new Error('事务支持文件路径无效。');
    const parts = relative.split('/'), leaf = parts.pop();
    let parent = root;
    for (const part of parts) {
        parent = path.join(parent, part);
        const info = fs.lstatSync(parent);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('事务支持文件目录无效。');
    }
    if (fs.realpathSync(parent) !== parent) throw new Error('事务支持文件目录越界。');
    const file = path.join(parent, leaf);
    try {
        const info = fs.lstatSync(file);
        if (info.isSymbolicLink() || !info.isFile() || path.dirname(fs.realpathSync(file)) !== parent)
            throw new Error('事务支持文件不是工作区内普通文件。');
        return {relative,file,exists:true};
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return {relative,file,exists:false};
    }
}

function intent(root, expectedState, commit) {
    root = fs.realpathSync(root);
    if (!/^[a-f0-9]{64}$/.test(expectedState) || !/^[a-f0-9]{64}$/.test(commit)) throw new Error('事务身份无效。');
    const statePath = regular(root, '.codex-review/state.json', '.json');
    const stateRaw = fs.readFileSync(statePath);
    if (sha(stateRaw) !== expectedState) throw new Error('事务状态已变化；未写入正文。');
    const state = JSON.parse(stateRaw.toString('utf8'));
    if (state.schema !== 3 || state.transaction?.commit !== commit || state.transaction.owner !== false || !Array.isArray(state.transaction.files))
        throw new Error('事务状态与请求不一致。');
    const objectPath = regular(root, '.codex-review/objects/' + commit + '.json', '.json');
    const objectRaw = fs.readFileSync(objectPath);
    if (sha(objectRaw) !== commit) throw new Error('事务对象完整性不匹配。');
    const object = JSON.parse(objectRaw.toString('utf8')).files;
    const files = state.transaction.files.map((relative, index) => {
        const file = regular(root, relative, '.tex'), before = decode(object[index + '-old']), after = decode(object[index + '-new']);
        const bom = raw => raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
        if (bom(before) !== bom(after)) throw new Error('事务不能改变源文件 BOM：' + relative);
        return {relative,file,before,after,beforeText:utf8(before),afterText:utf8(after)};
    });
    if (new Set(files.map(item => process.platform === 'win32' ? item.file.toLowerCase() : item.file)).size !== files.length) throw new Error('事务文件重复。');
    const checks = (state.transaction.checks || []).map((relative, index) => {
        const file = regular(root, relative);
        if (!['.tex','.txt','.md','.sty'].includes(path.extname(file).toLowerCase())) throw new Error('审核核对文件类型无效。');
        const before = decode(object['check-' + index]);
        return {relative,file,before,beforeText:utf8(before)};
    });
    const identities = [...files,...checks].map(item => process.platform === 'win32' ? item.file.toLowerCase() : item.file);
    if (new Set(identities).size !== identities.length) throw new Error('事务核对文件重复。');
    const resources = (state.transaction.created || []).map((relative, index) =>
        ({...excerptResource(root, relative), after:decode(object['resource-' + index + '-new'])}));
    if (resources.length > 1 || resources.some(item => identities.includes(process.platform === 'win32' ? item.file.toLowerCase() : item.file)))
        throw new Error('事务支持文件重复。');
    for (const item of resources) if (!item.after.equals(fs.readFileSync(path.join(__dirname, 'texscholar-excerpt.sty'))))
        throw new Error('事务支持文件内容不匹配。');
    return {root,statePath,stateRaw,state,files,checks,resources};
}

async function applyTransaction(vscode, registry, root, generation, expectedState, commit, recover = false) {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任论文工作区。');
    root = fs.realpathSync(root);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    const sameFile = require('./tools').samePath;
    if (!folder || !sameFile(fs.realpathSync(folder.uri.fsPath), root)) throw new Error('事务不属于当前受信任论文工作区。');
    const {statePath,files,checks,resources} = intent(root, expectedState, commit);
    for (const item of resources) {
        if (item.exists && !(recover && fs.readFileSync(item.file).equals(item.after)))
            throw new Error('摘录支持文件已存在或变化：' + item.relative);
        const open = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, item.file));
        if (open?.isDirty) throw new Error('摘录支持文件存在未保存编辑：' + item.relative);
    }
    for (const item of files) {
        const actual = fs.readFileSync(item.file);
        if (!actual.equals(item.before) && !(recover && actual.equals(item.after))) throw new Error('正文已变化：' + item.relative);
        item.current = actual;
        item.currentText = utf8(actual);
    }
    for (const item of checks) if (!fs.readFileSync(item.file).equals(item.before)) throw new Error('审核核对文件已变化：' + item.relative);
    for (const item of [...files,...checks]) {
        const open = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, item.file));
        if (open?.isDirty) throw new Error('正文存在未保存编辑：' + item.relative);
    }
    for (const item of [...files,...checks]) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.file));
        if (document.isDirty || document.getText() !== (item.currentText ?? item.beforeText)) throw new Error('编辑器正文已变化：' + item.relative);
        if (item.afterText !== undefined) {
            const expectedEol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            if ((item.afterText.match(/\r\n|\r|\n/g) || []).some(eol => eol !== expectedEol))
                throw new Error('事务换行与编辑器不一致：' + item.relative);
        }
        item.document = document;
        item.version = document.version;
    }
    const authority = () => {const state = registry.state(root); return !!state?.eligible && state.generation === generation;};
    const checkInputs = () => {
        for (const item of checks) if (!fs.readFileSync(item.file).equals(item.before) || item.document.isDirty || item.document.version !== item.version || item.document.getText() !== item.beforeText)
            throw new Error('审核核对文件已变化：' + item.relative);
    };
    for (const item of resources) {
        await registry.check(root, generation);
        checkInputs();
        if (sha(fs.readFileSync(statePath)) !== expectedState) throw new Error('事务状态已变化。');
        if (!item.exists) {
            const fd = fs.openSync(item.file, 'wx');
            try {fs.writeFileSync(fd, item.after); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
        }
    }
    for (const item of files) {
        await registry.check(root, generation);
        checkInputs();
        if (sha(fs.readFileSync(statePath)) !== expectedState || !fs.readFileSync(item.file).equals(item.current))
            throw new Error('事务期间正文或状态已变化：' + item.relative);
        const document = item.document;
        const before = item.currentText, after = item.afterText;
        if (document.isDirty || document.getText() !== before) throw new Error('编辑器正文已变化：' + item.relative);
        if (item.current.equals(item.after)) continue;
        await registry.check(root, generation);
        await applyHostEdit(vscode, document, {version:item.version,text:before}, after, authority);
        if (!fs.readFileSync(item.file).equals(item.after)) throw new Error('保存后的正文与事务不一致：' + item.relative);
    }
    await registry.check(root, generation);
    checkInputs();
    if (sha(fs.readFileSync(statePath)) !== expectedState) throw new Error('事务状态已变化；请核对恢复。');
    return {files:files.map(item => item.relative)};
}

function finishTransaction(root, expectedState, commit, finalEncoded) {
    const current = intent(root, expectedState, commit);
    const finalRaw = decode(finalEncoded), finalState = JSON.parse(utf8(finalRaw));
    const expected = {...current.state}; delete expected.transaction;
    if (!isDeepStrictEqual(finalState, expected)) throw new Error('最终状态与事务意图不一致。');
    for (const item of current.files) if (!fs.readFileSync(item.file).equals(item.after))
        throw new Error('事务正文已变化：' + item.relative);
    for (const item of current.checks) if (!fs.readFileSync(item.file).equals(item.before))
        throw new Error('审核核对文件已变化：' + item.relative);
    for (const item of current.resources) if (!item.exists || !fs.readFileSync(item.file).equals(item.after))
        throw new Error('摘录支持文件已变化：' + item.relative);
    if (!fs.readFileSync(current.statePath).equals(current.stateRaw)) throw new Error('事务状态已变化。');
    const temporary = current.statePath + '.write-' + crypto.randomUUID();
    const fd = fs.openSync(temporary,'wx');
    try {fs.writeFileSync(fd,finalRaw); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temporary, current.statePath);
    return {sha256:sha(finalRaw)};
}

module.exports = {applyTransaction, finishTransaction, regular, decode, utf8, sha};
