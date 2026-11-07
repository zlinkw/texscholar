'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {selection} = require('./candidate_panel');
const reviewStyle = require('./review_style');

function filterItems(items, filter) {
    const query = filter.query.trim().toLocaleLowerCase(), kind = filter.kind;
    const exactQuestion = /^r\d+-q\d+$/i.test(query);
    return items.filter(i => (!kind || i.kind === kind) && (!filter.notes || i.requests > 0)
        && (exactQuestion ? (i.questions || []).some(q => q.toLocaleLowerCase() === query)
            : [i.id, i.file, i.location, i.summary, ...(i.questions || [])].join(' ').toLocaleLowerCase().includes(query)))
        .sort((a, b) => Number(b.id.toLocaleLowerCase() === query) - Number(a.id.toLocaleLowerCase() === query));
}

function html(nonce, assets = {}) {
    const client = fs.readFileSync(path.join(__dirname, 'review_workbench_client.js'), 'utf8');
    const math = fs.readFileSync(path.join(__dirname, 'review_math.js'), 'utf8');
    const diff = fs.readFileSync(path.join(__dirname, 'vendor', 'diff', 'diff.min.js'), 'utf8');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.source || ''} 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src ${assets.source || "'none'"}; script-src 'nonce-${nonce}'; connect-src 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1">${assets.css ? `<link rel="stylesheet" href="${assets.css}">` : ''}<style nonce="${nonce}">
*{box-sizing:border-box}
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:var(--review-font-size,16px)/var(--review-line-height,1.5) var(--review-font-family,var(--vscode-font-family));--space:.35em;--section-space:.6em;overflow-anchor:none}
body.comfortable{--space:.65em;--section-space:1em}
button,select,input,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));max-width:100%}
button,.more>summary{font:var(--control-font-size,13px)/1.35 var(--vscode-font-family);border-radius:.45em;padding:.25em .55em;margin:0;border:max(1px,.075em) solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;white-space:nowrap}
button:disabled{opacity:.5;cursor:default}button.secondary,.more>summary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
header{position:sticky;top:0;z-index:2;background:var(--vscode-editor-background);padding:.3em .45em;border-bottom:1px solid var(--vscode-panel-border);display:flex;align-items:center;gap:.3em;font-size:var(--control-font-size,13px)}
.navigation,#toolbarExtras,#pdfActions,.optionActions,.dialogHeading,.questionHeading{display:flex;align-items:center;gap:.3em;min-width:0}
.navigation{flex:1;min-width:8em}#progress{overflow:hidden;text-overflow:ellipsis;max-width:24em}#toolbarExtras{flex:none}#pdfActions{gap:.1em}#pdfStatus{font-size:inherit;max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#layout{display:grid;grid-template-columns:minmax(0,1fr)}main{min-width:0;padding:.4em .65em}h3,h4,p{margin:var(--space) 0}h3{font-size:1.05em}h4{font-size:1em}small,#status,#pdfStatus{color:var(--vscode-descriptionForeground)}#pdfError{padding:.3em .65em;font-size:var(--control-font-size,13px)}#pdfError,#status.error,#appearanceStatus.error{color:var(--vscode-errorForeground)}#pageFeedback:empty,#status:empty,#translateStatus:empty,#fewer:empty,.zh:empty{display:none}
section{margin:0 0 var(--section-space)}#options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,24em),1fr));gap:.55em}article{min-width:0;border:1px solid var(--vscode-panel-border);padding:var(--space);border-radius:.3em}article.selected{border-color:var(--vscode-focusBorder)}article.focused{grid-column:1/-1}article.focused>.optionHeading{position:sticky;top:var(--toolbar-height,2.5em);z-index:1;background:var(--vscode-editor-background);padding:.2em 0}article.folded .detail,article.folded .reason{display:none}
.review-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}:is(.review-text,.zh) .old{color:var(--removed);text-decoration:var(--strike)}:is(.review-text,.zh) .new{color:var(--added)}:is(.review-text,.zh) .same{color:var(--unchanged,inherit)}
::highlight(review-location){background:var(--vscode-editor-findMatchHighlightBackground,#e5c07b66);text-decoration:underline}
::highlight(review-selection){background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,inherit)}
.zh{font-size:var(--translation-font-size,15px);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:var(--space);border-left:2px solid var(--vscode-panel-border);padding-left:.5em;color:var(--vscode-descriptionForeground)}
textarea{width:100%;min-height:6em;resize:vertical;padding:.5em;white-space:pre-wrap;overflow-wrap:anywhere}textarea.edit{min-height:11em;font-family:var(--vscode-editor-font-family,monospace)}details{margin:var(--space) 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:var(--space) 0;font:inherit}.question,.note{border-top:1px solid var(--vscode-panel-border);padding:var(--space) 0}.note{font-size:.94em}.questionHeading{justify-content:space-between;flex-wrap:wrap}.questionHeading>div{display:flex;gap:.3em}#scope{overflow-wrap:anywhere}#translateStatus{font-size:.8em}[hidden]{display:none!important}#empty{padding:1em}
.formula{display:inline;vertical-align:baseline}.math-preview{display:inline;vertical-align:baseline;white-space:normal;color:var(--unchanged,inherit);overflow-wrap:normal;word-break:normal}.display-formula{display:block;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:.45em .2em}.display-formula>.math-preview{display:block}.math-preview .katex-display{margin:.3em 0}.math-error{font-size:.8em;color:var(--vscode-descriptionForeground)}
.reviewHeading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.4em}.comparisonControl{font-size:var(--control-font-size,13px)}.draftLabel{display:block;font-size:.85em;color:var(--vscode-descriptionForeground)}#rankingNotice{display:block;margin-bottom:.4em;color:var(--vscode-descriptionForeground)}.optionHeading{display:flex;align-items:center;justify-content:space-between;gap:.3em;flex-wrap:wrap}.optionHeading h4{white-space:nowrap;margin:0}.optionActions{flex-wrap:wrap;margin-left:auto}.tradeoff,.scopeSummary,.intent{font-size:.85em;overflow-wrap:anywhere;margin:.2em 0}.scopeSummary{color:var(--vscode-descriptionForeground)}.reason{font-size:.85em;margin:var(--space) 0}.reason summary{cursor:pointer;color:var(--vscode-descriptionForeground)}
.more{position:relative;display:inline-block;margin:0}.more summary{list-style:none}.more summary::-webkit-details-marker{display:none}.more>.menu{position:absolute;right:0;top:100%;z-index:10;min-width:17em;max-width:calc(100vw - 1em);max-height:65vh;overflow-y:auto;padding:.5em;border:1px solid var(--vscode-panel-border);border-radius:.45em;background:var(--vscode-editor-background);box-shadow:0 3px 12px #0003;display:flex;flex-direction:column;gap:.3em;font-size:var(--control-font-size,13px)}.more>.menu button{text-align:left;white-space:normal}.more>.menu label{padding:.3em}#overflowActions:empty{display:none}#overflowActions{display:flex;flex-direction:column;gap:.3em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:.4em}
dialog{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-panel-border);border-radius:.5em;padding:.8em;width:min(38em,calc(100vw - 1em));max-height:85vh;overflow:auto;font-size:var(--control-font-size,13px)}dialog::backdrop{background:#0005}.dialogHeading{justify-content:space-between;margin-bottom:.7em}.appearanceFields{display:grid;grid-template-columns:1fr 1fr;gap:.6em}.appearanceFields label{display:flex;flex-direction:column;gap:.2em}.appearanceFields label:first-child{grid-column:1/-1}.appearanceFields input,.appearanceFields select{width:100%;padding:.3em}dialog small{display:block;margin:.7em 0}.directoryCurrent{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}#pageFeedback{position:sticky;top:var(--toolbar-height,2.5em);z-index:2;background:var(--vscode-editor-background);padding:0 .65em;font-size:var(--control-font-size,13px)}#status{overflow-wrap:anywhere}#status.error{color:var(--vscode-errorForeground)}.directoryFilters{display:flex;gap:.4em;flex-wrap:wrap;margin-bottom:.5em}#directoryQuery{flex:1;min-width:10em}.directoryFilters input,.directoryFilters select{padding:.3em}#directoryResults{display:flex;flex-direction:column;gap:.2em}#directoryResults button{text-align:left;white-space:normal}.note.editing>.review-text,.note.editing>details,.note.editing>button{display:none}.noteQuote{white-space:pre-wrap!important;overflow-wrap:anywhere;text-align:left;max-width:100%}#noteComposer{margin:var(--space) 0}#noteComposer button{margin:.2em .2em .2em 0}
</style></head><body>
<header><div class="navigation"><button data-action="previous" class="secondary" title="上一审核项（Alt+←）" aria-label="上一审核项">‹</button><button data-action="next" class="secondary" title="下一审核项（Alt+→）" aria-label="下一审核项">›</button><button id="progress" data-action="directory" class="secondary" title="按编号、位置、文件或关联问题查找（Alt+F）">审核项</button><button id="backRelated" data-action="backRelated" class="secondary" hidden>返回原审核项</button></div><div id="toolbarExtras"><button id="sourceLocation" data-action="source" class="secondary" title="打开当前审核项的真实源文件并定位到原文；不保存、不接收、不编译">定位源文件</button><button data-action="mathMode" class="secondary" id="mathMode" aria-pressed="false" title="切换审核页公式预览／完整 LaTeX 源码，不保存、不编译">LaTeX 源码</button><div id="pdfActions" role="group" aria-label="审核 PDF"><button data-action="reopen" title="打开已有审核 PDF 窗口，不编译">打开 PDF</button><button data-action="locate" title="定位到当前审核项">定位</button><button data-action="pdf" title="更新完整审核 PDF">更新</button></div><span id="pdfStatus" role="status">PDF 未核对</span></div><button data-action="handoff" title="把全部待处理批注加入 Codex 输入区，不自动发送">批注 → Codex</button><details class="more"><summary>更多</summary><div class="menu" id="mainMenu"><div id="overflowActions"></div><button data-action="appearance">外观设置</button><button id="configuration" data-action="configuration" class="secondary">检查配置</button><button data-action="start">AI 论文助手</button><button data-action="checkUpdates" title="立即检查 GitHub 正式版，发现新版后可下载并安装">检查插件更新</button><button data-action="translate">翻译／重试当前项</button><button data-action="provider">切换翻译来源</button><button data-action="toggleChinese">显示／收起中文</button><label><input type="checkbox" id="compare">PDF 对比本项全部方案</label><button data-action="finish">Git 备份已接收修改</button></div></details></header><div id="pdfError" role="alert" hidden></div><div id="pageFeedback"></div>
<dialog id="appearanceDialog" aria-labelledby="appearanceTitle"><form method="dialog"><div class="dialogHeading"><strong id="appearanceTitle">审核页外观</strong><button aria-label="关闭外观设置" class="secondary">关闭</button></div></form><div class="appearanceFields"><label>阅读字体<input id="style-fontFamily" data-style="fontFamily" placeholder="留空跟随 VS Code；如 Microsoft YaHei, sans-serif"></label><label>阅读字号<input type="number" id="style-candidateFontSize" data-style="candidateFontSize" min="10" max="32" step="1"></label><label>文字行高<input type="number" id="style-candidateLineHeight" data-style="candidateLineHeight" min="1" max="2.5" step="0.1"></label><label>按钮字号<input type="number" id="style-controlFontSize" data-style="controlFontSize" min="10" max="24" step="1"></label><label>中文字号<input type="number" id="style-translationFontSize" data-style="translationFontSize" min="10" max="32" step="1"></label><label>内容间距<select id="style-cardLayout" data-style="cardLayout"><option value="compact">紧凑</option><option value="comfortable">宽松</option></select></label></div><small>更改后即时生效并保存。仅影响审核页，不修改论文、PDF 字号或全局 SKILL。源码编辑保持等宽字体。</small><div><button data-action="resetAppearance" class="secondary">恢复默认外观</button><span id="appearanceStatus" role="status"></span></div></dialog>
<dialog id="directoryDialog" aria-labelledby="directoryTitle"><form method="dialog"><div class="dialogHeading"><strong id="directoryTitle">跳转审核项</strong><button class="secondary">关闭</button></div></form><div class="directoryFilters"><input id="directoryQuery" aria-describedby="directoryHint" aria-label="搜索审核项" placeholder="编号、位置、文件、R1-Q3…"><select id="directoryKind" aria-label="筛选文档"><option value="">全部文档</option><option value="manuscript">正文</option><option value="response">回复信</option></select><label><input id="directoryNotes" type="checkbox">有待处理批注</label></div><button data-action="clearFilter" class="secondary">清除筛选</button><small>上一项、下一项及接收后跳转遵循此筛选。</small><small id="directoryHint" role="status" aria-live="polite"></small><div id="directoryResults"></div></dialog>
<div id="layout"><main><div id="empty" hidden>当前没有可显示的审核项；可通过顶部编号目录清除筛选、选择其他项目，或用“Git 备份已接收修改”备份成果。</div><div id="review"><div class="reviewHeading"><h3 id="title"></h3><div class="optionActions"><button data-action="previousChange" class="secondary" title="定位当前可见内容中的上一处实际差异">上处差异</button><button data-action="nextChange" class="secondary" title="定位当前可见内容中的下一处实际差异">下处差异</button><label class="comparisonControl">对照 <select id="comparisonChoice" aria-label="审核页对照方式"><option value="original">原文对照</option></select></label></div></div><small id="rankingNotice" hidden></small><p id="comparisonNotice" class="scopeSummary" hidden></p>
<p id="intent" class="intent" hidden></p><section><h4>原文</h4><div id="original" class="review-text" data-side="original"></div><div id="originalZh" class="zh"></div></section>
<div id="translateStatus"></div>
<section id="options"></section><div id="composerDock"></div><p id="fewer"></p><section><h4>关联原始审稿问题</h4><div id="questions"></div></section>
<section><h4>返修批注</h4><button data-action="newNote" title="新增返修批注（Alt+N）" class="secondary">新增返修批注</button><button data-action="reject" data-write class="secondary">拒绝本项全部候选</button><div id="noteComposer" hidden><p id="noteMode">新增返修批注</p><div id="noteScopeControls"><label>范围 <select id="scopeChoice"><option value="group">本项全部方案（默认）</option><option value="original">完整原文</option></select></label><button data-action="whole" class="secondary">取消选区／整项批注</button></div><p id="scope">未划词时可以直接填写整项要求。</p><button id="useSelection" data-action="useSelection" class="secondary" hidden>改用新选区</button><textarea id="note" placeholder="填写返修要求"></textarea><button title="保存当前批注（Ctrl/Cmd+Enter）" id="saveNote" data-action="note" data-write>保存返修批注</button><button data-action="noteHandoff" data-write title="先保存，再把本项待处理批注加入 Codex 输入区；不自动发送">保存并加入 Codex</button><button data-action="cancelNote" class="secondary">取消</button></div><div id="notes"></div></section></div><small id="operationStatus" role="status" aria-live="polite"></small><p id="status" role="status" aria-live="polite"></p><button id="retryHandoff" data-action="retryHandoff" data-write hidden>重试本项交接</button></main></div>
${assets.script ? `<script nonce="${nonce}" src="${assets.script}"></script>` : ''}<script nonce="${nonce}">${diff}</script><script nonce="${nonce}">${math}</script><script nonce="${nonce}">${filterItems.toString()}\n${client}</script></body></html>`;
}

function createWorkbench(vscode, context, services) {
    let panel, active, loaded, dirty = false, noteDirty = false, handling = false, pending, hasPending = false;
    const translations = new Map();
    let translationRun, translationRequested = false, retryTranslation = false, translationEpoch = 0;
    let lastRecords = new Map(), sourceSelection;
    let ready = false, client, uiState, notice, reading, handoffRetry;
    let appearanceWork = Promise.resolve();
    let navigationFilter = {query: '', kind: '', notes: false};
    let relatedReturn;
    // Reading preferences only: never revive drafts, notes or old review decisions.
    function readingState(state) {
        if (!state) return;
        return {...state, c: {...active}, drafts: {}, note: '', selected: undefined, selectionStale: false,
            editingNote: undefined, composer: false, scope: 'group', expandedNotes: []};
    }
    function post(message) {
        if (['result', 'saved', 'noteSaved', 'noteEdited', 'conflict'].includes(message.type)) message.action = handling || undefined;
        if (message.type === 'noteSaved' || message.type === 'noteEdited') {
            noteDirty = false;
            if (uiState) Object.assign(uiState, {note: '', editingNote: undefined, selected: undefined, composer: false});
        }
        if (message.type === 'saved' && uiState) {
            uiState.c = {...active}; delete uiState.drafts[message.option];
            if (uiState.selected) {
                const chosen = uiState.selected;
                const text = chosen.side === 'candidate' ? options(loaded).find(o => o.label === chosen.option)?.after : loaded.original;
                uiState.selectionStale = text === undefined || text.replace(/\r\n/g, '\n') !== chosen.value;
            }
            message.resume = uiState;
            dirty = Object.entries(uiState.drafts).some(([label, value]) => options(loaded).some(o => o.label === label && o.after.replace(/\r\n/g, '\n') !== value));
        }
        if (['result', 'noteSaved', 'noteEdited'].includes(message.type)) notice = message;
        if (ready && panel?.visible) return panel.webview.postMessage(message);
    }
    const configuration = require('./ai_setup');
    context.subscriptions.push(configuration.subscribe(value => post({type: 'configuration', ...value})));
    const key = c => JSON.stringify([c.repo, c.owner, c.id, c.version]);
    const options = data => data.options || [{label: 'A', after: data.candidate, reason: '已有单方案', changes: data.changes}];
    const directory = () => services.directory().filter(item => lastRecords.has(item.id));
    function packet() {
        const {file, kind, location, versions, requests, questions} = loaded.edit;
        return {type: 'content', c: active, data: {original: loaded.original, edit: {file, kind, location, versions, requests, questions}, intent: loaded.intent, fewer_options_reason: loaded.fewer_options_reason},
            options: options(loaded), directory: directory(), navigationFilter, style: services.style(),
            sourceSelection, resume: uiState, reading, busy: handling, relatedReturn: relatedReturn?.c.id,
            preview: services.selection(active), pdfStatus: services.pdfStatus(active)};
    }
    const valid = c => active && key(active) === key(c);
    function annotationSelection(value) {
        if (!['question', 'translation'].includes(value.side)) {
            const text = value.side === 'candidate' ? options(loaded).find(o => o.label === value.option)?.after : loaded.original;
            if (text === undefined) throw new Error('批注方案不存在。');
            return {...selection(text, value.value, value.start, value.end), side: value.side, option: value.option};
        }
        const question = value.question && (loaded.edit.questions || []).find(q =>
            q.id === value.question.id && q.file === value.question.file && q.quote === value.question.quote);
        if (value.question && !question) throw new Error('关联问题已变化，请重新选择。');
        const option = value.option && options(loaded).find(o => o.label === value.option);
        if (value.option && !option || value.side === 'question' && !question) throw new Error('批注来源不存在，请重新选择。');
        const source = question ? question.quote : option ? option.after : loaded.original;
        let text = source;
        if (value.side === 'translation') {
            const entry = translations.get(JSON.stringify([value.provider, source]));
            if (value.provider !== services.provider() || !entry || entry.error) throw new Error('译文已变化或未就绪，请重新翻译并选择。');
            text = entry.text;
        }
        const span = selection(text, value.value, value.start, value.end);
        const side = option && !question ? 'candidate' : 'original';
        const anchor = side === 'candidate' ? option.after : loaded.original;
        return {side, option: side === 'candidate' ? option.label : undefined, start: 0, end: Array.from(anchor).length, quote: anchor,
            display_context: {kind: value.side, source_side: question ? 'question' : side, source, text,
                start: span.start, end: span.end, quote: span.quote,
                ...(question ? {question} : {}), ...(value.side === 'translation' ? {provider: value.provider} : {})}};
    }
    async function decideAndAdvance(c, action, option) {
        const list = filterItems(directory(), navigationFilter), index = list.findIndex(r => r.id === c.id);
        await services[action]({...c, option, workbench: true});
        const eligible = new Set(filterItems(directory(), navigationFilter).map(r => r.id));
        const next = list.slice(index + 1).concat(list.slice(0, Math.max(0, index))).find(r => eligible.has(r.id) && r.id !== c.id);
        hasPending = false;
        if (next) await show(lastRecords.get(next.id).c);
        else post({type: 'unavailable', message: '当前筛选范围没有下一项；可清除筛选查看其余项目。未自动提交 Git 或判定科学问题完成。'});
    }
    async function handoffSavedNote(c) {
        try {
            await services.handoff(c);
            handoffRetry = undefined;
            post({type: 'handoffRetry', available: false});
            post({type: 'result', message: '批注已保存，本项待处理批注已加入 Codex 输入区；请自行发送。'});
        } catch (error) {
            handoffRetry = {...c};
            post({type: 'handoffRetry', available: true});
            throw new Error('批注已保存，但加入 Codex 失败：' + error.message + '；可点“重试本项交接”，无需重复保存。');
        }
    }
    function sendContent() {
        if (!ready || !panel?.visible) return;
        post(packet()); post({type: 'configuration', ...configuration.status()});
        post({type: 'handoffRetry', available: !!handoffRetry && valid(handoffRetry)});
        if (hasPending && pending && pending.c.version !== active.version && (dirty || noteDirty)) post({type: 'conflict', message: 'AI 已生成新版。未保存编辑仍保留；请保存到别处或放弃后载入最新。'});
        if (!lastRecords.has(active.id)) post({type: 'unavailable', message: '当前项已处理或原文冲突；未覆盖任何未保存内容。'});
        if (notice?.message) post(notice);
        if (translations.size) for (const item of translationItems(loaded)) {
            const entry = translations.get(JSON.stringify([services.provider(), item.text]));
            if (entry) post({type: 'translation', key: item.key, source: item.text, provider: services.provider(), ...entry});
        }
        autoTranslate();
    }
    async function allowSwitch() {
        if (!dirty && !noteDirty) return true;
        const before = key(active);
        const answer = await vscode.window.showWarningMessage('当前审核页有未保存的候选或返修要求。保存不代表接收。', {modal: true}, '保存并切换', '放弃未保存内容并切换');
        if (key(active) !== before) throw new Error('审核项已变化，请重新选择目标。');
        if (answer === '保存并切换') {await savePendingInputs(); return true;}
        return answer === '放弃未保存内容并切换';
    }
    async function savePendingInputs() {
        const state = uiState;
        if (!state) throw new Error('尚未收到当前草稿，请返回审核页后重试。');
        const ownLock = !handling;
        if (ownLock) {handling = 'saveSwitch'; post({type: 'busy', action: handling});}
        try {
            // Save an existing version's note before draft edits create a new version.
            if (noteDirty) {
                if (state.selectionStale) throw new Error('批注所选文字已变化，请重新选择范围或明确改为整项批注。');
                if (state.editingNote) {
                    const note = loaded.edit.requests.find(n => n.id === state.editingNote.id);
                    if (!note || note.version !== active.version || note.status !== 'open') throw new Error('批注版本已变化，未覆盖新版。');
                    await services.editNote({...active}, note, state.note, state.editingNote.previousText);
                } else {
                    let selected;
                    const chosen = state.selected;
                    if (chosen) {
                        selected = annotationSelection(chosen);
                    } else selected = {side: 'original', start: 0, end: Array.from(loaded.original).length, quote: loaded.original,
                        option: /^[ABC]$/.test(state.scope) ? state.scope : undefined};
                    await services.note({...active}, selected, state.note);
                }
                loaded = await services.read({...active});
                post({type: 'noteEdited', requests: loaded.edit.requests || [], message: '批注已保存，继续保存候选。'});
            }
            for (const [label, text] of Object.entries({...state.drafts})) {
                const option = options(loaded).find(o => o.label === label);
                if (!option) throw new Error('草稿对应方案已不存在：' + label);
                if (text === option.after.replace(/\r\n/g, '\n')) continue;
                const value = option.after.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
                loaded = await services.save({...active}, label, value);
                active = {...active, version: loaded.version};
                post({...packet(), type: 'saved', option: label});
            }
            dirty = noteDirty = false;
            services.saved({...active}, services.selection(active), !!state.compare);
        } catch (error) {
            throw new Error('未切换：' + error.message + '；已成功保存的内容保留，其余草稿仍在当前页。');
        } finally {
            if (ownLock) {handling = false; post({type: 'busy', action: false});}
        }
    }
    async function show(c, restore) {
        if (active && key(active) === key(c) && panel && !restore) {panel.reveal(); await services.activeChanged?.(active); return;}
        if (!await allowSwitch()) {if (active) await services.activeChanged?.(active); return;}
        const data = await services.read(c);
        active = {...c}; loaded = data; dirty = noteDirty = false; hasPending = false; sourceSelection = undefined;
        uiState = notice = handoffRetry = undefined;
        if (restore) {uiState = readingState(restore.state); navigationFilter = restore.filter;}
        if (!panel) {
            panel = vscode.window.createWebviewPanel('texscholarReview', '论文审核', vscode.ViewColumn.One,
                {enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(__dirname, 'vendor', 'katex'))], retainContextWhenHidden: false});
            panel.webview.onDidReceiveMessage(receive);
            panel.onDidChangeViewState(({webviewPanel}) => {if (!webviewPanel.visible) {ready = false; translationRequested = retryTranslation = false;}});
            panel.onDidDispose(() => {panel = undefined; active = loaded = pending = sourceSelection = undefined;
                lastRecords = new Map(); hasPending = dirty = noteDirty = ready = false; uiState = notice = client = reading = relatedReturn = undefined; translationEpoch++; translations.clear();});
            const asset = name => panel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'vendor', 'katex', name))).toString();
            panel.webview.html = html(crypto.randomBytes(16).toString('hex'), {source: panel.webview.cspSource, css: asset('katex.min.css'), script: asset('katex.min.js')});
        } else {panel.reveal(); sendContent();}
        await services.activeChanged?.(active);
    }
    function sync(records, scope) {
        if (!active || active.repo !== scope.repo || active.owner !== scope.owner) return;
        lastRecords = records;
        const next = records.get(active.id);
        post({type: 'directory', directory: directory()});
        post({type: 'pdfStatus', message: services.pdfStatus(active)});
        if (handling) {pending = next; hasPending = true; return;}
        if (!next) {post({type: 'unavailable', message: '当前项已处理或原文冲突；未覆盖任何未保存内容。'}); return;}
        if (next.c.version === active.version) {
            const questionsChanged = JSON.stringify(loaded.edit.questions) !== JSON.stringify(next.data.edit.questions);
            loaded = next.data;
            post({type: 'notes', requests: loaded.edit.requests || [], questions: loaded.edit.questions || []});
            if (questionsChanged) autoTranslate();
        } else if (dirty || noteDirty) {
            pending = next; hasPending = true;
            post({type: 'conflict', message: 'AI 已生成新版。未保存编辑仍保留；请保存到别处或放弃后载入最新。'});
        } else {active = {...next.c}; loaded = next.data; uiState = readingState(uiState); sourceSelection = notice = undefined; sendContent();}
    }
    function autoTranslate(force = false) {
        if (!active || !ready || !panel?.visible || (!force && !services.autoTranslate())) return;
        translationRequested = true;
        retryTranslation ||= force;
        if (translationRun) return;
        translationRun = (async () => {
            while (translationRequested && active) {
                translationRequested = false;
                const retry = retryTranslation; retryTranslation = false;
                await translate(retry);
            }
        })().catch(error => post({type: 'translationStatus', message: error.message})).finally(() => {translationRun = undefined;});
    }
    function trimTranslations() {
        if (!translations.size) return;
        const texts = new Set();
        const keep = data => {texts.add(data.original); for (const o of options(data)) texts.add(o.after);
            for (const q of data.edit.questions || []) texts.add(q.quote);};
        for (const record of lastRecords.values()) keep(record.data);
        if (loaded) keep(loaded);
        const provider = services.provider();
        for (const key of translations.keys()) {const [source, text] = JSON.parse(key); if (source !== provider || !texts.has(text)) translations.delete(key);}
    }
    async function translate(retry) {
        trimTranslations();
        const c = {...active}, data = loaded, epoch = translationEpoch, provider = services.provider();
        const items = translationItems(data);
        let failure;
        for (const item of items) {
            if (!valid(c) || epoch !== translationEpoch || !ready || !panel?.visible) return;
            if (!item.text.trim()) continue;
            const cacheKey = JSON.stringify([provider, item.text]);
            let translated = translations.get(cacheKey);
            if (!translated || (retry && translated.error)) {
                post({type: 'translationStatus', message: provider + '：正在翻译 ' + item.key});
                try {translated = failure ? {error: failure} : {text: await services.translate(item.text, provider)};}
                catch (error) {failure = error.message; translated = {error: failure};}
                if (epoch !== translationEpoch) return;
                translations.set(cacheKey, translated);
            }
            if (valid(c)) post({type: 'translation', key: item.key, source: item.text, provider, ...translated});
        }
        if (valid(c)) post({type: 'translationStatus', message: provider + '：本项翻译已处理，失败项可手动重试'});
    }
    function translationItems(data) {
        return [{key: 'original', text: data.original}, ...options(data).map(o => ({key: o.label, text: o.after})),
            ...(data.edit.questions || []).map((q, i) => ({key: 'question' + i, text: q.quote}))];
    }
    async function receive(message) {
        if (message.type === 'checkUpdates') {
            try {
                await vscode.commands.executeCommand('localLatex.checkForUpdates');
                post({type: 'actionResult', action: message.type, message: ''});
            } catch (error) {post({type: 'actionResult', action: message.type, error: true, message: error.message});}
            return;
        }
        if (message.type === 'ready') {
            if (!active || !panel?.visible || ready && client === message.instance) return;
            if (!uiState && message.state?.c && key(message.state.c) === key(active)) uiState = message.state;
            if (!reading && uiState) reading = {sourceMode: uiState.sourceMode, chinese: uiState.chinese};
            client = message.instance; ready = true; sendContent(); return;
        }
        if (!active || !panel) return;
        if (message.type === 'filter') {
            const f = message.filter;
            if (!f || typeof f.query !== 'string' || !['', 'manuscript', 'response'].includes(f.kind) || typeof f.notes !== 'boolean') return;
            navigationFilter = {query: f.query, kind: f.kind, notes: f.notes};
            return;
        }
        if (message.type === 'appearance') {
            appearanceWork = appearanceWork.then(async () => {
                const values = message.reset ? Object.fromEntries(reviewStyle.screenKeys.map(k => [k, reviewStyle.defaults[k]])) : message.values;
                if (!values || !Object.keys(values).length || Object.keys(values).some(k => !reviewStyle.screenKeys.includes(k))) throw new Error('不支持的外观设置。');
                const config = vscode.workspace.getConfiguration('localLatex', vscode.Uri.file(active.repo));
                reviewStyle.read({get: (name, fallback) => Object.hasOwn(values, name.slice(12)) ? values[name.slice(12)] : config.get(name, fallback)});
                for (const [key, value] of Object.entries(values)) {
                    const name = 'reviewStyle.' + key, existing = config.inspect(name);
                    const target = existing?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
                        : existing?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
                    await config.update(name, value, target);
                }
                post({type: 'style', style: services.style()});
                post({type: 'appearanceResult', request: message.request, message: '已保存'});
            }).catch(error => post({type: 'appearanceResult', request: message.request, error: true, message: error.message}));
            return appearanceWork;
        }
        if (message.type === 'viewState' && message.version === active.version && message.id === active.id) {
            uiState = {...message.state, c: {...active}}; reading = {sourceMode: uiState.sourceMode, chinese: uiState.chinese}; return;
        }
        if (message.type === 'viewStatePatch' && message.version === active.version && message.id === active.id) {
            if (uiState) Object.assign(uiState, {scrollTop: message.patch.scrollTop, anchor: message.patch.anchor, focus: message.patch.focus, textareas: message.patch.textareas});
            return;
        }
        if (message.type === 'dirty' && message.version === active.version && message.id === active.id) {
            if (message.state) {uiState = {...message.state, c: {...active}}; reading = {sourceMode: uiState.sourceMode, chinese: uiState.chinese};}
            dirty = message.dirty === true; noteDirty = message.noteDirty === true; return;
        }
        // These actions don't write review state or replace the active item.
        // They stay usable during a save, without releasing the writer guard.
        if (['reopen', 'locate', 'source', 'question', 'translate', 'handoff', 'configuration', 'start'].includes(message.type)) {
            try {
                if (!valid({...active, id: message.id, version: message.version})) throw new Error('当前项已更新，请核对新版。');
                const c = {...active};
                if (message.type === 'reopen') await services.reopen();
                else if (message.type === 'locate') await services.locate(c, services.selection(c));
                else if (message.type === 'source') await services.source(c);
                else if (message.type === 'translate') autoTranslate(true);
                else if (message.type === 'handoff') await services.handoff();
                else if (message.type === 'configuration') {
                    await vscode.commands.executeCommand('localLatex.checkAIConfiguration');
                    await vscode.commands.executeCommand('localLatex.checkMCPVersion');
                }
                else if (message.type === 'start') await services.start();
                else {
                    const q = loaded.edit.questions?.[message.index];
                    if (!q) throw new Error('原始问题关联不存在。');
                    await services.question(c, q);
                }
                post({type: 'actionResult', action: message.type, message: message.type === 'handoff' ? '批注快照已加入 Codex 输入区，请自行发送。' : ''});
            } catch (error) {post({type: 'actionResult', action: message.type, error: true, message: error.message});}
            return;
        }
        if (handling) return post({type: 'actionResult', error: true, message: '当前审核操作仍在完成，未保存内容保留。'});
        handling = message.type; notice = undefined;
        post({type: 'busy', action: handling});
        try {
            if (message.type === 'connect') {await services.connect(); return post({type: 'result', message: ''});}
            if (message.type === 'copy') {await services.copy(); return post({type: 'result', message: '已复制三方案规则，不修改 SKILL。'});}
            if (message.type === 'finish') {await services.finish(); return post({type: 'result', message: '结束审核操作已返回，请核对备份结果。'});}
            if (message.version !== active.version || message.id !== active.id) throw new Error('当前项已更新，旧操作已停止；请核对新版。');
            const c = {...active};
            if (message.type === 'backRelated') {
                const target = relatedReturn, record = target && lastRecords.get(target.c.id);
                if (!record || record.c.repo !== target.c.repo || record.c.owner !== target.c.owner) {
                    relatedReturn = undefined; post({type: 'relatedReturn'});
                    return post({type: 'result', message: '原审核项已处理或不再可用，未恢复旧候选。'});
                }
                await show(record.c, {state: target.state, filter: target.filter});
                if (active.id === record.c.id) {relatedReturn = undefined; post({type: 'relatedReturn'});}
                return;
            }
            if (message.type === 'retryHandoff') {
                if (!handoffRetry || !valid(handoffRetry)) throw new Error('交接目标已改变，请核对当前项；未重复保存批注。');
                return await handoffSavedNote({...handoffRetry});
            }
            if (message.type === 'switch' || message.type === 'next' || message.type === 'previous') {
                const list = filterItems(directory(), navigationFilter), index = list.findIndex(e => e.id === active.id);
                const id = message.type === 'switch' ? message.target : list[index + (message.type === 'next' ? 1 : -1)]?.id;
                const next = lastRecords.get(id);
                if (next) await show(next.c);
                else return post({type: 'result', message: '当前筛选范围没有更多项目；可清除筛选查看全部。已接收成果可查 Git。'});
            } else if (message.type === 'latest') {
                if (!await allowSwitch()) return;
                const data = await services.read({...c, version: pending?.c.version || c.version});
                active = {...c, version: data.version}; loaded = data; dirty = noteDirty = false; hasPending = false; uiState = readingState(uiState); sourceSelection = notice = undefined; sendContent();
            } else if (message.type === 'save' || message.type === 'saveAccept') {
                const option = options(loaded).find(o => o.label === message.option);
                if (!option || typeof message.value !== 'string') throw new Error('请选择现有候选方案。');
                if (message.type === 'saveAccept' && (noteDirty || Object.entries(uiState?.drafts || {}).some(([label, value]) =>
                    label !== message.option && options(loaded).some(o => o.label === label && o.after.replace(/\r\n/g, '\n') !== value)))) {
                    throw new Error('请先保存其他方案草稿和返修批注，再保存并接收本方案。');
                }
                const value = option.after.includes('\r\n') ? message.value.replace(/\r?\n/g, '\r\n') : message.value;
                if (message.type === 'save' && value === option.after) return post({type: 'result', message: '候选未修改，无需保存。'});
                if (value !== option.after) {
                    loaded = await services.save(c, message.option, value);
                    active = {...c, version: loaded.version}; dirty = false;
                    post({...packet(), type: 'saved', option: message.option, message: '方案 ' + message.option + ' 已保存；尚未接收。'});
                }
                if (message.type === 'saveAccept') {
                    try {await decideAndAdvance({...active}, 'accept', message.option);}
                    catch (error) {throw new Error('候选保存步骤已完成，接收或跳转返回错误：' + error.message + '；请核对当前状态，不要重复保存。');}
                } else {
                    autoTranslate(); services.saved(active, message.option, !!message.compare);
                }
            } else if (message.type === 'editNote') {
                const note = (loaded.edit.requests || []).find(n => n.id === message.request);
                if (!note || note.status !== 'open' || note.version !== c.version) throw new Error('该批注已更新或不是当前版本的待处理批注，请核对新版。');
                await services.editNote(c, note, message.text, message.previousText);
                loaded = await services.read(c);
                post({type: 'noteEdited', request: note.id, requests: loaded.edit.requests || [], message: '批注已修改；编号、选区与候选保持不变。'});
                if (message.handoff) return await handoffSavedNote(c);
            } else if (message.type === 'note') {
                if (dirty) throw new Error('请先保存候选编辑，再绑定返修选区。');
                const option = options(loaded).find(o => o.label === message.option);
                let selected;
                if (['question', 'translation'].includes(message.side)) selected = annotationSelection(message);
                else if (message.side === 'candidate') {
                    if (!option) throw new Error('候选方案不存在。');
                    selected = selection(option.after, message.value, message.start, message.end);
                    selected.option = option.label;
                } else {
                    const excerpt = loaded.original;
                    selected = {side: 'original', start: 0, end: Array.from(excerpt).length, quote: excerpt};
                    if (message.side === 'original' && message.start !== undefined) selected = {...selection(excerpt, message.value, message.start, message.end), side: 'original'};
                    if (option) selected.option = option.label;
                }
                await services.note(c, selected, message.text); noteDirty = false; sourceSelection = undefined;
                post({type: 'noteSaved', message: '返修要求已保存，可继续添加；未发送 AI。'});
                if (message.handoff) return await handoffSavedNote(c);
            } else if (message.type === 'accept' || message.type === 'reject') {
                if (dirty || noteDirty) throw new Error('请先保存候选和返修要求，再接收或拒绝。');
                if (message.type === 'accept' && !options(loaded).some(o => o.label === message.option)) throw new Error('请选择具体接收方案。');
                await decideAndAdvance(c, message.type, message.option);
            } else if (message.type === 'preview' || message.type === 'pdf') {
                if (dirty) throw new Error('请先保存候选编辑再预览 PDF。');
                const option = message.option || services.selection(c);
                if (!options(loaded).some(o => o.label === option)) throw new Error('预览方案不存在。');
                services.preview(c, option, !!message.compare, message.type === 'pdf');
                post({type: 'preview', option});
            } else if (message.type === 'related') {
                const origin = {c, state: readingState(uiState), filter: {...navigationFilter}};
                await services.related(c, loaded.edit.questions?.[message.index]);
                if (active.repo === c.repo && active.owner === c.owner && active.id !== c.id) {
                    relatedReturn = origin; post({type: 'relatedReturn', id: c.id});
                }
            }
            else if (message.type === 'provider') {await services.changeProvider(); translationEpoch++; autoTranslate();}
            else throw new Error('不支持的审核操作。');
            post({type: 'result', message: ''});
        } catch (error) {post({type: 'result', error: true, message: error.message});}
        finally {
            handling = false;
            if (hasPending && (!dirty && !noteDirty || pending?.c.version === active.version)) {const next = pending; hasPending = false; sync(next ? new Map(lastRecords) : lastRecords, {repo: active.repo, owner: active.owner});}
            post({type: 'busy', action: false});
        }
    }
    context.subscriptions.push({dispose() {panel?.dispose();}});
    return {show, sync, setRecords(records) {lastRecords = records; trimTranslations();},
        assertReloadSafe() {
            if (handling) throw new Error('审核操作正在进行，已停止重载；请等该操作完成。');
            if (dirty || noteDirty) throw new Error('审核页有未保存的候选编辑或返修批注，已停止重载；请先保存或明确放弃。');
        },
        async annotate(c, selected) {
            await show(c);
            if (!valid(c)) return;
            sourceSelection = selected;
            post({type: 'sourceSelection', selection: selected});
        },
        status(c, message) {if (active && key(active) === key(c)) post({type: 'pdfStatus', message});},
        updateStyle() {if (active) post({type: 'style', style: services.style()});},
        settingsChanged() {if (active) {translationEpoch++; autoTranslate();}},
        get active() {return active;}, whenTranslationIdle: () => translationRun || Promise.resolve()};
}
module.exports = {createWorkbench, html, filterItems};
