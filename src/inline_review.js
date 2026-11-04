'use strict';
// Original-file comment cards. Durable proposals/decisions stay in source_review.py.
const path = require('node:path');
const fs = require('node:fs/promises');
const cp = require('node:child_process');
const OPEN = new Set(['pending', 'rework']);
const EXCLUDE = '**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**';

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
const utf16 = (text, offset) => Array.from(text).slice(0, offset).join('').length;
// Display-only break opportunities for long TeX tokens; never alter stored text
// or the exact source-selection offsets used for acceptance and annotations.
const wrapHtml = text => escapeHtml(text.replace(/\S{32,}/gu, word => Array.from(word).join('\u200b'))).replace(/\r?\n/g, '<br>');
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

function markedWords(data, side) {
    const text = data[side], prefix = side === 'original' ? 'old' : 'new';
    const comments = commentSpans(text);
    function visible(start, end) {
        let cursor = start, output = '';
        for (const [a, b] of comments) {
            if (b <= cursor || a >= end) continue;
            output += text.slice(cursor, Math.max(cursor, a));
            cursor = Math.min(end, b);
        }
        return wrapHtml(output + text.slice(cursor, end));
    }
    let offset = 0, result = '';
    for (const change of data.changes) {
        const start = change[prefix + '_start'], end = change[prefix + '_end'];
        result += visible(offset, utf16(text, start));
        const changed = visible(utf16(text, start), utf16(text, end));
        if (changed) result += side === 'original' ? `<span style="color:#d32f2f;"><del>${changed}</del></span>` : `<span style="color:#1565c0;">${changed}</span>`;
        offset = utf16(text, end);
    }
    return result + visible(offset, text.length);
}

function createInlineReview(vscode, context, execute = run) {
    const cards = new Map(), records = new Map(), drafts = new WeakMap(), threadContexts = new WeakMap(), threadMembers = new WeakMap(), expandedSources = new Set();
    const controller = vscode.comments.createCommentController('localLatexInlineReview', '原文内修订审核');
    const deleted = vscode.window.createTextEditorDecorationType({color: '#d32f2f', textDecoration: 'line-through'});
    let activeScope, busy = false, startup = Promise.resolve(), ownerAfterWrite;
    const shownPanels = new Set(), openedPDFs = new Set(), expandedQuestions = new Set(), pdfMetadata = new Map();
    context.subscriptions.push(controller, deleted);
    controller.options = {prompt: '填写针对选中文字的返修要求', placeHolder: '保存后可一键把全部批注加入 Codex；不会自动发送。'};
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
    async function current(c) {
        const data = await backend(c, ['inspect', '--id', c.id, '--version', c.version, '--source']);
        if (!OPEN.has(data.edit.status)) throw new Error('该编号已有决定。请刷新或查看下一项。');
        if (data.edit.versions.at(-1) !== c.version) throw new Error('候选已经更新，请先刷新卡片。');
        if (!data.source_match) throw new Error('原文被手动修改，需先核对；没有覆盖任何内容。');
        cleanBuffers(c, data.edit.file);
        const shown = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && sameFile(doc.uri.fsPath, path.join(c.repo, data.edit.file)));
        if (shown && shown.getText() !== data.source.text) throw new Error('编辑区正在同步磁盘内容，请待同步后重新点击；没有覆盖任何内容。');
        return data;
    }
    function range(doc, data) {
        return new vscode.Range(doc.positionAt(utf16(data.source.text, data.source.start)), doc.positionAt(utf16(data.source.text, data.source.end)));
    }
    function contextFor(arg) {
        const card = arg?.thread || arg;
        const attached = card && threadContexts.get(card);
        if (attached) return attached;
        if (arg?.repo && arg.id) return arg;
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('请先打开原文审核卡片。');
        const selected = sourceRecord(editor);
        if (!selected) throw new Error('请点击要审核的原文位置，或使用该处的“接收并替换正文”按钮。');
        return selected.c;
    }
    function sourceRecord(editor) {
        const candidates = [...records.values()].filter(r => sameFile(editor.document.uri.fsPath, path.join(r.c.repo, r.data.edit.file)));
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
    async function showPanel(repo, explicit = false) {
        if (!explicit && shownPanels.has(repo)) return;
        // VS Code registers this view/command only after real comment threads
        // or commenting ranges reach its main thread. Do not focus it earlier.
        if (!(await vscode.commands.getCommands(true)).includes('workbench.action.focusCommentsPanel')) return;
        const editor = vscode.window.activeTextEditor;
        await vscode.commands.executeCommand('workbench.action.focusCommentsPanel');
        shownPanels.add(repo);
        if (editor) await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
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
    const sourceKey = c => JSON.stringify([c.repo, c.owner, c.id]);
    // Native gutter clicks toggle every thread ending on the clicked source line.
    // Share the view, not the underlying candidates or their decisions/notes.
    const lineKey = record => JSON.stringify([record.c.repo, record.c.owner, record.data.edit.file,
        record.data.source.text.slice(0, utf16(record.data.source.text, record.data.source.end)).split('\n').length]);
    const cardTitle = (data, id) => {
        const members = threadMembers.get(cards.get(id)) || [];
        return label(data, id) + (members.length > 1 ? ' · 本行：' + members.join('、') : '');
    };
    function cardBody(data, id, c) {
        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = false;
        const enabledCommands = [];
        const members = threadMembers.get(cards.get(id)) || [];
        if (members.length > 1) {
            enabledCommands.push('localLatex.inlineSelectCard');
            markdown.appendMarkdown('选择本行编号：' + members.map(member => member === id ? `**${member}**`
                : `[${member}](command:localLatex.inlineSelectCard?${encodeURIComponent(JSON.stringify([records.get(member).c]))})`).join(' · ') + '\n\n');
        }
        if (!data.edit.deferred) markdown.appendMarkdown('旧式记录：候选此前已在源码中；本工具不会静默撤回。\n\n');
        const old = displayText(data.original) ? markedWords(data, 'original').trim() : '仅补充，无对应原句。';
        const proposed = displayText(data.candidate) ? markedWords(data, 'candidate').trim()
            : `本句／本项已删除。删除后衔接（仅预览）：<br>${wrapHtml(deletionPreview(data))}`;
        markdown.appendMarkdown(`<div><strong>原文：</strong> ${old}<br><strong>候选：</strong> ${proposed}</div>\n`);
        markdown.appendMarkdown('<div>图例：<span style="color:#d32f2f;"><del>old</del></span>＝删除／替换；'
            + '<span style="color:#1565c0;">new</span>＝新增／改写；same＝未改；公式可仅标色。'
            + ' → 原文到候选；Addition only＝无对应原句。</div>');
        if (data.edit.questions?.length) {
            enabledCommands.push('localLatex.inlineQuestions', 'localLatex.jumpQuestion');
            const toggle = encodeURIComponent(JSON.stringify([c]));
            markdown.appendMarkdown(`\n\n[关联问题 ${data.edit.questions.map(q => escapeHtml(q.id)).join('、')}（展开／收起）](command:localLatex.inlineQuestions?${toggle})`);
            if (expandedQuestions.has(sourceKey(c))) for (const q of data.edit.questions) {
                const target = encodeURIComponent(JSON.stringify([{repo: c.repo, question: q}]));
                markdown.appendMarkdown(`\n\n<div><strong>${escapeHtml(q.id)}：</strong>${wrapHtml(q.quote)}</div>\n\n`
                    + `[跳转原始文件](command:localLatex.jumpQuestion?${target})`);
            }
        }
        if (commentSpans(data.original).length || commentSpans(data.candidate).length) {
            const expanded = expandedSources.has(sourceKey(c));
            const target = 'command:localLatex.inlineToggleSource?' + encodeURIComponent(JSON.stringify([c]));
            enabledCommands.push('localLatex.inlineToggleSource');
            markdown.appendMarkdown(`\n\n[${expanded ? '收起完整源码' : '展开完整源码（含注释）'}](${target})`);
            if (expanded) markdown.appendMarkdown(`\n\n<div><strong>原文完整源码：</strong><br>${wrapHtml(data.original)}<br><strong>候选完整源码：</strong><br>${wrapHtml(data.candidate)}</div>`);
        }
        if (enabledCommands.length) markdown.isTrusted = {enabledCommands};
        return markdown;
    }
    function renderCard(thread, record, previous, preserveDraft = false, previousMembers = []) {
        const {c, data} = record;
        const sameBody = previous && previous.c.id === c.id && previous.c.version === c.version
            && previous.data.edit.deferred === data.edit.deferred
            && JSON.stringify(previous.data.edit.questions) === JSON.stringify(data.edit.questions)
            && JSON.stringify(previousMembers) === JSON.stringify(threadMembers.get(thread))
            && (displayText(data.candidate) || deletionPreview(previous.data) === deletionPreview(data));
        const comments = [sameBody ? thread.comments[0]
            : {body: cardBody(data, c.id, c), mode: vscode.CommentMode.Preview, author: {name: c.id}}];
        const oldNotes = new Map((previous?.data.edit.requests || []).map((note, index) => [note.id, {note, comment: thread.comments[index + 1]}]));
        for (const note of data.edit.requests || []) {
            const old = oldNotes.get(note.id);
            if (old && JSON.stringify(old.note) === JSON.stringify(note)) comments.push(old.comment);
            else {
                const body = new vscode.MarkdownString();
                body.appendText(`${note.side === 'original' ? '原文' : '候选'}选区：${note.quote}\n返修要求：${note.text}\n状态：${note.status}`);
                comments.push({body, mode: vscode.CommentMode.Preview, author: {name: '作者'}});
            }
        }
        if (comments.length !== thread.comments.length || comments.some((comment, i) => comment !== thread.comments[i])) thread.comments = comments;
        thread.range = record.range;
        if (!preserveDraft) {
            const title = cardTitle(data, c.id);
            if (thread.label !== title) thread.label = title;
            if (thread.contextValue !== 'localLatexInlineCard') thread.contextValue = 'localLatexInlineCard';
            if (thread.canReply !== false) thread.canReply = false;
        }
        threadContexts.set(thread, c);
    }
    function showCard(c) {
        const record = records.get(c.id), thread = cards.get(c.id);
        if (!record || !thread) throw new Error('该卡片已更新，请重新打开。');
        if (drafts.has(thread)) {
            if (drafts.get(thread).c.id !== c.id) throw new Error('请先保存或取消当前批注草稿，再切换同行候选；草稿仍保留。');
        } else renderCard(thread, record, records.get(threadContexts.get(thread).id), false, threadMembers.get(thread));
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        activeScope = record.c;
    }
    async function refresh(c, explicitPanel = false, focus = false) {
        const state = await backend(c, ['cards']);
        const documents = new Map();
        const previous = new Map(), writing = new Map(), available = new Map();
        const oldCards = new Map(cards), oldRecords = new Map(records), oldThreads = new Set(cards.values());
        for (const thread of new Set(cards.values())) {
            const selected = threadContexts.get(thread); let record = records.get(selected.id);
            previous.set(lineKey(record), selected.id);
            const replacement = state.cards[selected.id];
            if (drafts.has(thread) && (!replacement || replacement.version === selected.version)) {
                if (replacement) record = {...record, data: {...record.data, edit: {...record.data.edit, questions: replacement.edit.questions}}};
                writing.set(lineKey(record), {thread, record});
            } else if (drafts.has(thread)) {
                drafts.delete(thread);
                thread.dispose();
                oldThreads.delete(thread);
            }
            if (oldThreads.has(thread)) available.set(lineKey(record), thread);
        }
        cards.clear(); records.clear();
        // Ordinary refresh/metadata updates keep the draft. A genuine new
        // candidate generation replaces its old disposable review interaction.
        for (const {record} of writing.values()) records.set(record.c.id, record);
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
        const groups = new Map();
        for (const record of records.values()) {
            const key = lineKey(record);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        }
        const used = new Set();
        for (const [key, members] of groups) {
            const draft = writing.get(key);
            const record = draft?.record || (focus && members.find(r => r.c.id === c.id))
                || members.find(r => r.c.id === previous.get(key)) || members[0];
            let thread = draft?.thread || available.get(key);
            if (!thread || used.has(thread)) thread = members.map(r => oldCards.get(r.c.id)).find(t => t && oldThreads.has(t) && !used.has(t));
            const old = thread && oldRecords.get(threadContexts.get(thread).id);
            const oldMembers = thread ? threadMembers.get(thread) : [];
            if (!thread) thread = controller.createCommentThread(uri(record.c, record.data.edit.file), record.range, []);
            used.add(thread);
            threadMembers.set(thread, members.map(r => r.c.id));
            for (const member of members) cards.set(member.c.id, thread);
            renderCard(thread, record, old, !!draft, oldMembers);
            if (!draft && !old) {
                thread.collapsibleState = record.c.id === c.id ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
            } else if (focus && record.c.id === c.id) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }
        for (const thread of oldThreads) if (!used.has(thread)) thread.dispose();
        decorate();
        await setContext();
        await showPanel(c.repo, explicitPanel);
    }
    function decorate() {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme !== 'file') continue;
            const spans = [];
            if (!editor.document.isDirty) for (const {c, data} of records.values()) {
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
    async function open(c) {
        const draft = drafts.get(cards.get(c.id));
        if (draft && draft.c.id !== c.id) throw new Error('请先保存或取消当前批注草稿，再切换同行候选；草稿仍保留。');
        const state = await prepareProject(c);
        c = {...c, version: state.edits[c.id].versions.at(-1)};
        activeScope = c;
        const data = await current(c);
        const editor = await vscode.window.showTextDocument(uri(c, data.edit.file), {viewColumn: vscode.ViewColumn.One, preview: false});
        const at = range(editor.document, data);
        editor.selection = new vscode.Selection(at.start, at.start);
        editor.revealRange(at, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        await refresh(c, false, true);
    }
    async function prepareProject(c) {
        let state = await backend(c, ['status']);
        if (state.schema === 1 || Object.values(state.edits || {}).some(edit => OPEN.has(edit.status) && !edit.deferred)) {
            for (const edit of Object.values(state.edits || {})) if (OPEN.has(edit.status)) cleanBuffers(c, edit.file);
            await backend(c, ['migrate', '--defer-pending'], undefined, state.sha256);
            state = await backend(c, ['status']);
        }
        return state;
    }
    async function select(next = false, arg) {
        if (!next) return enableReview(true);
        if (!activeScope) await enableReview();
        const choices = [...records.values()];
        if (!choices.length) return vscode.window.showInformationMessage('没有待审修改。');
        const from = arg ? contextFor(arg) : activeScope;
        const index = choices.findIndex(r => r.c.id === from?.id);
        const picked = choices[(index + 1) % choices.length];
        showCard(picked.c);
        const editor = await vscode.window.showTextDocument(uri(picked.c, picked.data.edit.file), {preview: false});
        editor.selection = new vscode.Selection(picked.range.start, picked.range.start);
        editor.revealRange(picked.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    async function accept(arg) {
        const c = contextFor(arg), data = await current(c);
        await backend(c, ['decide', '--accept', c.id, '--version', c.version], undefined, data.sha256);
        await refresh(c);
        vscode.window.showInformationMessage(`${c.id} 已接收并替换正文；未提交 Git 或推送。已打开的审核 PDF 保留为本次审核快照。`);
    }
    async function reject(arg) {
        const c = contextFor(arg), data = await current(c);
        await backend(c, ['decide', '--reject', c.id, '--version', c.version], undefined, data.sha256);
        await refresh(c);
        vscode.window.showInformationMessage(`${c.id} 候选已拒绝，原文保留；不代表科学问题已解决，未提交 Git 或推送。`);
    }
    async function annotate(arg) {
        const c = contextFor(arg), data = await current(c), editor = vscode.window.activeTextEditor;
        if (!editor || !sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file))) throw new Error('请先点击对应编号的原文。');
        const selection = editor.selection;
        const at = selection.isEmpty ? range(editor.document, data) : selection;
        const start = Array.from(editor.document.getText().slice(0, editor.document.offsetAt(at.start))).length - data.source.start;
        const end = Array.from(editor.document.getText().slice(0, editor.document.offsetAt(at.end))).length - data.source.start;
        if (start < 0 || end > Array.from(data[data.source.side]).length) throw new Error('请选择该编号原文范围内的文字。候选文字可在批注中明确引用。');
        showCard(c);
        const thread = cards.get(c.id);
        thread.contextValue = 'localLatexInlineDraft'; thread.canReply = true;
        thread.label = `${c.id} · 保存精确选区批注`;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        drafts.set(thread, {c, side: data.source.side, start, end, quote: editor.document.getText(at)});
        return thread;
    }
    function cancelComment(arg) {
        const thread = arg?.thread || arg, note = drafts.get(thread);
        if (!note) throw new Error('没有可取消的批注草稿。');
        drafts.delete(thread);
        if (threadContexts.has(thread)) {
            thread.canReply = false;
            thread.contextValue = 'localLatexInlineCard';
            thread.label = cardTitle(records.get(note.c.id).data, note.c.id);
        } else thread.dispose();
    }
    async function post(reply) {
        if (!reply?.text?.trim()) throw new Error('请填写返修要求。');
        const note = drafts.get(reply.thread);
        if (!note) throw new Error('请用原文右键的“批注选中文字”入口创建批注。');
        const data = await current(note.c);
        const saved = await backend(note.c, ['feedback'], {id: note.c.id, version: note.c.version, side: note.side,
            start: note.start, end: note.end, quote: note.quote, text: reply.text}, data.sha256);
        drafts.delete(reply.thread);
        ownerAfterWrite = saved.owner_text;
        const previous = records.get(note.c.id);
        const record = {...previous, data: {...saved.card, source: saved.card.source || previous.data.source}};
        records.set(note.c.id, record);
        renderCard(reply.thread, record, previous, false, threadMembers.get(reply.thread));
        // Feedback changes only the embedded state. Rebase cached owner offsets
        // across that header's size change, without rereading/repainting its peers.
        const offsets = new Map(), newLength = Array.from(saved.owner_text).length;
        for (const [id, peer] of records) {
            const source = peer.data.source;
            if (peer.data.edit.file !== note.c.owner || source.text === saved.owner_text) continue;
            if (!offsets.has(source.text)) {
                const end = /^% CODEX-REVIEW-STATE-END\r?$/m.exec(source.text);
                offsets.set(source.text, {delta: newLength - Array.from(source.text).length,
                    boundary: Array.from(source.text.slice(0, end.index + end[0].length)).length});
            }
            const {delta, boundary} = offsets.get(source.text), shift = source.start >= boundary ? delta : 0;
            records.set(id, {...peer, data: {...peer.data, source: {...source, text: saved.owner_text, start: source.start + shift, end: source.end + shift}}});
        }
        vscode.window.showInformationMessage(`${note.c.id} 批注已保存，原文和编号保留；尚未发送给 Codex。`);
        if (!saved.card.source_match) vscode.window.showWarningMessage('批注已保存，但原文随后发生变化；请核对并刷新，不会猜测重新定位。');
    }
    async function preview(arg) {
        const c = contextFor(arg), data = await current(c), cfg = config();
        let document = path.join(c.repo, data.edit.file);
        if (!/^\s*\\documentclass\b/m.test(data.source.text)) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(c.repo, '**/*.tex'), '**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**');
            const roots = [];
            for (const file of files) if (/^\s*\\documentclass\b/m.test(await fs.readFile(file.fsPath, 'utf8'))) roots.push({label: path.relative(c.repo, file.fsPath), file: file.fsPath});
            const picked = roots.length === 1 ? roots[0] : await vscode.window.showQuickPick(roots, {placeHolder: '选择该段落实际所属的可编译主文档'});
            if (!picked) return;
            document = picked.file;
        }
        await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: '生成完整论文的句子级审核 PDF（新窗口）'}, async () => {
            const result = JSON.parse(await execute(cfg.get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_pdf.py'),
                '--repo', c.repo, '--state', c.owner, '--document', document, '--id', c.id, '--version', c.version,
                '--git', cfg.get('gitPath', 'git'), '--latexdiff', cfg.get('latexdiffPath'), '--latexmk', cfg.get('latexmkPath')], c.repo));
            await current(c);
            if (result.navigation) {
                const saved = {...context.workspaceState?.get('reviewPDFMeta', {})};
                for (const [key, file] of Object.entries(saved)) if (file === result.navigation) delete saved[key];
                for (const [key, file] of pdfMetadata) if (file === result.navigation) pdfMetadata.delete(key);
                for (const id of result.shown_ids || [c.id]) {
                    const key = c.repo + '|' + id;
                    pdfMetadata.set(key, result.navigation); saved[key] = result.navigation;
                }
                if (context.workspaceState) await context.workspaceState.update('reviewPDFMeta', saved);
            }
            // Same supported launcher as VS Code's own code.cmd; avoid shell quoting
            // and keep the source window intact. Existing PDF associations select Workshop.
            const opened = openedPDFs.has(result.pdf) || context.workspaceState?.get('reviewPDFs', []).includes(result.pdf);
            if (!opened) {
                await execute(process.execPath, [path.join(vscode.env.appRoot, 'out', 'cli.js'), '--new-window', result.pdf],
                    c.repo, undefined, {ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: ''});
                openedPDFs.add(result.pdf);
                if (context.workspaceState) await context.workspaceState.update('reviewPDFs', [...new Set([...context.workspaceState.get('reviewPDFs', []), result.pdf])]);
            } else vscode.window.showInformationMessage('已更新同一份审核 PDF；现有预览窗口会重新加载。窗口已关闭时，可用“重新打开审核 PDF 窗口”。');
        });
    }
    async function addRequests() {
        const c = await discover(), state = await backend(c, ['feedback-context']);
        const notes = state.items.map(item => `审阅框编号：${item.id}\n文件：${item.file}\n批注基于版本：${item.version}\n当前候选版本：${item.current_version}`
            + `\n【原版完整内容】\n${item.original}\n【修改版完整内容】\n${item.candidate}\n【作者返修批注】\n`
            + item.requests.map(n => `${n.side === 'original' ? '原文' : '候选'}选区：${n.quote}\n返修要求：${n.text}`).join('\n\n'));
        if (!notes.length) return vscode.window.showInformationMessage('没有待处理的批注。');
        if (!(await vscode.commands.getCommands(true)).includes('chatgpt.addFileToThread')) throw new Error('当前 Codex 插件没有可用的添加上下文命令；批注仍保留，未发送。');
        const parent = path.join(c.repo, '.codex-review', 'requests');
        await fs.mkdir(parent, {recursive: true});
        const folder = await fs.mkdtemp(path.join(parent, 'batch-'));
        const file = path.join(folder, '返修批注.txt');
        await fs.writeFile(file, `请读取 ${c.owner} 中最新的唯一审核状态，再处理以下批注。此文件是请求快照，不是状态表。\n保留原文与编号，候选先留在批注卡片；接收后才替换正文，不自动接收。\n\n${notes.join('\n\n')}\n`, 'utf8');
        await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
        vscode.window.showInformationMessage('全部批注已作为上下文加入 Codex 输入区，请检查后自行发送。');
    }
    function command(name, handler, displayOnly = false) {
        context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
            await startup;
            if (busy && !displayOnly) return vscode.window.showWarningMessage('当前审核操作尚未结束。');
            if (!displayOnly) busy = true;
            try { return await handler(...args); } catch (error) { vscode.window.showErrorMessage(error.message); }
            finally { if (!displayOnly) busy = false; }
        }));
    }
    command('localLatex.inlineReview', () => select());
    command('localLatex.inlineReviewAt', c => open(c));
    command('localLatex.inlineNext', arg => select(true, arg), true);
    command('localLatex.inlineSelectCard', showCard, true);
    command('localLatex.inlineAccept', accept);
    command('localLatex.inlineReject', reject);
    command('localLatex.inlineAnnotate', annotate);
    command('localLatex.inlinePostComment', post);
    command('localLatex.inlineCancelComment', cancelComment);
    command('localLatex.inlinePreview', preview);
    command('localLatex.inlineLocatePDF', async arg => {
        const c = contextFor(arg);
        await current(c);
        const key = c.repo + '|' + c.id;
        const meta = pdfMetadata.get(key) || context.workspaceState?.get('reviewPDFMeta', {})[key];
        if (!meta) throw new Error('尚无该文件的审核 PDF，请先用生成／更新按钮打开。');
        await require('./pdf_navigation').locate(vscode, context, meta, c);
    });
    command('localLatex.inlineReopenPreview', async () => {
        const files = [...new Set([...openedPDFs, ...(context.workspaceState?.get('reviewPDFs', []) || [])])];
        if (!files.length) throw new Error('尚未生成审核 PDF，请先使用生成／更新按钮。');
        const file = files.length === 1 ? files[0] : await vscode.window.showQuickPick(files, {placeHolder: '重新打开已生成的审核 PDF（不编译）'});
        if (!file) return;
        await fs.access(file);
        await execute(process.execPath, [path.join(vscode.env.appRoot, 'out', 'cli.js'), '--new-window', file], path.dirname(file),
            undefined, {ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: ''});
    });
    command('localLatex.inlineAddRequests', addRequests);
    command('localLatex.inlineToggleSource', async c => {
        const selected = contextFor(c);
        const record = records.get(selected.id), thread = cards.get(selected.id);
        if (!record || !thread) throw new Error('该卡片已更新，请重新打开。');
        const key = sourceKey(selected);
        if (expandedSources.has(key)) expandedSources.delete(key); else expandedSources.add(key);
        thread.comments = [{...thread.comments[0], body: cardBody(record.data, selected.id, record.c)}, ...thread.comments.slice(1)];
    }, true);
    command('localLatex.inlineQuestions', async c => {
        const selected = contextFor(c), record = records.get(selected.id), thread = cards.get(selected.id);
        if (!record || !thread) throw new Error('请先打开对应的原文审核卡片。');
        if (!record.data.edit.questions?.length) {
            require('./questions').notifyProblem(vscode, '该候选尚未关联原始问题；请由论文会话读取原始意见后明确补充。')
                .catch(error => vscode.window.showErrorMessage(error.message));
            return;
        }
        const key = sourceKey(selected);
        if (expandedQuestions.has(key)) expandedQuestions.delete(key); else expandedQuestions.add(key);
        thread.comments = [{...thread.comments[0], body: cardBody(record.data, selected.id, record.c)}, ...thread.comments.slice(1)];
    }, true);
    // Retired compatibility alias; use localLatex.inlineReview.
    // command('localLatex.reviewChanges', () => select());
    context.subscriptions.push(vscode.window.registerUriHandler({async handleUri(resource) {
        try {
            if (resource.path === '/review-pdf') return await require('./pdf_navigation').handleUri(vscode, resource);
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
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse || event.textEditor !== vscode.window.activeTextEditor) return;
        const record = sourceRecord(event.textEditor), thread = record && cards.get(record.c.id);
        if (thread && threadMembers.get(thread).length > 1 && !drafts.has(thread) && threadContexts.get(thread).id !== record.c.id) showCard(record.c);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme !== 'file') return;
        if (!activeScope) {
            if (!event.document.isDirty && event.document.languageId === 'latex')
                startup = startup.then(() => enableReview()).catch(error => vscode.window.showErrorMessage(error.message));
            return;
        }
        if (sameFile(event.document.uri.fsPath, path.join(activeScope.repo, activeScope.owner)) && event.document.getText() === ownerAfterWrite) return;
        const relevant = sameFile(event.document.uri.fsPath, path.join(activeScope.repo, activeScope.owner))
            || [...records.values()].some(r => sameFile(event.document.uri.fsPath, path.join(r.c.repo, r.data.edit.file)));
        if (!relevant) return;
        if (event.document.isDirty) {decorate(); return;}
        if (!busy) refresh(activeScope).catch(error => vscode.window.showErrorMessage(error.message));
    }));
    startup = enableReview().catch(error => {vscode.window.showErrorMessage(error.message);});
    return {open, refresh, accept, reject, annotate, post, preview, addRequests, controller, records, ready: startup};
}
function activate(context) { return createInlineReview(require('vscode'), context); }
module.exports = {activate, createInlineReview, markedWords, displayText, summary, deletionPreview};
