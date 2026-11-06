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
    const style = () => reviewStyle.read(vscode.workspace.getConfiguration('localLatex'));
    let deleted = vscode.window.createTextEditorDecorationType({color: style().removedColor, textDecoration: style().strikeDeleted ? 'line-through' : 'none'});
    let activeScope, busy = false, startup = Promise.resolve(), ownerAfterWrite, batch;
    let watchedScope, watcher, autoRefresh, renderedOwnerHash, refreshChain = Promise.resolve();
    const changedFiles = new Set(), reviewFiles = new Set(), deferredFiles = new Set();
    const shownPanels = new Set(), openedPDFs = new Set(), pdfMetadata = new Map();
    const pendingPDFUpdates = new Map();
    let pdfChain = Promise.resolve(), automaticPDFRun;
    const previewChoices = new Map(), workbenchPDFRequests = new Map(), workbenchPDFStatus = new Map(), pdfIntents = new Map();
    let workbenchPDFRun, latestReviewState;
    context.subscriptions.push(deleted);
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
        return JSON.parse(await execute(cfg.get('pythonPath', 'python'), [...argv, ...args], c.repo, input));
    }
    function cleanBuffers(c, file) {
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' && doc.isDirty && [path.join(c.repo, c.owner), path.join(c.repo, file)].some(p => sameFile(p, doc.uri.fsPath))) {
                throw new Error('正文或审核状态存在未保存编辑，请先保存；批注草稿仍保留。');
            }
        }
    }
    async function readCurrent(c) {
        const data = await backend(c, ['inspect', '--id', c.id, '--source']);
        if (!OPEN.has(data.edit.status) || data.edit.versions.at(-1) !== c.version) {
            await refresh(c);
            throw new Error('该项已有新版或审核决定，显示已自动更新。请核对后再次操作；未代为接收或覆盖。');
        }
        if (!data.source_match) throw new Error('原文被手动修改，需先核对；没有覆盖任何内容。');
        return data;
    }
    async function current(c) {
        const data = await readCurrent(c);
        cleanBuffers(c, data.edit.file);
        const shown = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, path.join(c.repo, data.edit.file)));
        if (shown && shown.getText() !== data.source.text) throw new Error('编辑区正在同步磁盘内容，请待同步后重新点击；没有覆盖任何内容。');
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
        if (!owners.length && allowEmpty) return {repo};
        if (owners.length !== 1) throw new Error('需先建立或核对唯一的 CODEX-REVIEW-STATE。');
        return {repo, owner: path.relative(repo, owners[0]).split(path.sep).join('/')};
    }
    const listEvents = new vscode.EventEmitter();
    let fileRows = [];
    const listProvider = {
        onDidChangeTreeData: listEvents.event,
        getTreeItem: item => item,
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
                group.children = []; files.set(file, group);
            }
            const item = new vscode.TreeItem(`${c.id} · ${data.edit.location || file}`, vscode.TreeItemCollapsibleState.None);
            item.id = JSON.stringify([c.repo, c.owner, batch, c.id]);
            item.description = record.displayConflict ? '原文位置待核对' : data.edit.status === 'rework' ? '返修' : '待审';
            item.tooltip = `${c.id} · ${file} · 候选 v${data.edit.versions.length}`;
            item.command = {command: 'localLatex.reviewWorkbench', title: '打开论文审核页', arguments: [c]};
            files.get(file).children.push(item);
        }
        fileRows = [...files.values()];
        reviewList.message = records.size ? `${records.size} 项待审 · 点击编号在同一审核页切换` : '暂无待审候选；请先让 AI 按插件规则生成。';
        listEvents.fire();
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
    function flushRefresh() {
        if (busy || autoRefresh || !changedFiles.size) return autoRefresh || Promise.resolve();
        autoRefresh = (async () => {
            while (changedFiles.size && !busy) {
                const files = [...changedFiles]; changedFiles.clear();
                if (await changedSinceRender(files)) await refresh(watchedScope);
            }
        })().catch(error => vscode.window.showErrorMessage(error.message)).finally(() => {
            autoRefresh = undefined;
            if (changedFiles.size && !busy) return flushRefresh();
        });
        return autoRefresh;
    }
    function watchScope(c) {
        if (watchedScope && sameFile(watchedScope.repo, c.repo) && watchedScope.owner === c.owner) return;
        watcher?.dispose(); changedFiles.clear(); reviewFiles.clear(); deferredFiles.clear(); renderedOwnerHash = undefined; ownerAfterWrite = undefined;
        watchedScope = {repo: c.repo, owner: c.owner};
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(c.repo, '**/*.tex'));
        const changed = resource => requestRefresh(resource.fsPath);
        context.subscriptions.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }
    function refresh(c, explicitPanel = false) {
        const task = refreshChain.then(() => renderRefresh(c, explicitPanel));
        // Recover the sequencing tail only; the caller still receives failures.
        refreshChain = task.catch(() => {});
        return task;
    }
    async function renderRefresh(c, explicitPanel = false) {
        watchScope(c);
        const state = await backend(c, ['cards']);
        latestReviewState = state;
        reviewFiles.clear(); deferredFiles.clear();
        for (const edit of Object.values(state.edits)) if (OPEN.has(edit.status)) reviewFiles.add(path.join(c.repo, edit.file));
        if (batch && batch !== state.session) {
            pdfMetadata.clear();
            previewChoices.clear(); workbenchPDFStatus.clear();
            records.clear();
        }
        batch = state.session;
        const documents = new Map();
        const oldRecords = new Map(records);
        const blocked = new Set();
        for (const [file, text] of Object.entries(state.sources)) {
            const doc = await vscode.workspace.openTextDocument(uri(c, file));
            documents.set(file, doc);
            if (doc.isDirty || doc.getText() !== text) {blocked.add(file); deferredFiles.add(path.join(c.repo, file));}
        }
        records.clear();
        for (const [id, record] of oldRecords) if (blocked.has(record.data.edit.file) && state.cards[id]) records.set(id, record);
        for (const [id, data] of Object.entries(state.cards)) {
            if (records.has(id)) continue;
            const edit = data.edit;
            if (!OPEN.has(edit.status)) continue;
            const selected = {...c, id, version: edit.versions.at(-1)};
            data.source.text = state.sources[edit.file];
            if (!documents.has(edit.file)) documents.set(edit.file, await vscode.workspace.openTextDocument(uri(c, edit.file)));
            const doc = documents.get(edit.file);
            if (doc.isDirty || doc.getText() !== data.source.text) continue;
            const at = range(doc, data);
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
        workbench.sync(new Map([...records].filter(([, r]) => !r.displayConflict)), c);
        decorate();
        await setContext();
        await showPanel(c.repo, explicitPanel);
    }
    function relocateDocument(document) {
        const text = document.getText(), currentView = positions.view(text), oldViews = new Map();
        let affected = false;
        for (const [id, record] of records) {
            if (!sameFile(document.uri.fsPath, path.join(record.c.repo, record.data.edit.file))) continue;
            affected = true;
            if (!oldViews.has(record.data.source.text)) oldViews.set(record.data.source.text, positions.view(record.data.source.text));
            const span = positions.locateDisplay(record.data, currentView, oldViews.get(record.data.source.text));
            if (!span) {records.set(id, {...record, displayConflict: true}); continue;}
            const source = {...record.data.source, text, start: positions.codePointOffset(text, span.start), end: positions.codePointOffset(text, span.end)};
            records.set(id, {...record, displayConflict: false, data: {...record.data, source}, range: new vscode.Range(document.positionAt(span.start), document.positionAt(span.end))});
        }
        if (!affected) return;
        if (document.isDirty) deferredFiles.add(document.uri.fsPath);
        updateList();
        workbench.sync(new Map([...records].filter(([, r]) => !r.displayConflict)), watchedScope);
    }
    function decorate() {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme !== 'file') continue;
            const spans = [];
            if (!editor.document.isDirty) for (const {c, data, displayConflict} of records.values()) {
                if (displayConflict) continue;
                if (!sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file))) continue;
                if (editor.document.getText() !== data.source.text) continue;
                const side = data.source.side === 'original' ? 'old' : 'new';
                // Existing legacy candidate text is not painted as a deletion.
                if (side !== 'old') continue;
                for (const change of data.changes) if (change.old_end > change.old_start) {
                    spans.push(new vscode.Range(editor.document.positionAt(utf16(data.source.text, data.source.start + change.old_start)),
                        editor.document.positionAt(utf16(data.source.text, data.source.start + change.old_end))));
                }
            }
            editor.setDecorations(deleted, spans);
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
    async function accept(arg) {
        const c = contextFor(arg), data = await current(c);
        if (data.options?.length > 1 && !c.option) {await openWorkbench(c); return;}
        const navigation = pdfMetadata.get(c.repo + '|' + c.id) || context.workspaceState?.get('reviewPDFMeta', {})[c.repo + '|' + c.id];
        const ordered = orderedRecords(), index = ordered.findIndex(record => record.c.id === c.id);
        const following = ordered.slice(index + 1).map(record => record.c.id);
        await backend(c, ['decide', '--accept', c.id, '--version', c.version, ...(data.options?.length && data.options.length > 1 ? ['--option', c.option || 'A'] : data.options?.length && c.option ? ['--option', c.option] : [])], undefined, data.sha256);
        await refresh(c);
        const next = following.map(id => records.get(id)).find(Boolean);
        if (next && !c.workbench) await openWorkbench(next.c);
        if (navigation && config().get('reviewPDF.autoUpdateAfterAccept', true)) await queueAcceptedPDF(c, navigation);
        vscode.window.showInformationMessage(`${c.id} 已接收并替换正文；未提交 Git 或推送。`);
    }
    async function reject(arg) {
        const c = contextFor(arg), data = await current(c);
        await backend(c, ['decide', '--reject', c.id, '--version', c.version], undefined, data.sha256);
        await refresh(c);
        vscode.window.showInformationMessage(`${c.id} 候选已拒绝，原文保留；不代表科学问题已解决，未提交 Git 或推送。`);
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
        workbench.setRecords(new Map(orderedRecords().filter(r => !r.displayConflict).map(r => [r.c.id, r])));
        await workbench.annotate(c, selected);
    }
    async function saveNote(c, note, text) {
        const data = await current(c);
        const saved = await backend(c, ['feedback'], {id: c.id, version: c.version, side: note.side,
            start: note.start, end: note.end, quote: note.quote, text, ...(note.option ? {option: note.option} : {}),
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
        workbench.sync(new Map([...records].filter(([, r]) => !r.displayConflict)), c);
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
        style, read: readCurrent, selection: selectedOption,
        directory: () => Object.entries(latestReviewState?.edits || {}).map(([id, edit]) => ({id, file: edit.file, kind: edit.kind, status: edit.status,
            location: edit.location, questions: (edit.questions || []).map(q => q.id), requests: (edit.requests || []).filter(n => n.status === 'open').length})),
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
        note: (c, selected, text) => exclusive(() => saveNote(c, selected, text)),
        accept: c => exclusive(() => accept(c)), reject: c => exclusive(() => reject(c)),
        saved(c, option, compare) {if (selectedOption(c) === option) requestWorkbenchPDF(c, option, compare, false);},
        preview: requestWorkbenchPDF,
        locate: async (c, option) => {
            const navigation = pdfMetadata.get(c.repo + '|' + c.id) || context.workspaceState?.get('reviewPDFMeta', {})[c.repo + '|' + c.id];
            if (!navigation) throw new Error('当前项还没有审核 PDF，请先点击更新 PDF。');
            await require('./pdf_navigation').locate(vscode, context, navigation, {...c, option});
        },
        source: async c => {
            const data = await current(c), doc = await vscode.workspace.openTextDocument(uri(c, data.edit.file));
            const editor = await vscode.window.showTextDocument(doc, {preview: false, viewColumn: vscode.ViewColumn.One});
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
    async function openWorkbench(arg) {
        await enableReview();
        const c = arg?.repo ? arg : workbench.active || orderedRecords()[0]?.c;
        if (!c) return vscode.window.showInformationMessage('没有待审候选。可先把插件三方案规则交给 AI 创建候选。');
        trusted(c);
        if (arg?.repo && arg.version) await readCurrent(c);
        if (arg?.option) previewChoices.set(choiceKey(c), {version: c.version, option: arg.option});
        workbench.setRecords(new Map(orderedRecords().filter(r => !r.displayConflict).map(r => [r.c.id, r])));
        await workbench.show(c);
    }
    function pdfStatus(c, text, option = selectedOption(c)) {
        workbenchPDFStatus.set(choiceKey(c), {version: c.version, option, text});
        workbench.status(c, text);
    }
    async function resolvePDFDocument(c) {
        const data = await current(c);
        const registered = await require('./document_roles').confirmedRoot(vscode, c.repo, path.join(c.repo, data.edit.file), execute);
        if (registered) return registered;
        if (/^\s*\\documentclass\b/m.test(data.source.text)) return path.join(c.repo, data.edit.file);
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(c.repo, '**/*.tex'), EXCLUDE);
        const roots = [];
        for (const file of files) if (/^\s*\\documentclass\b/m.test(await fs.readFile(file.fsPath, 'utf8'))) roots.push({label: path.relative(c.repo, file.fsPath), file: file.fsPath});
        return (roots.length === 1 ? roots[0] : await vscode.window.showQuickPick(roots, {placeHolder: '选择实际所属的可编译主文档'}))?.file;
    }
    async function requestWorkbenchPDF(c, option, compare, force) {
        try {
            const intent = crypto.randomUUID(); pdfIntents.set(c.repo, intent);
            previewChoices.set(choiceKey(c), {version: c.version, option});
            pdfStatus(c, 'PDF 待更新：' + c.id + ' · ' + option);
            if (!force && !config().get('reviewPDF.followPreview', true)) return;
            const document = await resolvePDFDocument(c);
            if (!document) return;
            if (pdfIntents.get(c.repo) !== intent) return;
            const directory = path.join(path.dirname(document), '.latex-build', 'review-diff');
            await fs.mkdir(directory, {recursive: true});
            for (const folder of [path.dirname(directory), directory]) {
                const info = await fs.lstat(folder);
                if (!info.isDirectory() || info.isSymbolicLink() || !sameFile(await fs.realpath(folder), folder)) throw new Error('PDF 输出目录存在链接或异常，未写入。');
            }
            const choices = Object.fromEntries(orderedRecords().filter(r => r.c.repo === c.repo && r.c.owner === c.owner)
                .map(r => [r.c.id, {version: r.c.version, option: selectedOption(r.c)}]));
            const requestFile = path.join(directory, path.basename(document, '.tex') + '-selection.json');
            try {const info = await fs.lstat(requestFile); if (!info.isFile() || info.isSymbolicLink()) throw new Error('PDF 请求目标不是普通文件。');} catch (e) {if (e.code !== 'ENOENT') throw e;}
            const temporary = requestFile + '.write-' + crypto.randomUUID();
            if (pdfIntents.get(c.repo) !== intent) return;
            await fs.writeFile(temporary, JSON.stringify({token: crypto.randomUUID(), choices, compare_id: compare ? c.id : null}), {encoding: 'utf8', flag: 'wx'});
            await fs.rename(temporary, requestFile);
            workbenchPDFRequests.set(document, {c, document, requestFile, intent});
            if (workbenchPDFRun) return;
            workbenchPDFRun = (async () => {
                while (workbenchPDFRequests.size) {
                    const [key, request] = workbenchPDFRequests.entries().next().value;
                    workbenchPDFRequests.delete(key);
                    pdfStatus(request.c, 'PDF 正在更新；可以继续审核');
                    try {
                        await serializePDF(() => generatePDF(request.c, request.document, false, request.requestFile));
                        if (!workbenchPDFRequests.has(key) && pdfIntents.get(request.c.repo) === request.intent) pdfStatus(request.c, 'PDF 最新');
                    } catch (error) {if (!workbenchPDFRequests.has(key)) pdfStatus(request.c, 'PDF 更新失败，仍显示旧版：' + error.message);}
                }
            })().finally(() => {workbenchPDFRun = undefined;});
        } catch (error) {pdfStatus(c, 'PDF 更新失败，仍显示旧版：' + error.message);}
    }
    function serializePDF(action) {
        const task = pdfChain.then(action);
        pdfChain = task.catch(() => {});
        return task;
    }
    async function queueAcceptedPDF(c, navigation) {
        const saved = JSON.parse(await fs.readFile(navigation, 'utf8'));
        if (!saved.document) {
            vscode.window.showInformationMessage('此审核 PDF 来自旧版，请手动生成一次以建立自动更新关联。');
            return;
        }
        pendingPDFUpdates.set(saved.document, c);
        startAutomaticPDF();
    }
    function startAutomaticPDF() {
        if (automaticPDFRun) return;
        automaticPDFRun = (async () => {
            while (pendingPDFUpdates.size) {
                const [document, selected] = pendingPDFUpdates.entries().next().value;
                pendingPDFUpdates.delete(document);
                // Setting changes take effect even for requests already queued.
                if (!config().get('reviewPDF.autoUpdateAfterAccept', true)) continue;
                try {await serializePDF(() => generatePDF(selected, document, true));}
                catch (error) {vscode.window.showErrorMessage('接收已保存，但审核 PDF 自动更新失败：' + error.message);}
            }
        })().finally(() => {automaticPDFRun = undefined; if (pendingPDFUpdates.size) startAutomaticPDF();});
    }
    async function preview(arg) {
        const c = contextFor(arg), data = await current(c);
        const document = await resolvePDFDocument(c);
        if (!document) return;
        return serializePDF(() => generatePDF(c, document, false));
    }
    async function generatePDF(c, document, automatic, requestFile) {
        const cfg = config();
        await vscode.window.withProgress({location: vscode.ProgressLocation.Notification,
            title: automatic ? '接收后更新审核 PDF（后台，不阻塞下一项）' : '生成／更新完整论文审核 PDF'}, async () => {
            const result = JSON.parse(await execute(cfg.get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_pdf.py'),
                '--repo', c.repo, '--state', c.owner, '--document', document, '--id', c.id, '--version', c.version,
                '--git', cfg.get('gitPath', 'git'), '--latexdiff', cfg.get('latexdiffPath'), '--latexmk', cfg.get('latexmkPath'),
                '--style', JSON.stringify(style()), ...(automatic ? ['--refresh-accepted'] : []), ...(requestFile ? ['--request-file', requestFile] :
                    ['--choices', JSON.stringify(Object.fromEntries(orderedRecords().filter(r => r.c.repo === c.repo).map(r => [r.c.id, {version: r.c.version, option: selectedOption(r.c)}])))])], c.repo));
            if (!automatic) await current(c);
            if (result.navigation) {
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
            } else if (!automatic) vscode.window.showInformationMessage(result.reused_pdf ? '审核内容未变化，已复用核验后的 PDF，没有重新编译。'
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
            + item.requests.map(n => `${n.option ? '方案 ' + n.option : '整项／全部方案'} · ${n.side === 'original' ? '原文' : '候选'}选区：${n.quote}\n返修要求：${n.text}`).join('\n\n')
        );
        if (!notes.length) return vscode.window.showInformationMessage('没有待处理的批注。');
        if (!(await vscode.commands.getCommands(true)).includes('chatgpt.addFileToThread')) throw new Error('当前 Codex 插件没有可用的添加上下文命令；批注仍保留，未发送。');
        const parent = path.join(c.repo, '.codex-review', 'requests');
        await fs.mkdir(parent, {recursive: true});
        const folder = await fs.mkdtemp(path.join(parent, 'batch-'));
        const file = path.join(folder, '返修批注.txt');
        const contract = await fs.readFile(path.join(__dirname, 'collaboration-guide.md'), 'utf8');
        await fs.writeFile(file, `${contract}\n\n请读取 ${c.owner} 中最新的唯一审核状态，再处理以下批注。此文件是请求快照，不是状态表。\n保留原文与编号，使用 rework-options 一次提交排序后的 A/B/C；接收后才替换正文，不自动接收。\n\n${notes.join('\n\n')}\n`, 'utf8');
        await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
        vscode.window.showInformationMessage((target ? '本项待处理批注' : '全部批注') + '已作为上下文加入 Codex 输入区，请检查后自行发送。');
    }
    function command(name, handler, displayOnly = false) {
        context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
            await startup;
            if (busy && !displayOnly) return vscode.window.showWarningMessage('当前审核操作尚未结束。');
            if (!displayOnly) busy = true;
            try { return await handler(...args); } catch (error) { vscode.window.showErrorMessage(error.message); }
            finally { if (!displayOnly) {busy = false; await flushRefresh();} }
        }));
    }
    command('localLatex.inlineReview', () => select());
    command('localLatex.reviewWorkbench', openWorkbench, true);
    command('localLatex.inlineReviewAt', c => open(c));
    command('localLatex.inlineNext', arg => select(true, arg), true);
    command('localLatex.inlineSelectCard', openWorkbench, true);
    command('localLatex.inlineAccept', accept);
    command('localLatex.inlineReject', reject);
    command('localLatex.inlineAnnotate', annotate);
    command('localLatex.inlineEditCandidate', arg => openWorkbench(contextFor(arg)), true);
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
    command('localLatex.inlinePreview', preview);
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
        workbench, whenPDFIdle: () => workbenchPDFRun || automaticPDFRun || pdfChain, ready: startup};
}
function activate(context) { return createInlineReview(require('vscode'), context); }
module.exports = {activate, createInlineReview, markedWords, displayText, summary, deletionPreview};
