'use strict';
const tools = require('./tools');
const preset = require('./writing-presets.json');
const RECOMMENDED = [
    ['james-yu.latex-workshop', 'LaTeX 编译、PDF 与双向跳转'],
    ['tecosaur.latex-utilities', '表格／图片转换粘贴'],
    ['ltex-plus.vscode-ltex-plus', '英语检查'], ['usernamehw.errorlens', '行内诊断'],
    ['alefragnani.Bookmarks', '书签'], ['Gruntfuggly.todo-tree', '注释导航'],
    ['qmvis.latex-suite-vscode', '数学输入与矩阵快捷操作'], ['yfzhao.ultra-math-preview', '连续公式预览'],
    ['intellsmi.comment-translate', '可选悬浮翻译（服务可能发送所选文字到外部供应商）'],
    ['cyndigan.latex-visual-editor', '可选可视化编辑'], ['MS-CEINTL.vscode-language-pack-zh-hans', '可选界面汉化']
];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function merge(current, incoming) {
    if (Array.isArray(current) && Array.isArray(incoming)) return [...current, ...incoming.filter(x => !current.some(y => equal(x, y)))];
    if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)) {
        const result = {...current};
        for (const [key, value] of Object.entries(incoming)) result[key] = key in result ? merge(result[key], value) : value;
        return result;
    }
    return current === undefined ? incoming : current;
}
function overlay(current, incoming) {
    if (Array.isArray(current) && Array.isArray(incoming)) {
        const result = [...current];
        for (const item of incoming) {
            const index = item?.name ? result.findIndex(x => x?.name === item.name) : -1;
            if (index >= 0) result[index] = item;
            else if (!result.some(x => equal(x, item))) result.push(item);
        }
        return result;
    }
    if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)) {
        const result = {...current};
        for (const [key, value] of Object.entries(incoming)) result[key] = overlay(result[key], value);
        return result;
    }
    return incoming;
}
function bindings(found) {
    const pdf = found.latexmkPath || 'latexmk';
    const rows = Object.entries(found).filter(([key]) => !['synctexPath', 'chktexPath', 'texcountPath'].includes(key))
        .map(([key, value]) => ({key: 'localLatex.' + key, value}));
    for (const [tool, key] of [['ripgrepPath', 'todo-tree.ripgrep.ripgrep'], ['synctexPath', 'latex-workshop.synctex.path'], ['chktexPath', 'latex-workshop.linting.chktex.exec.path'],
        ['texcountPath', 'latex-workshop.texcount.path'], ['texcountPath', 'latex-utilities.countWord.path']])
        if (found[tool]) rows.push({key, value: found[tool]});
    rows.push({key: 'latex-workshop.latex.tools', value: [{name: 'local-paper-pdf', command: pdf,
        args: ['-pdf', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-outdir=%OUTDIR%', '%DOC%'],
        env: {LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C', ...(found.latexmkPath ? {PATH: tools.environment().PATH || tools.environment().Path} : {})}}]},
    {key: 'latex-workshop.latex.recipes', value: [{name: 'Local LaTeX: pdfLaTeX + BibTeX', tools: ['local-paper-pdf']}]});
    return rows;
}
async function apply(vscode, context, rows, force = false) {
    const saved = {...context.globalState.get('writingSettings', {})}, result = {applied: [], conflicts: [], unavailable: []};
    for (const row of rows) {
        const scope = row.language ? {languageId: row.language} : undefined;
        const cfg = vscode.workspace.getConfiguration(undefined, scope), info = cfg.inspect(row.key);
        if (!info || info.defaultValue === undefined && info.defaultLanguageValue === undefined) {result.unavailable.push(row.key); continue;}
        const id = (row.language || '') + ':' + row.key;
        const own = row.language ? info.globalLanguageValue : info.globalValue;
        const merged = merge(own, row.value);
        // Augment maps/lists without overwriting author-owned scalar choices.
        const owned = saved[id] && equal(own, saved[id].applied);
        const value = force || owned ? overlay(own, row.value) : merged;
        if (!force && !owned && own !== undefined && !equal(merged, row.value) && equal(own, merged) && !equal(own, row.value)) {
            result.conflicts.push(row.key); continue;
        }
        if (equal(own, value)) continue;
        const prior = saved[id] || {key: row.key, language: row.language, hadValue: own !== undefined, before: own};
        await cfg.update(row.key, value, vscode.ConfigurationTarget.Global, !!row.language);
        saved[id] = {...prior, applied: value};
        // Persist each completed change, so a partial setup remains recoverable.
        await context.globalState.update('writingSettings', saved);
        result.applied.push(row.key);
    }
    return result;
}
async function restore(vscode, context) {
    const saved = {...context.globalState.get('writingSettings', {})}, result = {restored: [], changed: []};
    for (const [id, row] of Object.entries(saved)) {
        const cfg = vscode.workspace.getConfiguration(undefined, row.language ? {languageId: row.language} : undefined);
        const info = cfg.inspect(row.key);
        if (!info) {result.changed.push(row.key); continue;}
        const current = row.language ? info.globalLanguageValue : info.globalValue;
        if (!equal(current, row.applied)) {result.changed.push(row.key); continue;}
        await cfg.update(row.key, row.hadValue ? row.before : undefined, vscode.ConfigurationTarget.Global, !!row.language);
        delete saved[id];
        await context.globalState.update('writingSettings', saved);
        result.restored.push(row.key);
    }
    return result;
}
async function activate(context, vscode = require('vscode')) {
    const output = vscode.window.createOutputChannel('本地论文写作：配置与环境');
    context.subscriptions.push(output);
    let discovered, running = Promise.resolve();
    async function setup(full = false, force = false) {
        if (!vscode.workspace.isTrusted) return;
        output.appendLine('检测本机工具位置。');
        const cfg = vscode.workspace.getConfiguration('localLatex');
        discovered = tools.discover(key => cfg.get(key));
        tools.configureEnvironment(discovered.found);
        output.appendLine('合并写作配置白名单。');
        const rows = [...preset.settings.filter(row => full || !row.optional), ...bindings(discovered.found)];
        const result = await apply(vscode, context, rows, force);
        output.appendLine(`配置完成：应用 ${result.applied.length} 项；保留已有选择 ${result.conflicts.length} 项；依赖尚未注册 ${result.unavailable.length} 项。`);
        if (result.conflicts.length) output.appendLine('保留的配置项：' + result.conflicts.join('、'));
        if (discovered.missing.length) output.appendLine('未发现工具：' + discovered.missing.join('、'));
        return result;
    }
    const command = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(name, async () => {
        try {await running; return await action();} catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    command('localLatex.setupWriting', async () => {
        const choice = await vscode.window.showQuickPick([
            {label: '完整导入（合并并保留已有选择）', full: true},
            {label: '仅补齐 LaTeX 专用设置', full: false},
            {label: '使用论文预设替换冲突项', full: true, force: true}
        ], {placeHolder: '只处理插件内置白名单，不复制其他个人配置；完整导入含 PDF 关联、书签、诊断与注释导航'});
        if (!choice) return;
        if (choice.force && await vscode.window.showWarningMessage('将替换白名单内的现有配置，原值可由本插件恢复；不会改论文、Typst 或登录信息。', {modal: true}, '应用预设') !== '应用预设') return;
        const result = await setup(choice.full, choice.force);
        output.show(true);
        vscode.window.showInformationMessage(`已应用 ${result.applied.length} 项，保留 ${result.conflicts.length} 项已有选择。`);
    });
    command('localLatex.restoreWriting', async () => {
        const result = await restore(vscode, context);
        vscode.window.showInformationMessage(`已恢复 ${result.restored.length} 项；${result.changed.length} 项后来有变化或依赖不可用，未覆盖。快捷键与代码片段随插件停用而停止提供。`);
    });
    command('localLatex.checkEnvironment', async () => {
        discovered = tools.discover(key => vscode.workspace.getConfiguration('localLatex').get(key));
        tools.configureEnvironment(discovered.found);
        output.appendLine(`平台：${process.platform} / ${process.arch}；macOS 尚未经实机验证。`);
        for (const [key, file] of Object.entries(discovered.found)) {
            if (!file) {output.appendLine(`${key}：未找到`); continue;}
            if (key === 'pythonPath') {
                const value = await tools.version(file);
                const match = /Python (\d+)\.(\d+)/.exec(value);
                output.appendLine(`${key}：${file}；${value}`);
                if (!match || +match[1] !== 3 || +match[2] < 12) throw new Error('审核后端需要 Python 3.12 或更新的 Python 3，请在设置中选择解释器。');
            } else output.appendLine(`${key}：${file}`);
        }
        output.appendLine('TeX 发行版、LTeX 语言服务器和 GitHub 登录由各自工具管理；本命令不安装软件、不登录、不编译、不操作 Git。');
        output.show(true);
    });
    command('localLatex.installRecommended', async () => {
        const options = RECOMMENDED.filter(([id]) => !vscode.extensions.getExtension(id)).map(([id, description]) => ({label: id, description, picked: id === 'james-yu.latex-workshop'}));
        const selected = await vscode.window.showQuickPick(options, {canPickMany: true, placeHolder: '安装所选官方市场扩展；不修改第三方扩展文件、不安装系统工具'});
        for (const item of selected || []) await vscode.commands.executeCommand('workbench.extensions.installExtension', item.label);
    });
    async function autoSetup() {
        if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return;
        const profile = vscode.workspace.getConfiguration('localLatex').get('configurationProfile', 'full');
        if (profile === 'off') return;
        output.appendLine('检测工作区内的真实 .tex 文件。');
        if (!(await vscode.workspace.findFiles('**/*.tex', '**/{.git,.codex-review,.latex-build,node_modules,clean_dir}/**', 1)).length) return;
        await setup(profile === 'full');
    }
    running = autoSetup().catch(error => {vscode.window.showErrorMessage('写作配置未全部应用：' + error.message);});
    context.subscriptions.push(vscode.extensions.onDidChange(() => {
        running = running.then(autoSetup).catch(error => {vscode.window.showErrorMessage(error.message);});
    }));
    await running;
    return {setup, output};
}
module.exports = {activate, apply, restore, merge, overlay, bindings};
