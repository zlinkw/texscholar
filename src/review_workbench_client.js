/* Runs only inside the fixed review webview. No network or filesystem access. */
'use strict';
const api = acquireVsCodeApi(), $ = id => document.getElementById(id);
const feedbackNode = $('status');
let current, data, options = [], preview = 'A', selected, waiting = false, unavailable = false, conflict = false, focused, chinese = true;
let editingNote, appearance, appearanceRequest, directoryItems = [], pendingSelection, selectionStale = false;
let navigationFilter = {query: '', kind: '', notes: false};
let changeCursor;
let directoryCursor, localFeedback;
const feedbackTargets = new Map();
const drafts = new Map(), models = new WeakMap(), translatedText = new Map(), rendered = new WeakMap(), differences = new WeakMap();
const displayedChanges = new WeakMap();
let sourceMode = false;
let comparison = 'original', draftFrame;
const math = globalThis.TeXScholarMath;
const instance = crypto.randomUUID();
let rendering = false, stateFrame, restoration, toolbarSize;
const passiveActions = new Set(['reopen', 'locate', 'source', 'question', 'translate', 'handoff', 'configuration', 'start']);
const sideBusy = new Set();
const actionNames = {save: '保存候选', saveSwitch: '保存并切换', saveAccept: '保存并接收候选', retryHandoff: '重试本项交接', noteHandoff: '保存并准备 Codex 批注', note: '保存批注', editNote: '保存批注修改', accept: '接收候选', reject: '拒绝候选',
    next: '切换审核项', previous: '切换审核项', switch: '切换审核项', backRelated: '返回原审核项', latest: '读取新版', handoff: '准备 Codex 批注', finish: '备份已接收成果',
    configuration: '检查配置', start: '准备 AI 任务', provider: '切换翻译来源', preview: '准备 PDF 预览', pdf: '准备 PDF 更新', related: '定位关联改动'};
function fitToolbar() {
    const header = document.querySelector('header'), home = $('toolbarExtras');
    document.documentElement.style.setProperty('--toolbar-height', header.offsetHeight + 'px');
    const size = JSON.stringify([header.clientWidth, appearance?.controlFontSize, $('mathMode').textContent, $('progress').textContent, $('pdfStatus').textContent, $('backRelated').hidden, $('backRelated').textContent]);
    if (toolbarSize === size) return;
    toolbarSize = size;
    const nodes = ['mathMode', 'pdfActions', 'pdfStatus'].map($);
    for (const node of nodes) home.appendChild(node);
    for (const id of ['mathMode', 'pdfStatus', 'pdfActions']) {
        if (header.scrollWidth <= header.clientWidth) break;
        $('overflowActions').appendChild($(id));
    }
}
new ResizeObserver(fitToolbar).observe(document.documentElement);
new ResizeObserver(fitToolbar).observe(document.querySelector('header'));
document.fonts.ready.then(fitToolbar);
function pdfStatus(message) {
    const node = $('pdfStatus'); node.title = message || '';
    node.textContent = /失败|错误/.test(message) ? 'PDF 更新失败' : /正在|生成中/.test(message) ? 'PDF 生成中'
        : /待更新|变更/.test(message) ? 'PDF 待更新' : /最新/.test(message) ? 'PDF 最新' : 'PDF 未核对';
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
    const anchor = range && range.startContainer.parentElement?.closest('main .text, main .zh') ? range : undefined;
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
    const node = [...document.querySelectorAll('main .text[id], main .zh[id]')].find(n => {
        const r = n.getBoundingClientRect(); return r.height && r.top <= y && r.bottom > y;
    });
    return node ? {id: node.id, top: node.getBoundingClientRect().top} : undefined;
}
function snapshot() {
    return {c: {...current}, drafts: Object.fromEntries(drafts), note: $('note').value, selected, editingNote,
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
    $('note').value = state.note; $('noteComposer').hidden = !state.composer; $('scopeChoice').value = state.scope;
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
function send(type, extra = {}, blocks = true) {
    if (!current) return;
    if (actionNames[type] || passiveActions.has(type)) feedbackTargets.set(type, localFeedback);
    if (passiveActions.has(type)) {if (sideBusy.has(type)) return; sideBusy.add(type); buttons();}
    if (blocks && !passiveActions.has(type)) {waiting = type; status(''); buttons();}
    api.postMessage({type, id: current.id, version: current.version, ...extra});
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
    const changed = options.some(o => drafts.has(o.label) && drafts.get(o.label) !== o.after.replace(/\r\n/g, '\n'));
    send('dirty', {dirty: changed, noteDirty: !!$('note').value.trim() || !!editingNote, state: remember(false)}, false); buttons(); return changed;
}
function buttons() {
    $('note').readOnly = !!waiting;
    for (const b of document.querySelectorAll('[data-action="newNote"],[data-action="cancelNote"],[data-action="editNoteOpen"]')) b.disabled = waiting;
    for (const button of document.querySelectorAll('button[data-write]')) button.disabled = waiting || unavailable || conflict;
    for (const button of document.querySelectorAll('button[data-action]')) {
        if (actionNames[button.dataset.action] || button.dataset.action === 'directory') button.disabled =
            !!(waiting && !passiveActions.has(button.dataset.action) && button.dataset.action !== 'directory') || !!(button.hasAttribute('data-write') && (unavailable || conflict));
        if (passiveActions.has(button.dataset.action)) button.disabled = sideBusy.has(button.dataset.action);
    }
    $('operationStatus').textContent = waiting ? current.id + ' · ' + (actionNames[waiting] || '审核操作') + '…' : '';
    for (const node of document.querySelectorAll('textarea.edit')) node.readOnly = !!waiting;
    for (const button of document.querySelectorAll('[data-action="save"]')) {
        const o = options.find(o => o.label === button.dataset.option);
        const unchanged = o && !hasDraft(o);
        button.disabled ||= !!unchanged;
        button.title = unchanged ? '候选未修改，无需保存；删除全部文字仍可保存。' : '保存此候选（Ctrl/Cmd+Enter），不接收';
    }
    const staleNote = editingNote && !data?.edit.requests?.some(n => n.id === editingNote.id && n.status === 'open' && n.version === current.version);
    const noteReason = selectionStale ? '请重新选择已变化的文字，或明确改为整项批注。' : staleNote ? '原批注版本已变化；请取消编辑后重新填写。'
        : !$('note').value.trim() ? '请先填写返修要求。' : editingNote && $('note').value === editingNote.previousText ? '批注未修改，无需保存。' : '';
    for (const button of document.querySelectorAll('[data-action="note"],[data-action="noteHandoff"]')) {
        button.disabled ||= !!noteReason; button.title = noteReason || (button.dataset.action === 'note' ? '保存当前批注（Ctrl/Cmd+Enter）' : '保存后加入 Codex 输入区，不自动发送');
    }
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
    const valid = (k, value) => value && !value.error && typeof value.text === 'string'
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
    const signature = JSON.stringify([entry.error, entry.text, sourceMode, changes, side]);
    if (rendered.get(node) === signature) {node.hidden = !chinese; return;}
    keepReading(() => {
        if (entry.error) {node.textContent = '翻译未完成：' + entry.error; models.delete(node);}
        else models.set(node, math.render(node, entry.text, changes, side, sourceMode ? 'source' : 'preview', globalThis.katex, models.get(node)));
        node.dataset.translation = key;
        node.title = side === 'readonly' ? '中文阅读译文；对照译文尚未就绪时不标差异。'
            : '中文译文之间的文字差异；翻译措辞变化也可能被标记，请结合原文审核。';
        node.hidden = !chinese;
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
    // Draft editors, note text, selected source coordinates and version stay intact.
}
function renderDirectory(items) {
    directoryItems = items;
    const pending = items.filter(i => ['pending', 'rework'].includes(i.status));
    $('progress').textContent = current ? current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · v' + data.edit.versions.length
        + (navigationFilter.query || navigationFilter.kind || navigationFilter.notes ? ' · 已筛选' : '') : '审核项';
    $('progress').title = '本批可操作 ' + items.length + ' 项 · 待处理 ' + pending.length + '；点击搜索编号、位置或关联问题';
    if ($('directoryDialog').open) filterDirectory();
    fitToolbar();
}
function filterDirectory() {
    const filter = {query: $('directoryQuery').value.trim(), kind: $('directoryKind').value, notes: $('directoryNotes').checked};
    if (JSON.stringify(filter) !== JSON.stringify(navigationFilter)) {
        directoryCursor = undefined;
        navigationFilter = filter; send('filter', {filter}, false);
        $('progress').textContent = current.id + (filter.query || filter.kind || filter.notes ? ' · 已筛选' : ' · 全部');
    }
    const found = filterItems(directoryItems, navigationFilter);
    $('directoryResults').replaceChildren();
    for (const item of found) {
        const node = document.createElement('button'); node.className = 'secondary'; node.dataset.action = 'switch'; node.dataset.target = item.id;
        node.textContent = item.id + ' · ' + (item.status === 'rework' ? '返修' : '待审') + ' · ' + item.file + (item.location ? ' · ' + item.location : '') + (item.requests ? ' · 批注 ' + item.requests : '') + (item.summary ? '\n' + item.summary : '');
        node.disabled = !!waiting; $('directoryResults').appendChild(node);
    }
    if (!found.length) $('directoryResults').textContent = '没有符合条件的可操作审核项。';
    if (!found.some(i => i.id === directoryCursor)) directoryCursor = found[0]?.id;
    markDirectoryCursor();
    $('directoryHint').textContent = found.length + ' 项；↑↓ 选择，Enter 打开，Esc 关闭。';
}
function markDirectoryCursor() {
    for (const node of $('directoryResults').children) {
        const active = node.dataset.target === directoryCursor;
        node.classList.toggle('directoryCurrent', active);
        if (active) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
    }
}
function renderOption(o) {
    let article = $('option-' + o.label);
    if (!article) {article = document.createElement('article'); article.id = 'option-' + o.label; $('options').appendChild(article);}
    article.className = [preview === o.label ? 'selected' : '', focused === o.label ? 'focused' : focused ? 'folded' : ''].join(' ');
    if (!article.children.length) article.innerHTML = '<div class="optionHeading"><h4>' + o.label + (o.label === 'A' ? ' · 推荐' : '') + '</h4>'
        + '<div class="optionActions"><button data-action="preview" data-option="' + o.label + '" class="secondary" title="预览本方案的审核 PDF">预览</button><button data-action="focus" data-option="' + o.label + '" class="secondary">' + (focused === o.label ? '返回比较' : '展开') + '</button><button data-action="accept" data-write data-option="' + o.label + '">接收 ' + o.label + '</button><details class="more"><summary title="更多方案操作" aria-label="更多方案操作">⋯</summary><div class="menu"><button data-action="editToggle" data-option="' + o.label + '">编辑候选</button><button data-action="optionNote" data-option="' + o.label + '">针对 ' + o.label + ' 写返修要求</button></div></details></div></div><small class="draftLabel"></small><p class="tradeoff"></p><p class="scopeSummary"></p><details class="reason"><summary>详细取舍</summary><span></span></details>'
        + '<div class="detail"><div class="text" id="text-' + o.label + '" data-side="candidate" data-option="' + o.label + '"></div><div class="zh" id="zh-' + o.label + '" ' + (chinese ? '' : 'hidden') + '></div>'
        + '<div id="editor-' + o.label + '" hidden><textarea class="edit" id="edit-' + o.label + '" data-option="' + o.label + '" spellcheck="false"></textarea><button data-action="save" title="保存此候选（Ctrl/Cmd+Enter）" data-write data-option="' + o.label + '">保存 ' + o.label + '（不接收）</button><button data-action="saveAccept" data-write data-option="' + o.label + '">保存并接收 ' + o.label + '</button><small>“保存”只更新待审版本；“保存并接收”替换正文并进入下一项。</small></div></div>';
    article.querySelector('.tradeoff').textContent = o.summary || o.reason;
    article.querySelector('.reason span').textContent = o.reason;
    article.querySelector('.reason').hidden = !o.summary || o.summary === o.reason;
    const count = o.scope;
    article.querySelector('.scopeSummary').textContent = !count ? '' : count.error ? '修改范围暂无法统计：' + count.error
        : `相对原文的变动涉及：原文 ${count.old_sentences} 句 → 候选 ${count.new_sentences} 句`
            + (count.old_environments || count.new_environments ? `；独立环境 ${count.old_environments} → ${count.new_environments}` : '');
    article.querySelector('.scopeSummary').title = '按 TeX 结构统计涉及变化的句子，不是质量评分或修改上限；不含纯首尾空白变化。';
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
    $('rankingNotice').hidden = !manual;
    $('rankingNotice').textContent = manual ? '已手动调整：原 AI 排序和取舍仅供参考，不代表对当前内容重新评估。' : '';
    $('comparisonNotice').hidden = !paired;
    $('comparisonNotice').textContent = paired ? `${left.label} → ${right.label}：仅突出两个方案之间的差异，不改变 PDF 或接收结果；接收按钮始终对应自己的方案。` : '';
    for (const o of options) {
        const article = $('option-' + o.label), draft = hasDraft(o);
        article.hidden = paired && !pair.includes(o.label);
        article.querySelector('h4').textContent = o.label + (paired ? o === left ? ' · 基准' : o === right ? ' · 比较' : '' : o.label === 'A' && !manual ? ' · 推荐' : '');
        article.querySelector('.draftLabel').textContent = draft ? '未保存预览；句数统计与译文保存后更新。'
            : o.manually_edited ? '作者已手动调整；下方为原 AI 取舍。' : '';
        article.querySelector('.scopeSummary').hidden = draft;
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
            node.innerHTML = '<div class="questionHeading"><strong></strong><div><button class="secondary" data-action="question" title="跳转到原始审稿意见文件位置">原始位置</button><button class="secondary" data-action="related" title="查看本问题关联的全部改动">全部改动</button></div></div><div class="text"></div><div class="zh"></div>';
            node.querySelector('strong').textContent = q.id;
        }
        if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
        node.dataset.index = String(index);
        for (const b of node.querySelectorAll('button')) b.dataset.index = String(index);
        const text = node.querySelector('.text'), zh = node.querySelector('.zh');
        text.id = 'question-text-' + index; zh.id = 'zh-question' + index; zh.hidden = !chinese;
        text.dataset.question = String(index);
        renderText(text, q.quote, [], 'readonly');
        const entry = entries.get(key);
        if (entry && entry.source === q.quote) translatedText.set('question' + index, entry);
    }
    for (const [key, entry] of translatedText) if (key.startsWith('question')) renderTranslation(key, entry);
    highlightSelection();
}
function renderNotes(requests) {
    const container = $('notes');
    for (const node of [...container.children]) if (!requests.some(n => n.id === node.dataset.noteId)) {
        if (node.contains($('noteComposer'))) $('notes').before($('noteComposer'));
        node.remove();
    }
    for (const n of requests) {
        let node = [...container.children].find(node => node.dataset.noteId === n.id);
        if (!node) {node = document.createElement('div'); node.className = 'note'; node.dataset.noteId = n.id; container.appendChild(node);}
        const signature = JSON.stringify([n, n.version === current.version]);
        if (node.dataset.signature === signature) continue;
        node.dataset.signature = signature;
        if (node.contains($('noteComposer'))) $('notes').before($('noteComposer'));
        const context = n.display_context;
        const origin = context ? (context.question ? context.question.id : n.option ? '方案 ' + n.option : '原文') + (context.kind === 'translation' ? '译文' : '审稿问题') : n.option || '整项';
        node.innerHTML = '<strong>' + esc(origin) + ' · ' + esc(n.status) + '</strong><div class="text">' + esc(n.text) + '</div><details><summary>查看批注选区</summary><button class="secondary noteQuote" data-action="locateNote" title="定位并高亮本条批注的准确范围">' + esc(context?.quote ?? n.quote) + '</button></details>' +
            (n.status === 'open' && n.version === current.version ? '<button class="secondary" data-action="editNoteOpen">编辑批注</button>' : '');
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
        const content = selected && ['question', 'translation'].includes(side) ? selectionNode(selected) : side === 'original' ? $('originalZh') : $('zh-' + label);
        const article = content?.closest('article');
        const obscured = article && (article.hidden || article.classList.contains('folded'));
        if (content && !composer.hidden && obscured) {if (composer.parentElement !== $('composerDock')) $('composerDock').appendChild(composer);}
        else if (content && !composer.hidden) {if (content.nextElementSibling !== composer) content.after(composer);}
        else if ($('noteComposer').nextElementSibling !== $('notes')) $('notes').before($('noteComposer'));
    }
    if (activeInput && composer.parentElement !== previousParent) activeInput.focus({preventScroll: true});
}
function closeComposer() {
    status('');
    editingNote = undefined; selected = pendingSelection = undefined; selectionStale = false; highlightSelection(); $('note').value = ''; $('noteComposer').hidden = true; $('noteMode').textContent = '新增返修批注';
    $('noteScopeControls').hidden = false; $('saveNote').textContent = '保存返修批注'; placeComposer(); dirty();
}
function openComposer() {$('noteComposer').hidden = false; placeComposer();}
function canChangeNote() {
    if (editingNote || $('note').value.trim()) {status('请先保存或取消当前批注输入。', true); return false;}
    return true;
}
function scope() {
    selected = pendingSelection = undefined; selectionStale = false; highlightSelection();
    $('scope').textContent = $('scopeChoice').value === 'group' ? '针对本项全部方案，不需要逐个拒绝。' : $('scopeChoice').value === 'original' ? '针对完整原文。' : '针对方案 ' + $('scopeChoice').value + ' 整体。';
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
    const index = value.question && (data.edit.questions || []).findIndex(q => q.id === value.question.id && q.file === value.question.file && q.quote === value.question.quote);
    if (value.question && index < 0) return;
    if (value.side === 'question') return $('question-text-' + index);
    if (value.side === 'translation') return value.question ? $('zh-question' + index) : value.option ? $('zh-' + value.option) : $('originalZh');
    return $(value.side === 'original' ? 'original' : 'text-' + value.option);
}
function selectionLabel(value) {
    return (value.question ? value.question.id : value.option ? '方案 ' + value.option : '原文')
        + (value.side === 'translation' ? '中文译文' : value.side === 'question' ? '审稿问题' : '');
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
        if (note.option) revealCandidate(note.option);
        const node = selectionNode(value), model = models.get(node);
        if (!model || model.raw !== ctx.text) {status('所选问题或译文已变化／尚未就绪，批注快照仍保留，请核对后重新选择。', true); return;}
        if (ctx.kind === 'translation') {chinese = true; node.hidden = false;}
        const offset = n => Array.from(ctx.text).slice(0, n).join('').replace(/\r\n/g, '\n').length;
        locateRanges(math.selectionRanges(model, offset(ctx.start), offset(ctx.end))); return;
    }
    const raw = note.side === 'candidate' ? options.find(o => o.label === note.option)?.after : data.original;
    if (raw === undefined || !Number.isInteger(note.start) || !Number.isInteger(note.end) || note.start < 0 || note.end <= note.start
        || Array.from(raw).slice(note.start, note.end).join('') !== note.quote) {status('批注摘录与当前准确范围不一致，未猜测位置。', true); return;}
    const label = note.side === 'candidate' ? note.option : undefined;
    if (label && hasDraft(options.find(o => o.label === label))) {status('该方案有未保存编辑，请先保存或恢复后定位批注。', true); return;}
    revealCandidate(label);
    const model = models.get($(label ? 'text-' + label : 'original'));
    const offset = n => Array.from(raw).slice(0, n).join('').replace(/\r\n/g, '\n').length;
    locateRanges(math.selectionRanges(model, offset(note.start), offset(note.end)));
}
function jumpChange(direction) {
    const targets = [];
    for (const node of document.querySelectorAll('.text[data-side]')) {
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
        const selector = '.text[data-side], .text[data-question], .zh[data-translation]';
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
        if (node.dataset.translation !== undefined) {
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
for (const id of ['directoryKind', 'directoryNotes']) $(id).addEventListener('change', filterDirectory);
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
document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const type = button.dataset.action, option = button.dataset.option;
    localFeedback = feedbackFor(button);
    const menu = button.closest('.more'); if (menu) menu.open = false;
    if (type === 'appearance') {style(appearance); $('appearanceDialog').showModal(); return;}
    if (type === 'resetAppearance') {saveAppearance({reset: true}); return;}
    if (type === 'directory') {filterDirectory(); $('directoryDialog').showModal(); $('directoryQuery').focus(); return;}
    if (type === 'clearFilter') {$('directoryQuery').value = ''; $('directoryKind').value = ''; $('directoryNotes').checked = false; filterDirectory(); return;}
    if (type === 'nextChange' || type === 'previousChange') {jumpChange(type === 'nextChange' ? 1 : -1); return;}
    if (type === 'locateNote') {locateNote(button.closest('.note').dataset.noteId); return;}
    if (type === 'switch') $('directoryDialog').close();
    if (type === 'newNote') {if (!canChangeNote()) return; scope(); $('noteMode').textContent = '新增返修批注'; openComposer(); $('note').focus(); return;}
    if (type === 'cancelNote') {closeComposer(); return;}
    if (type === 'useSelection') {if (pendingSelection) bindSelection(pendingSelection); return;}
    if (type === 'editNoteOpen') {
        const id = button.closest('.note').dataset.noteId;
        if (editingNote?.id === id) {$('note').focus(); return;}
        if (!canChangeNote()) return;
        const note = data.edit.requests.find(n => n.id === id);
        editingNote = {id, previousText: note.text}; selected = undefined;
        $('note').value = note.text; $('noteMode').textContent = '编辑返修批注';
        $('noteScopeControls').hidden = true; $('scope').textContent = '原批注范围保持不变：' + (note.option || '整项');
        $('saveNote').textContent = '保存修改'; placeComposer(); openComposer(); $('note').focus(); dirty(); return;
    }
    if (type === 'mathMode') {toggleMathMode(); return;}
    if (type === 'toggleChinese') {chinese = !chinese; document.querySelectorAll('.zh').forEach(n => n.hidden = !chinese); renderReadings(); return;}
    if (type === 'focus') {
        focused = focused === option ? undefined : option;
        for (const o of options) {const node = $('option-' + o.label); node.classList.toggle('focused', focused === o.label); node.classList.toggle('folded', !!focused && focused !== o.label);}
        for (const b of document.querySelectorAll('[data-action="focus"]')) b.textContent = focused === b.dataset.option ? '返回比较' : '展开'; placeComposer(); return;
    }
    if (type === 'whole') {$('scopeChoice').value = 'group'; scope(); return;}
    if (type === 'optionNote') {if (!canChangeNote()) return; $('scopeChoice').value = option; scope(); openComposer(); $('note').focus(); return;}
    if (type === 'editToggle') {$('editor-' + option).hidden = !$('editor-' + option).hidden; if (!$('editor-' + option).hidden) $('edit-' + option).focus(); return;}
    if (type === 'note' || type === 'noteHandoff') {
        const handoff = type === 'noteHandoff';
        if (editingNote) {send('editNote', {request: editingNote.id, text: $('note').value, previousText: editingNote.previousText, handoff}); return;}
        const value = $('scopeChoice').value;
        send('note', {...(selected || {side: 'original', option: 'ABC'.includes(value) && value.length === 1 ? value : undefined}), text: $('note').value, handoff}); return;
    }
    send(type, {option, target: button.dataset.target, index: Number(button.dataset.index),
        compare: $('compare').checked, ...(['save', 'saveAccept'].includes(type) ? {value: $('edit-' + option).value} : {})});
});
window.addEventListener('message', ({data: message}) => {
    if (message.type === 'relatedReturn') {showRelatedReturn(message.id); return;}
    if (message.type === 'handoffRetry') {$('retryHandoff').hidden = !message.available; return;}
    if (message.type === 'busy') {waiting = message.action; buttons(); return;}
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
    if (message.type === 'configuration') {$('configuration').textContent = message.ready ? '已配置' : '配置待完善'; $('configuration').title = message.ready ? '可检测配置已通过，点击重新检查；不代表 AI 会话已加载或论文已编译' : message.issues.join('；'); return;}
    if (message.type === 'style') {style(message.style); return;}
    if (message.type === 'translation') {
        if (message.source !== translationSource(message.key)) return;
        const entry = {...message};
        translatedText.set(message.key, entry);
        for (const [key, value] of translatedText) renderTranslation(key, value);
        return;
    }
    if (message.type === 'translationStatus') {$('translateStatus').textContent = message.message; return;}
    if (message.type === 'pdfStatus') {pdfStatus(message.message); return;}
    if (message.type === 'directory') {renderDirectory(message.directory); return;}
    if (message.type === 'preview') {
        preview = message.option;
        for (const o of options) $('option-' + o.label).classList.toggle('selected', preview === o.label);
        renderReadings(); return;
    }
    if (message.type === 'noteEdited') {data.edit.requests = message.requests; closeComposer(); renderNotes(message.requests);}
    if (message.type === 'notes') {data.edit.requests = message.requests; data.edit.questions = message.questions;
        keepReading(() => {renderNotes(message.requests); renderQuestions(message.questions);}); return;}
    if (message.type === 'noteSaved') closeComposer();
    if (message.type === 'conflict') {
        conflict = true;
        if (!$('latest')) {const b = document.createElement('button'); b.id = 'latest'; b.dataset.action = 'latest'; b.textContent = '载入最新（需确认放弃草稿）'; $('pageFeedback').appendChild(b);}
    }
    if (message.type === 'unavailable') {unavailable = true; $('empty').hidden = false; $('review').hidden = true;}
    if (message.type === 'content' || message.type === 'saved') {
        rendering = true; restoration = undefined;
        const saved = message.type === 'saved';
        const refresh = !saved && current && current.repo === message.c.repo && current.owner === message.c.owner && current.id === message.c.id;
        const oldOptions = options;
        current = message.c; data = message.data; options = message.options;
        const resume = message.resume;
        showRelatedReturn(message.relatedReturn);
        navigationFilter = message.navigationFilter;
        $('directoryQuery').value = navigationFilter.query; $('directoryKind').value = navigationFilter.kind; $('directoryNotes').checked = navigationFilter.notes;
        if (message.reading) {sourceMode = message.reading.sourceMode; chinese = message.reading.chinese;}
        $('originalZh').hidden = !chinese;
        $('mathMode').textContent = sourceMode ? '公式预览' : 'LaTeX 源码';
        $('mathMode').setAttribute('aria-pressed', String(sourceMode));
        preview = message.preview; unavailable = conflict = false; $('latest')?.remove();
        style(message.style); $('empty').hidden = true; $('review').hidden = false;
        $('title').textContent = current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · ' + (data.edit.location || data.edit.file) + ' · 候选 v' + data.edit.versions.length;
        pdfStatus(message.pdfStatus);
        renderDirectory(message.directory);
        if (!saved) {
            editingNote = undefined; $('noteComposer').hidden = true; placeComposer(); $('noteScopeControls').hidden = false;
            $('saveNote').textContent = '保存返修批注'; drafts.clear(); selected = pendingSelection = undefined; selectionStale = false;
            focused = undefined; changeCursor = undefined; $('compare').checked = false; $('note').value = '';
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
        highlightSelection();
        dirty();
    }
    if (message.type === 'content') waiting = message.busy;
    if (message.message) status(message.message, message.error, message.action);
    buttons();
});
api.postMessage({type: 'ready', instance, state: api.getState()});
