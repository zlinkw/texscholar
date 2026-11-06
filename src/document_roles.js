'use strict';
const path = require('node:path'), fs = require('node:fs/promises'), crypto = require('node:crypto');
const {run} = require('./backup');
const EXCLUDE = '**/{.git,.codex-review,.latex-build,node_modules,clean_dir}/**';
const LABELS = {manuscript: '论文主文档', chapter: '章节／正文子文件', response: '回复信', review: '原始审稿意见', template: '参考模板', other: '其他 TeX 文件'};
async function call(vscode, repo, operation, input, execute = run) {
    const cfg = vscode.workspace.getConfiguration('localLatex');
    const python = cfg.get('pythonPath') || require('./tools').discover(k => cfg.get(k)).found.pythonPath;
    if (!python) throw new Error('文件角色识别需要 Python 3.12+，请先配置本地工具。');
    return JSON.parse(await execute(python, ['-X', 'utf8', path.join(__dirname, 'document_roles.py'), '--project', repo, operation], repo,
        input === undefined ? undefined : JSON.stringify(input)));
}
function structuralText(text) {
    text = text.replace(/^% CODEX-(REVIEW-STATE|FILE-ROLES)-BEGIN\r?\n[\s\S]*?^% CODEX-\1-END\r?$/gm,
        match => match.startsWith('% CODEX-FILE-ROLES-') ? match : '');
    return (text.match(/^% CODEX-FILE-ROLES-BEGIN\r?\n[\s\S]*?^% CODEX-FILE-ROLES-END\r?$/gm) || []).join('\n') + '\n' +
        (text.match(/\\(?:documentclass\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}|(?:input|include|subfile)\s*(?:\{[^{}]*\}|[^\s{}%]+)|(?:subimport|import)\s*\{[^{}]*\}\s*\{[^{}]*\})|^\s*%\s*!\s*TeX\s+root\s*=.*$/gmi) || []).join('\n');
}
async function confirmedRoot(vscode, repo, file, execute = run) {
    const data = await call(vscode, repo, 'scan', undefined, execute);
    if (data.status === 'changed') throw new Error('文件或编译关系已变化，请先执行“识别／确认论文文件角色”，未猜测 PDF 入口。');
    if (data.status !== 'confirmed') return;
    const entry = data.files.find(item => item.file === path.relative(repo, file).split(path.sep).join('/'));
    if (!entry?.root) throw new Error('该文件尚未指定编译入口；请在文件角色确认中选择，不会自动改编另一份文档。');
    return path.join(repo, entry.root);
}
function activate(context, vscode = require('vscode'), execute = run) {
    const observed = new Map(), notifications = new Map(), pending = new Set();
    let chain = Promise.resolve(), prompting = false;
    const trusted = () => vscode.workspace.isTrusted;
    async function scan(repo) {
        return call(vscode, repo, 'scan', undefined, execute);
    }
    function clean(repo) {
        for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && doc.uri.scheme === 'file'
            && require('./tools').samePath(vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || '', repo)
            && path.extname(doc.uri.fsPath).toLowerCase() === '.tex')
            throw new Error('请先保存项目内的 TeX 编辑，再确认文件角色；未覆盖任何内容。');
    }
    async function confirm(repo) {
        if (!trusted()) throw new Error('请先信任该本地论文文件夹。');
        if (prompting) return;
        prompting = true;
        try {
            clean(repo);
            const data = await scan(repo);
            if (!data.structure.length) return;
            const entries = data.suggested.map(suggested => {
                const prior = data.files.find(f => f.file === suggested.file);
                return {file: suggested.file, roles: [...(prior?.roles || suggested.roles)],
                    root: prior?.root === null ? null : prior?.root && data.roots.includes(prior.root) ? prior.root : suggested.root};
            });
            let ownerChoice = {file: data.owner || entries.find(e => e.roles.includes('manuscript'))?.file || entries[0].file};
            while (true) {
                const detail = '保存位置：' + ownerChoice.file + ' 顶部注释\n\n' + entries.map(e => e.file + '\n  ' + e.roles.map(r => LABELS[r]).join('、') + ' ｜ 编译：' + (e.root || '未指定／不编译')).join('\n\n')
                    + '\n\n自动识别只是建议。原始意见与回复可以同文件；动态宏／共享子文件的入口请核对。不会修改正文或审核决定。';
                const action = await vscode.window.showInformationMessage('确认论文文件角色与编译入口', {modal: true, detail}, '确认并保存', '逐项调整');
                if (action === '确认并保存') break;
                if (action !== '逐项调整') return;
                const selected = await vscode.window.showQuickPick([...entries.map(e => ({label: e.file, file: e.file})),
                    {label: '调整顶部登记拥有文件', owner: true}], {title: '选择要调整的文件'});
                if (!selected) continue;
                if (selected.owner) {
                    if (data.owner) {vscode.window.showInformationMessage('已有登记继续使用 ' + data.owner + '，不会自动搬移或创建重复登记。'); continue;}
                    const picked = await vscode.window.showQuickPick(entries.map(e => ({label: e.file, file: e.file})), {title: '选择唯一登记拥有文件'});
                    if (picked) ownerChoice = picked;
                    continue;
                }
                const entry = entries.find(e => e.file === selected.file);
                const chosen = await vscode.window.showQuickPick(Object.entries(LABELS).map(([role, label]) => ({label, role, picked: entry.roles.includes(role)})),
                    {canPickMany: true, title: entry.file + ' 的角色（可多选）', placeHolder: data.suggested.find(e => e.file === entry.file).reason});
                if (!chosen) continue;
                if (!chosen.length) throw new Error('每个文件至少选择一个角色；尚未保存。');
                entry.roles = chosen.map(c => c.role);
                const compile = await vscode.window.showQuickPick([{label: '不参与编译／暂未指定', file: null}, ...data.roots.map(file => ({label: file, file}))],
                    {title: entry.file + ' 的编译入口', placeHolder: '当前：' + (entry.root || '未指定')});
                if (compile) entry.root = compile.file;
            }
            clean(repo);
            const owner = path.join(repo, ownerChoice.file), raw = await fs.readFile(owner);
            const result = await call(vscode, repo, 'save', {owner: ownerChoice.file, previous_owner: data.owner,
                previous_files: data.files, owner_sha256: crypto.createHash('sha256').update(raw).digest('hex'), structure: data.structure, files: entries}, execute);
            notifications.delete(repo);
            vscode.window.showInformationMessage('文件角色已确认并保存至 ' + result.owner + ' 顶部注释。未接收候选、初始化审核批次或操作 Git。');
            return result;
        } finally {prompting = false;}
    }
    async function inspect(repo) {
        const data = await scan(repo);
        if (!data.structure.length) return;
        if (data.status === 'confirmed') {notifications.delete(repo); return;}
        const key = JSON.stringify([data.owner, data.status, data.structure]);
        if (notifications.get(repo) === key) return;
        notifications.set(repo, key);
        const message = data.status === 'changed' ? 'TeXScholar：文件角色登记有变化，需要重新确认：' + data.changes.join('、')
            : 'TeXScholar：已自动识别 TeX 文件用途与编译关系，请首次确认。不会仅凭文件名猜定正文或回复信。';
        // Nonblocking activation; dismissing never writes or counts as confirmation.
        vscode.window.showInformationMessage(message, '确认文件角色', '稍后').then(choice => {
            if (choice === '确认文件角色') return confirm(repo);
        }).catch(error => vscode.window.showErrorMessage(error.message));
    }
    const request = repo => {
        pending.add(repo);
        const work = chain.then(async () => {
            while (pending.size && trusted()) {const next = pending.values().next().value; pending.delete(next); await inspect(next);}
        });
        chain = work.catch(error => {vscode.window.showErrorMessage('文件角色识别未完成：' + error.message);});
        return chain;
    };
    async function initialize() {
        if (!trusted()) return;
        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (folder.uri.scheme !== 'file') continue;
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.tex'), EXCLUDE);
            if (!files.length) continue;
            for (const file of files) observed.set(file.fsPath, structuralText(await fs.readFile(file.fsPath, 'utf8')));
            await request(folder.uri.fsPath);
        }
    }
    const changed = async (file, force = false) => {
        if (!trusted() || file.scheme !== 'file') return;
        const folder = vscode.workspace.getWorkspaceFolder(file);
        if (!folder || /(?:^|[\\/])(?:\.codex-review|\.latex-build|node_modules|clean_dir|\.git)(?:[\\/]|$)/.test(path.relative(folder.uri.fsPath, file.fsPath))) return;
        let value;
        try {value = structuralText(await fs.readFile(file.fsPath, 'utf8'));}
        catch (error) {if (error.code !== 'ENOENT') throw error;}
        const before = observed.get(file.fsPath); observed.set(file.fsPath, value);
        if (force || before !== value) await request(folder.uri.fsPath);
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    const handle = (file, force) => changed(file, force).catch(error => vscode.window.showErrorMessage(error.message));
    context.subscriptions.push(watcher, watcher.onDidChange(file => handle(file, false)), watcher.onDidCreate(file => handle(file, true)), watcher.onDidDelete(file => handle(file, true)),
        vscode.workspace.onDidChangeWorkspaceFolders(() => initialize().catch(error => vscode.window.showErrorMessage(error.message))),
        vscode.commands.registerCommand('localLatex.confirmFileRoles', async () => {
            const folders = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file');
            const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({placeHolder: '选择要识别文件角色的论文项目'});
            if (folder) try {return await confirm(folder.uri.fsPath);} catch (error) {vscode.window.showErrorMessage(error.message);}
        }));
    return {ready: initialize().catch(error => vscode.window.showErrorMessage('文件角色识别未完成：' + error.message)), confirm,
        whenIdle: () => chain};
}
module.exports = {activate, confirmedRoot, structuralText};
