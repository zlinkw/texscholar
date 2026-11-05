'use strict';
// Original-file comment cards. Durable proposals/decisions stay in source_review.py.
const path = require('node:path');
const fs = require('node:fs/promises');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const positions = require('./review_positions');
const reviewStyle = require('./review_style');
const OPEN = new Set(['pending', 'rework']);
const EXCLUDE = '**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**';
const TRANSLATORS = {google: 'Google', bing: 'Bing', deepl: 'DeepL 网页版', transmart: '腾讯 TranSmart'};

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
    const cards = new Map(), records = new Map(), drafts = new WeakMap(), threadContexts = new WeakMap(), threadMembers = new WeakMap(), expandedSources = new Set();
    const controller = vscode.comments.createCommentController('localLatexInlineReview', '原文内修订审核');
    const style = () => reviewStyle.read(vscode.workspace.getConfiguration('localLatex'));
    let deleted = vscode.window.createTextEditorDecorationType({color: style().removedColor, textDecoration: style().strikeDeleted ? 'line-through' : 'none'});
    let activeScope, busy = false, startup = Promise.resolve(), ownerAfterWrite, batch;
    let watchedScope, watcher, autoRefresh, renderedOwnerHash, refreshChain = Promise.resolve();
    const changedFiles = new Set(), reviewFiles = new Set(), deferredFiles = new Set();
    const shownPanels = new Set(), openedPDFs = new Set(), collapsedQuestions = new Set(), pdfMetadata = new Map(), translations = new Map();
    const pendingPDFUpdates = new Map();
    let pdfChain = Promise.resolve(), automaticPDFRun;
    context.subscriptions.push(controller, deleted);
    controller.options = {prompt: '填写返修要求（默认针对整项原文，也可选中文字）', placeHolder: '保存后可一键把全部批注加入 Codex；不会自动发送。'};
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
        const data = await backend(c, ['inspect', '--id', c.id, '--source']);
        if (!OPEN.has(data.edit.status) || data.edit.versions.at(-1) !== c.version) {
            await refresh(c);
            throw new Error('该项已有新版或审核决定，显示已自动更新。请核对后再次操作；未代为接收或覆盖。');
        }
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
        return label(data, id) + (members.length > 1 ? ' · 本行：' + members.join('、') : '')
            + (style().showLegend ? ' ｜ − 删除/替换 · ＋ 新增/改写 · ＝ 未改' : '');
    };
    function translationInput(c, data) {
        const provider = config().get('translation.provider', 'google');
        if (!TRANSLATORS[provider]) throw new Error('请在设置中选择可用的翻译来源。');
        const items = [{key: 'original', text: displayText(data.original)},
            {key: 'candidate', text: displayText(data.candidate) || deletionPreview(data)},
            ...(data.edit.questions || []).map((q, i) => ({key: 'question' + i, text: displayText(q.quote)}))].filter(item => item.text);
        return {provider, items, signature: JSON.stringify([c.version, provider, items])};
    }
    function translationState(c, data) {
        const entry = translations.get(sourceKey(c));
        return entry?.signature === translationInput(c, data).signature ? entry : undefined;
    }
    function redrawCard(c) {
        const thread = cards.get(c.id), record = records.get(c.id);
        if (thread && record && threadContexts.get(thread)?.id === c.id)
            thread.comments = [{...thread.comments[0], body: cardBody(record.data, c.id, record.c)}, ...thread.comments.slice(1)];
    }
    async function translateCard(arg) {
        const c = contextFor(arg), record = records.get(c.id);
        if (!record) throw new Error('该项已更新或处理，请查看当前卡片。');
        trusted(c);
        if (!sameFile(c.repo, record.c.repo) || c.owner !== record.c.owner || c.version !== record.c.version)
            throw new Error('该翻译入口来自旧版本或其他项目，请核对当前卡片。');
        const input = translationInput(c, record.data), key = sourceKey(c);
        let entry = translationState(c, record.data);
        if (entry?.loading) return entry.promise;
        if (entry && !Object.keys(entry.errors).length) {
            entry.expanded = !entry.expanded; redrawCard(c); return;
        }
        if (arg?.hideTranslation && entry) {entry.expanded = false; redrawCard(c); return;}
        entry ||= {c, signature: input.signature, results: {}, errors: {}, expanded: true};
        entry.expanded = true; entry.loading = true; entry.errors = {};
        translations.set(key, entry); redrawCard(c);
        const items = input.items.filter(item => !(item.key in entry.results));
        const http = vscode.workspace.getConfiguration('http');
        const proxy = http.get('proxySupport') === 'off' ? '' : http.get('proxy') || null;
        entry.promise = (async () => {
            try {
                const result = JSON.parse(await execute(config().get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_translate.py')], c.repo,
                    {provider: input.provider, proxy, items}));
                Object.assign(entry.results, result.results); entry.errors = result.errors;
            } catch (error) {entry.errors = Object.fromEntries(items.map(item => [item.key, error.message]));}
            finally {
                entry.loading = false;
                if (translations.get(key) === entry && records.has(c.id)
                    && translationInput(c, records.get(c.id).data).signature === entry.signature) redrawCard(c);
            }
        })();
        return entry.promise;
    }
    function cardBody(data, id, c) {
        const appearance = style();
        const translation = translationState(c, data), provider = translationInput(c, data).provider;
        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = false;
        const enabledCommands = [];
        enabledCommands.push('localLatex.inlineTranslate', 'localLatex.inlineTranslationSource');
        const translationAction = translation?.loading ? '正在翻译…' : translation && Object.keys(translation.errors).length ? '重试未完成翻译'
            : translation ? translation.expanded ? '收起中文' : '展开中文' : '翻译本条为中文';
        let translationLinks = `[${translationAction}（${TRANSLATORS[provider]}）](command:localLatex.inlineTranslate?${encodeURIComponent(JSON.stringify([c]))})`;
        if (translation?.expanded && Object.keys(translation.errors).length)
            translationLinks += ` · [收起中文](command:localLatex.inlineTranslate?${encodeURIComponent(JSON.stringify([{...c, hideTranslation: true}]))})`;
        translationLinks += ` · [切换翻译源](command:localLatex.inlineTranslationSource?${encodeURIComponent(JSON.stringify([c]))})`;
        const chinese = key => {
            if (!translation?.expanded) return '';
            const value = translation.results[key], error = translation.errors[key];
            // Remote text is literal display data, never Markdown commands.
            const literal = text => wrapHtml(text).replace(/[\[\]()*_`]/g, char => '&#' + char.charCodeAt(0) + ';');
            if (value !== undefined) return '<br><strong>中文：</strong>' + literal(value);
            if (error) return '<br><strong>翻译未完成：</strong>' + literal(error);
            return translation.loading ? '<br>中文：正在翻译…' : '';
        };
        const members = threadMembers.get(cards.get(id)) || [];
        if (members.length > 1) {
            enabledCommands.push('localLatex.inlineSelectCard');
            markdown.appendMarkdown('选择本行编号：' + members.map(member => member === id ? `**${member}**`
                : `[${member}](command:localLatex.inlineSelectCard?${encodeURIComponent(JSON.stringify([records.get(member).c]))})`).join(' · ') + '\n\n');
        }
        if (!data.edit.deferred) markdown.appendMarkdown('旧式记录：候选此前已在源码中；本工具不会静默撤回。\n\n');
        const old = displayText(data.original) ? markedWords(data, 'original', appearance).trim() : '仅补充，无对应原句。';
        const proposed = displayText(data.candidate) ? markedWords(data, 'candidate', appearance).trim()
            : `本句／本项已删除。删除后衔接（仅预览）：<br>${wrapHtml(deletionPreview(data))}`;
        const between = appearance.cardLayout === 'compact' ? '<br>' : '</div>\n\n<div>';
        markdown.appendMarkdown(`<div><strong>原文：</strong> ${old}${chinese('original')}${between}<strong>候选：</strong> ${proposed}${chinese('candidate')}</div>\n`);
        markdown.appendMarkdown('\n\n' + translationLinks);
        if (data.edit.questions?.length) {
            enabledCommands.push('localLatex.inlineQuestions', 'localLatex.jumpQuestion', 'localLatex.inlineRelatedChanges');
            const toggle = encodeURIComponent(JSON.stringify([c]));
            markdown.appendMarkdown(`\n\n[关联问题 ${data.edit.questions.map(q => escapeHtml(q.id)).join('、')}（${collapsedQuestions.has(sourceKey(c)) ? '展开' : '收起'}原始意见）](command:localLatex.inlineQuestions?${toggle})`);
            markdown.appendMarkdown(` · [查看这些问题的全部改动](command:localLatex.inlineRelatedChanges?${toggle})`);
            if (!collapsedQuestions.has(sourceKey(c))) for (const [index, q] of data.edit.questions.entries()) {
                const target = encodeURIComponent(JSON.stringify([{repo: c.repo, question: q}]));
                markdown.appendMarkdown(`\n\n<div><strong>${escapeHtml(q.id)}：</strong>${wrapHtml(q.quote)}${chinese('question' + index)}</div>\n\n`
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
            && previous.data.edit.location === data.edit.location
            && JSON.stringify(previous.data.edit.questions) === JSON.stringify(data.edit.questions)
            && JSON.stringify(previousMembers) === JSON.stringify(threadMembers.get(thread))
            && (displayText(data.candidate) || deletionPreview(previous.data) === deletionPreview(data));
        const comments = [sameBody ? thread.comments[0]
            : {body: cardBody(data, c.id, c), mode: vscode.CommentMode.Preview,
                author: {name: `${c.id} · ${data.edit.location || data.edit.file}`}}];
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
    function refresh(c, explicitPanel = false, focus = false) {
        const task = refreshChain.then(() => renderRefresh(c, explicitPanel, focus));
        // Recover the sequencing tail only; the caller still receives failures.
        refreshChain = task.catch(() => {});
        return task;
    }
    async function renderRefresh(c, explicitPanel = false, focus = false) {
        watchScope(c);
        const state = await backend(c, ['cards']);
        reviewFiles.clear(); deferredFiles.clear();
        for (const edit of Object.values(state.edits)) if (OPEN.has(edit.status)) reviewFiles.add(path.join(c.repo, edit.file));
        if (batch && batch !== state.session) {
            expandedSources.clear(); collapsedQuestions.clear(); pdfMetadata.clear(); translations.clear();
            for (const thread of new Set(cards.values())) {drafts.delete(thread); thread.dispose();}
            cards.clear(); records.clear();
        }
        batch = state.session;
        const documents = new Map();
        const previous = new Map(), writing = new Map(), available = new Map();
        const oldCards = new Map(cards), oldRecords = new Map(records), oldThreads = new Set(cards.values());
        const blocked = new Set();
        for (const [file, text] of Object.entries(state.sources)) {
            const doc = await vscode.workspace.openTextDocument(uri(c, file));
            documents.set(file, doc);
            if (doc.isDirty || doc.getText() !== text) {blocked.add(file); deferredFiles.add(path.join(c.repo, file));}
        }
        for (const thread of new Set(cards.values())) {
            const selected = threadContexts.get(thread); let record = records.get(selected.id);
            previous.set(lineKey(record), selected.id);
            const replacement = state.cards[selected.id];
            if (drafts.has(thread) && state.edits[selected.id] && OPEN.has(state.edits[selected.id].status) && (!replacement || replacement.version === selected.version)) {
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
        reconcileThreads(c, {oldCards, oldRecords, oldThreads, previous, available, writing}, focus);
        for (const [key, entry] of translations) {
            const record = records.get(entry.c.id);
            if (!record || translationInput(record.c, record.data).signature !== entry.signature) translations.delete(key);
        }
        renderedOwnerHash = state.sha256;
        candidatePanel.sync(new Map([...records].filter(([, r]) => !r.displayConflict)), c);
        decorate();
        await setContext();
        await showPanel(c.repo, explicitPanel);
    }
    function reconcileThreads(c, prior, focus = false, resetFile) {
        const {oldCards, oldRecords, oldThreads, previous, available, writing} = prior;
        const groups = new Map();
        for (const record of records.values()) {
            if (record.displayConflict) continue;
            const key = lineKey(record);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        }
        const used = new Set();
        for (const [key, members] of groups) {
            const draft = writing.get(key);
            const record = draft?.record || (focus && members.find(r => r.c.id === c.id))
                || members.find(r => r.c.id === previous.get(key))
                || members.find(r => threadContexts.get(oldCards.get(r.c.id))?.id === r.c.id) || members[0];
            let thread = draft?.thread || available.get(key);
            if (!thread || used.has(thread)) thread = members.map(r => oldCards.get(r.c.id)).find(t => t && oldThreads.has(t) && !used.has(t));
            const old = thread && oldRecords.get(threadContexts.get(thread).id);
            const oldMembers = thread ? threadMembers.get(thread) : [];
            if (!thread) thread = controller.createCommentThread(uri(record.c, record.data.edit.file), record.range, []);
            used.add(thread);
            threadMembers.set(thread, members.map(r => r.c.id));
            for (const member of members) cards.set(member.c.id, thread);
            // Whole-buffer edits can move native tracked decorations even when
            // the extension's cached Range compares equal. Rebind via the public
            // file-comment position, preserving the thread and its draft/body.
            if (resetFile && sameFile(resetFile, thread.uri.fsPath)) thread.range = undefined;
            renderCard(thread, record, old, !!draft, oldMembers);
            if (!draft && !old) {
                thread.collapsibleState = record.c.id === c.id ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
            } else if (focus && record.c.id === c.id) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }
        for (const thread of oldThreads) if (!used.has(thread)) {
            const selected = threadContexts.get(thread), record = records.get(selected.id);
            if (drafts.has(thread) && record?.displayConflict) {
                thread.range = undefined;
                thread.label = `${selected.id} · 原文位置待核对，批注草稿仍保留`;
                cards.set(selected.id, thread);
            } else thread.dispose();
        }
    }
    function relocateDocument(document) {
        const text = document.getText(), currentView = positions.view(text), oldViews = new Map();
        const prior = {oldCards: new Map(cards), oldRecords: new Map(records), oldThreads: new Set(cards.values()), previous: new Map(), available: new Map(), writing: new Map()};
        let affected = false;
        for (const [id, record] of records) {
            if (!sameFile(document.uri.fsPath, path.join(record.c.repo, record.data.edit.file))) continue;
            affected = true;
            if (!oldViews.has(record.data.source.text)) oldViews.set(record.data.source.text, positions.view(record.data.source.text));
            const span = positions.locateDisplay(record.data, currentView, oldViews.get(record.data.source.text));
            if (!span) {records.set(id, {...record, displayConflict: true}); continue;}
            const source = {...record.data.source, text, start: Array.from(text.slice(0, span.start)).length, end: Array.from(text.slice(0, span.end)).length};
            records.set(id, {...record, displayConflict: false, data: {...record.data, source}, range: new vscode.Range(document.positionAt(span.start), document.positionAt(span.end))});
        }
        if (!affected) return;
        if (document.isDirty) deferredFiles.add(document.uri.fsPath);
        for (const thread of prior.oldThreads) {
            const selected = threadContexts.get(thread), record = records.get(selected.id);
            if (!record || record.displayConflict) continue;
            prior.previous.set(lineKey(record), selected.id);
            prior.available.set(lineKey(record), thread);
            if (drafts.has(thread)) prior.writing.set(lineKey(record), {thread, record});
        }
        cards.clear();
        reconcileThreads(watchedScope, prior, false, document.uri.fsPath);
        candidatePanel.sync(new Map([...records].filter(([, r]) => !r.displayConflict)), watchedScope);
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
    async function open(c) {
        const draft = drafts.get(cards.get(c.id));
        if (draft && draft.c.id !== c.id) throw new Error('请先保存或取消当前批注草稿，再切换同行候选；草稿仍保留。');
        // Opening is read-only. Reuse the watcher packet when its exact disk
        // inputs still match; mutations keep their independent current() checks.
        await refreshChain;
        let record = records.get(c.id);
        if (record && sameFile(record.c.repo, c.repo) && record.c.owner === c.owner && record.data.edit.deferred) {
            trusted(c);
            if (await changedSinceRender([path.join(c.repo, c.owner), path.join(c.repo, record.data.edit.file)])) {
                await refresh(c);
                record = records.get(c.id);
            }
            if (!record || record.displayConflict) throw new Error('该项已处理或原文发生冲突，请核对最新审核内容。');
            showCard(record.c);
            const editor = await vscode.window.showTextDocument(uri(record.c, record.data.edit.file), {viewColumn: vscode.ViewColumn.One, preview: false});
            editor.selection = new vscode.Selection(record.range.start, record.range.start);
            editor.revealRange(record.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            return;
        }
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
        const choices = orderedRecords();
        if (!choices.length) return vscode.window.showInformationMessage('没有待审修改。');
        const from = arg ? contextFor(arg) : activeScope;
        const index = choices.findIndex(r => r.c.id === from?.id);
        const picked = choices[(index + 1) % choices.length];
        showCard(picked.c);
        const editor = await vscode.window.showTextDocument(uri(picked.c, picked.data.edit.file), {preview: false});
        editor.selection = new vscode.Selection(picked.range.start, picked.range.start);
        editor.revealRange(picked.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    function orderedRecords() {
        return [...records.values()].sort((a, b) => {
            const x = a.c.id, y = b.c.id, numericX = /^\d/.test(x), numericY = /^\d/.test(y);
            return numericX !== numericY ? (numericX ? -1 : 1) : x.length - y.length || x.localeCompare(y);
        });
    }
    async function accept(arg) {
        const c = contextFor(arg), data = await current(c);
        const navigation = pdfMetadata.get(c.repo + '|' + c.id) || context.workspaceState?.get('reviewPDFMeta', {})[c.repo + '|' + c.id];
        const ordered = orderedRecords(), index = ordered.findIndex(record => record.c.id === c.id);
        const following = ordered.slice(index + 1).map(record => record.c.id);
        await backend(c, ['decide', '--accept', c.id, '--version', c.version], undefined, data.sha256);
        await refresh(c);
        const next = following.map(id => records.get(id)).find(Boolean);
        if (next) {
            const editor = await vscode.window.showTextDocument(uri(next.c, next.data.edit.file), {viewColumn: vscode.ViewColumn.One, preview: false});
            editor.selection = new vscode.Selection(next.range.start, next.range.start);
            editor.revealRange(next.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            showCard(next.c);
        }
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
        const side = data.original.trim() ? 'original' : 'candidate', excerpt = data[side];
        let note = {c, side, start: 0, end: Array.from(excerpt).length, quote: excerpt};
        const selected = editor && sameFile(editor.document.uri.fsPath, path.join(c.repo, data.edit.file)) && !editor.selection.isEmpty;
        if (selected) {
            const at = editor.selection;
            const start = Array.from(editor.document.getText().slice(0, editor.document.offsetAt(at.start))).length - data.source.start;
            const end = Array.from(editor.document.getText().slice(0, editor.document.offsetAt(at.end))).length - data.source.start;
            if (start >= 0 && start < end && end <= Array.from(data[data.source.side]).length) note = {c, side: data.source.side, start, end, quote: editor.document.getText(at)};
            else if (!threadContexts.has(arg?.thread || arg) && !arg?.repo) throw new Error('请选择该编号原文范围内的文字，或在该卡片内添加整项批注。');
        }
        showCard(c);
        const thread = cards.get(c.id);
        thread.contextValue = 'localLatexInlineDraft'; thread.canReply = true;
        thread.label = `${c.id} · 保存返修批注`;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        drafts.set(thread, note);
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
        await saveNote(note.c, note, reply.text);
        drafts.delete(reply.thread);
    }
    async function saveNote(c, note, text) {
        const data = await current(c);
        const saved = await backend(c, ['feedback'], {id: c.id, version: c.version, side: note.side,
            start: note.start, end: note.end, quote: note.quote, text}, data.sha256);
        updateSaved(c, saved);
        vscode.window.showInformationMessage(`${c.id} 批注已保存，原文和编号保留；尚未发送给 Codex。`);
        if (!saved.card.source_match) vscode.window.showWarningMessage('批注已保存，但原文随后发生变化；请核对并刷新，不会猜测重新定位。');
    }
    function updateSaved(c, saved) {
        ownerAfterWrite = saved.owner_text;
        const previous = records.get(c.id), thread = cards.get(c.id);
        const record = {...previous, c: {...c, version: saved.card.version}, data: {...saved.card, source: saved.card.source || previous.data.source}};
        records.set(c.id, record);
        drafts.delete(thread);
        renderCard(thread, record, previous, false, threadMembers.get(thread));
        // Feedback changes only the embedded state. Rebase cached owner offsets
        // across that header's size change, without rereading/repainting its peers.
        const offsets = new Map(), newLength = Array.from(saved.owner_text).length;
        for (const [id, peer] of records) {
            const source = peer.data.source;
            if (peer.data.edit.file !== c.owner || source.text === saved.owner_text) continue;
            if (!offsets.has(source.text)) {
                const end = /^% CODEX-REVIEW-STATE-END\r?$/m.exec(source.text);
                offsets.set(source.text, {delta: newLength - Array.from(source.text).length,
                    boundary: Array.from(source.text.slice(0, end.index + end[0].length)).length});
            }
            const {delta, boundary} = offsets.get(source.text), shift = source.start >= boundary ? delta : 0;
            records.set(id, {...peer, data: {...peer.data, source: {...source, text: saved.owner_text, start: source.start + shift, end: source.end + shift}}});
        }
    }
    async function exclusive(action) {
        if (busy) throw new Error('当前审核操作尚未结束。');
        busy = true;
        try {return await action();} finally {busy = false; await flushRefresh();}
    }
    const candidatePanel = require('./candidate_panel').createCandidatePanel(vscode, context, {
        style,
        read: current,
        save: (c, after) => exclusive(async () => {
            const data = await current(c);
            const saved = await backend(c, ['rework', '--id', c.id], {after, discard_annotations: true}, data.sha256);
            updateSaved(c, saved);
            return saved.card;
        }),
        note: (c, selected, text) => exclusive(() => saveNote(c, selected, text)),
        back: async c => {
            await current(c);
            const record = records.get(c.id);
            const editor = await vscode.window.showTextDocument(uri(c, record.data.edit.file), {viewColumn: vscode.ViewColumn.One, preview: false});
            editor.revealRange(record.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            showCard(c);
        }
    });
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
        let document = path.join(c.repo, data.edit.file);
        if (!/^\s*\\documentclass\b/m.test(data.source.text)) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(c.repo, '**/*.tex'), '**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**');
            const roots = [];
            for (const file of files) if (/^\s*\\documentclass\b/m.test(await fs.readFile(file.fsPath, 'utf8'))) roots.push({label: path.relative(c.repo, file.fsPath), file: file.fsPath});
            const picked = roots.length === 1 ? roots[0] : await vscode.window.showQuickPick(roots, {placeHolder: '选择该段落实际所属的可编译主文档'});
            if (!picked) return;
            document = picked.file;
        }
        return serializePDF(() => generatePDF(c, document, false));
    }
    async function generatePDF(c, document, automatic) {
        const cfg = config();
        await vscode.window.withProgress({location: vscode.ProgressLocation.Notification,
            title: automatic ? '接收后更新审核 PDF（后台，不阻塞下一项）' : '生成／更新完整论文审核 PDF'}, async () => {
            const result = JSON.parse(await execute(cfg.get('pythonPath', 'python'), ['-X', 'utf8', path.join(__dirname, 'review_pdf.py'),
                '--repo', c.repo, '--state', c.owner, '--document', document, '--id', c.id, '--version', c.version,
                '--git', cfg.get('gitPath', 'git'), '--latexdiff', cfg.get('latexdiffPath'), '--latexmk', cfg.get('latexmkPath'),
                '--style', JSON.stringify(style()), ...(automatic ? ['--refresh-accepted'] : [])], c.repo));
            if (!automatic) await current(c);
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
            if (!opened && !automatic) {
                await execute(process.execPath, [path.join(vscode.env.appRoot, 'out', 'cli.js'), '--new-window', result.pdf],
                    c.repo, undefined, {ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: ''});
                openedPDFs.add(result.pdf);
                if (context.workspaceState) await context.workspaceState.update('reviewPDFs', [...new Set([...context.workspaceState.get('reviewPDFs', []), result.pdf])]);
            } else if (!automatic) vscode.window.showInformationMessage(result.reused_pdf ? '审核内容未变化，已复用核验后的 PDF，没有重新编译。'
                : '已更新同一份审核 PDF；现有预览窗口会重新加载。窗口已关闭时，可用“重新打开审核 PDF 窗口”。');
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
            finally { if (!displayOnly) {busy = false; await flushRefresh();} }
        }));
    }
    command('localLatex.inlineReview', () => select());
    command('localLatex.inlineReviewAt', c => open(c));
    command('localLatex.inlineNext', arg => select(true, arg), true);
    command('localLatex.inlineSelectCard', showCard, true);
    command('localLatex.inlineAccept', accept);
    command('localLatex.inlineReject', reject);
    command('localLatex.inlineAnnotate', annotate);
    command('localLatex.inlineEditCandidate', arg => candidatePanel.show(contextFor(arg)), true);
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
    command('localLatex.inlineTranslate', translateCard, true);
    command('localLatex.inlineTranslationSource', async arg => {
        const c = contextFor(arg); trusted(c);
        const currentProvider = config().get('translation.provider', 'google');
        const options = Object.entries(TRANSLATORS).map(([provider, label]) => ({provider, label,
            description: (provider === currentProvider ? '当前来源；' : '')
                + (provider === 'google' ? '可能返回 429 限流' : provider === 'bing' ? '匿名请求可能返回 401' : '免密钥网页接口，可能失效')}));
        const chosen = await vscode.window.showQuickPick(options, {placeHolder: '手动切换翻译源；切换本身不发送文字，之后点击翻译'});
        if (chosen && chosen.provider !== currentProvider) {
            const cfg = config(), target = cfg.inspect('translation.provider').workspaceValue === undefined
                ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
            await cfg.update('translation.provider', chosen.provider, target);
        }
    }, true);
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
        if (collapsedQuestions.has(key)) collapsedQuestions.delete(key); else collapsedQuestions.add(key);
        thread.comments = [{...thread.comments[0], body: cardBody(record.data, selected.id, record.c)}, ...thread.comments.slice(1)];
    }, true);
    // Retired compatibility alias; use localLatex.inlineReview.
    // command('localLatex.reviewChanges', () => select());
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
            translations.clear();
            for (const thread of new Set(cards.values())) redrawCard(threadContexts.get(thread));
        }
        if (!event.affectsConfiguration('localLatex.reviewStyle')) return;
        try {
            const appearance = style();
            deleted.dispose();
            deleted = vscode.window.createTextEditorDecorationType({color: appearance.removedColor, textDecoration: appearance.strikeDeleted ? 'line-through' : 'none'});
            context.subscriptions.push(deleted);
            for (const thread of new Set(cards.values())) {
                const c = threadContexts.get(thread), record = records.get(c.id);
                thread.comments = [{...thread.comments[0], body: cardBody(record.data, c.id, c)}, ...thread.comments.slice(1)];
                thread.label = cardTitle(record.data, c.id);
            }
            candidatePanel.updateStyle();
            decorate();
        } catch (error) {vscode.window.showErrorMessage(error.message);}
    }));
    startup = enableReview().catch(error => {vscode.window.showErrorMessage(error.message);});
    return {open, refresh, accept, reject, annotate, post, preview, addRequests, controller, records,
        whenPDFIdle: () => automaticPDFRun || pdfChain, ready: startup};
}
function activate(context) { return createInlineReview(require('vscode'), context); }
module.exports = {activate, createInlineReview, markedWords, displayText, summary, deletionPreview};
