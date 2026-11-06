/* Runs only inside the fixed review webview. No network or filesystem access. */
'use strict';
const api = acquireVsCodeApi(), $ = id => document.getElementById(id);
let current, data, options = [], preview = 'A', selected, waiting = false, unavailable = false, conflict = false, focused, chinese = true;
const drafts = new Map(), models = new WeakMap();
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function send(type, extra = {}, blocks = true) {
    if (!current) return;
    if (blocks) {waiting = true; buttons();}
    api.postMessage({type, id: current.id, version: current.version, ...extra});
}
function status(message, error = false) {$('status').textContent = message || ''; $('status').className = error ? 'error' : '';}
function dirty() {
    const changed = options.some(o => drafts.has(o.label) && drafts.get(o.label) !== o.after.replace(/\r\n/g, '\n'));
    send('dirty', {dirty: changed, noteDirty: !!$('note').value.trim()}, false); return changed;
}
function buttons() {
    for (const button of document.querySelectorAll('button[data-write]')) button.disabled = waiting || unavailable || conflict;
}
function style(value) {
    const root = document.documentElement.style;
    root.setProperty('--review-font-size', value.candidateFontSize + 'px');
    root.setProperty('--review-line-height', value.candidateLineHeight);
    root.setProperty('--removed', value.removedColor); root.setProperty('--added', value.addedColor);
    root.setProperty('--strike', value.strikeDeleted ? 'line-through' : 'none');
    root.setProperty('--unchanged', value.unchangedColor || 'inherit');
}
function projection(raw) {
    let text = '', offsets = [], at = 0;
    // Keep exact coordinates in TeX even while hiding machine/author comments.
    for (const line of raw.split(/(?<=\n)/)) {
        const comment = /^[ \t]*%/.test(line);
        if (!comment) for (let i = 0; i < line.length; i++) {offsets.push(at + i); text += line[i];}
        at += line.length;
    }
    offsets.push(raw.length); return {text, offsets, raw};
}
function renderText(node, raw, changes, side) {
    const model = projection(raw), points = Array.from(raw), starts = [0];
    for (const char of points) starts.push(starts.at(-1) + char.length);
    const prefix = side === 'original' ? 'old' : 'new';
    const ranges = (changes || []).map(c => [starts[c[prefix + '_start']], starts[c[prefix + '_end']]]);
    let html = '', buffer = '', previous;
    function flush() {if (buffer) html += '<span class="' + (previous ? side === 'original' ? 'old' : 'new' : 'same') + '">' + esc(buffer) + '</span>'; buffer = '';}
    for (let i = 0; i < model.text.length; i++) {
        const changed = ranges.some(([a, b]) => model.offsets[i] >= a && model.offsets[i] < b);
        if (changed !== previous) {flush(); previous = changed;}
        buffer += model.text[i];
    }
    flush(); node.innerHTML = html;
    if (!model.text.trim()) node.textContent = side === 'original' ? '仅补充，无对应原句。' : '本项已删除，正式结果为不再保留这段内容。';
    models.set(node, model);
}
function renderDirectory(items) {
    const pending = items.filter(i => ['pending', 'rework'].includes(i.status));
    $('progress').textContent = '本批 ' + items.length + ' 项 · 待处理 ' + pending.length;
}
function renderOption(o) {
    let article = $('option-' + o.label);
    if (!article) {article = document.createElement('article'); article.id = 'option-' + o.label; $('options').appendChild(article);}
    article.className = [preview === o.label ? 'selected' : '', focused === o.label ? 'focused' : focused ? 'folded' : ''].join(' ');
    article.innerHTML = '<div class="optionHeading"><h4>' + o.label + (o.label === 'A' ? ' · 推荐' : '') + '</h4>'
        + '<div class="optionActions"><button data-action="preview" data-option="' + o.label + '" class="secondary">预览 PDF</button><button data-action="focus" data-option="' + o.label + '" class="secondary">' + (focused === o.label ? '返回比较' : '展开阅读') + '</button><button data-action="accept" data-write data-option="' + o.label + '">接收 ' + o.label + '</button><details class="more"><summary title="更多方案操作" aria-label="更多方案操作">⋯</summary><div class="menu"><button data-action="editToggle" data-option="' + o.label + '">编辑候选</button><button data-action="optionNote" data-option="' + o.label + '">针对 ' + o.label + ' 写返修要求</button></div></details></div></div><small class="reason">' + esc(o.reason) + '</small>'
        + '<div class="detail"><div class="text" id="text-' + o.label + '" data-side="candidate" data-option="' + o.label + '"></div><div class="zh" id="zh-' + o.label + '" ' + (chinese ? '' : 'hidden') + '></div>'
        + '<div id="editor-' + o.label + '" hidden><textarea class="edit" id="edit-' + o.label + '" data-option="' + o.label + '" spellcheck="false"></textarea><button data-action="save" data-write data-option="' + o.label + '">保存 ' + o.label + '（不接收）</button><small>仅保存待审版本，其他备选保留。</small></div></div>';
    renderText($('text-' + o.label), o.after, o.changes, 'candidate');
    $('edit-' + o.label).value = drafts.get(o.label) ?? o.after.replace(/\r\n/g, '\n');
}
function renderQuestions(questions) {
    const signature = JSON.stringify(questions);
    if ($('questions').dataset.signature === signature) return;
    $('questions').dataset.signature = signature;
    $('questions').innerHTML = questions.length ? questions.map((q, index) => '<div class="question"><strong>' + esc(q.id) + '</strong><div class="text">' + esc(q.quote) + '</div><div id="zh-question' + index + '" class="zh" ' + (chinese ? '' : 'hidden') + '></div><button class="secondary" data-action="question" data-index="' + index + '">跳转原始文件</button><button class="secondary" data-action="related" data-index="' + index + '">查看本问题全部改动</button></div>').join('') : '当前未关联审稿问题；新论文撰写可以不关联。';
}
function renderNotes(requests) {
    const signature = JSON.stringify(requests);
    if ($('notes').dataset.signature === signature) return;
    $('notes').dataset.signature = signature;
    $('notes').innerHTML = requests.map(n => '<div class="note"><strong>' + esc(n.option || '整项') + ' · ' + esc(n.status) + '</strong><div class="text">' + esc(n.quote) + '</div><div class="text">' + esc(n.text) + '</div></div>').join('');
}
function scope() {
    selected = undefined;
    $('scope').textContent = $('scopeChoice').value === 'group' ? '针对本项全部方案，不需要逐个拒绝。' : $('scopeChoice').value === 'original' ? '针对完整原文。' : '针对方案 ' + $('scopeChoice').value + ' 整体。';
}
function selectionChanged(event) {
    if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains('edit')) {
        const node = event.target, o = options.find(o => o.label === node.dataset.option);
        if (node.selectionStart === node.selectionEnd) return;
        selected = {side: 'candidate', option: o.label, value: node.value, start: node.selectionStart, end: node.selectionEnd};
    } else {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0), ancestor = range.commonAncestorContainer;
        const node = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement).closest('.text[data-side]');
        if (!node || !node.contains(range.startContainer) || !node.contains(range.endContainer)) return;
        const model = models.get(node);
        if (!model || !model.text) return;
        const prefix = range.cloneRange(); prefix.selectNodeContents(node); prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length, end = start + range.toString().length;
        const rawStart = model.offsets[start], rawEnd = end === model.text.length ? model.offsets[end] : model.offsets[end - 1] + 1;
        selected = {side: node.dataset.side, option: node.dataset.option, value: model.raw.replace(/\r\n/g, '\n'),
            start: model.raw.slice(0, rawStart).replace(/\r\n/g, '\n').length, end: model.raw.slice(0, rawEnd).replace(/\r\n/g, '\n').length};
    }
    $('scope').textContent = (selected.option ? '方案 ' + selected.option : '原文') + '选区：' + selected.value.slice(selected.start, selected.end);
}
document.addEventListener('mouseup', selectionChanged);
document.addEventListener('pointerdown', event => {
    for (const menu of document.querySelectorAll('details.more[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keyup', event => {if (event.shiftKey) selectionChanged(event);});
document.addEventListener('input', event => {
    if (event.target.classList.contains('edit')) {drafts.set(event.target.dataset.option, event.target.value); selected = undefined;}
    if (event.target.matches('textarea')) dirty();
});
$('scopeChoice').addEventListener('change', scope);
$('compare').addEventListener('change', () => send('preview', {option: preview, compare: $('compare').checked}));
document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const type = button.dataset.action, option = button.dataset.option;
    const menu = button.closest('.more'); if (menu) menu.open = false;
    if (type === 'toggleChinese') {chinese = !chinese; document.querySelectorAll('.zh').forEach(n => n.hidden = !chinese); return;}
    if (type === 'focus') {
        focused = focused === option ? undefined : option;
        for (const o of options) {const node = $('option-' + o.label); node.classList.toggle('focused', focused === o.label); node.classList.toggle('folded', !!focused && focused !== o.label);}
        button.textContent = focused ? '返回比较' : '展开阅读'; return;
    }
    if (type === 'whole') {$('scopeChoice').value = 'group'; scope(); return;}
    if (type === 'optionNote') {$('scopeChoice').value = option; scope(); $('note').focus(); return;}
    if (type === 'editToggle') {$('editor-' + option).hidden = !$('editor-' + option).hidden; if (!$('editor-' + option).hidden) $('edit-' + option).focus(); return;}
    if (type === 'note') {
        const value = $('scopeChoice').value;
        send('note', {...(selected || {side: 'original', option: 'ABC'.includes(value) && value.length === 1 ? value : undefined}), text: $('note').value}); return;
    }
    send(type, {option, target: button.dataset.target, index: Number(button.dataset.index),
        compare: $('compare').checked, ...(type === 'save' ? {value: $('edit-' + option).value} : {})});
});
window.addEventListener('message', ({data: message}) => {
    if (message.type === 'sourceSelection') {
        selected = message.selection;
        if (selected) $('scope').textContent = '原文选区：' + selected.value.slice(selected.start, selected.end);
        else {$('scopeChoice').value = 'group'; scope();}
        $('note').focus(); return;
    }
    if (message.type === 'style') {style(message.style); return;}
    if (message.type === 'translation') {
        const node = message.key === 'original' ? $('originalZh') : $('zh-' + message.key);
        if (node) {node.textContent = message.error ? '翻译未完成：' + message.error : message.text; node.hidden = !chinese;}
        return;
    }
    if (message.type === 'translationStatus') {$('translateStatus').textContent = message.message; return;}
    if (message.type === 'pdfStatus') {$('pdfStatus').textContent = message.message; return;}
    if (message.type === 'directory') {renderDirectory(message.directory); return;}
    if (message.type === 'preview') {
        preview = message.option;
        for (const o of options) $('option-' + o.label).classList.toggle('selected', preview === o.label);
        const chosen = options.find(o => o.label === preview);
        renderText($('original'), data.original, chosen.changes, 'original'); return;
    }
    if (message.type === 'notes') {renderNotes(message.requests); renderQuestions(message.questions); return;}
    if (message.type === 'noteSaved') {$('note').value = ''; selected = undefined; dirty();}
    if (message.type === 'conflict') {
        conflict = true;
        if (!$('latest')) {const b = document.createElement('button'); b.id = 'latest'; b.dataset.action = 'latest'; b.textContent = '载入最新（需确认放弃草稿）'; $('status').after(b);}
    }
    if (message.type === 'unavailable') {unavailable = true; $('empty').hidden = false; $('review').hidden = true;}
    if (message.type === 'content' || message.type === 'saved') {
        const saved = message.type === 'saved'; current = message.c; data = message.data; options = message.options;
        preview = message.preview; unavailable = conflict = false; $('latest')?.remove();
        style(message.style); $('empty').hidden = true; $('review').hidden = false;
        $('title').textContent = current.id + ' · ' + (data.edit.kind === 'response' ? '回复信' : '正文') + ' · ' + (data.edit.location || data.edit.file) + ' · 候选 v' + data.edit.versions.length;
        $('pdfStatus').textContent = message.pdfStatus;
        renderDirectory(message.directory);
        if (!saved) {drafts.clear(); selected = undefined; focused = undefined; $('compare').checked = false; $('options').replaceChildren(); $('note').value = ''; $('originalZh').textContent = ''; $('questions').dataset.signature = '';}
        else drafts.delete(message.option);
        renderText($('original'), data.original, options.find(o => o.label === preview)?.changes || options[0].changes, 'original');
        $('originalSource').textContent = data.original;
        for (const o of options) if (!saved || o.label === message.option) renderOption(o);
        $('scopeChoice').innerHTML = '<option value="group">本项全部方案（默认）</option><option value="original">完整原文</option>' + options.map(o => '<option value="' + o.label + '">方案 ' + o.label + ' 整体</option>').join('');
        scope(); renderNotes(data.edit.requests || []); renderQuestions(data.edit.questions || []);
        if (message.sourceSelection) {
            selected = message.sourceSelection;
            $('scope').textContent = '原文选区：' + selected.value.slice(selected.start, selected.end);
            $('note').focus();
        }
        $('fewer').textContent = data.fewer_options_reason || '';
        dirty();
    }
    waiting = false; status(message.message || '', message.error); buttons();
});
api.postMessage({type: 'ready'});
