'use strict';
// One fixed review page and a bottom ID list. Durable decisions stay in source_review.py.
const path = require('node:path');
const fs = require('node:fs/promises');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const positions = require('./review_positions');
const reviewStyle = require('./review_style');
const OPEN = new Set(['pending', 'rework']);
const EXCLUDE = '**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**';
const TRANSLATORS = {google: 'Google', googleapi: 'Google（googleapis）', bing: 'Bing', deepl: 'DeepL 网页版', transmart: '腾讯 TranSmart'};

function run(command, args, cwd, input, extraEnv) {
    return new Promise((resolve, reject) => {
        const env = require('./tools').environment(extraEnv);
        const child = cp.spawn(command, args, {cwd, env, windowsHide: true, shell: false});
        const out = [], err = [];
        child.stdout.on('data', data => out.push(data));
        child.stderr.on('data', data => err.push(data));
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(Buffer.concat(out).toString('utf8'))
            : reject(new Error(Buffer.concat(err).toString('utf8').trim() || `审核工具退出码：${code}`)));
        child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    });
}
const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const utf16 = positions.nativeOffset;
// Display-only break opportunities for long TeX tokens; never alter stored text
// or the exact source-selection offsets used for acceptance and annotations.
const wrapHtml = text => escapeHtml(text.replace(/\S{32,}/gu, word => Array.from(word).join('\u200b'))).replace(/\r?\n/g, '<br>');
function changedHtml(text, side, style = reviewStyle.defaults) {
    const color = side === 'original' ? style.removedColor : side === 'candidate' ? style.addedColor : style.unchangedColor;
    const colored = token => `<span style="color:${color};">${side === 'original' && style.strikeDeleted ? '<del>' : ''}${escapeHtml(token)}${side === 'original' && style.strikeDeleted ? '</del>' : ''}</span>`;
    // Native comment CSS forces spans to white-space:pre. Keep whitespace and
    // long-token break opportunities OUTSIDE colored spans so the browser wraps.
    return text.split(/(\s+)/u).map(token => {
        if (/^\s*$/u.test(token)) return wrapHtml(token);
        const chars = Array.from(token);
        return chars.length >= 32 ? chars.map(colored).join('\u200b') : colored(token);
    }).join('');
}
const label = (data, id) => `${id} · 原文 → 候选 v${data.edit.versions.length}`;

function commentSpans(text) {
    const spans = [];
    for (let i = 0; i < text.length;) {
        if (text[i] === '\\') {
            const token = /^\\(?:[A-Za-z@]+\*?|.)/.exec(text.slice(i))?.[0] || '\\';
            i += token.length;
            if ((token === '\\verb' || token === '\\verb*') && i < text.length) {
                const end = text.indexOf(text[i], i + 1);
                if (end >= 0) i = end + 1;
            }
        } else if (text[i] === '%') {
            const end = text.indexOf('\n', i);
            const line = text.lastIndexOf('\n', i - 1) + 1;
            const fullLine = !text.slice(line, i).trim();
            const stop = end < 0 ? text.length : end + (fullLine ? 1 : 0);
            spans.push([fullLine ? line : i, stop]);
            i = stop;
        } else i++;
    }
    return spans;
}
function displayText(text) {
    for (const [a, b] of commentSpans(text).reverse()) text = text.slice(0, a) + text.slice(b);
    return text.trim();
}
function summary(data, id) {
    const old = displayText(data.original), proposed = displayText(data.candidate);
    return `${id}｜${!old ? '补充' : !proposed ? '删除' : '修改后'}：${(proposed || old).replace(/\s+/g, ' ')}`;
}
function deletionPreview(data) {
    const text = data.source.text;
    const start = utf16(text, data.source.start), end = utf16(text, data.source.end);
    const blanks = [...text.matchAll(/\r?\n[ \t]*\r?\n/g)];
    const left = Math.max(0, ...blanks.filter(m => m.index + m[0].length <= start).map(m => m.index + m[0].length));
    const right = blanks.find(m => m.index >= end)?.index ?? text.length;
    let context = displayText(text.slice(left, start) + text.slice(end, right));
    if (!context) {
        const before = displayText(text.slice(0, left)).split(/\r?\n/).filter(line => line.trim()).at(-1) || '';
        const after = displayText(text.slice(right)).split(/\r?\n/).find(line => line.trim()) || '';
        context = [before, after].filter(Boolean).join('\n');
    }
    return context;
}

function markedWords(data, side, style = reviewStyle.defaults) {
    const text = data[side], prefix = side === 'original' ? 'old' : 'new';
    const comments = commentSpans(text);
    let cursor = 0, displayStart = text.length, displayEnd = 0;
    for (const [a, b] of [...comments, [text.length, text.length]]) {
        const part = text.slice(cursor, a), first = part.search(/\S/u);
        if (first >= 0) {
            displayStart = Math.min(displayStart, cursor + first);
            displayEnd = cursor + part.trimEnd().length;
        }
        cursor = b;
    }
    function visible(start, end, changed = false) {
        start = Math.max(start, displayStart); end = Math.min(end, displayEnd);
        if (start >= end) return '';
        let cursor = start, output = '';
        for (const [a, b] of comments) {
            if (b <= cursor || a >= end) continue;
            output += text.slice(cursor, Math.max(cursor, a));
            cursor = Math.min(end, b);
        }
        const prose = output + text.slice(cursor, end);
        return changed ? changedHtml(prose, side, style) : style.unchangedColor ? changedHtml(prose, 'unchanged', style) : wrapHtml(prose);
    }
    let offset = 0, result = '';
    for (const change of data.changes) {
        const start = change[prefix + '_start'], end = change[prefix + '_end'];
        result += visible(offset, utf16(text, start));
        result += visible(utf16(text, start), utf16(text, end), true);
        offset = utf16(text, end);
    }
    return result + visible(offset, text.length);
}

function createInlineReview(vscode, context, execute = run) {
    const records = new Map();
    const diagnostics = vscode.window.createOutputChannel?.('TeXScholar 接收与备份');
    if (diagnostics) context.subscriptions.push(diagnostics);
    const style = () => reviewStyle.read(vscode.workspace.getConfiguration('localLatex'));
    let deleted = vscode.window.createTextEditorDecorationType({color: style().removedColor, textDecoration: style().strikeDeleted ? 'line-through' : 'none'});
    const protectedBlock = vscode.window.createTextEditorDecorationType({isWholeLine: true, borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: new vscode.ThemeColor('editorWarning.foreground')});
    let activeScope, busy = false, startup = Promise.resolve(), ownerAfterWrite, batch;
    let watchedScope, watcher, stateWatcher, autoRefresh, renderedOwnerHash, refreshChain = Promise.resolve();
    const changedFiles = new Set(), reviewFiles = new Set(), deferredFiles = new Set();
    const synchronizedVersions = new Map();
    const synchronizationConflicts = new Map();
    const shownPanels = new Set(), openedPDFs = new Set(), pdfMetadata = new Map();
    const pdfRequests = new Map();
    const pdfGenerations = new Map();
    let pdfRun;
    let pdfRequestWrites = Promise.resolve();
    const acceptedPDFPreparations = new Set();
    const previewChoices = new Map(), workbenchPDFStatus = new Map(), pdfIntents = new Map();
    let latestReviewState;
    const titleTranslations = new Map();
    let titleRun;
    const locationTitle = edit => edit.location_zh || titleTranslations.get(edit.location) || edit.location;
    function translateTitles(c, state) {
        if (!config().get('translation.autoTranslate', true) || titleRun) return;
        const texts = [...new Set(Object.values(state.edits).filter(e => OPEN.has(e.status) && !e.location_zh)
            .map(e => e.location).filter(t => t && /[a-z]{3}/i.test(t) && !/[\u3400-\u9fff]/.test(t) && !titleTranslations.has(t)))];
        if (!texts.length) return;
        const provider = config().get('translation.provider', 'bing'), http = vscode.workspace.getConfiguration('http');
        const proxy = ['google','googleapi'].includes(provider) ? null : http.get('proxySupport') === 'off' ? '' : http.get('proxy') || null;
        titleRun = execute(config().get('pythonPath','python'), ['-X','utf8',path.join(__dirname,'review_translate.py')], c.repo,
            {provider, proxy, items: texts.map((text,i) => ({key:String(i),text,kind:'title'}))}).then(raw => {
            const result = JSON.parse(raw);
            texts.forEach((text,i) => {if (result.results[String(i)]) titleTranslations.set(text,result.results[String(i)]);});
            if (activeScope?.repo !== c.repo) return;
            for (const record of records.values()) record.data.edit.display_location = locationTitle(record.data.edit);
            updateList(); workbench.titles?.();
            const errors = Object.values(result.errors || {});
            if (errors.length) workbench.titleStatus?.('部分标题翻译失败：' + errors.join('；') + '。原始标题仍可查看。');
        }).catch(error => workbench.titleStatus?.('标题翻译失败：' + error.message)).finally(() => {titleRun = undefined;});
    }
    context.subscriptions.push(deleted, protectedBlock);
    const config = () => vscode.workspace.getConfiguration('localLatex');
    const uri = (c, file) => vscode.Uri.file(path.join(c.repo, file));
    const sameFile = require('./tools').samePath;

    function trusted(c) {
        if (!vscode.workspace.isTrusted) throw new Error('请在受信任的论文工作区使用原文审核。');
        if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(c.repo))) throw new Error('请先打开该论文文件夹。');
    }
    async function backend(c, args, input, expect) {
        trusted(c);
        const cfg = config(), argv = ['-X', 'utf8', path.join(__dirname, 'source_review.py'), '--project', c.repo,
            '--state', c.owner, '--git', cfg.get('gitPath', 'git')];
        if (expect) argv.push('--apply', '--expect', expect);
        const started = performance.now();
        const finishWriter = expect ? require('./backup').reviewWriter(c.repo) : undefined;
        let raw;
        try {raw = await execute(cfg.get('pythonPath', 'python'), [...argv, ...args], c.repo, input);}
        finally {finishWriter?.();}
        const processMs = performance.now() - started, parseStarted = performance.now();
        const result = JSON.parse(raw);
        diagnostics?.appendLine(JSON.stringify({stage:'backend',operation:args[0],id:c.id,version:c.version,
            ids:input?.items?.map(i=>({id:i.id,version:i.version,option:i.option})),
            process_ms:processMs,json_parse_ms:performance.now()-parseStarted,timings:result.timings}));
        return result;
    }
    function cleanBuffers(c, file) {
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' && doc.isDirty && [path.join(c.repo, c.owner), path.join(c.repo, file)].some(p => sameFile(p, doc.uri.fsPath))) {
                throw new Error('正文或审核状态存在未保存编辑，请先保存；批注草稿仍保留。');
            }
        }
    }
    async function readCurrent(c, requireMatch = true) {
        const data = await backend(c, ['inspect', '--id', c.id, '--source']);
        if (!OPEN.has(data.edit.status) || data.edit.versions.at(-1) !== c.version) {
            await refresh(c);
            throw new Error('该项已有新版或审核决定，显示已自动更新。请核对后再次操作；未代为接收或覆盖。');
        }
        if (requireMatch && !data.source_match) {
            const cause = data.conflict || '定位校验失败';
            const reason = /\(0 matches\)/.test(cause) ? '未找到位置；' : /\(\d+ matches\)/.test(cause) ? '存在多个匹配；' : '';
            throw new Error(`当前正文失配（候选定位阶段）：审核项 ${c.id}，文件 ${data.edit.file}；${reason}${cause}；没有覆盖任何内容。`);
        }
        return data;
    }
    async function current(c) {
        const data = await readCurrent(c);
        cleanBuffers(c, data.edit.file);
        const shown = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, path.join(c.repo, data.edit.file)));
        if (shown && shown.getText() !== data.source.text) throw new Error('编辑区正在同步磁盘内容，请待同步后重新点击；没有覆盖任何内容。');
        return data;
    }
    async function currentFromRecords(c, requireMatch = true) {
        const record = records.get(c.id);
        if (!record || record.c.repo !== c.repo || record.c.owner !== c.owner || record.c.version !== c.version ||
            requireMatch && !record.data.source_match) return requireMatch ? current(c) : readCurrent(c, false);
        const data = record.data;
        if (requireMatch) cleanBuffers(c, data.edit.file);
        else if (vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'file' && doc.isDirty &&
            [path.join(c.repo, c.owner), path.join(c.repo, data.edit.file)].some(file => sameFile(file, doc.uri.fsPath)))) return readCurrent(c, false);
        const [owner, source] = await Promise.all([
            fs.readFile(path.join(c.repo, c.owner)), fs.readFile(path.join(c.repo, data.edit.file))]);
        const text = source.toString('utf8').replace(/^\uFEFF/, '');
        const shown = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, path.join(c.repo, data.edit.file)));
        if (crypto.createHash('sha256').update(owner).digest('hex') !== data.sha256 || text !== data.source.text || shown && shown.getText() !== text)
            return requireMatch ? current(c) : readCurrent(c, false);
        return data;
    }
    function range(doc, data) {
        return new vscode.Range(doc.positionAt(utf16(data.source.text, data.source.start)), doc.positionAt(utf16(data.source.text, data.source.end)));
    }
    function contextFor(arg) {
        if (arg?.repo && arg.id) return arg;
        const editor = vscode.window.activeTextEditor;
        if (!editor && workbench.active) return workbench.active;
        if (!editor) throw new Error('请先选择论文审核编号。');
        const selected = sourceRecord(editor);
        if (!selected) throw new Error('请点击要审核的原文位置，或使用该处的“接收并替换正文”按钮。');
        return selected.c;
    }
    function sourceRecord(editor) {
        const candidates = [...records.values()].filter(r => !r.displayConflict && sameFile(editor.document.uri.fsPath, path.join(r.c.repo, r.data.edit.file)));
        const point = editor.document.offsetAt(editor.selection.start);
        return candidates.find(r => {
            const start = editor.document.offsetAt(r.range.start), end = editor.document.offsetAt(r.range.end);
            return point >= start && point < end || start === end && point === start;
        });
    }
    async function discover(allowEmpty = false) {
        if (activeScope) return activeScope;
        if (!vscode.workspace.isTrusted) throw new Error('请先在受信任的本地论文工作区打开 .tex。');
        const doc = vscode.window.activeTextEditor?.document;
        const folder = (doc?.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(doc.uri)) || vscode.workspace.workspaceFolders?.[0];
        if (!folder && allowEmpty) return;
        if (!folder) throw new Error('请先打开论文文件夹。');
        const repo = folder.uri.fsPath;
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(repo, '**/*.tex'), EXCLUDE);
        if (!files.length && allowEmpty) return;
        const owners = [];
        for (const [file, text] of await Promise.all(files.map(async file => [file, await fs.readFile(file.fsPath, 'utf8')]))) {
            if (text.includes('% CODEX-REVIEW-STATE-BEGIN') && text.includes('% CODEX-REVIEW-DATA ')) owners.push(file.fsPath);
        }
        const sidecar = path.join(repo, '.codex-review', 'state.json');
        let hasSidecar = false;
        try {await fs.access(sidecar); hasSidecar = true;} catch (error) {if (error.code !== 'ENOENT') throw error;}
        if (hasSidecar) {
            let state;
            try {state = JSON.parse(await fs.readFile(sidecar,'utf8'));}
            catch (error) {if (error instanceof SyntaxError) throw new Error('外置状态损坏或迁移未完成；请使用“预览并恢复中断的审核迁移”。'); throw error;}
            if (state?.transaction?.kind === 'migration') throw new Error('迁移尚未完成；请使用“预览并恢复中断的审核迁移”。');
        }
        if (hasSidecar && owners.length) throw new Error('发现两份活动审核状态，请先核对迁移状态。');
        if (hasSidecar) return {repo, owner: '.codex-review/state.json'};
        if (!owners.length && allowEmpty) return {repo};
        if (owners.length !== 1) throw new Error('需先建立或核对唯一的 CODEX-REVIEW-STATE。');
        return {repo, owner: path.relative(repo, owners[0]).split(path.sep).join('/')};
    }
    const listEvents = new vscode.EventEmitter();
    let fileRows = [];
    let listSelection = Promise.resolve(), pendingListSelection;
    const listProvider = {
        onDidChangeTreeData: listEvents.event,
        getTreeItem: item => item,
        getParent: item => item.parent,
        getChildren: item => item ? item.children || [] : fileRows
    };
    const reviewList = vscode.window.createTreeView('texscholar.reviewList', {treeDataProvider: listProvider, showCollapseAll: true});
    context.subscriptions.push(listEvents, reviewList);
    function updateList() {
        const files = new Map();
        for (const record of orderedRecords()) {
            const {c, data} = record, file = data.edit.file;
            if (!files.has(file)) {
                const group = new vscode.TreeItem(file, vscode.TreeItemCollapsibleState.Expanded);
                group.id = JSON.stringify([c.repo, c.owner, batch, 'file', file]);
                group.children = []; files.set(file, group);
            }
            const notes = (data.edit.requests || []).filter(n => n.status === 'open');
            const item = new vscode.TreeItem(`${c.id} · ${locationTitle(data.edit) || file}`,
                notes.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
            item.id = JSON.stringify([c.repo, c.owner, batch, c.id]);
            const state = notes.length || data.edit.status === 'rework' ? '返修' : '待审';
            item.description = (record.displayConflict ? '原文位置待核对' : state) + (notes.length ? ` · ${notes.length} 条批注` : '');
            item.tooltip = `${c.id} · ${file} · 候选 v${data.edit.versions.length}`;
            item.command = {command: 'localLatex.reviewWorkbench', title: '打开论文审核页', arguments: [c]};
            item.parent = files.get(file);
            item.children = notes.map((note, index) => {
                const child = new vscode.TreeItem(note.text.replace(/\s+/g, ' '), vscode.TreeItemCollapsibleState.None);
                child.id = JSON.stringify([c.repo, c.owner, batch, c.id, 'note', note.id]);
                const ctx = note.display_context;
                child.description = (ctx?.question ? ctx.question.id : note.option ? '方案 ' + note.option : '整项')
                    + (ctx?.kind === 'translation' ? '译文' : ctx?.kind === 'question' ? '审稿问题' : '');
                child.tooltip = `${c.id} · 批注 ${index + 1} · ${child.description}\n${ctx?.quote || note.quote}\n${note.text}`;
                child.command = item.command; child.parent = item;
                return child;
            });
            files.get(file).children.push(item);
        }
        fileRows = [...files.values()];
        reviewList.message = records.size ? `${records.size} 项待审 · 点击编号在同一审核页切换` : '暂无待审候选；请先让 AI 按插件规则生成。';
        listEvents.fire();
        if (workbench.active) selectReviewItem(workbench.active).catch(error => vscode.window.showErrorMessage('论文评论定位失败：' + error.message));
    }
    function selectReviewItem(c) {
        pendingListSelection = c;
        const revealLatest = async () => {
            const target = pendingListSelection; pendingListSelection = undefined;
            if (!target) return;
            const item = fileRows.flatMap(group => group.children).find(row => {
                const c = row.command.arguments[0];
                return c.repo === target.repo && c.owner === target.owner && c.id === target.id;
            });
            if (item && reviewList.selection[0] !== item) await reviewList.reveal(item, {select: true, focus: false});
        };
        // Serialize reveals and coalesce queued events. A later request can also
        // recover from a reported reveal failure without leaving the queue stuck.
        listSelection = listSelection.then(revealLatest, revealLatest);
        return listSelection;
    }
    async function showPanel(repo, explicit = false) {
        await vscode.commands.executeCommand('setContext', 'localLatex.hasTeXProject', true);
        if (!explicit && shownPanels.has(repo)) return;
        await vscode.commands.executeCommand('texscholar.reviewList.focus');
        shownPanels.add(repo);
    }
    async function enableReview(explicit = false) {
        if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length && !vscode.window.activeTextEditor) return;
        const scope = await discover(true);
        if (!scope) return;
        if (scope.owner && (!activeScope || explicit)) {
            activeScope = {repo: scope.repo, owner: scope.owner};
            await refresh(activeScope, explicit);
            if (scope.owner === '.codex-review/state.json') {
                for (const file of reviewFiles) changedFiles.add(file);
                await flushRefresh(true);
            }
            // Track external state-file changes without showing/moving its editor.
            await vscode.workspace.openTextDocument(uri(scope, scope.owner));
        } else await showPanel(scope.repo, explicit);
    }
    function relevantFile(file) {
        return watchedScope && (sameFile(file, path.join(watchedScope.repo, watchedScope.owner))
            || [...reviewFiles].some(p => sameFile(file, p)));
    }
    function requestRefresh(file) {
        if (relevantFile(file)) changedFiles.add(file);
        return flushRefresh();
    }
    async function changedSinceRender(files) {
        for (const file of files) {
            if (!relevantFile(file)) continue;
            if ([...deferredFiles].some(p => sameFile(file, p))) return true;
            const raw = await fs.readFile(file), text = raw.toString('utf8').replace(/^\uFEFF/, '');
            if (sameFile(file, path.join(watchedScope.repo, watchedScope.owner))) {
                // Compare the actual owner version with the backend packet, or
                // our own exact write, before starting another Python process.
                if (text !== ownerAfterWrite && crypto.createHash('sha256').update(raw).digest('hex') !== renderedOwnerHash) return true;
            } else {
                const cached = [...records.values()].find(r => sameFile(file, path.join(r.c.repo, r.data.edit.file)));
                if (!cached || cached.data.source.text !== text) return true;
            }
        }
        return false;
    }
    async function synchronizeSaved(c, files) {
        if (c.owner !== '.codex-review/state.json') return;
        const state = await backend(c, ['cards']);
        const sources = {};
        for (const [rel, text] of Object.entries(state.sources)) {
            const file = path.join(c.repo, rel);
            if (!files.some(p => sameFile(p, file))) continue;
            const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && sameFile(d.uri.fsPath, file));
            if (doc && (doc.isDirty || doc.getText() !== text)) continue;
            sources[rel] = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
        }
        if (!Object.keys(sources).length) return;
        const owner = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && sameFile(d.uri.fsPath, path.join(c.repo, c.owner)));
        if (owner?.isDirty) return {sources:{}, deferred:Object.keys(sources)};
        const result = await backend(c, ['sync-saved'], {sources}, state.sha256);
        if (result.changed) for (const item of result.items) synchronizedVersions.set(item.id, item.version);
        for (const item of result.conflicts) synchronizationConflicts.set(item.id, item.message);
        return {sources, deferred:[]};
    }
    function flushRefresh(force = false) {
        if (busy || autoRefresh || !changedFiles.size) return autoRefresh || Promise.resolve();
        autoRefresh = (async () => {
            const processed = new Map();
            while (changedFiles.size && !busy) {
                const files = [...changedFiles]; changedFiles.clear();
                try {
                    if (files.some(file => sameFile(file, path.join(watchedScope.repo, watchedScope.owner))))
                        for (const file of deferredFiles) if (!files.some(p => sameFile(p, file))) files.push(file);
                    let changed = force || await changedSinceRender(files);
                    if (!changed) for (const file of files) {
                        const previous = processed.get(file);
                        if (previous === undefined) continue;
                        const text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
                        if (crypto.createHash('sha256').update(text, 'utf8').digest('hex') !== previous) {changed = true; break;}
                    }
                    if (busy) {for (const file of files) changedFiles.add(file); break;}
                    if (changed) {
                        force = false;
                        busy = true;
                        try {
                            const {sources = {}, deferred = []} = await synchronizeSaved(watchedScope, files) || {};
                            for (const [rel, revision] of Object.entries(sources || {})) processed.set(path.join(watchedScope.repo, rel), revision);
                            await refresh(watchedScope, false, true);
                            for (const rel of deferred) deferredFiles.add(path.join(watchedScope.repo, rel));
                            for (const [rel, revision] of Object.entries(sources || {})) {
                                const file = path.join(watchedScope.repo, rel);
                                const record = [...records.values()].find(r => sameFile(file, path.join(r.c.repo, r.data.edit.file)));
                                if (record && crypto.createHash('sha256').update(record.data.source.text, 'utf8').digest('hex') !== revision) deferredFiles.add(file);
                            }
                        }
                        finally {busy = false; synchronizationConflicts.clear();}
                    }
                } catch (error) {
                    const superseded = changedFiles.size && /审核卡片读取期间原文发生变化|正文已再次变化|Concurrent source\/state modification|Stale\/missing --expect/.test(error.message);
                    if (!superseded) vscode.window.showErrorMessage('自动同步未完成：' + error.message);
                }
            }
        })().catch(error => vscode.window.showErrorMessage(error.message)).finally(() => {
            autoRefresh = undefined;
            if (changedFiles.size && !busy) return flushRefresh();
        });
        return autoRefresh;
    }
    function watchScope(c) {
        if (watchedScope && sameFile(watchedScope.repo, c.repo) && watchedScope.owner === c.owner) return;
        watcher?.dispose(); stateWatcher?.dispose(); changedFiles.clear(); reviewFiles.clear(); deferredFiles.clear(); renderedOwnerHash = undefined; ownerAfterWrite = undefined;
        synchronizedVersions.clear();
        watchedScope = {repo: c.repo, owner: c.owner};
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(c.repo, '**/*.tex'));
        const changed = resource => requestRefresh(resource.fsPath);
        context.subscriptions.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
        if (c.owner === '.codex-review/state.json') {
            stateWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(c.repo, '.codex-review/state.json'));
            context.subscriptions.push(stateWatcher, stateWatcher.onDidChange(changed), stateWatcher.onDidCreate(changed), stateWatcher.onDidDelete(changed));
        }
    }
    function reusableVersions(c, source = records) {
        return Object.fromEntries([...source].filter(([, record]) => record.c.repo === c.repo && record.c.owner === c.owner)
            .map(([id, record]) => [id, record.c.version]));
    }
    function refresh(c, explicitPanel = false, automatic = false, packet) {
        const task = refreshChain.then(() => renderRefresh(c, explicitPanel, automatic, packet));
        // Recover the sequencing tail only; the caller still receives failures.
        refreshChain = task.catch(() => {});
        return task;
    }
    async function renderRefresh(c, explicitPanel = false, automatic = false, packet) {
        const started = performance.now();
        watchScope(c);
        const oldRecords = new Map(records);
        if (packet) {
            const owner = await fs.readFile(path.join(c.repo, c.owner));
            if (crypto.createHash('sha256').update(owner).digest('hex') !== packet.sha256) packet = undefined;
            else for (const [file, text] of Object.entries(packet.sources)) {
                if ((await fs.readFile(path.join(c.repo, file), 'utf8')).replace(/^\uFEFF/, '') !== text) {packet = undefined; break;}
            }
        }
        if (packet && Object.entries(packet.cards).some(([id, data]) => data.diff_reused && oldRecords.get(id)?.data.version !== data.version)) packet = undefined;
        const state = packet || await backend(c, ['cards', '--reuse-diffs'], reusableVersions(c, oldRecords));
        for (const [id, data] of Object.entries(state.cards)) if (data.diff_reused) {
            const previous = oldRecords.get(id)?.data;
            if (!previous || previous.version !== data.version || previous.original !== data.original || previous.candidate !== data.candidate ||
                previous.options.length !== data.options.length || data.options.some((o, i) => o.label !== previous.options[i].label || o.after !== previous.options[i].after))
                throw new Error('不可变候选版本与已显示内容不一致；已停止复用差异。');
            data.options = data.options.map((o, i) => ({...o, changes: previous.options[i].changes, scope: previous.options[i].scope}));
            data.changes = previous.changes;
            delete data.diff_reused;
        }
        latestReviewState = state;
        require('./backup').restoreAutomaticStatus(c.repo, state.auto_backup);
        workbench.backupStatus?.(require('./backup').automaticStatus(c.repo));
        reviewFiles.clear(); deferredFiles.clear();
        for (const edit of Object.values(state.edits)) if (OPEN.has(edit.status)) reviewFiles.add(path.join(c.repo, edit.file));
        if (batch && batch !== state.session) {
            pdfMetadata.clear();
            previewChoices.clear(); workbenchPDFStatus.clear();
            records.clear();
        }
        batch = state.session;
        const documents = new Map(), documentViews = new Map();
        const blocked = new Set();
        for (const [file, text] of Object.entries(state.sources)) {
            const doc = await vscode.workspace.openTextDocument(uri(c, file));
            documents.set(file, doc);
            const view = positions.view(doc.getText()); documentViews.set(file, view);
            // State comments can reach disk before VS Code synchronizes its
            // buffer. They must not hold back a new, read-only candidate.
            if (doc.isDirty || doc.getText() !== text && (!view || view.body !== positions.view(text)?.body)) {
                blocked.add(file); deferredFiles.add(path.join(c.repo, file));
            }
        }
        records.clear();
        for (const [id, record] of oldRecords) if (blocked.has(record.data.edit.file) && state.cards[id]) records.set(id, record);
        for (const [id, data] of Object.entries(state.cards)) {
            if (records.has(id)) continue;
            const edit = data.edit;
            if (!data.source_match && synchronizationConflicts.has(id)) data.conflict = synchronizationConflicts.get(id);
            if (!OPEN.has(edit.status)) continue;
            const selected = {...c, id, version: edit.versions.at(-1)};
            if (!data.source_match) {
                data.source.text = state.sources[edit.file];
                records.set(id, {c: selected, data, displayConflict: true});
                continue;
            }
            data.source.text = state.sources[edit.file];
            if (!documents.has(edit.file)) documents.set(edit.file, await vscode.workspace.openTextDocument(uri(c, edit.file)));
            const doc = documents.get(edit.file);
            if (blocked.has(edit.file) || doc.isDirty) continue;
            const span = doc.getText() !== data.source.text && positions.locateDisplay(data, documentViews.get(edit.file));
            if (doc.getText() !== data.source.text && !span) continue;
            const at = span ? new vscode.Range(doc.positionAt(span.start), doc.positionAt(span.end)) : range(doc, data);
            records.set(id, {c: selected, data, range: at});
        }
        updateList();
        const compared = new Set();
        const presentationChanged = oldRecords.size !== records.size || [...records].some(([id, record]) => {
            const previous = oldRecords.get(id);
            if (!previous || previous.c.version !== record.c.version || JSON.stringify(previous.data.edit.questions) !== JSON.stringify(record.data.edit.questions)) return true;
            if (compared.has(record.data.edit.file)) return false;
            compared.add(record.data.edit.file);
            return positions.view(previous.data.source.text)?.body !== positions.view(record.data.source.text)?.body;
        });
        if (presentationChanged) for (const record of records.values()) workbenchPDFStatus.delete(choiceKey(record.c));
        renderedOwnerHash = state.sha256;
        const synchronizedIds = new Set([...synchronizedVersions].filter(([id, version]) => records.get(id)?.c.version === version).map(([id]) => id));
        workbench.sync(new Map(records), c, synchronizedIds);
        for (const id of synchronizedIds) synchronizedVersions.delete(id);
        for (const [id, version] of synchronizedVersions) if (state.edits[id]?.versions.at(-1) !== version) synchronizedVersions.delete(id);
        if (!automatic) translateTitles(c, state);
        decorate();
        await setContext();
        await showPanel(c.repo, explicitPanel);
        diagnostics?.appendLine(JSON.stringify({stage:'host_cards_refresh',ms:performance.now()-started,items:records.size}));
    }
    function relocateDocument(document) {
        const text = document.getText(), currentView = positions.view(text), oldViews = new Map();
        let affected = false;
        for (const [id, record] of records) {
            if (!sameFile(document.uri.fsPath, path.join(record.c.repo, record.data.edit.file))) continue;
            affected = true;
            if (record.c.owner === '.codex-review/state.json' && text !== record.data.source.text) {
                records.set(id, {...record, displayConflict: true});
                continue;
            }
            if (!oldViews.has(record.data.source.text)) oldViews.set(record.data.source.text, positions.view(record.data.source.text));
            const span = positions.locateDisplay(record.data, currentView, oldViews.get(record.data.source.text));
            if (!span) {records.set(id, {...record, displayConflict: true}); continue;}
            const source = {...record.data.source, text, start: positions.codePointOffset(text, span.start), end: positions.codePointOffset(text, span.end)};
            records.set(id, {...record, displayConflict: false, data: {...record.data, source}, range: new vscode.Range(document.positionAt(span.start), document.positionAt(span.end))});
        }
        if (!affected) return;
        if (document.isDirty) deferredFiles.add(document.uri.fsPath);
        updateList();
        workbench.sync(new Map(records), watchedScope);
    }
    function decorate() {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme !== 'file') continue;
            const spans = [], protectedSpans = [], blocks = new Set();
            if (!editor.document.isDirty) for (const {c, data, displayConflict} of records.values()) {
                if (displayConflict) continue;
                if (!sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file))) continue;
                if (editor.document.getText() !== data.source.text) continue;
                if (data.block && !blocks.has(data.block.id)) {
                    blocks.add(data.block.id);
                    protectedSpans.push({range: new vscode.Range(editor.document.positionAt(utf16(data.source.text, data.block.start)),
                        editor.document.positionAt(utf16(data.source.text, data.block.end))),
                        hoverMessage: '此块有待审候选或批注；请通过审核卡片编辑原文。直接修改后会暂停接收并保留正文。'});
                }
                const side = data.source.side === 'original' ? 'old' : 'new';
                // Existing legacy candidate text is not painted as a deletion.
                if (side !== 'old') continue;
                for (const change of data.changes) if (change.old_end > change.old_start) {
                    spans.push(new vscode.Range(editor.document.positionAt(utf16(data.source.text, data.source.start + change.old_start)),
                        editor.document.positionAt(utf16(data.source.text, data.source.start + change.old_end))));
                }
            }
            editor.setDecorations(deleted, spans);
            editor.setDecorations(protectedBlock, protectedSpans);
        }
    }
    async function setContext() {
        const doc = vscode.window.activeTextEditor?.document;
        const enabled = !!doc && [...records.values()].some(r => sameFile(doc.uri.fsPath, path.join(r.c.repo, r.data.edit.file)));
        await vscode.commands.executeCommand('setContext', 'localLatex.inlineReviewActive', enabled);
    }
    async function open(c) { return openWorkbench(c); }
    async function select(next = false, arg) {
        if (!next) return enableReview(true);
        await enableReview();
        const choices = orderedRecords().filter(r => !r.displayConflict);
        if (!choices.length) return vscode.window.showInformationMessage('没有待审修改。');
        const from = arg ? contextFor(arg) : workbench.active;
        const index = choices.findIndex(r => r.c.id === from?.id);
        return openWorkbench(choices[(index + 1) % choices.length].c);
    }
    function orderedRecords() {
        return [...records.values()].sort((a, b) => {
            const x = a.c.id, y = b.c.id, numericX = /^\d/.test(x), numericY = /^\d/.test(y);
            return numericX !== numericY ? (numericX ? -1 : 1) : x.length - y.length || x.localeCompare(y);
        });
    }
    function decisionContext(arg) {
        const c = arg === undefined ? (workbench.active || contextFor()) : arg;
        if (!c || !['repo', 'owner', 'id', 'version'].every(k => typeof c[k] === 'string' && c[k])) throw new Error('接收目标缺少明确 ID/version；操作已停止，请重新打开审核项。');
        return {...c};
    }
    async function accept(arg) {
        const c = decisionContext(arg), data = await currentFromRecords(c);
        if (data.options?.length > 1 && !c.option) {await openWorkbench(c); return;}
        const navigation = pdfMetadata.get(c.repo + '|' + c.id) || context.workspaceState?.get('reviewPDFMeta', {})[c.repo + '|' + c.id];
        const ordered = orderedRecords(), index = ordered.findIndex(record => record.c.id === c.id);
        const following = ordered.slice(index + 1).map(record => record.c.id);
        const result = await backend(c, ['decide', '--accept', c.id, '--version', c.version, ...(data.options?.length && data.options.length > 1 ? ['--option', c.option || 'A'] : data.options?.length && c.option ? ['--option', c.option] : []), '--return-cards'], {reuse:reusableVersions(c)}, data.sha256);
        vscode.window.showInformationMessage(`${c.id} 已接收并保存；Git 备份已在后台排队，未决批注保留。`);
        scheduleBackup(c);
        if (result.cards_error) vscode.window.showErrorMessage('接收已保存，但刷新卡片失败：' + result.cards_error);
        await refresh(c, false, false, result.cards_packet);
        const next = following.map(id => records.get(id)).find(Boolean);
        if (next && !c.workbench) await openWorkbench(next.c);
        if (navigation && config().get('reviewPDF.autoUpdateAfterAccept', true)) scheduleAcceptedPDF(c, navigation);
    }
    async function reject(arg) {
        const c = decisionContext(arg), data = await currentFromRecords(c, false);
        cleanBuffers(c, data.edit.file);
        const result = await backend(c, ['decide', '--reject', c.id, '--version', c.version, '--return-cards'], {reuse:reusableVersions(c)}, data.sha256);
        if (result.cards_error) vscode.window.showErrorMessage('拒绝已保存，但刷新卡片失败：' + result.cards_error);
        await refresh(c, false, false, result.cards_packet);
        vscode.window.showInformationMessage(`${c.id} 候选已拒绝，原文保留；不代表科学问题已解决，未提交 Git 或推送。`);
    }
    function scheduleBackup(c, trigger = '接收') {
        if (!c?.repo || !c.owner) return;
        const cfg = config();
        require('./backup').enqueueAutomatic(c.repo, c.owner,
            {git: cfg.get('gitPath', 'git'), gh: cfg.get('ghPath', 'gh'), python: cfg.get('pythonPath', 'python')},
            value => diagnostics?.appendLine(JSON.stringify({stage:'git_backup',...value})), undefined, trigger);
    }
    async function acceptBatch(items) {
        if (!Array.isArray(items) || !items.length) throw new Error('请明确选择接收项及方案。');
        const c = decisionContext(items[0]);
        if (items.some(i => i.repo !== c.repo || i.owner !== c.owner)) throw new Error('批量接收不能跨论文项目。');
        const state = await backend(c, ['cards']);
        for (const item of items) {
            decisionContext(item);
            const edit = state.edits[item.id];
            if (!edit || !OPEN.has(edit.status) || edit.versions.at(-1) !== item.version) throw new Error('选中项已变化：' + item.id + '；未接收任何项。');
            cleanBuffers(c, edit.file);
        }
        const result = await backend(c, ['decide-batch', '--return-cards'], {items: items.map(({id, version, option}) => ({id, version, option})), reuse:reusableVersions(c)}, state.sha256);
        vscode.window.showInformationMessage('已接收并保存 ' + result.accepted.join(', ') + '；后台备份已排队。');
        scheduleBackup(c);
        if (result.cards_error) vscode.window.showErrorMessage('接收已保存，但刷新卡片失败：' + result.cards_error);
        await refresh(c, false, false, result.cards_packet);
        const navigation = items.map(i => pdfMetadata.get(i.repo + '|' + i.id)).find(Boolean);
        if (navigation && config().get('reviewPDF.autoUpdateAfterAccept', true)) scheduleAcceptedPDF(c, navigation);
        return result;
    }
    async function relocate(c) {
        c = decisionContext(c);
        const data = await readCurrent(c, false), editor = vscode.window.activeTextEditor;
        if (!editor || !sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file))) throw new Error('先打开 ' + data.edit.file + '，选择准确原文；插入项请放置光标，再点修复位置。');
        cleanBuffers(c, data.edit.file);
        const text = editor.document.getText(), a = editor.document.offsetAt(editor.selection.start), b = editor.document.offsetAt(editor.selection.end);
        if (text.slice(a,b) !== data.original) throw new Error('所选原文与候选原文不完全相同；未修复。插入项需要空选区。');
        const view = positions.view(text);
        if (!view || view.start !== undefined && (a < view.end && b >= view.start)) throw new Error('不能在审核运行状态块内定位。');
        const offset = x => view.end !== undefined && x >= view.end ? x - (view.end-view.start) : x;
        await backend(c, ['relocate', '--id', c.id, '--version', c.version],
            {before: data.original, left: view.body.slice(0,offset(a)), right: view.body.slice(offset(b))}, data.sha256);
        await refresh(c);
        return readCurrent(c, false);
    }
    async function annotate(arg) {
        const c = contextFor(arg), data = await current(c), editor = vscode.window.activeTextEditor;
        let selected;
        if (editor && sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file)) && !editor.selection.isEmpty) {
            const start = editor.document.offsetAt(editor.selection.start) - utf16(data.source.text, data.source.start);
            const end = editor.document.offsetAt(editor.selection.end) - utf16(data.source.text, data.source.start);
            if (start < 0 || end > data.original.length || start >= end) throw new Error('请选择该编号原文范围内的文字。');
            const value = data.original.replace(/\r\n/g, '\n');
            selected = {side: 'original', value, start: data.original.slice(0, start).replace(/\r\n/g, '\n').length,
                end: data.original.slice(0, end).replace(/\r\n/g, '\n').length};
        }
        workbench.setRecords(new Map(orderedRecords().map(r => [r.c.id, r])));
        await workbench.annotate(c, selected);
    }
    async function saveNote(c, note, text) {
        const data = await current(c);
        const saved = await backend(c, ['feedback'], {id: c.id, version: c.version, side: note.side,
            start: note.start, end: note.end, quote: note.quote, text, ...(note.option ? {option: note.option} : {}),
            ...(note.display_context ? {display_context: note.display_context} : {}),
            ...(note.request_id ? {request_id: note.request_id, previous_text: note.previous_text} : {})}, data.sha256);
        updateSaved(c, saved);
        vscode.window.showInformationMessage(`${c.id} 批注已保存，原文和编号保留；尚未发送给 Codex。`);
        if (!saved.card.source_match) vscode.window.showWarningMessage('批注已保存，但原文随后发生变化；请核对并刷新，不会猜测重新定位。');
    }
    function updateSaved(c, saved) {
        ownerAfterWrite = saved.owner_text;
        const previous = records.get(c.id);
        if (previous.c.version !== saved.card.version) for (const peer of records.values()) workbenchPDFStatus.delete(choiceKey(peer.c));
        const record = {...previous, c: {...c, version: saved.card.version}, data: {...saved.card, source: saved.card.source || previous.data.source}};
        records.set(c.id, record);
        if (latestReviewState) latestReviewState.edits[c.id] = saved.card.edit;
        updateList();
        // Feedback changes only the embedded state. Rebase cached owner offsets
        // across that header's size change, without rereading/repainting its peers.
        const offsets = new Map(), newLength = positions.codePointOffset(saved.owner_text, saved.owner_text.length);
        if (c.owner === '.codex-review/state.json') {
            workbench.sync(new Map(records), c);
            return;
        }
        for (const [id, peer] of records) {
            const source = peer.data.source;
            if (peer.data.edit.file !== c.owner || source.text === saved.owner_text) continue;
            if (!offsets.has(source.text)) {
                const end = /^% CODEX-REVIEW-STATE-END\r?$/m.exec(source.text);
                offsets.set(source.text, {delta: newLength - positions.codePointOffset(source.text, source.text.length),
                    boundary: positions.codePointOffset(source.text, end.index + end[0].length)});
            }
            const {delta, boundary} = offsets.get(source.text), shift = source.start >= boundary ? delta : 0;
            records.set(id, {...peer, data: {...peer.data, source: {...source, text: saved.owner_text, start: source.start + shift, end: source.end + shift}}});
        }
        workbench.sync(new Map(records), c);
    }
    async function exclusive(action) {
        if (busy) throw new Error('当前审核操作尚未结束。');
        busy = true;
        try {return await action();} finally {busy = false; await flushRefresh();}
    }
    const choiceKey = c => JSON.stringify([c.repo, c.owner, c.id]);
    function selectedOption(c) {
        const saved = previewChoices.get(choiceKey(c));
        return saved?.version === c.version ? saved.option : 'A';
    }
    const workbench = require('./review_workbench').createWorkbench(vscode, context, {
        style, read: c => readCurrent(c, false), readNext: c => currentFromRecords(c, false), selection: selectedOption, activeChanged: selectReviewItem,
        trace: value => diagnostics?.appendLine(JSON.stringify(value)),
        directory: () => Object.entries(latestReviewState?.edits || {}).map(([id, edit]) => ({id, file: edit.file, kind: edit.kind, status: edit.status,
            version: edit.versions.at(-1), source_match: edit.source_match, options: records.get(id)?.data?.options?.map(o => o.label), manual_options: records.get(id)?.data?.options?.filter(o => o.manually_edited).map(o => o.label), option: selectedOption({...activeScope, id, version: edit.versions.at(-1)}), location: locationTitle(edit), summary: displayText(records.get(id)?.data?.options?.[0]?.after || '').replace(/\s+/g, ' ').slice(0, 140), questions: (edit.questions || []).map(q => q.id), requests: (edit.requests || []).filter(n => n.status === 'open').length})),
        pdfStatus: c => {
            const entry = workbenchPDFStatus.get(choiceKey(c));
            return entry?.version === c.version && entry.option === selectedOption(c) ? entry.text : 'PDF 尚未核对／待更新';
        },
        autoTranslate: () => config().get('translation.autoTranslate', true),
        provider: () => config().get('translation.provider', 'bing'),
        translate: async (text, provider) => {
            const http = vscode.workspace.getConfiguration('http');
            const proxy = ['google', 'googleapi'].includes(provider) ? null : http.get('proxySupport') === 'off' ? '' : http.get('proxy') || null;
            const result = JSON.parse(await execute(config().get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_translate.py')], workbench.active.repo,
                {provider, proxy, items: [{key: 'text', text: displayText(text)}]}));
            if (result.errors.text) throw new Error(result.errors.text);
            return result.results.text;
        },
        save: (c, option, after) => exclusive(async () => {
            const data = await current(c);
            const saved = await backend(c, ['edit-option', '--id', c.id, '--version', c.version, '--option', option], {after}, data.sha256);
            const chosen = selectedOption(c);
            updateSaved(c, saved);
            previewChoices.set(choiceKey(c), {version: saved.card.version, option: chosen});
            return saved.card;
        }),
        saveSource: (c, displayed, text) => exclusive(async () => {
            const data = await readCurrent(c, false);
            cleanBuffers(c, data.edit.file);
            if (!data.block || data.block.id !== displayed.id || data.block.source_revision !== displayed.source_revision)
                throw new Error('正文或审核块已变化，请重新读取后编辑。');
            const shown = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, path.join(c.repo, data.edit.file)));
            if (shown && shown.getText() !== (await fs.readFile(path.join(c.repo, data.edit.file), 'utf8')).replace(/^\uFEFF/, ''))
                throw new Error('编辑区与磁盘尚未同步；请先核对。');
            await backend(c, ['save-block-source', '--id', c.id, '--version', c.version],
                {block_id: displayed.id, source_revision: displayed.source_revision, text}, data.sha256);
            changedFiles.add(path.join(c.repo, data.edit.file));
        }),
        manualRebase: (c, displayed, selection) => exclusive(async () => {
            const data = await readCurrent(c, false);
            cleanBuffers(c, data.edit.file);
            if (!data.block || data.block.id !== displayed.id || data.block.source_revision !== displayed.source_revision ||
                selection.block_id !== displayed.id || selection.source_revision !== displayed.source_revision)
                throw new Error('正文或审核块已变化，请重新选择范围；草稿已保留。');
            const spec = {block_id:selection.block_id, source_revision:selection.source_revision,
                start:selection.start, end:selection.end, quote:selection.quote, options:selection.options};
            const args = ['manual-rebase', '--id', c.id, '--version', c.version];
            await backend(c, args, spec);
            const detail = '选中当前原文：\n' + (spec.quote || '（空选区，插入位置）') + '\n\n' +
                spec.options.map(o => o.label + '：' + o.after).join('\n\n');
            const choice = await vscode.window.showWarningMessage('以选定的当前正文更新此项全部候选？保留旧版本和批注，不自动接收。',
                {modal:true, detail}, '更新候选');
            if (choice !== '更新候选') return;
            const saved = await backend(c, args, spec, data.sha256);
            updateSaved(c, saved);
            await refresh(c);
            return saved.card;
        }),
        syncBlock: (c, displayed) => exclusive(async () => {
            const data = await readCurrent(c, false);
            cleanBuffers(c, data.edit.file);
            if (!displayed || !data.block || data.block.id !== displayed.id || data.block.source_revision !== displayed.source_revision)
                throw new Error('正文或审核块已变化，请重新读取后同步。');
            const args = ['sync-block', '--id', c.id, '--version', c.version], spec = {source_revision: data.block.source_revision};
            const preview = await backend(c, args, spec);
            if (!preview.changed) return;
            const summary = preview.options.map(o => `${o.label}：${o.after}`).join('\n\n');
            const choice = await vscode.window.showWarningMessage('将按当前原文生成新版候选，原版本和批注保留；不接收。',
                {modal: true, detail: summary}, '同步候选');
            if (choice !== '同步候选') return;
            const saved = await backend(c, args, spec, data.sha256);
            await refresh(c);
            return readCurrent({...c, version: saved.version}, false);
        }),
        repairBlock: (c, displayed) => exclusive(async () => {
            const data = await readCurrent(c, false), editor = vscode.window.activeTextEditor;
            if (!data.edit.block_id || data.edit.block_id !== displayed.edit.block_id) throw new Error('审核块身份已变化，请重新打开。');
            if (!editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex' || !vscode.workspace.getWorkspaceFolder(editor.document.uri))
                throw new Error('请先在论文工作区打开需要修复或重新关联的源文件。');
            const rel = path.relative(c.repo, editor.document.uri.fsPath).split(path.sep).join('/');
            if (rel.startsWith('../') || path.isAbsolute(rel)) throw new Error('目标文件不属于当前论文工作区。');
            cleanBuffers(c, rel);
            const text = (await fs.readFile(editor.document.uri.fsPath,'utf8')).replace(/^\uFEFF/, '');
            if (editor.document.isDirty || editor.document.getText() !== text) throw new Error('目标编辑区与磁盘尚未同步，请先核对。');
            const choice = await vscode.window.showQuickPick([
                {label:'关联已移动的完整块', restore:false},
                {label:'在当前完整行选区恢复缺失标记', restore:true}
            ], {placeHolder:'选择审核块修复方式'});
            if (!choice) return;
            const spec = {file:rel, block_id:data.edit.block_id, restore:choice.restore,
                source_revision:crypto.createHash('sha256').update(text,'utf8').digest('hex')};
            if (choice.restore) {
                spec.start = positions.codePointOffset(text,editor.document.offsetAt(editor.selection.start));
                spec.end = positions.codePointOffset(text,editor.document.offsetAt(editor.selection.end));
            }
            const preview = await backend(c,['reassociate-block'],spec);
            if (!preview.changed) return data;
            const detail = preview.marked || `文件：${preview.previous_file} → ${preview.file}\n受影响审核项：${preview.ids.join('、')}`;
            const approved = await vscode.window.showWarningMessage('请核对审核块修复预览；候选和批注会保留，不自动接收。', {modal:true, detail}, '确认修复');
            if (approved !== '确认修复') return;
            await backend(c,['reassociate-block'],spec,data.sha256);
            await refresh(c);
            return readCurrent(c,false);
        }),
        note: (c, selected, text) => exclusive(() => saveNote(c, selected, text)),
        accept: c => exclusive(() => accept(c)), reject: c => exclusive(() => reject(c)),
        acceptBatch: items => exclusive(() => acceptBatch(items)),
        relocate: c => exclusive(() => relocate(c)),
        backupStatus: () => require('./backup').automaticStatus(activeScope?.repo),
        retryBackup: () => scheduleBackup(activeScope, '重试'),
        saved(c, option, compare) {if (selectedOption(c) === option) requestWorkbenchPDF(c, option, compare, false);},
        preview: requestWorkbenchPDF,
        locate: async (c, option) => {
            const navigation = pdfMetadata.get(c.repo + '|' + c.id) || context.workspaceState?.get('reviewPDFMeta', {})[c.repo + '|' + c.id];
            if (!navigation) throw new Error('当前项还没有审核 PDF，请先点击更新 PDF。');
            await require('./pdf_navigation').locate(vscode, context, navigation, {...c, option});
        },
        source: async c => {
            const data = await readCurrent(c, false), doc = await vscode.workspace.openTextDocument(uri(c, data.edit.file));
            const editor = await vscode.window.showTextDocument(doc, {preview: false, viewColumn: vscode.ViewColumn.One});
            if (!data.source_match) {vscode.window.showInformationMessage('请选择准确原文或插入点，再回审核页点“修复位置”。'); return;}
            const at = range(doc, data); editor.selection = new vscode.Selection(at.start, at.start);
            editor.revealRange(at, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        },
        question: (c, question) => vscode.commands.executeCommand('localLatex.jumpQuestion', {repo: c.repo, question}),
        related: async (c, question) => {
            if (!question) throw new Error('当前问题关联不存在。');
            const state = await backend(c, ['status']);
            const choices = Object.entries(state.edits).filter(([, edit]) => (edit.questions || []).some(q => q.id === question.id && q.file === question.file && q.quote === question.quote))
                .map(([id, edit]) => ({label: id + ' · ' + edit.status + ' · ' + edit.file, description: edit.location, id}));
            const picked = await vscode.window.showQuickPick(choices, {placeHolder: question.id + ' 的全部关联修改；接收不代表问题解决'});
            if (!picked) return;
            const record = records.get(picked.id);
            if (record) await workbench.show(record.c);
            else vscode.window.showInformationMessage('该项已处理，本批状态保留其关联；成功成果可查 Git。');
        },
        changeProvider: () => vscode.commands.executeCommand('localLatex.inlineTranslationSource', workbench.active),
        reopen: reopenPreview,
        editNote: (c, note, text, previous) => saveNote(c, {...note, request_id: note.id, previous_text: previous}, text),
        copy: () => vscode.commands.executeCommand('localLatex.copyReviewContract'),
        handoff: addRequests,
        finish: () => vscode.commands.executeCommand('localLatex.finishReview'),
        connect: () => vscode.commands.executeCommand('localLatex.connectCodex'),
        start: () => vscode.commands.executeCommand('localLatex.startPaperTask')
    });
    context.subscriptions.push(require('./backup').onAutomatic((root, value) => {
        if (activeScope && sameFile(root, activeScope.repo)) workbench.backupStatus?.(value);
    }));
    async function openWorkbench(arg) {
        await enableReview();
        const c = arg?.repo ? arg : workbench.active || orderedRecords()[0]?.c;
        if (!c) return vscode.window.showInformationMessage('没有待审候选。可先把插件三方案规则交给 AI 创建候选。');
        trusted(c);
        if (arg?.repo && arg.version) await readCurrent(c, false);
        if (arg?.option) previewChoices.set(choiceKey(c), {version: c.version, option: arg.option});
        workbench.setRecords(new Map(orderedRecords().map(r => [r.c.id, r])));
        await workbench.show(c);
    }
    function pdfStatus(c, text, option = selectedOption(c)) {
        workbenchPDFStatus.set(choiceKey(c), {version: c.version, option, text});
        workbench.status(c, text);
    }
    async function resolvePDFDocument(c, sourceOnly = false) {
        const data = sourceOnly ? await backend(c, ['inspect', '--id', c.id, '--source']) : await current(c);
        if (sourceOnly) cleanBuffers(c, data.edit.file);
        const registered = await require('./document_roles').confirmedRoot(vscode, c.repo, path.join(c.repo, data.edit.file), execute);
        if (registered) return registered;
        const text = data.source?.text ?? await fs.readFile(path.join(c.repo, data.edit.file), 'utf8');
        if (/^\s*\\documentclass\b/m.test(text)) return path.join(c.repo, data.edit.file);
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(c.repo, '**/*.tex'), EXCLUDE);
        const roots = [];
        for (const file of files) if (/^\s*\\documentclass\b/m.test(await fs.readFile(file.fsPath, 'utf8'))) roots.push({label: path.relative(c.repo, file.fsPath), file: file.fsPath});
        return (roots.length === 1 ? roots[0] : await vscode.window.showQuickPick(roots, {placeHolder: '选择实际所属的可编译主文档'}))?.file;
    }
    async function requestWorkbenchPDF(c, option, compare, force, sourceOnly = false) {
        const intent = crypto.randomUUID(); pdfIntents.set(c.repo, intent);
        try {
            previewChoices.set(choiceKey(c), {version: c.version, option});
            pdfStatus(c, sourceOnly ? '正式 PDF 待更新' : 'PDF 待更新：' + c.id + ' · ' + option);
            if (!force && !config().get('reviewPDF.followPreview', true)) return;
            const document = await resolvePDFDocument(c, sourceOnly);
            if (!document) return;
            if (pdfIntents.get(c.repo) !== intent) return;
            const write = pdfRequestWrites.then(async () => {
                if (pdfIntents.get(c.repo) !== intent) return;
                const directory = path.join(path.dirname(document), '.latex-build', 'review-diff');
                await fs.mkdir(directory, {recursive: true});
                for (const folder of [path.dirname(directory), directory]) {
                    const info = await fs.lstat(folder);
                    if (!info.isDirectory() || info.isSymbolicLink() || !sameFile(await fs.realpath(folder), folder)) throw new Error('PDF 输出目录存在链接或异常，未写入。');
                }
                const choices = Object.fromEntries(orderedRecords().filter(r => r.c.repo === c.repo && r.c.owner === c.owner)
                    .map(r => [r.c.id, {version: r.c.version, option: selectedOption(r.c)}]));
                const requestFile = path.join(directory, path.basename(document, '.tex') + (sourceOnly ? '-source-selection.json' : '-selection.json'));
                try {const info = await fs.lstat(requestFile); if (!info.isFile() || info.isSymbolicLink()) throw new Error('PDF 请求目标不是普通文件。');} catch (e) {if (e.code !== 'ENOENT') throw e;}
                const temporary = requestFile + '.write-' + crypto.randomUUID();
                await fs.writeFile(temporary, JSON.stringify({token: crypto.randomUUID(), choices, compare_id: compare ? c.id : null}), {encoding: 'utf8', flag: 'wx'});
                await fs.rename(temporary, requestFile);
                return requestFile;
            });
            pdfRequestWrites = write.catch(() => {}); // The caller below reports the original write error.
            const requestFile = await write;
            if (!requestFile || pdfIntents.get(c.repo) !== intent) return;
            await schedulePDF((sourceOnly ? 'source|' : '') + document, async isCurrent => {
                if (!isCurrent() || pdfIntents.get(c.repo) !== intent) return;
                pdfStatus(c, (sourceOnly ? '正式 PDF' : '审核 PDF') + ' 正在更新；可以继续审核');
                await generatePDF(c, document, false, requestFile, sourceOnly, isCurrent);
                if (isCurrent() && pdfIntents.get(c.repo) === intent) pdfStatus(c, sourceOnly ? '正式 PDF 最新；不含未接收候选' : 'PDF 最新');
            });
        } catch (error) {if (pdfIntents.get(c.repo) === intent) pdfStatus(c, (sourceOnly ? '正式 PDF' : '审核 PDF') + ' 更新失败；已有 PDF 为旧版：' + error.message);}
    }
    function schedulePDF(document, action) {
        const generation = (pdfGenerations.get(document) || 0) + 1;
        pdfGenerations.set(document, generation);
        const previous = pdfRequests.get(document);
        const waiters = previous?.waiters || [];
        const result = new Promise((resolve, reject) => waiters.push({resolve, reject}));
        pdfRequests.set(document, {action: () => action(() => pdfGenerations.get(document) === generation), waiters});
        startPDFQueue();
        return result;
    }
    function startPDFQueue() {
        if (!pdfRun) pdfRun = Promise.resolve().then(async () => {
            while (pdfRequests.size) {
                const [file, request] = pdfRequests.entries().next().value;
                pdfRequests.delete(file);
                try {
                    const value = await request.action();
                    for (const waiter of request.waiters) waiter.resolve(value);
                } catch (error) {for (const waiter of request.waiters) waiter.reject(error);}
            }
        }).finally(() => {pdfRun = undefined; if (pdfRequests.size) startPDFQueue();});
    }
    function scheduleAcceptedPDF(c, navigation) {
        const task = queueAcceptedPDF(c, navigation).catch(error => vscode.window.showErrorMessage(error.message));
        acceptedPDFPreparations.add(task);
        task.finally(() => acceptedPDFPreparations.delete(task));
    }
    async function queueAcceptedPDF(c, navigation) {
        const saved = JSON.parse(await fs.readFile(navigation, 'utf8'));
        if (!saved.document) {
            vscode.window.showInformationMessage('此审核 PDF 来自旧版，请手动生成一次以建立自动更新关联。');
            return;
        }
        const status = text => {
            pdfStatus(c, text);
            for (const record of records.values()) if (pdfMetadata.get(record.c.repo + '|' + record.c.id) === navigation)
                pdfStatus(record.c, text);
        };
        schedulePDF(saved.document, async isCurrent => {
            if (!config().get('reviewPDF.autoUpdateAfterAccept', true)) return;
            status('接收已保存；PDF 正在后台更新');
            try {await generatePDF(c, saved.document, true, undefined, false, isCurrent);}
            catch (error) {
                if (!isCurrent()) return;
                const message = '接收已保存；已有 PDF 为旧版：' + error.message;
                status(message); vscode.window.showErrorMessage(message);
                throw error;
            }
        }).catch(() => {}); // The active build above reports failure once, including coalesced waiters.
    }
    async function preview(arg) {
        const c = contextFor(arg), data = await current(c);
        const document = await resolvePDFDocument(c);
        if (!document) return;
        return schedulePDF(document, isCurrent => generatePDF(c, document, false, undefined, false, isCurrent));
    }
    async function generatePDF(c, document, automatic, requestFile, sourceOnly = false, isCurrent = () => true) {
        const started = performance.now();
        const cfg = config();
        await vscode.window.withProgress({location: vscode.ProgressLocation.Notification,
            title: sourceOnly ? '编译正式源码 PDF（不应用未接收候选）' : automatic ? '接收后更新审核 PDF（后台，不阻塞下一项）' : '生成／更新完整论文审核 PDF'}, async () => {
            const result = JSON.parse(await execute(cfg.get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_pdf.py'),
                '--repo', c.repo, '--state', c.owner, '--document', document, '--id', c.id, '--version', c.version,
                '--git', cfg.get('gitPath', 'git'), '--latexdiff', cfg.get('latexdiffPath'), '--latexmk', cfg.get('latexmkPath'),
                '--style', JSON.stringify(style()), ...(sourceOnly ? ['--source-only'] : []), ...(automatic ? ['--refresh-accepted'] : []), ...(requestFile ? ['--request-file', requestFile] :
                    ['--choices', JSON.stringify(Object.fromEntries(orderedRecords().filter(r => r.c.repo === c.repo).map(r => [r.c.id, {version: r.c.version, option: selectedOption(r.c)}])))])], c.repo));
            diagnostics?.appendLine(JSON.stringify({stage:'pdf_build',id:c.id,version:c.version,ms:performance.now()-started,automatic}));
            if (!isCurrent()) return;
            if (!automatic && !sourceOnly) await current(c);
            if (result.warning) vscode.window.showWarningMessage(result.warning);
            if (result.navigation && !sourceOnly) {
                const saved = {...context.workspaceState?.get('reviewPDFMeta', {})};
                for (const [key, file] of Object.entries(saved)) if (file === result.navigation) delete saved[key];
                for (const [key, file] of pdfMetadata) if (file === result.navigation) pdfMetadata.delete(key);
                for (const id of result.shown_ids || [c.id]) {
                    const key = c.repo + '|' + id;
                    pdfMetadata.set(key, result.navigation); saved[key] = result.navigation;
                    const peer = records.get(id), rendered = result.inputs?.items?.[id];
                    if (peer && rendered?.version === peer.c.version && rendered.option === selectedOption(peer.c)) pdfStatus(peer.c, 'PDF 最新', rendered.option);
                }
                if (context.workspaceState) await context.workspaceState.update('reviewPDFMeta', saved);
            }
            // A floating editor shares the source workbench/Workshop instance;
            // reverse SyncTeX never opens a source editor in a separate workspace.
            const opened = openedPDFs.has(result.pdf) || context.workspaceState?.get('reviewPDFs', []).includes(result.pdf);
            if (!opened && !automatic) {
                await require('./pdf_navigation').openFloating(vscode, vscode.Uri.file(result.pdf), true);
                openedPDFs.add(result.pdf);
                if (context.workspaceState) await context.workspaceState.update('reviewPDFs', [...new Set([...context.workspaceState.get('reviewPDFs', []), result.pdf])]);
            } else if (!automatic) vscode.window.showInformationMessage(sourceOnly ? '正式源码 PDF 已更新；不含未接收候选。' : result.reused_pdf ? '审核内容未变化，已复用核验后的 PDF，没有重新编译。'
                : '已更新同一份审核 PDF；现有预览窗口会重新加载。窗口已关闭时，可用“重新打开审核 PDF 窗口”。');
        });
    }
    async function reopenPreview() {
        const files = [...new Set([...openedPDFs, ...(context.workspaceState?.get('reviewPDFs', []) || [])])];
        if (!files.length) throw new Error('尚未生成审核 PDF，请先使用生成／更新按钮。');
        const file = files.length === 1 ? files[0] : await vscode.window.showQuickPick(files, {placeHolder: '重新打开已生成的审核 PDF（不编译）'});
        if (!file) return;
        await fs.access(file);
        await require('./pdf_navigation').openFloating(vscode, vscode.Uri.file(file));
    }
    async function addRequests(target) {
        await vscode.commands.executeCommand('localLatex.checkMCPVersion', false);
        const c = target || await discover(), state = await backend(c, ['feedback-context']);
        const items = target ? state.items.filter(item => item.id === target.id) : state.items;
        if (target && items.some(item => item.current_version !== target.version)) throw new Error('候选已更新，请核对新版再交接。');
        const generations = new Map();
        for (const item of items) {
            const key = JSON.stringify([item.id, item.version]);
            if (generations.has(key)) generations.get(key).requests.push(...item.requests);
            else generations.set(key, {...item, requests: [...item.requests]});
        }
        const notes = [...generations.values()].map(item => `审阅框编号：${item.id}\n方案：见每条批注范围\n文件：${item.file}\n批注基于版本：${item.version}\n当前候选版本：${item.current_version}`
            + `\n【原版完整内容】\n${item.original}`
            + (item.options ? '\n【本轮全部备选（本批注对应方案见上方）】\n' + JSON.stringify(item.options, null, 2) : '\n【修改版完整内容】\n' + item.candidate)
            + '\n【作者返修批注】\n'
            + item.requests.map(n => `${n.option ? '方案 ' + n.option : '整项／全部方案'} · ${n.display_context ? n.display_context.kind === 'translation' ? '中文译文' : '审稿问题' : n.side === 'original' ? '原文' : '候选'}选区：${n.display_context?.quote ?? n.quote}\n返修要求：${n.text}\n定位：${JSON.stringify({id: n.id, version: n.version, side: n.side, option: n.option, start: n.start, end: n.end, display_context: n.display_context})}`).join('\n\n')
        );
        if (!notes.length) return vscode.window.showInformationMessage('没有待处理的批注。');
        if (!(await vscode.commands.getCommands(true)).includes('chatgpt.addFileToThread')) throw new Error('当前 Codex 插件没有可用的添加上下文命令；批注仍保留，未发送。');
        const parent = path.join(c.repo, '.codex-review', 'requests');
        await fs.mkdir(parent, {recursive: true});
        const folder = await fs.mkdtemp(path.join(parent, 'batch-'));
        const file = path.join(folder, '返修批注.txt');
        const ids = [...new Set(items.map(item => item.id))];
        const readRequest = {project: c.repo, state: c.owner, ids, expected_plugin_version: require('../package.json').version,
            known_feedback: (state.known_feedback || []).filter(receipt => ids.includes(receipt.id))};
        await fs.writeFile(file, `插件版本：${require('../package.json').version}\n首次 read_context 参数：${JSON.stringify(readRequest)}\n若服务版本不匹配或旧服务缺少版本信息，提示重启 Codex 的 MCP，不混用另一版本 CLI。\n\n先核对当前状态；known_feedback 仅表示本附件已经完整提供的原文、候选与批注，工具核对未变时不重复发送，变化时以新版为准。有同版本 rules_receipt 时作为 known_rules 传回。不修改全局 SKILL。此文件是请求快照，不是状态表。\n保留原文与编号，使用 MCP rework_options 提交排序后的 A/B/C；外置状态默认保留旧批注，只有作者明确要求时才使用 discard_annotations 或 resolve_requests。旧内嵌状态保持原有返修默认行为。失败保留原状。多个位置可用 submit_options 顺序保存，失败不重放已成功项。接收后才替换正文，不自动接收。\n\n${notes.join('\n\n')}\n`, 'utf8');
        await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
        vscode.window.showInformationMessage((target ? '本项待处理批注' : '全部批注') + '已作为上下文加入 Codex 输入区，请检查后自行发送。');
    }
    function command(name, handler, displayOnly = false) {
        context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
            if (['localLatex.inlineAccept', 'localLatex.inlineReject'].includes(name)) {
                try {args = [decisionContext(args[0])];} catch (error) {return vscode.window.showErrorMessage(error.message);}
            }
            await startup;
            if (busy && !displayOnly) return vscode.window.showWarningMessage('当前审核操作尚未结束。');
            if (!displayOnly) busy = true;
            try { return await handler(...args); } catch (error) { vscode.window.showErrorMessage(error.message); }
            finally { if (!displayOnly) {busy = false; await flushRefresh();} }
        }));
    }
    command('localLatex.inlineReview', () => select());
    command('localLatex.reviewWorkbench', openWorkbench, true);
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.checkReviewBeforeReload', () => workbench.assertReloadSafe()));
    command('localLatex.inlineReviewAt', c => open(c));
    command('localLatex.inlineNext', arg => select(true, arg), true);
    command('localLatex.inlineSelectCard', openWorkbench, true);
    command('localLatex.inlineAccept', accept);
    command('localLatex.inlineReject', reject);
    command('localLatex.inlineAnnotate', annotate);
    command('localLatex.inlineEditCandidate', arg => openWorkbench(contextFor(arg)), true);
    command('localLatex.prepareReviewBlock', () => exclusive(async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file' || editor.document.languageId !== 'latex')
            throw new Error('请在论文源码中选择需要审核的完整行。');
        const c = activeScope || await discover();
        if (c.owner !== '.codex-review/state.json') throw new Error('请先显式迁移到外置审核状态。');
        const rel = path.relative(c.repo, editor.document.uri.fsPath).split(path.sep).join('/');
        if (rel.startsWith('../') || path.isAbsolute(rel)) throw new Error('所选文件不属于当前论文。');
        cleanBuffers(c, rel);
        const text = editor.document.getText();
        if (text !== (await fs.readFile(editor.document.uri.fsPath, 'utf8')).replace(/^\uFEFF/, ''))
            throw new Error('编辑区与磁盘尚未同步；请先核对。');
        const selected = await vscode.window.showQuickPick([
            {label: '自然段', kind: 'paragraph'}, {label: '公式或图表', kind: 'display'}, {label: '插入槽', kind: 'slot'},
            {label: '审稿问题容器', kind: 'question'}],
            {placeHolder: '选择审核块类型；选区应覆盖完整独立行'});
        if (!selected) return;
        const spec = {file: rel, kind: selected.kind,
            start: positions.codePointOffset(text, editor.document.offsetAt(editor.selection.start)),
            end: positions.codePointOffset(text, editor.document.offsetAt(editor.selection.end)),
            source_revision: crypto.createHash('sha256').update(text, 'utf8').digest('hex')};
        const preview = await backend(c, ['prepare-block'], spec);
        const choice = await vscode.window.showWarningMessage('将在选区边界加入固定审核块标记，正文内容不变。',
            {modal: true, detail: preview.marked}, '加入标记');
        if (choice !== '加入标记') return;
        await backend(c, ['prepare-block'], {...spec, block_id: preview.block_id}, preview.expected_sha256);
        await refresh(c);
        vscode.window.showInformationMessage('审核块标记已保存；尚未创建或接收候选。');
    }), true);
    command('localLatex.migrateReviewState', () => exclusive(async () => {
        const c = activeScope || await discover();
        if (c.owner === '.codex-review/state.json') throw new Error('当前项目已使用外置审核状态。');
        const preview = await backend(c, ['migrate-state']);
        const choice = await vscode.window.showWarningMessage('请核对完整迁移预览。确认后加入必要标记并切换审核状态，不接收候选。',
            {modal:true, detail:JSON.stringify(preview,null,2)}, '确认迁移');
        if (choice !== '确认迁移') return;
        await backend(c, ['migrate-state'], preview, preview.state_sha256);
        activeScope = {repo:c.repo, owner:'.codex-review/state.json'};
        await refresh(activeScope, true);
        vscode.window.showInformationMessage('审核状态迁移完成；候选和批注保持待审。');
    }), true);
    command('localLatex.recoverReviewMigration', () => exclusive(async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = (editor?.document.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(editor.document.uri)) || vscode.workspace.workspaceFolders?.[0];
        if (!folder) throw new Error('请先打开需要恢复的论文工作区。');
        const c = {repo:folder.uri.fsPath, owner:'.codex-review/state.json'};
        const preview = await backend(c, ['recover-migration']);
        const choice = await vscode.window.showWarningMessage('迁移尚未完成。请核对恢复文件与当前版本，确认后继续；作者改动冲突会停止。',
            {modal:true, detail:JSON.stringify(preview,null,2)}, '确认恢复');
        if (choice !== '确认恢复') return;
        await backend(c, ['recover-migration'], preview, preview.commit);
        activeScope = c;
        await refresh(activeScope, true);
        vscode.window.showInformationMessage('迁移恢复完成；候选和批注保持待审。');
    }), true);
    command('localLatex.inlineRelatedChanges', async arg => {
        const c = contextFor(arg), state = await backend(c, ['cards']);
        const item = state.edits[c.id];
        if (!item || item.versions.at(-1) !== c.version) throw new Error('该卡片或批次已经更新，请刷新当前审核。');
        const questions = item.questions || [];
        if (!questions.length) throw new Error('请先核实并关联原始审稿问题，再查看对应改动。');
        const matches = (edit) => (edit.questions || []).filter(q => questions.some(source =>
            source.id === q.id && source.file === q.file && source.quote === q.quote));
        const status = {pending: '待审', rework: '返修', accepted: '已接收', rejected: '已拒绝'};
        const choices = Object.entries(state.edits).filter(([id, edit]) => id !== c.id && matches(edit).length)
            .map(([id, edit]) => ({label: `${id} · ${status[edit.status] || edit.status} · ${edit.file}`,
                description: matches(edit).map(q => q.id).join('、'), detail: edit.location || '本批关联修改；接收不代表科学问题已解决。', id, edit}));
        if (!choices.length) return vscode.window.showInformationMessage('本批没有其他精确关联的改动；已精简的历史请查看 Git，不据此判定问题已完成。');
        const picked = await vscode.window.showQuickPick(choices, {placeHolder: '本批关联改动（按已核实的原始问题关联，不自动判断完成）', matchOnDescription: true, matchOnDetail: true});
        if (!picked) return;
        const target = {...c, id: picked.id, version: picked.edit.versions.at(-1)};
        if (OPEN.has(picked.edit.status)) return open(target);
        if (!target.version) throw new Error('该已完结记录已精简；请到 Git 查看已备份成果。');
        const data = await backend(target, ['inspect', '--id', target.id, '--version', target.version, '--source']);
        if (!data.source_match) throw new Error('该位置后来发生变化，无法精确定位；请查看文件或 Git，不猜测跳转。');
        const editor = await vscode.window.showTextDocument(uri(target, data.edit.file), {viewColumn: vscode.ViewColumn.One, preview: false});
        if (editor.document.getText() !== data.source.text) throw new Error('编辑区内容与定位快照不同，请先保存并重新核对位置。');
        const at = range(editor.document, data);
        editor.selection = new vscode.Selection(at.start, at.end);
        editor.revealRange(at, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }, true);
    command('localLatex.inlinePreview', preview, true);
    command('localLatex.inlineLocatePDF', async arg => {
        const c = contextFor(arg);
        await current(c);
        const key = c.repo + '|' + c.id;
        const meta = pdfMetadata.get(key) || context.workspaceState?.get('reviewPDFMeta', {})[key];
        if (!meta) throw new Error('尚无该文件的审核 PDF，请先用生成／更新按钮打开。');
        await require('./pdf_navigation').locate(vscode, context, meta, c);
    });
    command('localLatex.inlineReopenPreview', reopenPreview, true);
    command('localLatex.openFloatingPDF', async arg => {
        const selected = arg?.scheme ? arg : vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
        await require('./pdf_navigation').openFloating(vscode, selected, true);
    }, true);
    command('localLatex.inlineAddRequests', () => addRequests());
    command('localLatex.inlineTranslate', arg => openWorkbench(contextFor(arg)), true);
    command('localLatex.inlineTranslationSource', async arg => {
        const c = contextFor(arg); trusted(c);
        const currentProvider = config().get('translation.provider', 'bing');
        const options = Object.entries(TRANSLATORS).map(([provider, label]) => ({provider, label,
            description: (provider === currentProvider ? '当前来源；' : '')
                + (provider === 'google' ? '可能返回 429 限流' : provider === 'bing' ? '微软 Edge 免密钥接口，仍可能限流' : '免密钥网页接口，可能失效')}));
        const chosen = await vscode.window.showQuickPick(options, {placeHolder: '选择翻译来源；自动翻译开启时会翻译当前可见卡片'});
        if (chosen && chosen.provider !== currentProvider) {
            const cfg = config(), target = cfg.inspect('translation.provider').workspaceValue === undefined
                ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
            await cfg.update('translation.provider', chosen.provider, target);
        }
    }, true);
    command('localLatex.inlineToggleSource', arg => openWorkbench(contextFor(arg)), true);
    command('localLatex.inlineQuestions', arg => openWorkbench(contextFor(arg)), true);
    context.subscriptions.push(vscode.window.registerUriHandler({async handleUri(resource) {
        try {
            if (resource.path === '/review-pdf') return await require('./pdf_navigation').handleUri(vscode, resource);
            if (resource.path === '/source') return await require('./pdf_navigation').handleSourceUri(vscode, context, resource);
            if (resource.path !== '/review') throw new Error('不支持的审核入口。');
            const q = new URLSearchParams(resource.query);
            const c = {repo: q.get('repo'), owner: q.get('state'), id: q.get('id')};
            trusted(c);
            const state = await backend(c, ['status']);
            if (!state.edits[c.id]) throw new Error('没有该审核编号。');
            await vscode.commands.executeCommand('localLatex.inlineReviewAt', {...c, version: state.edits[c.id].versions.at(-1)});
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }}));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        decorate(); setContext().catch(error => vscode.window.showErrorMessage(error.message));
        if (!activeScope && editor?.document.languageId === 'latex')
            startup = startup.then(() => enableReview()).catch(error => vscode.window.showErrorMessage(error.message));
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme !== 'file') return;
        if (!activeScope) {
            if (!event.document.isDirty && event.document.languageId === 'latex')
                startup = startup.then(() => enableReview()).catch(error => vscode.window.showErrorMessage(error.message));
            return;
        }
        const relevant = sameFile(event.document.uri.fsPath, path.join(activeScope.repo, activeScope.owner))
            || [...records.values()].some(r => sameFile(event.document.uri.fsPath, path.join(r.c.repo, r.data.edit.file)));
        if (!relevant) return;
        relocateDocument(event.document);
        if (sameFile(event.document.uri.fsPath, path.join(activeScope.repo, activeScope.owner)) && event.document.getText() === ownerAfterWrite) return;
        if (event.document.isDirty) {decorate(); return;}
        return requestRefresh(event.document.uri.fsPath);
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (document.uri.scheme === 'file') return requestRefresh(document.uri.fsPath);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('localLatex.translation')) {
            workbench.settingsChanged();
        }
        if (!event.affectsConfiguration('localLatex.reviewStyle')) return;
        try {
            const appearance = style();
            workbench.updateStyle();
            if (reviewStyle.pdfKeys.some(key => event.affectsConfiguration('localLatex.reviewStyle.' + key))) {
                deleted.dispose();
                deleted = vscode.window.createTextEditorDecorationType({color: appearance.removedColor, textDecoration: appearance.strikeDeleted ? 'line-through' : 'none'});
                context.subscriptions.push(deleted);
                for (const peer of records.values()) pdfStatus(peer.c, 'PDF 样式已变更，待更新');
                decorate();
            }
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    startup = enableReview().catch(error => {vscode.window.showErrorMessage(error.message);});
    return {open, refresh, accept, reject, annotate, preview, addRequests, reviewList, listProvider, records,
        whenTranslationIdle: () => workbench.whenTranslationIdle(),
        whenPDFPrepared: () => Promise.all([...acceptedPDFPreparations]),
        workbench, whenPDFIdle: async () => {await Promise.all([...acceptedPDFPreparations]); await pdfRun;}, ready: startup};
}
function activate(context) { return createInlineReview(require('vscode'), context); }
module.exports = {activate, createInlineReview, markedWords, displayText, summary, deletionPreview};
