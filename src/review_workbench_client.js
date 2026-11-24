/* Runs only inside the fixed review webview. No network or filesystem access. */
'use strict';
const api = acquireVsCodeApi(), $ = id => document.getElementById(id);
const feedbackNode = $('status');
let current, data, options = [], preview = 'A', selected, waiting = false, coordinating = false, unavailable = false, conflict = false, transactionBlocked = false, focused, chinese = true;
let currentSession, pendingCardAction, consumedCardAction;
let reviewMode = 'paragraph', selectedQuestion = '';
let editingNote, appearance, appearanceRequest, directoryItems = [], pendingSelection, selectionStale = false;
let navigationFilter = {query: '', kind: '', notes: false};
let changeCursor;
let directoryCursor, localFeedback;
let stashes = [], questionRows = [];
const batchSelection = new Map();
const noteSelection = new Map();
let feedbackRows = [];
const coordinatedWrites = new Set(['save', 'saveAccept', 'accept', 'acceptBatch', 'reject', 'note', 'noteHandoff', 'editNote', 'batchNote', 'manageFeedback', 'saveSource', 'manualRebase', 'syncBlock', 'repairBlock', 'relocate']);
const feedbackTargets = new Map();
const drafts = new Map(), models = new WeakMap(), translatedText = new Map(), rendered = new WeakMap(), differences = new WeakMap();
const displayedChanges = new WeakMap();
const questionTranslations = new Map(), questionClosed = new Set(), questionNodes = new Map();
const questionSources = new Map();
const paragraphClosed = new Set();
let questionObserver, questionVisible = new Set(), paragraphObserver;
let sourceMode = false;
let comparison = 'original', draftFrame;
const math = globalThis.TeXScholarMath;
const instance = crypto.randomUUID();
let rendering = false, stateFrame, restoration;
const toolbarLabels = {previous:'上一项', next:'下一项', handoff:'批注 → Codex', source:'定位源文件', mathMode:'LaTeX 源码', reopen:'打开 PDF', locate:'定位 PDF', pdf:'更新审核 PDF', sourcePDF:'正式 PDF', translate:'翻译／重试', provider:'翻译来源', toggleChinese:'显示／收起中文', paperBackground:'当前论文背景', personalPrompts:'个人论文提示词', configuration:'检查配置', start:'AI 论文助手', checkUpdates:'检查插件更新', finish:'Git 备份', stashClose:'暂存并关闭'};
const toolbarOrder = Object.keys(toolbarLabels), toolbarDefault = {order:toolbarOrder, visible:['previous','next']};
const toolbarNodes = Object.fromEntries(toolbarOrder.map(id => [id, document.querySelector('header [data-action="' + id + '"]')]));
let toolbar = toolbarDefault, toolbarDraft;
let sourceDraftStale = false, candidateDraftStale = false, oldOriginal;
let selectedBlockRevision;
$('currentBlock').addEventListener('pointerup', () => {selectedBlockRevision = data?.block?.source_revision;});
$('currentBlock').addEventListener('keyup', () => {selectedBlockRevision = data?.block?.source_revision;});
const passiveActions = new Set(['reopen', 'locate', 'source', 'question', 'translate', 'handoff', 'configuration', 'paperBackground', 'personalPrompts', 'start', 'checkUpdates', 'sourcePDF']);
const sideBusy = new Set();
const actionNames = {save: '保存候选', saveSource: '保存当前原文', syncBlock: '同步候选', repairBlock: '修复审核块', manualRebase: '人工更新候选', saveSwitch: '保存并切换', saveAccept: '保存并接收候选', retryHandoff: '重试本项交接', noteHandoff: '保存并准备 Codex 批注', note: '保存批注', editNote: '保存批注修改', accept: '接收候选', reject: '拒绝候选',
    next: '切换审核项', previous: '切换审核项', switch: '切换审核项', postpone: '暂缓本项', restorePostponed: '恢复本项', stashClose: '暂存并关闭', restoreStash: '恢复草稿', discardStash: '放弃暂存', checkQuestion:'核对问题', questionEntry:'查看关联项', questionCard:'打开问题卡操作', backRelated: '返回原审核项', latest: '读取新版', handoff: '准备 Codex 批注', finish: '备份已接收成果',
    configuration: '检查配置', checkUpdates: '检查插件更新', start: '准备 AI 任务', provider: '切换翻译来源', preview: '准备 PDF 预览', pdf: '准备 PDF 更新', sourcePDF: '编译正式 PDF', related: '定位关联改动'};
function fitToolbar() {
    const header = document.querySelector('header');
    document.documentElement.style.setProperty('--toolbar-height', header.offsetHeight + 'px');
}
function applyToolbar(value) {
    toolbar = value;
    for (const id of value.order) (value.visible.includes(id) ? $('toolbarCustom') : $('overflowActions')).appendChild(toolbarNodes[id]);
    $('overflowActions').appendChild($('pdfStatus'));
    fitToolbar();
}
function renderToolbarChoices() {
    const root = $('toolbarChoices'); root.replaceChildren();
    toolbarDraft.order.forEach((id, index) => {
        const row=document.createElement('div'), label=document.createElement('label'), input=document.createElement('input');
        input.type='checkbox'; input.checked=toolbarDraft.visible.includes(id);
        input.addEventListener('change', () => {toolbarDraft.visible = input.checked ? [...toolbarDraft.visible,id] : toolbarDraft.visible.filter(value => value!==id);});
        label.append(input, document.createTextNode(' ' + toolbarLabels[id])); row.appendChild(label);
        for (const [delta,text] of [[-1,'上移'],[1,'下移']]) {
            const button=document.createElement('button'); button.className='secondary'; button.textContent=text;
            button.disabled=index+delta<0 || index+delta>=toolbarDraft.order.length;
            button.addEventListener('click', () => {const order=toolbarDraft.order; [order[index],order[index+delta]]=[order[index+delta],order[index]]; renderToolbarChoices();});
            row.appendChild(button);
        }
        root.appendChild(row);
    });
}
new ResizeObserver(fitToolbar).observe(document.documentElement);
new ResizeObserver(fitToolbar).observe(document.querySelector('header'));
document.fonts.ready.then(fitToolbar);
function pdfStatus(message) {
    const node = $('pdfStatus'); node.title = message || '';
    const label = /^正式 PDF/.test(message) ? '正式 PDF' : '审核 PDF';
    node.textContent = label + (/失败|错误/.test(message) ? ' 更新失败' : /正在|生成中/.test(message) ? ' 生成中'
        : /待更新|变更/.test(message) ? ' 待更新' : /最新/.test(message) ? ' 最新' : ' 未核对');
    node.style.color = /失败|错误/.test(message) ? 'var(--vscode-errorForeground)' : '';
    $('pdfError').hidden = !/失败|错误/.test(message);
    $('pdfError').textContent = $('pdfError').hidden ? '' : message;
    fitToolbar();
}
function showRelatedReturn(id) {
    $('backRelated').hidden = !id;
    $('backRelated').textContent = id ? '返回 ' + id : '返回原审核项';
    fitToolbar();
}
function keepReading(update) {
    // Only compensate for synchronous layout changes above the visible text.
    // No timer, deferred scroll or focus changes can fight subsequent user input.
    const y = document.querySelector('header').getBoundingClientRect().bottom + 10;
    const range = document.caretRangeFromPoint?.(Math.min(120, innerWidth / 3), y);
    const anchor = range && range.startContainer.parentElement?.closest('main .review-text, main .zh') ? range : undefined;
    const anchorNode = anchor?.startContainer;
    const before = anchor?.getBoundingClientRect().top;
    update();
    if (anchorNode?.isConnected && anchor.startContainer === anchorNode && before !== undefined) {
        const delta = anchor.getBoundingClientRect().top - before;
        if (delta) window.scrollBy(0, delta);
    }
}
function readingAnchor() {
    const y = document.querySelector('header').getBoundingClientRect().bottom + 24;
    const node = [...document.querySelectorAll('main .review-text[id], main .zh[id]')].find(n => {
        const r = n.getBoundingClientRect(); return r.height && r.top <= y && r.bottom > y;
    });
    return node ? {id: node.id, top: node.getBoundingClientRect().top} : undefined;
}
function snapshot() {
    return {c: {...current}, drafts: Object.fromEntries(drafts), blockDraft: data?.block || sourceDraftStale ? $('blockSource').value : undefined, sourceDraftStale, candidateDraftStale, oldOriginal, note: $('note').value, purpose:$('notePurpose').value, batchNote:$('batchNote').value, batchPurpose:$('batchPurpose').value, batchScope:$('batchNoteScope').value, batchItems:$('batchNote').value.trim() ? [...batchSelection.values()].map(item=>({...item})) : undefined, selected, editingNote,
        composer: !$('noteComposer').hidden, scope: $('scopeChoice').value, selectionStale, sourceMode, chinese, focused, comparison,
        compare: $('compare').checked, scrollTop: restoration?.scrollTop ?? window.scrollY, anchor: restoration?.anchor ?? readingAnchor(), focus: document.activeElement?.id,
        editors: options.filter(o => !$('editor-' + o.label).hidden).map(o => o.label),
        textareas: Object.fromEntries([...document.querySelectorAll('textarea')].map(node => [node.id,
            {start: node.selectionStart, end: node.selectionEnd, top: node.scrollTop, left: node.scrollLeft}])),
        expandedNotes: [...document.querySelectorAll('#notes .note details[open]')].map(node => node.closest('.note').dataset.noteId)};
}
function remember(notify = true) {
    if (!current || rendering) return;
    const state = snapshot(); api.setState(state);
    if (notify) send('viewState', {state}, false);
    return state;
}
function saveBatchSelection() {
    send('batchSelection', {session:currentSession, items:[...batchSelection.values()]}, false);
}
function queueRemember() {
    if (stateFrame === undefined) stateFrame = requestAnimationFrame(() => {
        stateFrame = undefined;
        if (!current || rendering) return;
        send('viewStatePatch', {patch: {scrollTop: window.scrollY, anchor: readingAnchor(), focus: document.activeElement?.id,
            textareas: Object.fromEntries([...document.querySelectorAll('textarea')].map(node => [node.id,
                {start: node.selectionStart, end: node.selectionEnd, top: node.scrollTop, left: node.scrollLeft}]))}}, false);
    });
}
function restoreInputs(state) {
    selected = state.selected; editingNote = state.editingNote; selectionStale = !!state.selectionStale;
    $('note').value = state.note; $('notePurpose').value=state.purpose || 'revision'; $('batchNote').value=state.batchNote || ''; $('batchPurpose').value=state.batchPurpose || 'revision'; $('batchNoteScope').value=state.batchScope || 'whole'; $('noteComposer').hidden = !state.composer; $('scopeChoice').value = state.scope;
    $('noteScopeControls').hidden = !!editingNote;
    $('noteMode').textContent = editingNote ? '编辑返修批注' : '新增返修批注';
    $('saveNote').textContent = editingNote ? '保存修改' : '保存返修批注';
    placeComposer();
    if (editingNote) $('scope').textContent = '原批注范围保持不变';
    else if (selected) $('scope').textContent = selectionStale ? '所选文字已变化：请重新划词，或明确改为整项批注；已写要求保留。'
        : selectionLabel(selected) + '选区：' + selected.value.slice(selected.start, selected.end);
    else scope();
    $('compare').checked = state.compare;
    for (const label of state.editors) if (options.some(o => o.label === label)) $('editor-' + label).hidden = false;
    for (const [id, caret] of Object.entries(state.textareas)) {
        const node = $(id);
        if (node) {node.setSelectionRange(caret.start, caret.end); node.scrollTop = caret.top; node.scrollLeft = caret.left;}
    }
    if (state.focus) $(state.focus)?.focus({preventScroll: true});
    for (const node of document.querySelectorAll('#notes .note details')) node.open = state.expandedNotes.includes(node.closest('.note').dataset.noteId);
    restoration = state;
    document.fonts.ready.then(() => requestAnimationFrame(() => {
        if (restoration !== state) return;
        const anchor = state.anchor && $(state.anchor.id);
        if (anchor?.getClientRects().length) window.scrollBy(0, anchor.getBoundingClientRect().top - state.anchor.top);
        else window.scrollTo(0, state.scrollTop);
        restoration = undefined; remember();
    }));
}
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const noteKey = row => JSON.stringify([row.id, row.note.id, row.note.version]);
function saveNoteSelection() {
    api.postMessage({type:'noteSelection', instance, repo:current.repo, owner:current.owner, session:currentSession, items:[...noteSelection.values()]});
}
function renderFeedbackManager() {
    const root = $('notesRows'); root.replaceChildren();
    const rows = feedbackRows.filter(row => $('notesScope').value === 'all' || row.id === current.id);
    for (const row of rows) {
        const key = noteKey(row), selected = noteSelection.get(key), label = document.createElement('label'), check = document.createElement('input');
        check.type = 'checkbox'; check.checked = !!selected; check.disabled = !row.note.id || !row.note.version;
        check.addEventListener('change', () => {if (check.checked) noteSelection.set(key, row); else noteSelection.delete(key); saveNoteSelection(); renderFeedbackManager();});
        const text = document.createElement('span');
        const state = {open:'待处理','addressed-pending-review':'待作者核对','closed-by-author-acceptance':'接收后关闭','closed-by-author-rejection':'拒绝后关闭'}[row.note.status] || row.note.status;
        text.textContent = ` ${row.id} · ${row.file} · ${row.source === 'previous_feedback' ? '上一版' : '批注'} · ${row.note.option ? '方案 ' + row.note.option : '整项／原文'} · 版本 ${row.note.version?.slice(0,8) || '未知'} · ${state}${row.note.held ? ' · 暂留' : ''}${check.disabled ? ' · 身份不完整，保留待核' : ''}${selected && JSON.stringify(selected) !== JSON.stringify(row) ? ' · 已变化，请清选后重新选择' : ''}\n选区：${row.note.display_context?.quote ?? row.note.quote}\n${row.note.text}`;
        text.style.whiteSpace = 'pre-wrap'; label.append(check, text); const box = document.createElement('div'); box.className = 'note'; box.append(label); root.append(box);
    }
    $('notesCount').textContent = ` 已选 ${noteSelection.size} 条`;
}
function send(type, extra = {}, blocks = true) {
    if (!current) return;
    if (actionNames[type] || passiveActions.has(type)) feedbackTargets.set(type, localFeedback);
    if (passiveActions.has(type)) {if (sideBusy.has(type)) return; sideBusy.add(type); buttons();}
    if (blocks && !passiveActions.has(type)) {waiting = type; status(''); buttons();}
    api.postMessage({type, sentAt: Date.now(), instance, repo: current.repo, owner: current.owner, id: current.id, version: current.version, ...extra});
}
function status(message, error = false, action) {
    const node = feedbackNode;
    if (message) {
        const target = action ? feedbackTargets.get(action) : localFeedback;
        const matches = target && target.item === JSON.stringify([current.repo, current.owner, current.id]);
        const container = matches && [target.node, target.fallback].find(n => n?.isConnected && n.getClientRects().length);
        (container || $('pageFeedback')).appendChild(node);
    }
    if (!node.isConnected) $('pageFeedback').appendChild(node);
    node.textContent = message || ''; node.className = error ? 'error' : '';
}
function feedbackFor(button) {
    const node = button.closest('#noteComposer, .note, [id^="editor-"], article, .question');
    const label = selected?.option || $('scopeChoice').value;
    return {item: JSON.stringify([current.repo, current.owner, current.id]), node,
        fallback: node?.closest('article') || (node?.id === 'noteComposer'
            ? selected?.side === 'original' || $('scopeChoice').value === 'original' ? $('original').parentElement : $('option-' + label)
            : undefined)};
}
function dirty() {
    const candidateDirty = options.some(o => drafts.has(o.label) && drafts.get(o.label) !== o.after.replace(/\r\n/g, '\n'));
    if (!candidateDirty) candidateDraftStale = false;
    if (sourceDraftStale && data?.block && $('blockSource').value === data.block.text.replace(/\r\n/g, '\n')) sourceDraftStale = false;
    draftWarning();
    const changed = candidateDirty || sourceDraftStale ||
        !!data?.block && $('blockSource').value !== data.block.text.replace(/\r\n/g, '\n');
    send('dirty', {dirty: changed, noteDirty: !!$('note').value.trim() || !!editingNote || !!$('batchNote').value.trim(), state: remember(false)}, false);
    buttons(); return changed;
}
function draftWarning() {
    $('draftStale').hidden = !sourceDraftStale && !candidateDraftStale;
    $('draftStale').textContent = [sourceDraftStale && '原文草稿基于旧正文，已保留；请复制或放弃后载入最新。', candidateDraftStale && '候选草稿基于旧正文，已保留；请核对后人工更新。'].filter(Boolean).join(' ');
    $('resetSourceDraft').hidden = !sourceDraftStale || !data?.block;
    $('oldBaseline').hidden = !oldOriginal || !candidateDraftStale && !sourceDraftStale && !$('note').value.trim();
    $('oldBaselineText').textContent = oldOriginal || '';
}
function cardButtonDisabled(button) {
    const targetCurrent = current && button.dataset.target === current.id && button.dataset.targetVersion === current.version;
    const mismatch = button.dataset.targetMismatch === 'true' || targetCurrent && data?.source_match === false;
    return !!waiting || button.dataset.intent === 'accept' && (coordinating || transactionBlocked || mismatch || button.dataset.postponed==='true' || targetCurrent && (unavailable || conflict)) ||
        button.dataset.intent === 'preview' && mismatch;
}
function buttons() {
    $('note').readOnly = !!waiting;
    $('blockSource').readOnly = !!waiting;
    for (const b of document.querySelectorAll('[data-action="newNote"],[data-action="cancelNote"],[data-action="editNoteOpen"]')) b.disabled = waiting;
    for (const button of document.querySelectorAll('button[data-write]')) button.disabled = waiting || coordinating || unavailable || conflict;
    for (const button of document.querySelectorAll('button[data-action]')) {
        if (actionNames[button.dataset.action] || button.dataset.action === 'directory') button.disabled =
            !!(waiting && !passiveActions.has(button.dataset.action) && button.dataset.action !== 'directory') || !!(button.hasAttribute('data-write') && (coordinating || unavailable || conflict));
        if (passiveActions.has(button.dataset.action)) button.disabled = sideBusy.has(button.dataset.action);
        if (coordinating && coordinatedWrites.has(button.dataset.action)) button.disabled = true;
    }
    if (data?.source_match === false) for (const b of document.querySelectorAll('[data-action="accept"],[data-action="saveAccept"],[data-action="preview"],[data-action="pdf"]')) b.disabled = true;
    for (const button of document.querySelectorAll('[data-action="questionCard"]')) button.disabled = cardButtonDisabled(button);
    document.querySelector('[data-action="restoreStash"]').disabled ||= !stashes.find(item => item.id === $('stashChoice').value)?.exact;
    $('operationStatus').textContent = waiting ? current.id + ' · ' + (actionNames[waiting] || '审核操作') + '…' : coordinating ? '正在协调已保存的正文，完成后可继续写入。' : '';
    for (const node of document.querySelectorAll('textarea.edit')) node.readOnly = !!waiting;
    for (const button of document.querySelectorAll('[data-action="save"]')) {
        const o = options.find(o => o.label === button.dataset.option);
        const unchanged = o && !hasDraft(o);
        button.disabled ||= !!unchanged;
        button.title = unchanged ? '候选未修改，无需保存；删除全部文字仍可保存。' : '保存此候选（Ctrl/Cmd+Enter），不接收';
    }
    const staleNote = editingNote && !data?.edit.requests?.some(n => n.id === editingNote.id && n.status === 'open' && n.version === current.version);
    const noteReason = selectionStale ? '请重新选择已变化的文字，或明确改为整项批注。' : staleNote ? '原批注版本已变化；请取消编辑后重新填写。'
        : !$('note').value.trim() ? '请先填写返修要求。' : editingNote && $('note').value === editingNote.previousText && $('notePurpose').value === (editingNote.previousPurpose || 'revision') ? '批注未修改，无需保存。' : '';
    for (const button of document.querySelectorAll('[data-action="note"],[data-action="noteHandoff"]')) {
        button.disabled ||= !!noteReason; button.title = noteReason || (button.dataset.action === 'note' ? '保存当前批注（Ctrl/Cmd+Enter）' : '保存后加入 Codex 输入区，不自动发送');
    }
    selectedCount();
}
function style(value) {
    appearance = value;
    const root = document.documentElement.style;
    root.setProperty('--review-font-size', value.candidateFontSize + 'px');
    root.setProperty('--review-line-height', value.candidateLineHeight);
    root.setProperty('--control-font-size', value.controlFontSize + 'px');
    root.setProperty('--translation-font-size', value.translationFontSize + 'px');
    root.setProperty('--review-font-family', value.fontFamily || 'var(--vscode-font-family)');
    document.body.classList.toggle('comfortable', value.cardLayout === 'comfortable');
    root.setProperty('--removed', value.removedColor); root.setProperty('--added', value.addedColor);
    root.setProperty('--strike', value.strikeDeleted ? 'line-through' : 'none');
    root.setProperty('--unchanged', value.unchangedColor || 'inherit');
    for (const input of document.querySelectorAll('[data-style]')) if (document.activeElement !== input) input.value = value[input.dataset.style];
    fitToolbar();
}
function saveAppearance(change) {
    appearanceRequest = crypto.randomUUID();
    $('appearanceStatus').textContent = '保存中…'; $('appearanceStatus').className = '';
    send('appearance', {...change, request: appearanceRequest}, false);
}
function renderText(node, raw, changes, side) {
    displayedChanges.set(node, {raw, changes, side});
    const signature = JSON.stringify([raw, changes, side, sourceMode]);
    if (rendered.get(node) === signature && models.has(node)) return;
    models.set(node, math.render(node, raw, changes, side, sourceMode ? 'source' : 'preview', globalThis.katex, models.get(node)));
    rendered.set(node, signature);
}
function translationSource(key) {
    return key === 'original' ? data.original : key.startsWith('question') ? data.edit.questions?.[Number(key.slice(8))]?.quote : options.find(o => o.label === key)?.after;
}
function translationComparison(key, entry, node) {
    if (key.startsWith('question')) return {changes: [], side: 'readonly'};
    const pair = comparison === 'original' ? [] : comparison.split(':');
    const paired = pair.length === 2 && pair.every(label => options.some(o => o.label === label));
    const oldKey = paired ? pair[0] : 'original';
    const newKey = paired ? pair[1] : key === 'original' ? preview : key;
    if (paired && !pair.includes(key)) return {changes: [], side: 'readonly'};
    const before = translatedText.get(oldKey), after = translatedText.get(newKey);
    const valid = (k, value) => value && !value.error && !value.noTranslation && typeof value.text === 'string'
        && value.source === translationSource(k) && value.provider === entry.provider
        && !options.some(o => o.label === k && hasDraft(o));
    if (!valid(oldKey, before) || !valid(newKey, after)) return {changes: [], side: 'readonly'};
    return {changes: textChanges(node, before.text, after.text, true), side: key === oldKey ? 'original' : 'candidate'};
}
function renderTranslation(key, entry) {
    const node = key === 'original' ? $('originalZh') : $('zh-' + key);
    if (!node || entry.source !== translationSource(key)) return;
    if (options.some(o => o.label === key && hasDraft(o))) {node.hidden = true; return;}
    const {changes, side} = translationComparison(key, entry, node);
    const signature = JSON.stringify([entry.error, entry.text, entry.noTranslation, entry.warning, sourceMode, changes, side]);
    if (rendered.get(node) === signature) {node.hidden = !chinese || paragraphClosed.has(JSON.stringify([current.id,current.version,key])); return;}
    keepReading(() => {
        if (entry.error) {node.textContent = '翻译未完成：' + entry.error; models.delete(node);}
        else if (entry.noTranslation) {node.textContent = entry.noTranslation; models.delete(node);}
        else models.set(node, math.render(node, entry.text, changes, side, sourceMode ? 'source' : 'preview', globalThis.katex, models.get(node)));
        node.dataset.translation = key;
        node.title = entry.warning || (side === 'readonly' ? '中文阅读译文；对照译文尚未就绪时不标差异。'
            : '中文译文之间的文字差异；翻译措辞变化也可能被标记，请结合原文审核。');
        node.hidden = !chinese || paragraphClosed.has(JSON.stringify([current.id,current.version,key]));
    });
    rendered.set(node, signature);
    highlightSelection();
}
function toggleMathMode() {
    sourceMode = !sourceMode;
    $('mathMode').textContent = sourceMode ? '公式预览' : 'LaTeX 源码';
    $('mathMode').setAttribute('aria-pressed', String(sourceMode));
    fitToolbar();
    if (!data || unavailable) return;
    renderReadings();
    renderQuestions(data.edit.questions || []);
    if (reviewMode === 'question') renderQuestionMode();
    // Draft editors, note text, selected source coordinates and version stay intact.
}
function renderDirectory(items) {
    directoryItems = items;
    const postponed = items.some(item => item.id === current?.id && item.postponed);
    $('postpone').hidden = postponed; $('restorePostponed').hidden = !postponed;
    const pending = items.filter(i => ['pending', 'rework'].includes(i.status));
    $('progress').textContent = current ? current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · v' + (data.edit.generation ?? data.edit.versions.length)
        + (navigationFilter.query || navigationFilter.kind || navigationFilter.notes ? ' · 已筛选' : '') : '审核项';
    $('progress').title = '本批可操作 ' + items.length + ' 项 · 待处理 ' + pending.length + ' · 暂缓 ' + items.filter(i => i.postponed).length + ' · 定位冲突 ' + items.filter(i => i.source_match === false).length + '；点击搜索编号、位置或关联问题';
    if ($('directoryDialog').open) filterDirectory();
    else selectedCount();
    if (reviewMode === 'question') renderQuestionMode();
    fitToolbar();
}
function filterDirectory() {
    const filter = {query: $('directoryQuery').value.trim(), kind: $('directoryKind').value, notes: $('directoryNotes').checked, queue: $('directoryQueue').value};
    if (JSON.stringify(filter) !== JSON.stringify(navigationFilter)) {
        directoryCursor = undefined;
        navigationFilter = filter; send('filter', {filter}, false);
        $('progress').textContent = current.id + (filter.query || filter.kind || filter.notes ? ' · 已筛选' : ' · 全部');
    }
    const found = filterItems(directoryItems, navigationFilter);
    $('directoryResults').replaceChildren();
    for (const item of found) {
        const node = document.createElement('button'); node.className = 'secondary'; node.dataset.action = 'switch'; node.dataset.target = item.id;
        node.textContent = item.id + (item.postponed ? ' · 暂缓' : '') + ' · ' + (item.source_match === false ? '定位冲突（需要重新定位）' : item.status === 'rework' ? '返修' : '待审') + ' · ' + item.file + (item.location ? ' · ' + item.location : '') + (item.requests ? ' · 批注 ' + item.requests : '') + (item.summary ? '\n' + item.summary : '');
        node.disabled = !!waiting;
        const row = document.createElement('div'), check = document.createElement('input'), choice = document.createElement('select');
        check.type = 'checkbox'; check.setAttribute('aria-label', '选择 ' + item.id);
        const saved = batchSelection.get(item.id);
        if (saved && saved.version !== item.version) node.textContent += ' · 已选旧版，需重核';
        check.checked = batchSelection.has(item.id);
        check.disabled = !check.checked && (item.postponed || item.source_match===false);
        for (const label of (item.options || ['A','B','C'])) {const option = document.createElement('option'); option.value = label; option.textContent = label + (item.manual_options?.includes(label) ? '（已手改）' : ''); choice.appendChild(option);}
        choice.value = batchSelection.get(item.id)?.option || (item.id === current.id ? preview : item.option) || 'A';
        choice.setAttribute('aria-label', item.id + ' 接收方案');
        check.addEventListener('change', () => {if (check.checked) batchSelection.set(item.id,{id:item.id,version:item.version,option:choice.value}); else batchSelection.delete(item.id); check.disabled=!check.checked && (item.postponed || item.source_match===false); saveBatchSelection(); selectedCount();});
        choice.addEventListener('change', () => {if (check.checked && batchSelection.get(item.id)?.version === item.version) {batchSelection.set(item.id,{id:item.id,version:item.version,option:choice.value}); saveBatchSelection(); selectedCount();}});
        row.append(check, choice, node); $('directoryResults').appendChild(row);
    }
    selectedCount();
    if (!found.length) $('directoryResults').textContent = '没有符合条件的可操作审核项。';
    if (!found.some(i => i.id === directoryCursor)) directoryCursor = found[0]?.id;
    markDirectoryCursor();
    $('directoryHint').textContent = found.length + ' 项；↑↓ 选择，Enter 打开，Esc 关闭。';
}
function selectedCount() {
    const stale = staleBatchSelections(batchSelection, directoryItems);
    for (const card of $('questionModeCards').querySelectorAll('article[data-question-target]')) {
        const chosen=batchSelection.get(card.dataset.questionTarget), check=card.querySelector('input[data-question-item]');
        if (check) {check.checked=!!chosen; check.disabled=!chosen && check.dataset.unavailable==='true'; if (chosen?.version===card.dataset.questionVersion) check.nextElementSibling.value=chosen.option;}
        for (const node of card.querySelectorAll('.questionOption[data-batch-option]')) {
            const selected=!!chosen && chosen.version===card.dataset.questionVersion && chosen.option===node.dataset.batchOption;
            node.classList.toggle('selected',selected);
            node.setAttribute('aria-label',card.dataset.questionTarget+' 方案 '+node.dataset.batchOption+'，'+(selected ? '已选择' : '未选择')+'；按回车或空格批量选择');
        }
    }
    $('selectedCount').textContent = '已选 ' + batchSelection.size + ' 项' + (stale.length ? '；' + stale.length + ' 项需重核，整批不能接收' : '') + (batchSelection.size ? '；接收顺序（同点插入依此排列）：' + [...batchSelection.values()].map(i => i.id + '(' + i.option + ')').join(' → ') : '');
    $('staleSelections').replaceChildren();
    for (const selected of batchSelection.values()) {
        const item = directoryItems.find(i => i.id === selected.id);
        const invalid = stale.some(value=>value.id===selected.id);
        const origins = questionRows.filter(row=>row.entries.some(entry=>entry.id===selected.id)).map(row=>[row.question.id,row.question.file,row.question.quote].join(' · '));
        const row = document.createElement('div');
        const button = document.createElement('button'); button.className = 'secondary'; button.dataset.action = 'switch'; button.dataset.target = selected.id;
        button.textContent = selected.id + ' · ' + (item?.file || '位置不可用') + ' · ' + (origins.join(' / ') || '未绑定问题') + (invalid ? ' · 已变化、暂缓或冲突，需重核' : ' · 有效'); button.disabled = !item || !!waiting;
        const choice = document.createElement('select'); choice.setAttribute('aria-label', selected.id + ' 已选方案');
        for (const label of item?.options || [selected.option]) {const option=document.createElement('option');option.value=label;option.textContent=label;choice.appendChild(option);}
        choice.value=selected.option;choice.disabled=invalid || !!waiting || coordinating;
        choice.addEventListener('change',()=>{batchSelection.set(selected.id,{...selected,option:choice.value});saveBatchSelection();selectedCount();});
        row.append(button,choice);$('staleSelections').appendChild(row);
    }
    const accept = document.querySelector('[data-action="acceptBatch"]');
    accept.disabled = !!stale.length || !!waiting || coordinating || unavailable || conflict;
    accept.title = stale.length ? '请定位并重新选择所有失效项，或明确取消选择。' : '';
    const inQuestion = new Set(questionEntries().map(entry=>entry.id));
    const scoped = [...batchSelection.values()].filter(item=>inQuestion.has(item.id));
    const unsaved=options.some(hasDraft) || candidateDraftStale || sourceDraftStale || !!data?.block && $('blockSource').value!==data.block.text.replace(/\r\n/g,'\n') || !!$('note').value.trim() || !!editingNote || !!$('batchNote').value.trim();
    const currentButton = document.querySelector('[data-action="questionAccept"]'), allButton = document.querySelector('[data-action="questionAcceptAll"]');
    currentButton.textContent = '接收当前问题已选 ' + scoped.length + ' 项';
    allButton.textContent = '接收全部已选 ' + batchSelection.size + ' 项（范围外 ' + (batchSelection.size-scoped.length) + ' 项）';
    currentButton.disabled = !scoped.length || stale.some(item=>inQuestion.has(item.id)) || !!waiting || coordinating || unavailable || conflict || unsaved;
    allButton.disabled = !batchSelection.size || !!stale.length || !!waiting || coordinating || unavailable || conflict || unsaved;
    currentButton.title=allButton.title=unsaved ? '请先保存或暂存候选、原文及返修草稿。' : '';
    if ($('batchNote').value.trim()) remember();
}
function renderStash() {
    const d = stashes.find(item => item.id === $('stashChoice').value);
    if (!d) return;
    $('stashStatus').textContent = d.exact ? '基准一致，可恢复草稿；恢复不代表保存或接收。' : '批次、版本或原文基准已变化；仅供对照，不能直接恢复。';
    $('stashOriginal').textContent = d.state.oldOriginal ?? d.block?.text ?? d.original;
    $('stashCurrent').textContent = data.block?.text ?? data.original;
    $('stashContents').textContent = [...Object.entries(d.state.drafts || {}).map(([label,value]) => '候选 ' + label + '\n' + value),
        ...(d.state.blockDraft === undefined ? [] : ['原文草稿\n' + d.state.blockDraft]), ...(d.state.note ? ['未提交批注\n' + d.state.note] : []), ...(d.state.batchNote ? ['未提交共同意见\n' + d.state.batchNote] : [])].join('\n\n');
    document.querySelector('[data-action="restoreStash"]').disabled = !d.exact || !!waiting;
}
function renderQuestionTable(rows) {
    questionRows = rows;
    renderQuestionMode();
    const root = $('questionTableRows'); root.replaceChildren();
    if (!rows.length) {root.textContent='本轮尚无明确关联的问题。'; return;}
    for (const row of rows) {
        const section=document.createElement('details'), heading=document.createElement('summary'), quote=document.createElement('pre');
        heading.textContent=row.question.id + ' · ' + row.question.file + (row.checked ? ' · 本轮已核对' : row.recheck ? ' · 需再核对' : ' · 尚未核对');
        quote.className='review-text'; quote.textContent=row.question.quote;
        const check=document.createElement('button'); check.className='secondary'; check.dataset.action='checkQuestion'; check.dataset.questionKey=row.key; check.textContent='本轮已核对';
        section.append(heading,quote,check); root.appendChild(section);
    }
}
function questionEntries() {
    if (selectedQuestion === '__unbound__') {
        const linked = new Set(questionRows.flatMap(row => row.entries.map(entry => entry.id)));
        return directoryItems.filter(item => !linked.has(item.id)).map(item => ({...item,openRequests:item.requests}));
    }
    return (questionRows.find(row => row.key === selectedQuestion)?.entries || []).filter(entry => entry.card).map(entry =>
        ({...entry,openRequests:entry.requests.filter(note => note.status === 'open').length}));
}
function questionEntryDraft(entry) {
    return entry.id===current?.id && entry.version===current.version && (sourceDraftStale || candidateDraftStale || options.some(hasDraft) || !!data?.block && $('blockSource').value!==data.block.text.replace(/\r\n/g,'\n'));
}
function changedLines(text, changes, side) {
    return math.questionExcerpt(text,changes,side);
}
function questionViewKey() {return JSON.stringify([currentSession,selectedQuestion,$('questionViewStyle').value,reviewMode]);}
function questionTranslationControl(parent, entry, side, option, source) {
    const viewStyle=$('questionViewStyle').value, target=entry.id, targetVersion=entry.version;
    const displayKey=JSON.stringify([currentSession,selectedQuestion,target,targetVersion,side,option || '',viewStyle,source]);
    const closeKey=JSON.stringify([currentSession,selectedQuestion,target,targetVersion,side,option || '']);
    const container=document.createElement('div'), button=document.createElement('button'), node=document.createElement('div');
    button.className='secondary'; button.textContent='翻译'; node.className='zh'; node.hidden=true;
    button.setAttribute('aria-label',target+' · '+(side==='question' ? '问题' : side==='original' ? '原文' : '方案 '+option)+'翻译');
    node.setAttribute('role','status');
    const value={session:currentSession,questionKey:selectedQuestion,target,targetVersion,side,option,viewStyle,source,displayKey,closeKey,view:questionViewKey(),node,button};
    questionNodes.set(displayKey,value); container.append(button,node); parent.appendChild(container);
    function draw() {
        const result=questionTranslations.get(displayKey), closed=questionClosed.has(closeKey);
        button.textContent=closed ? '显示中文' : result?.error ? '翻译／重试' : result ? '收起中文' : '翻译';
        node.hidden=closed || !chinese || !result;
        if (!result) return;
        if (result.error || result.noTranslation) {node.textContent=result.error ? '翻译未完成：'+result.error : result.noTranslation; models.delete(node);}
        else {models.set(node,math.render(node,result.text,[],'readonly',sourceMode ? 'source' : 'preview',globalThis.katex,models.get(node)));node.dataset.questionTranslation=displayKey;}
        node.title=result.warning || '中文阅读译文，请对照原文。';
    }
    value.draw=draw; draw();
    button.addEventListener('click',()=>{
        chinese=true;
        if (questionClosed.delete(closeKey)) {draw(); if (questionTranslations.has(displayKey)) return;}
        else if (questionTranslations.has(displayKey) && !questionTranslations.get(displayKey).error) {
            questionClosed.add(closeKey);questionVisible.delete(displayKey);
            send('questionTranslationView',{session:currentSession,view:questionViewKey(),visible:[...questionVisible]},false);draw();return;
        }
        button.textContent='翻译中…';
        send('questionTranslate',{...value,node:undefined,button:undefined,draw:undefined,retry:true,auto:false},false);
    });
    return container;
}
function observeQuestionTranslations() {
    questionObserver?.disconnect(); questionVisible=new Set();
    const view=questionViewKey();
    const publish=()=>send('questionTranslationView',{session:currentSession,view,visible:[...questionVisible]},false);
    publish();
    if (reviewMode!=='question' || !chinese) return;
    questionObserver=new IntersectionObserver(changes=>{
        for (const change of changes) {const key=change.target.dataset.translationKey;if(change.isIntersecting) questionVisible.add(key); else questionVisible.delete(key);}
        publish();
        const requests=[];
        for (const key of questionVisible) {
            const value=questionNodes.get(key);
            if (!value || questionClosed.has(value.closeKey) || questionTranslations.has(key)) continue;
            requests.push({...value,node:undefined,button:undefined,draw:undefined,auto:true,retry:false});
        }
        if (requests.length) send('questionTranslateBatch',{requests},false);
    });
    for (const [key,value] of questionNodes) {value.node.parentElement.dataset.translationKey=key;questionObserver.observe(value.node.parentElement);}
}
function observeParagraphTranslations() {
    paragraphObserver?.disconnect();
    const visible=new Set();
    const publish=()=>send('paragraphTranslationView',{visible:[...visible]},false);
    publish();
    if (reviewMode!=='paragraph' || !data || unavailable || !chinese) return;
    const targets=[];
    if (!sourceDraftStale && (!data.block || $('blockSource').value===data.block.text.replace(/\r\n/g,'\n'))) targets.push(['original',$('original')]);
    for (const option of options) if (!hasDraft(option) && !paragraphClosed.has(JSON.stringify([current.id,current.version,option.label]))) targets.push([option.label,$('text-'+option.label)]);
    for (let i=0;i<(data.edit.questions || []).length;i++) targets.push(['question'+i,$('question-text-'+i)]);
    paragraphObserver=new IntersectionObserver(changes=>{
        for (const change of changes) {const key=change.target.dataset.autoTranslation;if(change.isIntersecting) visible.add(key);else visible.delete(key);}
        publish();
    });
    for (const [key,node] of targets) if (node) {node.dataset.autoTranslation=key;paragraphObserver.observe(node);}
}
function bindQuestionOption(node, choose) {
    node.addEventListener('click',event=>{
        if (event.target.closest('button,input,select,textarea,a,summary,details,label,[contenteditable]') || !getSelection().isCollapsed) return;
        choose();
    });
    node.addEventListener('keydown',event=>{if (event.target===node && (event.key==='Enter' || event.key===' ')) {event.preventDefault();choose();}});
}
function renderQuestionMode() {
    const composer=$('noteComposer');
    if ($('questionModeCards').contains(composer) || $('questionModeQuote').contains(composer)) $('questionComposerDock').appendChild(composer);
    questionObserver?.disconnect(); questionNodes.clear(); questionSources.clear();
    const choice = $('questionModeChoice'), previous = selectedQuestion;
    choice.replaceChildren();
    const visible = questionRows.filter(row => row.entries.some(entry => entry.card));
    for (const row of visible) {
        const option=document.createElement('option'); option.value=row.key;
        const duplicates = visible.filter(other => other.question.id === row.question.id && other.question.file === row.question.file);
        option.textContent=row.question.id + ' · ' + row.question.file + (duplicates.length > 1 ? ' · ' + (duplicates.indexOf(row) + 1) : '');
        option.title=row.question.quote;
        choice.appendChild(option);
    }
    const unbound=document.createElement('option'); unbound.value='__unbound__'; unbound.textContent='未绑定问题的修改'; choice.appendChild(unbound);
    selectedQuestion = [...choice.options].some(option => option.value === previous) ? previous : choice.options[0].value;
    choice.value = selectedQuestion;
    $('questionModeQuote').textContent = questionRows.find(row => row.key === selectedQuestion)?.question.quote || '';
    const kindFilter=$('questionType').value;
    const entries=questionEntries().filter(entry=>!kindFilter || kindFilter==='rework' && entry.status==='rework' || kindFilter==='conflict' && (entry.conflict || entry.source_match===false) ||
        ['number','citation','math','term'].includes(kindFilter) && questionEntryDraft(entry) ||
        entry.card?.options.some(option=>(option.fact_changes || []).some(change=>change.kind===kindFilter))), root=$('questionModeCards'); root.replaceChildren();
    const quote=$('questionModeQuote'); quote.replaceChildren();
    const selectedRow=questionRows.find(row=>row.key===selectedQuestion), quoteEntry=selectedRow?.entries.find(entry=>entry.card);
    if (quoteEntry) {
        const text=document.createElement('div'); text.className='review-text'; quote.appendChild(text);
        models.set(text,math.render(text,selectedRow.question.quote,[],'readonly',sourceMode ? 'source' : 'preview',globalThis.katex));
        bindQuestionSource(text,quoteEntry,'question',undefined,selectedRow.question.quote);
        questionTranslationControl(quote,quoteEntry,'question',undefined,selectedRow.question.quote);
    }
    for (const [kind,label] of [['manuscript','正文'],['response','回复信']]) {
        const column=document.createElement('section'), heading=document.createElement('h4'); heading.textContent=label; column.appendChild(heading);
        for (const entry of entries.filter(e=>e.kind===kind)) {
            const card=document.createElement('article'), title=document.createElement('h4');
            card.dataset.questionTarget=entry.id; card.dataset.questionVersion=entry.version;
            const activeDraft=questionEntryDraft(entry);
            title.textContent=entry.id + ' · ' + entry.file + (entry.version ? ' · 版本 ' + entry.version.slice(0,8) : '') + (entry.location ? ' · ' + (entry.location.heading || '') : '') + (entry.conflict ? ' · 定位冲突' : '') + (entry.card?.postponed ? ' · 暂缓' : '') + (entry.status==='rework' ? ' · 返修' : '') + (activeDraft ? ' · 未保存草稿，变化标记待保存后重算' : '') + (entry.openRequests ? ' · 有待处理批注' : '') + (!entry.card ? ' · 已处理或历史不可用' : '');
            if (entry.version) title.title='完整版本：'+entry.version;
            card.appendChild(title);
            if (entry.card) {
                const check=document.createElement('input'), select=document.createElement('select'); check.type='checkbox'; check.setAttribute('aria-label','选择 '+entry.id);
                check.dataset.unavailable=String(!!(entry.conflict || entry.source_match===false || entry.card.postponed));
                check.checked=batchSelection.has(entry.id); check.dataset.questionItem=entry.id;
                for (const o of entry.card.options) {const option=document.createElement('option');option.value=o.label;option.textContent=o.label;select.appendChild(option);}
                select.value=batchSelection.get(entry.id)?.option || entry.card.options[0]?.label;
                select.setAttribute('aria-label',entry.id+' 接收方案');
                check.disabled = !check.checked && (entry.conflict || entry.source_match===false || entry.card.postponed);
                check.addEventListener('change',()=>{if(check.checked) batchSelection.set(entry.id,{id:entry.id,version:entry.version,option:select.value}); else batchSelection.delete(entry.id); check.disabled=!check.checked && (entry.conflict || entry.source_match===false || entry.card.postponed); saveBatchSelection(); selectedCount();});
                const reference=document.createElement('div'), referenceTitle=document.createElement('strong'), referenceText=document.createElement('pre'), referenceWarning=document.createElement('small');
                reference.className='questionReference'; referenceTitle.textContent='原文'; referenceText.className='review-text'; reference.append(referenceTitle,referenceText,referenceWarning);
                const comparison=document.createElement('div'); comparison.className='questionOptions';
                const optionNodes=entry.card.options.map(option=>{
                    const node=document.createElement('div'), heading=document.createElement('strong'), text=document.createElement('pre');
                    node.className='questionOption'; node.tabIndex=0; node.setAttribute('role','group'); node.dataset.batchOption=option.label;
                    heading.textContent='方案 '+option.label+(option.label==='A' ? ' · 推荐' : ''); text.className='review-text';
                    const choose=()=>{
                        const live=directoryItems.find(item=>item.id===entry.id), chosen=batchSelection.get(entry.id);
                        if (!live || live.version!==entry.version || chosen && chosen.version!==entry.version) {status('审核项版本已变化，请重新核对所选项。',true);return;}
                        if (waiting || coordinating || unavailable || conflict || entry.conflict || entry.source_match===false || entry.card.postponed || questionEntryDraft(entry)) {status('当前项暂不可批选，请先处理草稿、暂缓或定位冲突。',true);return;}
                        select.value=option.label;
                        if (!check.checked) {check.checked=true;check.dispatchEvent(new Event('change'));}
                        else select.dispatchEvent(new Event('change'));
                    };
                    bindQuestionOption(node,choose);
                    const actions=document.createElement('div'); actions.className='optionActions';
                    for (const [intent,label] of [['preview','预览'],['editToggle','编辑'],['optionNote','批注'],['accept','接收']]) {
                        const button=document.createElement('button'); button.dataset.action='questionCard'; button.dataset.intent=intent;
                        button.dataset.target=entry.id; button.dataset.targetVersion=entry.version; button.dataset.questionKey=selectedQuestion; button.dataset.option=option.label;
                        button.dataset.targetMismatch=String(!!entry.conflict || entry.source_match===false);
                        button.dataset.postponed=String(!!entry.card.postponed);
                        if (intent==='accept' && entry.card.postponed) button.title='本项已暂缓；请打开本项并恢复到活跃队列。';
                        button.textContent=label; if (intent!=='accept') button.className='secondary'; actions.appendChild(button);
                        button.disabled=cardButtonDisabled(button);
                    }
                    node.append(heading,actions,text);
                    if(option.migration){const details=document.createElement('details'),summary=document.createElement('summary'),plan=document.createElement('pre');
                        summary.textContent='此方案的旧版局部要求（未接收前仅作候选意图）';
                        plan.textContent=option.migration.fragments.filter(f=>f.kind==='plan').map(f=>f.text).join('\n');details.append(summary,plan);node.appendChild(details);}
                    comparison.appendChild(node); return {option,node,text};
                });
                const updateExcerpt=()=>{
                    const isCurrent=entry.id===current?.id && entry.version===current.version;
                    const sourceEdited=isCurrent && (sourceDraftStale || data?.block && $('blockSource').value!==data.block.text.replace(/\r\n/g,'\n'));
                    const full=$('questionViewStyle').value==='full';
                    const changes=optionNodes.map(({option})=>math.wordChanges(entry.card.original,isCurrent ? displayed(options.find(item=>item.label===option.label) || option) : option.after));
                    const original=sourceEdited || full ? entry.card.original : changedLines(entry.card.original,changes.flat(),'old') || entry.card.original;
                    models.set(referenceText,math.render(referenceText,original,[],'original',sourceMode ? 'source' : 'preview',globalThis.katex));
                    if (!activeDraft) bindQuestionSource(referenceText,entry,'original',undefined,original);
                    referenceWarning.textContent=sourceEdited ? '原文草稿尚未保存，变更片段暂不可用；请回到本项核对。' : '';
                    optionNodes.forEach(({option,node,text},index)=>{
                        const value=isCurrent ? displayed(options.find(item=>item.label===option.label) || option) : option.after;
                        const clipped=sourceEdited || full ? value : changedLines(value,changes[index],'new') || value;
                        const baseline=sourceEdited || full ? entry.card.original : changedLines(entry.card.original,changes[index],'old') || entry.card.original;
                        const visibleChanges=sourceEdited ? [] : full ? changes[index] : math.wordChanges(baseline,clipped);
                        models.set(text,math.render(text,clipped,visibleChanges,'candidate',sourceMode ? 'source' : 'preview',globalThis.katex));
                        if (!activeDraft) bindQuestionSource(text,entry,'candidate',option.label,clipped);
                        node.querySelector('strong').textContent='方案 '+option.label+(option.label==='A' ? ' · 推荐' : '')+(isCurrent && value!==option.after ? '（未保存草稿）' : '');
                    });
                    return changes;
                };
                select.addEventListener('change',()=>{if(check.checked && batchSelection.get(entry.id)?.version===entry.version) {batchSelection.set(entry.id,{id:entry.id,version:entry.version,option:select.value});saveBatchSelection();selectedCount();}updateExcerpt();});
                card.append(check,select);
                const changes=updateExcerpt();
                if (!activeDraft) {
                    const full=$('questionViewStyle').value==='full';
                    questionTranslationControl(reference,entry,'original',undefined,full ? entry.card.original : changedLines(entry.card.original,changes.flat(),'old'));
                    optionNodes.forEach(({option,node},index)=>questionTranslationControl(node,entry,'candidate',option.label,full ? option.after : changedLines(option.after,changes[index],'new')));
                }
                card.append(reference,comparison);
            }
            const open=document.createElement('button');open.className='secondary';open.dataset.action='questionCard';open.dataset.intent='open';open.dataset.questionKey=selectedQuestion;open.dataset.target=entry.id;open.dataset.targetVersion=entry.version;open.textContent='打开本项（段落审核）';
            if (!entry.card) {open.dataset.action='switch';open.textContent='打开本项';}
            card.appendChild(open);column.appendChild(card);
        }
        root.appendChild(column);
    }
    $('questionModeScope').textContent=selectedQuestion === '__unbound__' ? '未绑定不代表没有修改。' : '';
    $('questionModeView').hidden=reviewMode!=='question'; $('review').hidden=reviewMode==='question' || unavailable;
    document.querySelector('[data-action="paragraphMode"]').setAttribute('aria-pressed',String(reviewMode==='paragraph'));
    document.querySelector('[data-action="questionMode"]').setAttribute('aria-pressed',String(reviewMode==='question'));
    selectedCount();
    observeQuestionTranslations();
    observeParagraphTranslations();
    placeComposer();
    if (selected?.questionKey && !$('noteComposer').hidden) {
        $('scope').textContent=selectionLabel(selected)+'选区：'+selected.value.slice(selected.start,selected.end)
            +(reviewMode!=='question' || selected.questionKey!==selectedQuestion ? '；原问题已切换，请返回原问题后保存或重新选择。' : '');
    }
}
function bindQuestionSource(node,entry,side,option,source) {
    const viewStyle=$('questionViewStyle').value;
    const key=JSON.stringify([currentSession,selectedQuestion,entry.id,entry.version,side,option || '',viewStyle,source]);
    node.dataset.questionSource=key;
    questionSources.set(key,{node,session:currentSession,questionKey:selectedQuestion,target:entry.id,targetVersion:entry.version,side,option,viewStyle,source});
}
function markDirectoryCursor() {
    for (const node of $('directoryResults').querySelectorAll('button')) {
        const active = node.dataset.target === directoryCursor;
        node.classList.toggle('directoryCurrent', active);
        if (active) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
    }
}
function renderOption(o) {
    let article = $('option-' + o.label);
    if (!article) {article = document.createElement('article'); article.id = 'option-' + o.label; $('options').appendChild(article);}
    article.dataset.reviewId = current.id; article.dataset.reviewVersion = current.version;
    article.className = [preview === o.label ? 'selected' : '', focused === o.label ? 'focused' : focused ? 'folded' : ''].join(' ');
    if (!article.children.length) article.innerHTML = '<div class="optionHeading"><h4>' + o.label + (o.label === 'A' ? ' · 推荐' : '') + '</h4>'
        + '<div class="optionActions"><button data-action="preview" data-option="' + o.label + '" class="secondary" title="预览本方案的审核 PDF">预览</button><button data-action="focus" data-option="' + o.label + '" class="secondary">' + (focused === o.label ? '返回比较' : '展开') + '</button><button data-action="translateCard" data-option="' + o.label + '" class="secondary">翻译／收起</button><button data-action="accept" data-write data-option="' + o.label + '">接收 ' + o.label + '</button><details class="more"><summary title="更多方案操作" aria-label="更多方案操作">⋯</summary><div class="menu"><button data-action="editToggle" data-option="' + o.label + '">编辑候选</button><button data-action="optionNote" data-option="' + o.label + '">针对 ' + o.label + ' 写返修要求</button></div></details></div></div><small class="draftLabel"></small>'
        + '<details class="migrationIntent"><summary>查看此方案的旧版局部要求</summary><pre></pre></details><div class="detail"><div class="review-text" id="text-' + o.label + '" data-side="candidate" data-option="' + o.label + '"></div><div class="zh" id="zh-' + o.label + '" ' + (chinese ? '' : 'hidden') + '></div>'
        + '<div id="editor-' + o.label + '" hidden><textarea class="edit" id="edit-' + o.label + '" data-option="' + o.label + '" spellcheck="false"></textarea><button data-action="save" title="保存此候选（Ctrl/Cmd+Enter）" data-write data-option="' + o.label + '">保存 ' + o.label + '（不接收）</button><button data-action="saveAccept" data-write data-option="' + o.label + '">保存并接收 ' + o.label + '</button><small>“保存”只更新待审版本；“保存并接收”替换正文并进入下一项。</small></div></div>';
    const migration=article.querySelector('.migrationIntent');
    migration.hidden=!o.migration;
    migration.querySelector('pre').textContent=o.migration ? '此方案未接收前仅为候选意图。\n' + o.migration.fragments.filter(f=>f.kind==='plan').map(f=>f.text).join('\n') : '';
    if (translatedText.has(o.label) && translatedText.get(o.label).source !== o.after) {
        translatedText.delete(o.label); $('zh-' + o.label).textContent = ''; rendered.delete($('zh-' + o.label));
    }
    const text = drafts.get(o.label) ?? o.after.replace(/\r\n/g, '\n');
    if ($('edit-' + o.label).value !== text) $('edit-' + o.label).value = text;
}
function hasDraft(o) {return drafts.has(o.label) && drafts.get(o.label) !== o.after.replace(/\r\n/g, '\n');}
function displayed(o) {return hasDraft(o) ? drafts.get(o.label) : o.after;}
function textChanges(node, before, after, translated = false) {
    const saved = differences.get(node);
    if (saved?.before === before && saved.after === after) return saved.changes;
    const changes = math.wordChanges(before, after, translated);
    differences.set(node, {before, after, changes});
    return changes;
}
function renderReadings() {
    const pair = comparison === 'original' ? [] : comparison.split(':');
    const left = options.find(o => o.label === pair[0]), right = options.find(o => o.label === pair[1]);
    const paired = !!(left && right);
    const pairChanges = paired ? textChanges($('comparisonChoice'), displayed(left), displayed(right)) : undefined;
    const selectedOption = options.find(o => o.label === preview) || options[0];
    const originalChanges = hasDraft(selectedOption) ? textChanges($('text-' + selectedOption.label), data.original, displayed(selectedOption)) : selectedOption.changes;
    renderText($('original'), data.original, paired ? [] : originalChanges, 'original');
    const manual = options.some(o => o.manually_edited || hasDraft(o));
    $('comparisonNotice').hidden = !paired;
    $('comparisonNotice').textContent = paired ? `${left.label} → ${right.label}：仅突出两个方案之间的差异，不改变 PDF 或接收结果；接收按钮始终对应自己的方案。` : '';
    for (const o of options) {
        const article = $('option-' + o.label), draft = hasDraft(o);
        article.hidden = paired && !pair.includes(o.label);
        article.querySelector('h4').textContent = o.label + (paired ? o === left ? ' · 基准' : o === right ? ' · 比较' : '' : o.label === 'A' && !manual ? ' · 推荐' : '');
        article.querySelector('.draftLabel').textContent = draft ? '未保存预览；译文保存后更新。'
            : o.manually_edited ? '作者已手动调整。' : '';
        $('zh-' + o.label).hidden = !chinese || draft;
        if (article.hidden) continue;
        const changes = paired ? pairChanges : draft ? textChanges($('text-' + o.label), data.original, displayed(o)) : o.changes;
        const node = $('text-' + o.label);
        renderText(node, displayed(o), changes, paired && o === left ? 'original' : 'candidate');
        if (paired && !models.get(node).text.trim()) {
            node.textContent = o === left ? '基准方案为空。' : '比较方案为空。'; rendered.delete(node);
        }
    }
    highlightSelection();
    placeComposer();
    for (const [key, entry] of translatedText) renderTranslation(key, entry);
    observeParagraphTranslations();
}
function queueDraftPreview() {
    if (draftFrame !== undefined) return;
    draftFrame = requestAnimationFrame(() => {draftFrame = undefined; if (data && !unavailable) keepReading(renderReadings);});
}
function renderQuestions(questions) {
    const container = $('questions'), existing = new Map([...container.children].map(n => [n.dataset.key, n]));
    const entries = new Map([...existing].map(([key, node]) => [key, translatedText.get('question' + node.dataset.index)]));
    for (const key of translatedText.keys()) if (key.startsWith('question')) translatedText.delete(key);
    const keys = new Set(questions.map(q => JSON.stringify([q.id, q.file, q.quote])));
    for (const [key, node] of existing) if (!keys.has(key)) {
        if (node.contains($('noteComposer'))) $('composerDock').appendChild($('noteComposer'));
        node.remove();
    }
    if (!questions.length) {container.textContent = '当前未关联审稿问题；新论文撰写可以不关联。'; highlightSelection(); return;}
    if (!container.children.length) container.textContent = '';
    for (const [index, q] of questions.entries()) {
        const key = JSON.stringify([q.id, q.file, q.quote]);
        let node = existing.get(key);
        if (!node) {
            node = document.createElement('div'); node.className = 'question'; node.dataset.key = key;
            node.innerHTML = '<details><summary><strong></strong></summary><div class="questionHeading"><div><button class="secondary" data-action="question" title="跳转到原始审稿意见文件位置">原始位置</button><button class="secondary" data-action="questionFocus">进入问题审核</button><button class="secondary" data-action="related" title="查看本问题关联的全部改动">全部改动</button></div></div><div class="review-text"></div><div class="zh"></div></details>';
            const summary=Array.from(q.quote.replace(/\s+/g, ' '));
            node.querySelector('strong').textContent = q.id + ' · ' + summary.slice(0,100).join('') + (summary.length > 100 ? '…' : '');
        }
        if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
        node.dataset.index = String(index);
        for (const b of node.querySelectorAll('button')) b.dataset.index = String(index);
        const text = node.querySelector('.review-text'), zh = node.querySelector('.zh');
        text.id = 'question-text-' + index; zh.id = 'zh-question' + index; zh.hidden = !chinese;
        text.dataset.question = String(index);
        renderText(text, q.quote, [], 'readonly');
        const entry = entries.get(key);
        if (entry && entry.source === q.quote) translatedText.set('question' + index, entry);
    }
    for (const [key, entry] of translatedText) if (key.startsWith('question')) renderTranslation(key, entry);
    highlightSelection();
}
function noteOrigin(n) {
    const context = n.display_context;
    const origin = context ? (context.question ? context.question.id : n.option ? '方案 ' + n.option : '原文') + (context.kind === 'translation' ? '译文' : '审稿问题') : n.option || '整项';
    return origin + ' · ' + ({revision:'普通返修',skill:'完善通用 SKILL',personal:'完善我的习惯',paper_requirements:'完善本论文要求',paper_background:'论文背景',discussion:'仅提问或讨论'}[n.purpose || 'revision']) + ' · ' + n.version.slice(0, 8);
}
function fulfillmentText(n) {
    if (data.source_match === false || n.source_stale) return '<p>原文或批注基准已变化，请重新核对返修说明。</p>';
    const mappings = (data.fulfillment || []).filter(m => m.request === n.id && m.request_version === n.version && m.request_text === n.text);
    return mappings.length ? mappings.map(m => '<p>返修说明（已保存本版） · 方案 ' + esc(m.option) + ' · ' + esc(({attempted:'已尝试',partial:'部分',author:'待作者',evidence:'待证据'})[m.status]) + '：' + esc(m.explanation) + ' <button class="secondary" data-action="locateFulfillment" data-mapping="' + data.fulfillment.indexOf(m) + '">查看对应文字：' + esc(m.quote) + '</button></p>').join('') : '<p>本版未说明此要求的处理情况。</p>';
}
function renderPreviousNotes() {
    const container = $('previousNotes');
    const active = new Set((data.edit.requests || []).map(n => n.id));
    const notes = (data.edit.previous_feedback?.requests || []).filter(n => !active.has(n.id));
    $('previousFeedback').hidden = !notes.length;
    const signature = JSON.stringify([notes, notes.map(n => data.edit.versions.indexOf(n.version)), data.fulfillment, data.source_match]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.innerHTML = notes.map(n => '<div class="note"><strong>' + esc(noteOrigin(n)) + '</strong><div class="review-text">' + esc(n.text) + '</div>' +
        ((n.display_context?.quote ?? n.quote) ? '<details><summary>此前选区</summary><div class="review-text">' + esc(n.display_context?.quote ?? n.quote) + '</div></details>' : '') + fulfillmentText(n) + '</div>').join('');
}
function renderNotes(requests) {
    renderPreviousNotes();
    const container = $('notes');
    for (const node of [...container.children]) if (!requests.some(n => n.id === node.dataset.noteId)) {
        if (node.contains($('noteComposer'))) $('notes').before($('noteComposer'));
        node.remove();
    }
    for (const n of requests) {
        let node = [...container.children].find(node => node.dataset.noteId === n.id);
        if (!node) {node = document.createElement('div'); node.className = 'note'; node.dataset.noteId = n.id; container.appendChild(node);}
        const mappings = (data.fulfillment || []).filter(m => m.request === n.id && m.request_version === n.version && m.request_text === n.text);
        const signature = JSON.stringify([n, n.version === current.version, mappings, data.source_match]);
        if (node.dataset.signature === signature) continue;
        node.dataset.signature = signature;
        if (node.contains($('noteComposer'))) $('notes').before($('noteComposer'));
        const context = n.display_context;
        const origin = noteOrigin(n);
        node.innerHTML = '<strong>' + esc(origin) + ' · ' + esc(n.status) + (n.held ? ' · 暂留' : '') + (n.source_stale ? ' · 原批注，内容已变' : '') + '</strong><div class="review-text">' + esc(n.text) + '</div><details><summary>查看批注选区</summary><button class="secondary noteQuote" data-action="locateNote" title="定位并高亮本条批注的准确范围">' + esc(context?.quote ?? n.quote) + '</button></details>' +
            (n.status === 'open' && n.version === current.version ? '<button class="secondary" data-action="editNoteOpen">编辑批注</button>' : '') +
            fulfillmentText(n);
    }
    placeComposer();
    buttons();
}
function placeComposer() {
    const composer = $('noteComposer'), activeInput = composer.contains(document.activeElement) ? document.activeElement : undefined;
    const previousParent = composer.parentElement;
    const notes = [...$('notes').children], target = editingNote && notes.find(n => n.dataset.noteId === editingNote.id);
    for (const note of notes) note.classList.toggle('editing', note === target);
    if (target) {if ($('noteComposer').parentElement !== target) target.appendChild($('noteComposer'));}
    else {
        const side = selected?.side || ($('scopeChoice').value === 'original' ? 'original' : 'candidate');
        const label = selected?.option || $('scopeChoice').value;
        const content = selected && (selected.questionSourceKey || ['question', 'translation'].includes(side)) ? selectionNode(selected) : side === 'original' ? $('originalZh') : $('zh-' + label);
        const article = content?.closest('article');
        const obscured = article && (article.hidden || article.classList.contains('folded'));
        if (!composer.hidden && reviewMode==='question' && (!content || !$('questionModeView').contains(content))) {
            if (composer.parentElement !== $('questionComposerDock')) $('questionComposerDock').appendChild(composer);
        }
        else if (!composer.hidden && reviewMode==='paragraph' && content && $('questionModeView').contains(content)) {
            if (composer.parentElement !== $('composerDock')) $('composerDock').appendChild(composer);
        }
        else if (content && !composer.hidden && obscured) {if (composer.parentElement !== $('composerDock')) $('composerDock').appendChild(composer);}
        else if (content && !composer.hidden) {if (content.nextElementSibling !== composer) content.after(composer);}
        else if ($('noteComposer').nextElementSibling !== $('notes')) $('notes').before($('noteComposer'));
    }
    if (activeInput && composer.parentElement !== previousParent) activeInput.focus({preventScroll: true});
}
function closeComposer() {
    status('');
    editingNote = undefined; selected = pendingSelection = undefined; selectionStale = false; highlightSelection(); $('note').value = ''; $('notePurpose').value='revision'; $('noteComposer').hidden = true; $('noteMode').textContent = '新增返修批注';
    $('noteScopeControls').hidden = false; $('saveNote').textContent = '保存返修批注'; placeComposer(); dirty();
}
function openComposer() {$('noteComposer').hidden = false; placeComposer();}
function canChangeNote() {
    if (editingNote || $('note').value.trim()) {status('请先保存或取消当前批注输入。', true); return false;}
    return true;
}
function scope() {
    selected = pendingSelection = undefined; selectionStale = false; highlightSelection();
    $('scope').textContent = (reviewMode==='question' ? '当前审核项 '+current.id+'：' : '') + ($('scopeChoice').value === 'group' ? '针对本项全部方案，不需要逐个拒绝。' : $('scopeChoice').value === 'original' ? '针对完整原文。' : '针对方案 ' + $('scopeChoice').value + ' 整体。');
    placeComposer(); buttons();
}
function highlightSelection() {
    $('useSelection').hidden = !pendingSelection;
    if (!globalThis.CSS?.highlights) return;
    CSS.highlights.delete('review-selection');
    if (!selected || selectionStale) return;
    const node = selectionNode(selected), model = models.get(node);
    if (!model) {
        if (!node || selected.side === 'translation' && translatedText.get(node.dataset.translation)?.error) {selectionStale = true; buttons();}
        return;
    }
    if (model.raw.replace(/\r\n/g, '\n') !== selected.value) {selectionStale = true; buttons(); return;}
    CSS.highlights.set('review-selection', new Highlight(...math.selectionRanges(model, selected.start, selected.end)));
}
function selectionNode(value) {
    if (value.questionSourceKey) return questionSources.get(value.questionSourceKey)?.node;
    if (value.questionTranslationKey) return questionNodes.get(value.questionTranslationKey)?.node;
    const index = value.question && (data.edit.questions || []).findIndex(q => q.id === value.question.id && q.file === value.question.file && q.quote === value.question.quote);
    if (value.question && index < 0) return;
    if (value.side === 'question') return $('question-text-' + index);
    if (value.side === 'translation') return value.question ? $('zh-question' + index) : value.option ? $('zh-' + value.option) : $('originalZh');
    return $(value.side === 'original' ? 'original' : 'text-' + value.option);
}
function selectionLabel(value) {
    return (value.questionTarget ? value.questionTarget + ' · ' : '') + (value.question ? value.question.id : value.side==='question' ? '审稿问题' : value.option ? '方案 ' + value.option : '原文')
        + (value.side === 'translation' ? '中文译文' : value.side === 'question' && value.question ? '审稿问题' : '');
}
function bindSelection(value) {
    selected = value; pendingSelection = undefined; selectionStale = false; openComposer();
    $('scope').textContent = selectionLabel(selected) + '选区：' + selected.value.slice(selected.start, selected.end) + (selected.wholeMath ? '（整式；细部请切换源码）' : '');
    highlightSelection(); buttons(); remember();
}

function locateRanges(ranges) {
    if (!ranges.length) {status('该范围在当前预览中没有可显示文字；可切换 LaTeX 源码查看。', true); return;}
    if (globalThis.CSS?.highlights) CSS.highlights.set('review-location', new Highlight(...ranges));
    const rect = ranges[0].getBoundingClientRect(), header = document.querySelector('header').getBoundingClientRect();
    window.scrollBy(0, rect.top - header.bottom - (innerHeight - header.bottom) / 3);
}
function revealCandidate(label) {
    if (!label) return;
    if ($('option-' + label).hidden) {comparison = 'original'; $('comparisonChoice').value = comparison; renderReadings();}
    if ($('option-' + label).classList.contains('folded')) {
        focused = label;
        for (const o of options) {const node = $('option-' + o.label); node.classList.toggle('focused', focused === o.label); node.classList.toggle('folded', focused !== o.label);}
        for (const b of document.querySelectorAll('[data-action="focus"]')) b.textContent = focused === b.dataset.option ? '返回比较' : '展开';
    }
}
function locateNote(id) {
    const note = data.edit.requests.find(n => n.id === id);
    if (!note || note.version !== current.version) {status('该批注属于其他候选版本，未猜测当前位置。', true); return;}
    if (note.display_context) {
        const ctx = note.display_context, value = {side: ctx.kind, question: ctx.question, option: note.option};
        if (ctx.kind==='translation' && ctx.review_question) {
            const questionKey=JSON.stringify([ctx.review_question.id,ctx.review_question.file,ctx.review_question.quote]);
            if (!questionRows.some(row=>row.key===questionKey && row.entries.some(entry=>entry.id===current.id && entry.version===current.version))) {
                status('原关联问题已变化；批注快照仍保留。',true);return;
            }
            selectedQuestion=questionKey; reviewMode='question'; $('questionViewStyle').value=ctx.source_excerpt ? 'snippets' : 'full';
            renderQuestionMode();send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);
            const target=[...questionNodes.values()].find(item=>item.target===current.id && item.targetVersion===current.version &&
                item.side===ctx.source_side && item.option===note.option && item.source===(ctx.source_excerpt || ctx.source));
            const translation=target && questionTranslations.get(target.displayKey);
            if (!target || translation?.provider!==ctx.provider || translation.text!==ctx.text) {status('原译文尚未就绪或已变化，请核对批注快照。',true);return;}
            chinese=true;questionClosed.delete(target.closeKey);target.draw();
            const model=models.get(target.node), offset=n=>Array.from(ctx.text).slice(0,n).join('').replace(/\r\n/g,'\n').length;
            if (!model) {status('原译文尚未就绪，批注快照仍保留。',true);return;}
            locateRanges(math.selectionRanges(model,offset(ctx.start),offset(ctx.end)));return;
        }
        if (note.option) revealCandidate(note.option);
        const node = selectionNode(value), model = models.get(node);
        if (!model || model.raw !== ctx.text) {status('所选问题或译文已变化／尚未就绪，批注快照仍保留，请核对后重新选择。', true); return;}
        if (ctx.kind === 'translation') {chinese = true; node.hidden = false;}
        const offset = n => Array.from(ctx.text).slice(0, n).join('').replace(/\r\n/g, '\n').length;
        locateRanges(math.selectionRanges(model, offset(ctx.start), offset(ctx.end))); return;
    }
    const candidate = note.side === 'candidate' ? options.find(o => o.label === note.option) : undefined;
    const raw = note.side === 'candidate' ? candidate?.after : data.original;
    let start=note.start, end=note.end;
    if (candidate?.migration) {
        const fragments=candidate.migration.fragments, spans=note.segments || [{start,end}];
        const map=offset=>{let removed=0;for(const f of fragments){if(f.start<offset && offset<f.end)return undefined;if(f.end<=offset)removed+=f.end-f.start;}return offset-removed;};
        if (spans.some(span=>fragments.some(f=>Math.max(span.start,f.start)<Math.min(span.end,f.end)))) {status('旧批注选区含迁移前注释；原始快照保留，不能猜测当前范围。',true);return;}
        start=map(spans[0].start);end=map(spans.at(-1).end);
    }
    if (raw === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
        || Array.from(raw).slice(start, end).join('') !== note.quote) {status('批注摘录与当前准确范围不一致，未猜测位置。', true); return;}
    const label = note.side === 'candidate' ? note.option : undefined;
    if (label && hasDraft(options.find(o => o.label === label))) {status('该方案有未保存编辑，请先保存或恢复后定位批注。', true); return;}
    revealCandidate(label);
    const model = models.get($(label ? 'text-' + label : 'original'));
    const offset = n => Array.from(raw).slice(0, n).join('').replace(/\r\n/g, '\n').length;
    locateRanges(math.selectionRanges(model, offset(start), offset(end)));
}
function locateFulfillment(index) {
    const mapping=data.fulfillment?.[index], option=options.find(o=>o.label===mapping?.option);
    if (!mapping || !option || data.source_match===false || hasDraft(option) || Array.from(option.after).slice(mapping.start,mapping.end).join('')!==mapping.quote) {
        status('返修落点已变化或有未保存编辑；请重新核对，未猜测位置。',true);return;
    }
    revealCandidate(option.label);
    const model=models.get($('text-'+option.label));
    const offset=n=>Array.from(option.after).slice(0,n).join('').replace(/\r\n/g,'\n').length;
    locateRanges(math.selectionRanges(model,offset(mapping.start),offset(mapping.end)));
}
function jumpChange(direction) {
    const targets = [];
    for (const node of document.querySelectorAll('.review-text[data-side]')) {
        if (!node.getClientRects().length) continue;
        const entry = displayedChanges.get(node), model = models.get(node);
        if (!entry || !model) continue;
        for (const [a, b] of math.changedRanges(entry.raw, entry.changes, entry.side)) {
            if (a >= b) continue;
            const ranges = math.selectionRanges(model, entry.raw.slice(0, a).replace(/\r\n/g, '\n').length, entry.raw.slice(0, b).replace(/\r\n/g, '\n').length);
            if (ranges.length) targets.push({node, a, b, raw: entry.raw, ranges});
        }
    }
    if (!targets.length) {status('当前可见内容没有可定位的差异。'); return;}
    const index = targets.findIndex(t => t.node === changeCursor?.node && t.a === changeCursor.a && t.b === changeCursor.b && t.raw === changeCursor.raw);
    const next = index < 0 ? (direction > 0 ? 0 : targets.length - 1) : (index + direction + targets.length) % targets.length;
    changeCursor = targets[next]; locateRanges(changeCursor.ranges);
    status('差异 ' + (next + 1) + '/' + targets.length + ' · ' + (changeCursor.node.dataset.option ? '方案 ' + changeCursor.node.dataset.option : '原文'));
}
function selectionChanged(event) {
    if (editingNote || waiting) return;
    let next;
    if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains('edit')) {
        const node = event.target, o = options.find(o => o.label === node.dataset.option);
        if (node.selectionStart === node.selectionEnd) return;
        next = {side: 'candidate', option: o.label, value: node.value, start: node.selectionStart, end: node.selectionEnd};
    } else {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0), ancestor = range.commonAncestorContainer;
        const selector = '.review-text[data-side], .review-text[data-question], .review-text[data-question-source], .zh[data-translation], .zh[data-question-translation]';
        const node = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement).closest(selector);
        if (!node || !node.contains(range.startContainer) || !node.contains(range.endContainer)) {
            const touchesReview = [range.startContainer, range.endContainer].some(n => (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement)?.closest(selector));
            if (touchesReview) status('不能跨原文与候选绑定批注；请在同一内容区内选取。现有范围保持不变。', true);
            return;
        }
        const model = models.get(node);
        if (!model || !model.text) return;
        const bounds = math.selectedRange(node, range, model);
        if (!bounds) {status('该选区不能准确绑定源码；请切换 LaTeX 源码后划词。现有范围保持不变。', true); return;}
        next = {side: node.dataset.side, option: node.dataset.option, value: model.raw.replace(/\r\n/g, '\n'),
            start: model.raw.slice(0, bounds.start).replace(/\r\n/g, '\n').length,
            end: model.raw.slice(0, bounds.end).replace(/\r\n/g, '\n').length, wholeMath: bounds.wholeMath};
        if (node.dataset.questionSource !== undefined) {
            const key=node.dataset.questionSource, value=questionSources.get(key);
            if (!value) return;
            next={...next,side:value.side,option:value.option,questionSourceKey:key,questionTarget:value.target,
                questionTargetVersion:value.targetVersion,questionKey:value.questionKey,questionSource:value.source,
                questionViewStyle:value.viewStyle,session:value.session};
        } else if (node.dataset.questionTranslation !== undefined) {
            const key=node.dataset.questionTranslation, value=questionNodes.get(key), entry=questionTranslations.get(key);
            if (!value || !entry || entry.error || entry.noTranslation) return;
            next={...next,side:'translation',provider:entry.provider,questionTranslationKey:key,questionTarget:value.target,
                questionTargetVersion:value.targetVersion,questionKey:value.questionKey,questionSide:value.side,option:value.option,
                questionSource:value.source,questionViewStyle:value.viewStyle,session:value.session};
        } else if (node.dataset.translation !== undefined) {
            const key = node.dataset.translation, entry = translatedText.get(key);
            if (!entry || entry.error) return;
            next.side = 'translation'; next.provider = entry.provider;
            if (key.startsWith('question')) next.question = data.edit.questions[Number(key.slice(8))];
            else if (key !== 'original') next.option = key;
        } else if (node.dataset.question !== undefined) {next.side = 'question'; next.question = data.edit.questions[Number(node.dataset.question)];}
    }
    if ($('note').value.trim()) {
        pendingSelection = next; highlightSelection();
        status('已有批注输入，保留原绑定范围；需要替换时点击“改用新选区”。');
    } else bindSelection(next);
}
document.addEventListener('mouseup', selectionChanged);
const outsideDialogs = new WeakSet();
for (const dialog of document.querySelectorAll('dialog')) {
    const outside = event => {const box=dialog.getBoundingClientRect(); return event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom;};
    dialog.addEventListener('pointerdown', event => {if (event.target===dialog && outside(event)) outsideDialogs.add(dialog); else outsideDialogs.delete(dialog);});
    dialog.addEventListener('click', event => {if (event.target===dialog && outsideDialogs.has(dialog) && outside(event)) dialog.close(); outsideDialogs.delete(dialog);});
}
document.addEventListener('pointerdown', event => {
    for (const menu of document.querySelectorAll('details.more[open]')) if (!menu.contains(event.target)) menu.open=false;
});
document.addEventListener('pointerdown', event => {
    restoration = undefined;
    if (globalThis.CSS?.highlights) CSS.highlights.delete('review-location');
    for (const menu of document.querySelectorAll('details.more[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keyup', event => {if (event.shiftKey) selectionChanged(event);});
document.addEventListener('input', event => {
    restoration = undefined;
    if (event.target.id === 'directoryQuery') filterDirectory();
    if (event.target.classList.contains('edit')) {
        drafts.set(event.target.dataset.option, event.target.value);
        if (!$('note').value.trim() && !editingNote) scope();
        if (!event.isComposing) queueDraftPreview();
    }
    if (event.target.matches('textarea')) dirty();
});
document.addEventListener('compositionend', event => {if (event.target.classList.contains('edit')) queueDraftPreview();});
$('comparisonChoice').addEventListener('change', () => {
    comparison = $('comparisonChoice').value; focused = undefined;
    for (const article of $('options').children) {article.classList.remove('focused', 'folded'); article.querySelector('[data-action="focus"]').textContent = '展开';}
    keepReading(renderReadings); remember();
});
$('scopeChoice').addEventListener('change', scope);
for (const id of ['directoryKind', 'directoryNotes', 'directoryQueue']) $(id).addEventListener('change', filterDirectory);
$('stashChoice').addEventListener('change', renderStash);
$('directoryDialog').addEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.id !== 'directoryQuery' && !event.target.closest('#directoryResults')) return;
    const nodes = [...$('directoryResults').querySelectorAll('button:not(:disabled)')];
    if (!nodes.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = nodes.findIndex(n => n.dataset.target === directoryCursor), step = event.key === 'ArrowDown' ? 1 : -1;
        const node = nodes[(index + step + nodes.length) % nodes.length];
        directoryCursor = node.dataset.target; markDirectoryCursor(); node.scrollIntoView({block: 'nearest'});
        if (event.target.id !== 'directoryQuery') node.focus({preventScroll: true});
    } else if (event.key === 'Enter') {
        event.preventDefault(); nodes.find(n => n.dataset.target === directoryCursor)?.click();
    }
});
$('directoryResults').addEventListener('focusin', event => {
    const node = event.target.closest('button[data-target]');
    if (node) {directoryCursor = node.dataset.target; markDirectoryCursor();}
});
document.addEventListener('change', event => {
    const input = event.target;
    if (!input.dataset.style || !input.reportValidity()) return;
    const value = input.type === 'number' ? input.valueAsNumber : input.value;
    style({...appearance, [input.dataset.style]: value});
    saveAppearance({values: {[input.dataset.style]: value}});
});
document.addEventListener('click', () => queueMicrotask(remember));
document.addEventListener('change', () => remember());
document.addEventListener('toggle', queueRemember, true);
document.addEventListener('scroll', queueRemember, true);
document.addEventListener('selectionchange', queueRemember);
document.addEventListener('wheel', () => {restoration = undefined;}, {passive: true});
document.addEventListener('keydown', () => {restoration = undefined;});
document.addEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const editing = event.target.closest('input,textarea,[contenteditable="true"]');
    let action;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        action = event.target.id === 'note' ? 'note' : event.target.matches('textarea.edit') ? 'save' : undefined;
    } else if (!editing && event.altKey && !event.ctrlKey && !event.metaKey) {
        action = {ArrowLeft: 'previous', ArrowRight: 'next', KeyF: 'directory', KeyN: 'newNote', f: 'directory', n: 'newNote'}[event.code || event.key];
    }
    if (!action) return;
    const option = event.target.dataset.option;
    const button = document.querySelector('button[data-action="' + action + '"]' + (option ? '[data-option="' + option + '"]' : ''));
    if (button && !button.disabled) {event.preventDefault(); button.click();}
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) remember();
    else api.postMessage({type: 'ready', instance, state: api.getState()});
});
$('compare').addEventListener('change', () => send('preview', {option: preview, compare: $('compare').checked}));
$('questionModeChoice').addEventListener('change', () => {selectedQuestion=$('questionModeChoice').value; renderQuestionMode(); send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);});
$('questionViewStyle').addEventListener('change', () => {renderQuestionMode();send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);});
$('questionType').addEventListener('change', renderQuestionMode);
$('notesScope').addEventListener('change', renderFeedbackManager);
for (const id of ['notePurpose','batchPurpose','batchNoteScope']) $(id).addEventListener('change', dirty);
document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const type = button.dataset.action, option = button.dataset.option;
    localFeedback = feedbackFor(button);
    const menu = button.closest('.more'); if (menu) menu.open = false;
    if (type === 'toolbarSettings') {toolbarDraft={order:[...toolbar.order],visible:[...toolbar.visible]}; $('toolbarStatus').textContent=''; renderToolbarChoices(); $('toolbarDialog').showModal(); return;}
    if (type === 'toolbarCancel') {$('toolbarDialog').close(); return;}
    if (type === 'toolbarReset') {toolbarDraft={order:[...toolbarDefault.order],visible:[...toolbarDefault.visible]}; renderToolbarChoices(); return;}
    if (type === 'toolbarSave') {$('toolbarStatus').textContent='正在保存…'; send(type,{toolbar:toolbarDraft},false); return;}
    if (type === 'manageNotes') {renderFeedbackManager(); $('notesDialog').showModal(); return;}
    if (type === 'closeNotes') {$('notesDialog').close(); return;}
    if (type === 'clearNotes') {for (const [key,row] of noteSelection) if ($('notesScope').value === 'all' || row.id === current.id) noteSelection.delete(key); saveNoteSelection(); renderFeedbackManager(); return;}
    if (type === 'selectNotes') {for (const row of feedbackRows.filter(row => row.note.id && row.note.version && ($('notesScope').value === 'all' || row.id === current.id))) if (!noteSelection.has(noteKey(row))) noteSelection.set(noteKey(row),row); saveNoteSelection(); renderFeedbackManager(); return;}
    if (['holdNotes','releaseNotes','deleteNotes'].includes(type)) {
        if (!noteSelection.size) {$('notesStatus').textContent='请先选择批注。'; return;}
        $('notesStatus').textContent=''; send('manageFeedback',{session:currentSession,items:[...noteSelection.values()],action:{holdNotes:'hold',releaseNotes:'release',deleteNotes:'delete'}[type]}); return;
    }
    if (type === 'paragraphMode' || type === 'questionMode') {reviewMode=type === 'questionMode' ? 'question' : 'paragraph';renderQuestionMode();send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);return;}
    if (type === 'questionFocus') {const q=data.edit.questions[Number(button.dataset.index)]; selectedQuestion=JSON.stringify([q.id,q.file,q.quote]); reviewMode='question'; renderQuestionMode(); send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false); return;}
    if (type === 'questionCard') {send(type,{session:currentSession,questionKey:button.dataset.questionKey,target:button.dataset.target,targetVersion:button.dataset.targetVersion,option,intent:button.dataset.intent});return;}
    if (type === 'questionSelectAll') {for (const check of $('questionModeCards').querySelectorAll('input[data-question-item]:not(:disabled)')) if (!check.checked) {check.checked=true;check.dispatchEvent(new Event('change'));}return;}
    if (type === 'questionAccept' || type === 'questionAcceptAll') {
        const ids=new Set(questionEntries().map(entry=>entry.id));
        const items=[...batchSelection.values()].filter(item=>type==='questionAcceptAll'||ids.has(item.id));
        send('acceptBatch',{items,session:currentSession,questionKey:selectedQuestion,questionOnly:type==='questionAccept'});return;
    }
    if (type === 'appearance') {style(appearance); $('appearanceDialog').showModal(); return;}
    if (type === 'followFont') {style({...appearance, fontFamily:''}); saveAppearance({values:{fontFamily:''}}); return;}
    if (type === 'resetAppearance') {saveAppearance({reset: true}); return;}
    if (type === 'selectAll') {for (const row of $('directoryResults').children) {const input=row.querySelector('input'); if(input && !input.checked) {input.checked=true; input.dispatchEvent(new Event('change'));}} return;}
    if (type === 'clearSelection') {batchSelection.clear(); saveBatchSelection(); filterDirectory(); return;}
    if (type === 'acceptBatch' || type === 'handoffSelected') {send(type,{items:[...batchSelection.values()], session:currentSession}); return;}
    if (type === 'batchNote') {send(type,{items:[...batchSelection.values()].map(item => $('batchNoteScope').value === 'chosen' ? item : {id:item.id,version:item.version}),session:currentSession,text:$('batchNote').value,purpose:$('batchPurpose').value,scope:$('batchNoteScope').value}); return;}
    if (type === 'directory') {filterDirectory(); $('directoryDialog').showModal(); $('directoryQuery').focus(); return;}
    if (type === 'clearFilter') {$('directoryQuery').value = ''; $('directoryKind').value = ''; $('directoryNotes').checked = false; $('directoryQueue').value = 'active'; filterDirectory(); return;}
    if (type === 'nextChange' || type === 'previousChange') {jumpChange(type === 'nextChange' ? 1 : -1); return;}
    if (type === 'locateNote') {locateNote(button.closest('.note').dataset.noteId); return;}
    if (type === 'locateFulfillment') {locateFulfillment(Number(button.dataset.mapping)); return;}
    if (type === 'switch') $('directoryDialog').close();
    if (type === 'newNote') {if (!canChangeNote()) return; scope(); $('noteMode').textContent = '新增返修批注'; openComposer(); $('note').focus(); return;}
    if (type === 'cancelNote') {closeComposer(); return;}
    if (type === 'useSelection') {if (pendingSelection) bindSelection(pendingSelection); return;}
    if (type === 'editNoteOpen') {
        const id = button.closest('.note').dataset.noteId;
        if (editingNote?.id === id) {$('note').focus(); return;}
        if (!canChangeNote()) return;
        const note = data.edit.requests.find(n => n.id === id);
        editingNote = {id, previousText: note.text, previousPurpose:note.purpose || 'revision'}; selected = undefined;
        $('note').value = note.text; $('notePurpose').value=note.purpose || 'revision'; $('noteMode').textContent = '编辑返修批注';
        $('noteScopeControls').hidden = true; $('scope').textContent = '原批注范围保持不变：' + (note.option || '整项');
        $('saveNote').textContent = '保存修改'; placeComposer(); openComposer(); $('note').focus(); dirty(); return;
    }
    if (type === 'mathMode') {toggleMathMode(); return;}
    if (type === 'toggleChinese') {chinese = !chinese; document.querySelectorAll('.zh').forEach(n => n.hidden = !chinese); renderReadings(); for (const value of questionNodes.values()) value.draw(); observeQuestionTranslations(); return;}
    if (type === 'translate' && reviewMode==='question') {
        chinese=true;
        questionVisible=new Set([...questionNodes].filter(([,value])=>{const r=value.node.parentElement.getBoundingClientRect();return r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth;}).map(([key])=>key));
        send('questionTranslationView',{session:currentSession,view:questionViewKey(),visible:[...questionVisible]},false);
        for (const key of questionVisible) {const value=questionNodes.get(key);if (!value) continue;questionClosed.delete(value.closeKey);value.draw();send('questionTranslate',{...value,node:undefined,button:undefined,draw:undefined,auto:false,retry:true},false);}
        observeQuestionTranslations();
        return;
    }
    if (type === 'translateCard') {
        const item=options.find(value=>value.label===option), key=JSON.stringify([current.id,current.version,option]), result=translatedText.get(option);
        if (!item || hasDraft(item)) {status('候选含未保存草稿，请先保存后翻译。',true);return;}
        chinese=true;
        if (paragraphClosed.delete(key)) {if (result && !result.error) {renderTranslation(option,result);return;}}
        else if (result && !result.error) {paragraphClosed.add(key);renderTranslation(option,result);return;}
        send('translateCard',{option},false);return;
    }
    if (type === 'focus') {
        focused = focused === option ? undefined : option;
        for (const o of options) {const node = $('option-' + o.label); node.classList.toggle('focused', focused === o.label); node.classList.toggle('folded', !!focused && focused !== o.label);}
        for (const b of document.querySelectorAll('[data-action="focus"]')) b.textContent = focused === b.dataset.option ? '返回比较' : '展开'; placeComposer(); return;
    }
    if (type === 'whole') {$('scopeChoice').value = 'group'; scope(); return;}
    if (type === 'optionNote') {if (!canChangeNote()) return; $('scopeChoice').value = option; scope(); openComposer(); $('note').focus(); return;}
    if (type === 'editToggle') {$('editor-' + option).hidden = !$('editor-' + option).hidden; if (!$('editor-' + option).hidden) $('edit-' + option).focus(); return;}
    if (type === 'resetSourceDraft') {$('blockSource').value = data.block.text.replace(/\r\n/g, '\n'); sourceDraftStale = false; draftWarning(); dirty(); return;}
    if (type === 'manualRebase') {
        if (!data?.block || selectedBlockRevision !== data.block.source_revision) {status('请先在最新正文块中选择范围或插入位置。', true); return;}
        const field = $('currentBlock'), start = Array.from(field.value.slice(0, field.selectionStart)).length, end = Array.from(field.value.slice(0, field.selectionEnd)).length;
        send(type, {source_revision:data.block.source_revision, block_id:data.block.id, start, end, quote:Array.from(field.value).slice(start,end).join(''),
            options:options.map(o => ({label:o.label, after:drafts.get(o.label) ?? o.after.replace(/\r\n/g, '\n')}))}); return;
    }
    if (type === 'saveSource') {send(type, {value: $('blockSource').value}); return;}
    if (type === 'stashClose') {send(type, {state:snapshot()}); return;}
    if (type === 'restoreStash' || type === 'discardStash') {send(type, {stash:$('stashChoice').value}); return;}
    if (type === 'checkQuestion' || type === 'questionEntry') {
        const row=questionRows.find(item=>item.key===button.dataset.questionKey); if (!row) return;
        const entry=row.entries.find(item=>item.id===button.dataset.target);
        send(type,{questionKey:row.key,snapshot:row.snapshot,target:entry?.id,targetVersion:entry?.version}); return;
    }
    if (type === 'note' || type === 'noteHandoff') {
        const handoff = type === 'noteHandoff';
        if (editingNote) {send('editNote', {request: editingNote.id, text: $('note').value, purpose:$('notePurpose').value, previousText: editingNote.previousText, previousPurpose:editingNote.previousPurpose || 'revision', handoff}); return;}
        const value = $('scopeChoice').value;
        send('note', {...(selected || {side: 'original', option: 'ABC'.includes(value) && value.length === 1 ? value : undefined}), text: $('note').value, purpose:$('notePurpose').value, handoff}); return;
    }
    const clicked = button.closest('article');
    send(type, {...(clicked ? {id:clicked.dataset.reviewId,version:clicked.dataset.reviewVersion} : {}), option, target: button.dataset.target, index: Number(button.dataset.index),
        compare: $('compare').checked, ...(['save', 'saveAccept'].includes(type) ? {value: $('edit-' + option).value} : {})});
});
function activateCardAction() {
    const action=pendingCardAction;
    if (!action || waiting || action.token===consumedCardAction) return;
    pendingCardAction=undefined;
    if (!current || current.repo!==action.c.repo || current.owner!==action.c.owner || current.id!==action.c.id || current.version!==action.c.version || currentSession!==action.session) return;
    consumedCardAction=action.token;
    send('cardActionClaim',{token:action.token},false);
}
function executeCardAction(action) {
    if (!action || waiting || action.token!==consumedCardAction || !current || current.repo!==action.c.repo || current.owner!==action.c.owner || current.id!==action.c.id || current.version!==action.c.version || currentSession!==action.session) return;
    consumedCardAction=undefined;
    if (action.intent==='open' || action.intent==='editToggle' || action.intent==='optionNote') {reviewMode='paragraph';renderQuestionMode();send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);}
    if (action.intent==='open') {status('已打开 '+current.id+' 的段落审核；可切回问题审核。');return;}
    const target=$('option-'+action.option)?.querySelector('[data-action="'+action.intent+'"]');
    if (!target || target.disabled) {status('目标方案当前不可操作，请核对状态。',true);return;}
    target.click();
}
window.addEventListener('message', ({data: message}) => {
    if (message.type === 'toolbarResult') {
        $('toolbarStatus').textContent=message.message || '';
        if (!message.error) {applyToolbar(message.toolbar); $('toolbarDialog').close();}
        return;
    }
    if (message.type === 'cardActionGrant') {executeCardAction(message.action); return;}
    if (message.type === 'relatedReturn') {showRelatedReturn(message.id); return;}
    if (message.type === 'questionRows') {
        const before=selectedQuestion, composer=$('noteComposer'), rect=composer.getBoundingClientRect();
        const preserveComposer=reviewMode==='question' && !composer.hidden && rect.bottom>0 && rect.top<innerHeight;
        const card=reviewMode==='question' && [...$('questionModeCards').querySelectorAll('article[data-question-target]')].find(node=>node.getBoundingClientRect().bottom>document.querySelector('header').getBoundingClientRect().bottom);
        const cardKey=card && [card.dataset.questionTarget,card.dataset.questionVersion], top=preserveComposer ? rect.top : card?.getBoundingClientRect().top;
        renderQuestionTable(message.questions);
        if (reviewMode==='question' && selectedQuestion===before && top!==undefined) {
            const target=preserveComposer ? composer : [...$('questionModeCards').querySelectorAll('article[data-question-target]')].find(node=>node.dataset.questionTarget===cardKey[0] && node.dataset.questionVersion===cardKey[1]);
            if (target?.isConnected) window.scrollBy(0,target.getBoundingClientRect().top-top);
        }
        if (reviewMode==='question' && selectedQuestion!==before) send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);
        return;
    }
    if (message.type === 'focusQuestion') {
        if (reviewMode!=='question' || message.session!==currentSession) return;
        const row=message.questionKey==='__unbound__' ? null : questionRows.find(item=>item.key===message.questionKey);
        const entries=message.questionKey==='__unbound__' ? directoryItems.filter(item=>!questionRows.some(group=>group.entries.some(entry=>entry.id===item.id))) : row?.entries.filter(entry=>entry.card);
        if (!entries?.length || message.target && !entries.some(entry=>entry.id===message.target && entry.version===message.version)) {status('问题或审核项已变化，请重新选择。',true);return;}
        selectedQuestion=message.questionKey;
        if (message.target) $('questionType').value='';
        renderQuestionMode();
        const card=[...$('questionModeCards').querySelectorAll('article[data-question-target]')].find(node=>node.dataset.questionTarget===message.target && node.dataset.questionVersion===message.version);
        (card || $('questionModeChoice')).scrollIntoView({block:'start'});
        send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);
        return;
    }
    if (message.type === 'handoffRetry') {$('retryHandoff').hidden = !message.available; return;}
    if (message.type === 'busy') {waiting = message.action; buttons(); activateCardAction(); return;}
    if (message.type === 'coordinating') {coordinating = message.busy; buttons(); return;}
    if (message.type === 'batchAccepted') {
        if (current?.repo === message.repo && current.owner === message.owner && currentSession === message.session) {
            for (const item of message.items) {
                const selected = batchSelection.get(item.id);
                if (selected?.version === item.version && selected.option === item.option) batchSelection.delete(item.id);
            }
            selectedCount();
        }
        return;
    }
    if (message.type === 'batchNoteSaved') {
        const items=[...batchSelection.values()].map(item=>message.scope==='chosen' ? item : {id:item.id,version:item.version});
        if ($('batchNote').value === message.text && $('batchPurpose').value === message.purpose && $('batchNoteScope').value===message.scope && JSON.stringify(items)===JSON.stringify(message.items)) {$('batchNote').value = ''; $('batchPurpose').value='revision'; $('batchNoteScope').value='whole';}
        dirty(); status(message.message); return;
    }
    if (message.type === 'actionResult') {sideBusy.delete(message.action); buttons(); if (message.message) status(message.message, message.error, message.action); return;}
    if (message.type === 'appearanceResult') {
        if (message.request !== appearanceRequest) return;
        $('appearanceStatus').textContent = message.message; $('appearanceStatus').className = message.error ? 'error' : ''; return;
    }
    if (message.type === 'sourceSelection') {
        if (!canChangeNote()) return;
        if (message.selection) bindSelection(message.selection);
        else {$('scopeChoice').value = 'group'; scope(); openComposer();}
        $('note').focus(); return;
    }
    if (message.type === 'configuration') {
        $('configuration').textContent = message.mcpRuntime?.state === 'mismatch' ? 'MCP 需更新'
            : message.ready && message.mcpRuntime?.state === 'unknown' ? '已配置 · MCP 待核验' : message.ready ? '已配置' : '配置待完善';
        $('configuration').title = message.ready ? '可检测配置已通过，点击重新检查；最近活动 MCP ' + (message.mcpRuntime?.actual || '尚未报告版本') + '；不代表论文已编译' : message.issues.join('；'); return;
    }
    if (message.type === 'style') {style(message.style); return;}
    if (message.type === 'translation') {
        if (message.source !== translationSource(message.key)) return;
        const entry = {...message};
        translatedText.set(message.key, entry);
        for (const [key, value] of translatedText) renderTranslation(key, value);
        return;
    }
    if (message.type === 'translationStatus') {$('translateStatus').textContent = message.message; return;}
    if (message.type === 'questionTranslationReset') {
        questionTranslations.clear(); translatedText.clear();
        for (const node of document.querySelectorAll('#review .zh')) {node.textContent='';rendered.delete(node);}
        renderQuestionMode(); return;
    }
    if (message.type === 'questionTranslation') {
        const value=questionNodes.get(message.displayKey);
        if (!value || message.view!==questionViewKey() || value.view!==message.view || value.source!==message.source || value.targetVersion!==message.targetVersion) return;
        questionTranslations.set(message.displayKey,message); value.draw(); return;
    }
    if (message.type === 'factEvidence') {data.fact_evidence = message.evidence; keepReading(() => {options.forEach(renderOption); renderReadings();}); return;}
    if (message.type === 'pdfStatus') {pdfStatus(message.message); return;}
    if (message.type === 'locationStatus') {
        const oldBlock = data.block, changed = oldBlock?.text !== message.block?.text;
        const sourceDirty = oldBlock && $('blockSource').value !== oldBlock.text.replace(/\r\n/g, '\n');
        if (changed && sourceDirty) sourceDraftStale = true;
        if (changed && options.some(o => drafts.has(o.label) && drafts.get(o.label) !== o.after.replace(/\r\n/g, '\n'))) candidateDraftStale = true;
        selectedBlockRevision = undefined;
        data.block = message.block; data.source_match = message.source_match; data.conflict = message.conflict;
        if (data.block && !sourceDraftStale && !sourceDirty) $('blockSource').value = data.block.text.replace(/\r\n/g, '\n');
        $('blockEditor').hidden = !data.block && !sourceDraftStale;
        $('currentBlockPanel').hidden = !data.block || message.source_match !== false && !candidateDraftStale && !sourceDraftStale && !(oldOriginal && $('note').value.trim());
        $('currentBlock').value = data.block?.text.replace(/\r\n/g, '\n') || '';
        $('locationConflict').hidden = message.source_match !== false;
        $('locationConflict').textContent = message.source_match === false ? '正文或审核块需核对：' + message.conflict + '。候选和批注仍保留。' : '';
        $('syncBlock').hidden = !data.block || message.source_match !== false;
        $('repairBlock').hidden = current.owner !== '.codex-review/state.json' || !data.edit.block_id || message.source_match !== false;
        renderNotes(data.edit.requests || []); draftWarning(); dirty(); return;}
    if (message.type === 'titles') {data.edit.location = message.location; $('title').textContent = current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · ' + (message.location || data.edit.file) + ' · 候选 v' + (data.edit.generation ?? data.edit.versions.length); renderDirectory(message.directory); return;}
    if (message.type === 'titleStatus') {$('titleStatus').textContent = message.message; return;}
    if (message.type === 'backupStatus') {$('backupStatus').textContent = message.message || '后台 Git 备份尚无任务'; if (['failed','local'].includes(message.status)) $('backupDetails').open=true; return;}
    if (message.type === 'directory') {renderDirectory(message.directory); return;}
    if (message.type === 'feedbackRows') {feedbackRows = message.rows; renderFeedbackManager(); return;}
    if (message.type === 'feedbackManaged') {if (message.items) {noteSelection.clear(); for (const item of message.items) noteSelection.set(noteKey(item),item);} if (message.rows) feedbackRows=message.rows; $('notesStatus').textContent=message.message || (message.cancelled ? '已取消，批注未改变。' : ''); renderFeedbackManager();}
    if (message.type === 'preview') {
        preview = message.option;
        for (const o of options) $('option-' + o.label).classList.toggle('selected', preview === o.label);
        renderReadings(); return;
    }
    if (message.type === 'noteEdited') {data.edit.requests = message.requests; data.edit.previous_feedback = message.previous_feedback; if (!message.preserveInput) closeComposer(); renderNotes(message.requests);}
    if (message.type === 'notes') {data.edit.requests = message.requests; data.edit.questions = message.questions; data.edit.previous_feedback = message.previous_feedback;
        keepReading(() => {renderNotes(message.requests); renderQuestions(message.questions);}); return;}
    if (message.type === 'noteSaved' && !message.preserveInput) closeComposer();
    if (message.type === 'conflict') {
        conflict = true;
        if (!$('latest')) {const b = document.createElement('button'); b.id = 'latest'; b.dataset.action = 'latest'; b.textContent = '载入最新（需确认放弃草稿）'; $('pageFeedback').appendChild(b);}
    }
    if (message.type === 'unavailable') {unavailable = true; transactionBlocked = !!message.transaction; $('empty').hidden = false; $('review').hidden = true;}
    if (message.type === 'stashes') {
        stashes = message.stashes || [];
        const priorStash = $('stashChoice').value;
        $('stashChoice').replaceChildren();
        for (const item of stashes) {const option = document.createElement('option'); option.value=item.id; option.textContent='批次 ' + item.session.slice(0,8) + ' · 版本 ' + item.version + (item.exact ? '' : ' · 基准已变化'); $('stashChoice').appendChild(option);}
        if (stashes.some(item => item.id === priorStash)) $('stashChoice').value = priorStash;
        $('stashedDrafts').hidden = !stashes.length; if (stashes.length) renderStash();
        return;
    }
    if (message.type === 'content' || message.type === 'saved') {
        const renderStarted = performance.now();
        rendering = true; restoration = undefined;
        const saved = message.type === 'saved';
        const refresh = !saved && current && current.repo === message.c.repo && current.owner === message.c.owner && current.id === message.c.id;
        const oldOptions = options;
        if (message.session !== undefined && (currentSession !== message.session || current && (current.repo !== message.c.repo || current.owner !== message.c.owner))) selectedQuestion = message.questionPosition || '';
        if (Array.isArray(message.batchItems)) {batchSelection.clear(); for (const item of message.batchItems) batchSelection.set(item.id,item);}
        else if (message.session !== undefined && (currentSession !== message.session || current && (current.repo !== message.c.repo || current.owner !== message.c.owner))) batchSelection.clear();
        if (Array.isArray(message.noteItems)) {noteSelection.clear(); for (const item of message.noteItems) noteSelection.set(noteKey(item),item);}
        feedbackRows = message.feedbackRows || [];
        if (message.session !== undefined) currentSession = message.session;
        current = message.c; data = message.data; options = message.options;
        renderFeedbackManager();
        if (message.toolbar) applyToolbar(message.toolbar);
        renderQuestionTable(message.questions || []);
        stashes = message.stashes || [];
        const priorStash = $('stashChoice').value;
        $('stashChoice').replaceChildren();
        for (const item of stashes) {const option = document.createElement('option'); option.value=item.id; option.textContent='批次 ' + item.session.slice(0,8) + ' · 版本 ' + item.version + (item.exact ? '' : ' · 基准已变化'); $('stashChoice').appendChild(option);}
        if (stashes.some(item => item.id === priorStash)) $('stashChoice').value = priorStash;
        $('stashedDrafts').hidden = !stashes.length; if (stashes.length) renderStash();
        const resume = message.resume;
        selectedBlockRevision = undefined;
        sourceDraftStale = !!resume?.sourceDraftStale; candidateDraftStale = !!resume?.candidateDraftStale; oldOriginal = resume?.oldOriginal;
        showRelatedReturn(message.relatedReturn);
        navigationFilter = message.navigationFilter;
        $('directoryQuery').value = navigationFilter.query; $('directoryKind').value = navigationFilter.kind; $('directoryNotes').checked = navigationFilter.notes; $('directoryQueue').value = navigationFilter.queue || 'active';
        const postponed = message.directory.some(item => item.id === current.id && item.postponed);
        $('postpone').hidden = postponed; $('restorePostponed').hidden = !postponed;
        if (message.reading) {sourceMode = message.reading.sourceMode; chinese = message.reading.chinese;}
        $('originalZh').hidden = !chinese;
        $('mathMode').textContent = sourceMode ? '公式预览' : 'LaTeX 源码';
        $('mathMode').setAttribute('aria-pressed', String(sourceMode));
        preview = message.preview; unavailable = conflict = transactionBlocked = false; $('latest')?.remove();
        style(message.style); $('empty').hidden = true; $('review').hidden = false;
        $('title').textContent = current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · ' + (data.edit.location || data.edit.file) + ' · 候选 v' + (data.edit.generation ?? data.edit.versions.length);
        pdfStatus(message.pdfStatus);
        $('locationConflict').hidden = data.source_match !== false;
        $('locationConflict').textContent = data.source_match === false ? '正文或审核块需核对：' + data.conflict + '。候选和批注仍保留。' : '';
        $('syncBlock').hidden = !data.block || data.source_match !== false;
        $('repairBlock').hidden = current.owner !== '.codex-review/state.json' || !data.edit.block_id || data.source_match !== false;
        document.querySelector('[data-action="relocate"]').hidden = current.owner === '.codex-review/state.json';
        $('blockEditor').hidden = !data.block && !sourceDraftStale;
        $('blockSource').value = resume?.blockDraft ?? data.block?.text.replace(/\r\n/g, '\n') ?? '';
        $('currentBlockPanel').hidden = !data.block || data.source_match !== false && !candidateDraftStale && !sourceDraftStale && !(oldOriginal && resume?.note?.trim());
        $('currentBlock').value = data.block?.text.replace(/\r\n/g, '\n') || '';
        draftWarning();
        renderDirectory(message.directory);
        if (!saved) {
            editingNote = undefined; $('noteComposer').hidden = true; placeComposer(); $('noteScopeControls').hidden = false;
            $('saveNote').textContent = '保存返修批注'; drafts.clear(); selected = pendingSelection = undefined; selectionStale = false;
            focused = undefined; changeCursor = undefined; $('compare').checked = false; $('note').value = ''; $('notePurpose').value='revision'; $('batchNote').value=''; $('batchPurpose').value='revision';
            if (!refresh) {
                $('pageFeedback').appendChild(feedbackNode); status(''); feedbackTargets.clear(); localFeedback = undefined;
                translatedText.clear(); $('options').replaceChildren(); models.delete($('original')); rendered.delete($('original'));
                differences.delete($('comparisonChoice')); $('originalZh').textContent = ''; rendered.delete($('originalZh')); $('questions').replaceChildren();
            } else {
                for (const node of [...$('options').children]) if (!options.some(o => node.id === 'option-' + o.label)) node.remove();
                if (translatedText.has('original') && translatedText.get('original').source !== data.original) {
                    translatedText.delete('original'); $('originalZh').textContent = ''; rendered.delete($('originalZh'));
                }
            }
        }
        else drafts.delete(message.option);
        if (resume) {for (const [label, value] of Object.entries(resume.drafts)) drafts.set(label, value); focused = options.some(o => o.label === resume.focused) ? resume.focused : undefined;}
        for (const o of options) {
            if (saved ? o.label === message.option : !refresh || JSON.stringify(o) !== JSON.stringify(oldOptions.find(old => old.label === o.label))) renderOption(o);
            if (resume && drafts.has(o.label)) $('edit-' + o.label).value = drafts.get(o.label);
            const article = $('option-' + o.label);
            article.classList.toggle('focused', focused === o.label); article.classList.toggle('folded', !!focused && focused !== o.label);
            article.querySelector('[data-action="focus"]').textContent = focused === o.label ? '返回比较' : '展开';
        }
        if (!saved) {
            comparison = resume?.comparison || 'original'; $('retryHandoff').hidden = true;
            $('comparisonChoice').innerHTML = '<option value="original">原文对照</option>' + options.flatMap((o, i) => options.slice(i + 1).map(other =>
                '<option value="' + o.label + ':' + other.label + '">' + o.label + ' ↔ ' + other.label + '</option>')).join('');
            if (![...$('comparisonChoice').options].some(o => o.value === comparison)) comparison = 'original';
            $('comparisonChoice').value = comparison;
        }
        renderReadings();
        $('scopeChoice').innerHTML = '<option value="group">本项全部方案（默认）</option><option value="original">完整原文</option>' + options.map(o => '<option value="' + o.label + '">方案 ' + o.label + ' 整体</option>').join('');
        scope(); renderNotes(data.edit.requests || []); renderQuestions(data.edit.questions || []);
        if (resume) restoreInputs(resume);
        else if (message.sourceSelection) {
            bindSelection(message.sourceSelection);
            $('note').focus();
        }
        $('fewer').textContent = data.fewer_options_reason || '';
        $('intent').hidden = !data.intent;
        $('intent').textContent = data.intent ? '本项目标：' + data.intent.goal + '　保留：' + data.intent.preserve : '';
        rendering = false;
        api.postMessage({type:'rendered',id:current.id,version:current.version,ms:performance.now()-renderStarted,instance});
        highlightSelection();
        dirty();
    }
    if (message.type === 'content') {waiting = message.busy; coordinating = message.coordinating; reviewMode=message.mode || 'paragraph'; $('questionViewStyle').value=message.questionViewStyle || 'snippets'; selectedQuestion=message.questionPosition || selectedQuestion; pendingCardAction=message.pendingCardAction; renderQuestionMode(); if (reviewMode==='question') send('reviewMode',{mode:reviewMode,questionKey:selectedQuestion,viewStyle:$('questionViewStyle').value},false);}
    if (message.message) status(message.message, message.error, message.action);
    buttons();
    activateCardAction();
});
api.postMessage({type: 'ready', instance, state: api.getState()});
