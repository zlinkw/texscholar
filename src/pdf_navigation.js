'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {environment, samePath} = require('./tools');
const reviewPath = file => /[\\/]\.latex-build[\\/]review-diff[\\/]current[\\/][^\\/]+-review\.pdf$/i.test(file);
const sourceRouters = new WeakMap();
const inside = (root, file) => {const rel = path.relative(root, file); return rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);};
const registryPath = root => path.join(root, '.latex-build', 'texscholar-source-window.json');
async function readJSON(file) {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('PDF 定位登记不是普通文件。');
    return JSON.parse(await fs.readFile(file, 'utf8'));
}
function callbackURI(vscode, context, value, endpoint) {
    const uri = vscode.Uri.parse(value);
    if (uri.scheme !== vscode.env.uriScheme || uri.authority !== context.extension.id || uri.path !== endpoint)
        throw new Error('PDF 定位窗口地址无效。');
    return uri;
}
function sourcePosition(text, line, sourceDigest) {
    const plain = require('./review_positions').view(text.replace(/^\uFEFF/, ''));
    if (!plain) throw new Error('源码审核状态块不完整，未猜测位置。');
    if (crypto.createHash('sha256').update(plain.body.replace(/\r\n/g, '\n')).digest('hex') !== sourceDigest)
        throw new Error('源码已在审核 PDF 生成后改变，请更新审核 PDF 再定位。');
    const rows = plain.body.split('\n');
    if (!Number.isInteger(line) || line < 1 || line > rows.length) throw new Error('审核 PDF 的源码行号无效。');
    let offset = rows.slice(0, line - 1).reduce((n, row) => n + row.length + 1, 0);
    if (plain.start !== undefined && offset >= plain.start) offset += plain.end - plain.start;
    return text.startsWith('\uFEFF') ? offset + 1 : offset;
}
function pdfTabs(vscode) {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input?.uri)
        .filter(uri => uri?.scheme === 'file' && reviewPath(uri.fsPath));
}
function workshopModule(workshop, relative) {
    // Reuse Workshop's initialized singleton. Requiring a differently cased
    // Windows path creates a second, uninitialized CommonJS module graph.
    const file = path.join(workshop.extensionPath, 'out/src', relative);
    const loaded = Object.values(require.cache).find(module => samePath(module.filename, file));
    if (!loaded) throw new Error('当前 Workshop 定位模块尚未加载或版本接口已变化；未修改第三方扩展。');
    return loaded.exports;
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
    const viewer = workshopModule(workshop, 'preview/viewer.js');
    if (typeof viewer.locate !== 'function') throw new Error('当前 Workshop 不提供已核对的定位接口；未修改第三方扩展，请报告版本。');
    await viewer.locate(vscode.Uri.file(pdf), record);
}
function activate(context, vscode = require('vscode')) {
    let registering = Promise.resolve();
    const roots = new Map();
    async function registerSources() {
        if (!vscode.workspace.isTrusted) return;
        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (folder.uri.scheme !== 'file' || roots.has(folder.uri.fsPath)) continue;
            if (!(await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.tex'), '**/{.git,.latex-build,.codex-review,node_modules}/**', 1)).length) continue;
            const root = folder.uri.fsPath, directory = path.join(root, '.latex-build');
            try {await fs.mkdir(directory);} catch (error) {if (error.code !== 'EEXIST') throw error;}
            const info = await fs.lstat(directory);
            if (!info.isDirectory() || info.isSymbolicLink() || !inside(await fs.realpath(root), await fs.realpath(directory)))
                throw new Error('PDF 定位目录不是项目内的普通目录。');
            const token = crypto.randomUUID();
            const callback = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}/source`).with({query: new URLSearchParams({root, token}).toString()}));
            const file = registryPath(root), temporary = file + '.write-' + process.pid;
            try {await readJSON(file);} catch (error) {if (error.code !== 'ENOENT') throw error;}
            await fs.writeFile(temporary, JSON.stringify({root, source_uri: callback.toString()}), {encoding: 'utf8', flag: 'wx'});
            await fs.rename(temporary, file);
            roots.set(root, {token, callback});
        }
    }
    async function openSource(uri) {
        if (!vscode.workspace.isTrusted) throw new Error('请先信任论文工作区。');
        const q = new URLSearchParams(uri.query), root = q.get('root'), file = q.get('file');
        if (!roots.has(root) || roots.get(root).token !== q.get('token') || !file || !inside(root, file) || !/\.tex$/i.test(file))
            throw new Error('源码定位不属于本窗口登记的论文项目。');
        const real = await fs.realpath(file);
        if (!inside(await fs.realpath(root), real)) throw new Error('源码定位越出论文目录。');
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        let line = Number(q.get('line')), column = Number(q.get('column'));
        if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) throw new Error('源码定位坐标无效。');
        let position = q.has('source_digest') ? document.positionAt(sourcePosition(document.getText(), line, q.get('source_digest')))
            : new vscode.Position(Math.min(line - 1, document.lineCount - 1), column);
        const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input?.uri && samePath(tab.input.uri.fsPath, file));
        const editor = await vscode.window.showTextDocument(document, {viewColumn: tab?.group.viewColumn || vscode.ViewColumn.One, preview: false});
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    sourceRouters.set(context, openSource);
    let lastPDF, forwarding = Promise.resolve();
    const openedTextTabs = new Set();
    function rememberPDF() {
        const uri = vscode.window.tabGroups.activeTabGroup?.activeTab?.input?.uri;
        if (uri?.scheme === 'file' && /\.pdf$/i.test(uri.fsPath)) lastPDF = uri;
    }
    async function forwardSelection(event, pdf) {
        if (!pdf || !vscode.workspace.isTrusted || event.textEditor !== vscode.window.activeTextEditor
            || event.kind === vscode.TextEditorSelectionChangeKind.Mouse || event.kind === vscode.TextEditorSelectionChangeKind.Keyboard) return;
        const editor = event.textEditor, source = editor.document.uri;
        if (source.scheme !== 'file' || !/\.tex$/i.test(source.fsPath)) return;
        let directory = path.dirname(pdf.fsPath), registration;
        while (directory !== path.dirname(directory)) {
            try {registration = await readJSON(registryPath(directory)); break;}
            catch (error) {if (error.code !== 'ENOENT') throw error;}
            directory = path.dirname(directory);
        }
        if (!registration || (roots.has(registration.root) && !reviewPath(pdf.fsPath))) return;
        const root = registration.root;
        if (!samePath(root, directory)) throw new Error('PDF 源码窗口登记与目录不一致。');
        let file = source.fsPath, line = editor.selection.active.line + 1, column = editor.selection.active.character, sourceDigest;
        if (reviewPath(pdf.fsPath)) {
            const meta = await readJSON(pdf.fsPath.replace(/\.pdf$/i, '.json'));
            if (crypto.createHash('sha256').update(await fs.readFile(meta.pdf)).digest('hex') !== meta.pdf_digest)
                throw new Error('审核 PDF 正在更新，请待更新完成后重新定位。');
            const entry = Object.entries(meta.reverse || {}).find(([file]) => samePath(file, source.fsPath))?.[1];
            if (!entry) {
                if (inside(path.join(root, '.latex-build', 'review-diff'), source.fsPath)) throw new Error('此审核 PDF 缺少反向源码映射，请重新生成／更新。');
                return;
            }
            file = entry.file; line = entry.lines[line - 1]; column = 0; sourceDigest = entry.source_digest;
        }
        if (!inside(root, file)) throw new Error('PDF 返回的源码位置越出论文目录。');
        const target = callbackURI(vscode, context, registration.source_uri, '/source');
        const query = new URLSearchParams(target.query);
        query.set('file', file); query.set('line', line); query.set('column', column);
        if (sourceDigest) query.set('source_digest', sourceDigest);
        if (roots.has(root)) await openSource(target.with({query: query.toString()}));
        else if (!await vscode.env.openExternal(target.with({query: query.toString()}))) throw new Error('未能返回原论文编辑窗口。');
        const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => openedTextTabs.has(tab) && tab.input?.uri && samePath(tab.input.uri.fsPath, source.fsPath));
        if (tab && !editor.document.isDirty) {
            openedTextTabs.delete(tab);
            await vscode.window.tabGroups.close(tab, true);
        }
    }
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
    const run = () => {registering = registering.then(registerSources).then(register).catch(error => vscode.window.showErrorMessage('PDF 窗口登记失败：' + error.message)); return registering;};
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
        for (const tab of event.opened) if (/\.tex$/i.test(tab.input?.uri?.fsPath || '')) openedTextTabs.add(tab);
        for (const tab of event.closed) openedTextTabs.delete(tab);
        rememberPDF(); run();
    }));
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups(rememberPDF));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
        const pdf = lastPDF;
        forwarding = forwarding.then(() => forwardSelection(event, pdf)).catch(error => vscode.window.showErrorMessage('PDF 返回源码失败：' + error.message));
        return forwarding;
    }));
    rememberPDF();
    return {ready: run()};
}
async function handleSourceUri(vscode, context, uri) {
    const handler = sourceRouters.get(context);
    if (!handler) throw new Error('论文源码窗口尚未就绪。');
    return handler(uri);
}
module.exports = {activate, locate, handleUri, handleSourceUri, parseSync, reviewPath, sourcePosition, workshopModule};
