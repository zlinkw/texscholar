'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {environment, samePath} = require('./tools');
const reviewPath = file => /[\\/]\.latex-build[\\/]review-diff[\\/]current[\\/][^\\/]+-review\.pdf$/i.test(file);
function pdfTabs(vscode) {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input?.uri)
        .filter(uri => uri?.scheme === 'file' && reviewPath(uri.fsPath));
}
function parseSync(text) {
    const block = text.split('SyncTeX result begin')[1]?.split('SyncTeX result end')[0];
    if (!block) throw new Error('审核 PDF 没有返回可用的 SyncTeX 位置。');
    const value = {};
    for (const key of ['Page', 'x', 'y']) {
        const match = new RegExp('^' + key + ':([^\\r\\n]+)', 'm').exec(block);
        value[key.toLowerCase()] = match ? Number(match[1]) : NaN;
    }
    if (!Number.isInteger(value.page) || value.page < 1 || !Number.isFinite(value.x) || !Number.isFinite(value.y))
        throw new Error('审核 PDF 的 SyncTeX 坐标无效。');
    return {...value, indicator: true};
}
async function locate(vscode, context, metaFile, c) {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    if (!reviewPath(meta.pdf) || meta.versions[c.id] !== c.version || !meta.targets[c.id])
        throw new Error('审核 PDF 未包含当前候选版本，请先生成／更新。');
    for (const file of [meta.pdf, meta.compiled_pdf, meta.targets[c.id].file]) {
        const relative = path.relative(c.repo, file);
        if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('审核 PDF 导航路径越出当前项目。');
    }
    if (crypto.createHash('sha256').update(await fs.readFile(meta.pdf)).digest('hex') !== meta.pdf_digest)
        throw new Error('审核 PDF 与定位元数据版本不一致，请重新生成／更新；未猜测位置。');
    let registration;
    try {registration = JSON.parse(await fs.readFile(metaFile.replace(/\.json$/, '.viewer.json'), 'utf8'));}
    catch (error) {if (error.code === 'ENOENT') throw new Error('审核 PDF 窗口尚未登记；请先打开／重新打开审核 PDF，窗口就绪后再定位。'); throw error;}
    if (!samePath(registration.pdf, meta.pdf)) throw new Error('审核 PDF 窗口与文档不一致。');
    const target = vscode.Uri.parse(registration.viewer_uri);
    if (target.scheme !== vscode.env.uriScheme || target.authority !== context.extension.id || target.path !== '/review-pdf')
        throw new Error('审核 PDF 窗口地址无效，未打开外部地址。');
    const synctex = vscode.workspace.getConfiguration('latex-workshop').get('synctex.path', 'synctex');
    const item = meta.targets[c.id];
    const stdout = await new Promise((resolve, reject) => cp.execFile(synctex,
        ['view', '-i', `${item.line}:0:${item.file}`, '-o', meta.compiled_pdf],
        {env: environment(), windowsHide: true, shell: false}, (error, out, err) => error ? reject(new Error(err || error.message)) : resolve(out)));
    const record = parseSync(stdout);
    const query = new URLSearchParams(target.query);
    query.set('pdf', meta.pdf); query.set('record', JSON.stringify(record));
    query.set('digest', meta.pdf_digest);
    if (!await vscode.env.openExternal(target.with({query: query.toString()}))) throw new Error('未能切换到已登记的审核 PDF 窗口。');
}
async function handleUri(vscode, uri) {
    const q = new URLSearchParams(uri.query), pdf = q.get('pdf'), record = JSON.parse(q.get('record'));
    if (!pdf || !pdfTabs(vscode).some(item => samePath(item.fsPath, pdf))) throw new Error('对应审核 PDF 未在本窗口打开，请重新打开审核 PDF 窗口。');
    if (crypto.createHash('sha256').update(await fs.readFile(pdf)).digest('hex') !== q.get('digest'))
        throw new Error('定位期间审核 PDF 已更新，请重新点击定位。');
    if (!Number.isInteger(record.page) || record.page < 1 || !Number.isFinite(record.x) || !Number.isFinite(record.y)) throw new Error('审核定位坐标无效。');
    const workshop = vscode.extensions.getExtension('james-yu.latex-workshop');
    if (!workshop) throw new Error('未找到 LaTeX Workshop。');
    await workshop.activate();
    // Read-only adapter to Workshop's existing viewer. No files are patched.
    // Its public commands cannot specify a PDF plus coordinates in another window.
    const viewer = require(path.join(workshop.extensionPath, 'out/src/preview/viewer.js'));
    if (typeof viewer.locate !== 'function') throw new Error('当前 Workshop 不提供已核对的定位接口；未修改第三方扩展，请报告版本。');
    await viewer.locate(vscode.Uri.file(pdf), record);
}
function activate(context, vscode = require('vscode')) {
    let registering = Promise.resolve();
    async function register() {
        for (const uri of pdfTabs(vscode)) {
            const file = uri.fsPath.replace(/\.pdf$/i, '.json');
            const info = await fs.lstat(file);
            if (!info.isFile() || info.isSymbolicLink()) throw new Error('审核 PDF 导航元数据不是普通文件。');
            const meta = JSON.parse(await fs.readFile(file, 'utf8'));
            if (!samePath(meta.pdf, uri.fsPath)) throw new Error('审核 PDF 与导航元数据不一致。');
            const callback = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}/review-pdf`));
            const registration = file.replace(/\.json$/, '.viewer.json');
            try {
                const prior = await fs.lstat(registration);
                if (!prior.isFile() || prior.isSymbolicLink()) throw new Error('审核窗口登记文件不是普通文件。');
            } catch (error) {if (error.code !== 'ENOENT') throw error;}
            const temporary = registration + '.write-' + process.pid;
            await fs.writeFile(temporary, JSON.stringify({pdf: meta.pdf, viewer_uri: callback.toString()}), {encoding: 'utf8', flag: 'wx'});
            await fs.rename(temporary, registration);
        }
    }
    const run = () => {registering = registering.then(register).catch(error => vscode.window.showErrorMessage('审核 PDF 窗口登记失败：' + error.message));};
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(run));
    run();
}
module.exports = {activate, locate, handleUri, parseSync, reviewPath};
