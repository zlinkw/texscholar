'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {selection} = require('./candidate_panel');

function html(nonce, assets = {}) {
    const client = fs.readFileSync(path.join(__dirname, 'review_workbench_client.js'), 'utf8');
    const math = fs.readFileSync(path.join(__dirname, 'review_math.js'), 'utf8');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.source || ''} 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src ${assets.source || "'none'"}; script-src 'nonce-${nonce}'; connect-src 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1">${assets.css ? `<link rel="stylesheet" href="${assets.css}">` : ''}<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:var(--review-font-size,16px)/var(--review-line-height,1.5) var(--vscode-font-family)}
button,select,textarea{font:inherit}button{border-radius:6px;padding:4px 9px;margin:3px;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button:disabled{opacity:.5;cursor:default}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
header{position:sticky;top:0;z-index:2;background:var(--vscode-editor-background);padding:7px;border-bottom:1px solid var(--vscode-panel-border);display:flex;flex-wrap:wrap;align-items:center;gap:3px}#layout{display:grid;grid-template-columns:minmax(0,1fr)}main{min-width:0;padding:8px 10px}h3,h4,p{margin:6px 0}small,#status,#pdfStatus{color:var(--vscode-descriptionForeground)}#status.error{color:var(--vscode-errorForeground)}section{margin:6px 0 9px}#options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}article{min-width:0;border:1px solid var(--vscode-panel-border);padding:7px;border-radius:4px}article.selected{border-color:var(--vscode-focusBorder)}article.focused{grid-column:1/-1}article.folded .detail{display:none}.text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.text .old{color:var(--removed);text-decoration:var(--strike)}.text .new{color:var(--added)}.text .same{color:var(--unchanged,inherit)}.zh{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px;border-left:2px solid var(--vscode-panel-border);padding-left:8px;color:var(--vscode-descriptionForeground)}textarea,select{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));max-width:100%}textarea{width:100%;min-height:90px;resize:vertical;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}textarea.edit{min-height:180px}details{margin:6px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0;font:inherit}.question,.note{border-top:1px solid var(--vscode-panel-border);padding:7px 0}.note{font-size:.94em}#scope{overflow-wrap:anywhere}#translateStatus{font-size:.9em}[hidden]{display:none!important}#empty{padding:18px}
@media(max-width:980px){#options{grid-template-columns:1fr}article.focused{grid-column:auto}}@media(max-width:650px){main{padding:8px}}
.formula{max-width:100%;display:inline-block;vertical-align:middle}.display-formula{display:block}.math-preview{display:inline-block;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:.45em .2em;white-space:normal;color:var(--unchanged,inherit)}.display-formula>.math-preview{display:block}.math-preview .katex-display{margin:.3em 0}.math-code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--vscode-editor-font-family);font-size:.9em}.math-source-diff{margin:2px 0 5px;border-left:2px solid var(--vscode-panel-border);padding-left:5px}.math-source-diff summary,.math-error{font-size:12px;color:var(--vscode-descriptionForeground)}.math-error{display:block}.optionHeading{display:flex;align-items:center;justify-content:space-between;gap:3px;flex-wrap:wrap}.optionHeading h4{white-space:nowrap;margin:0}.optionActions{display:flex;align-items:center;flex-wrap:wrap;margin-left:auto}.optionActions button,.optionActions summary{font-size:12px;padding:3px 6px;margin:2px}.reason{display:block;margin:3px 0 7px}.more{position:relative;display:inline-block;margin:0}.more summary{list-style:none;cursor:pointer;border-radius:6px;padding:4px 9px;margin:3px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.more summary::-webkit-details-marker{display:none}.more>.menu{position:absolute;right:0;top:100%;z-index:10;min-width:210px;max-height:60vh;overflow-y:auto;padding:7px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editor-background);box-shadow:0 3px 12px #0003;display:flex;flex-direction:column}.more>.menu button{text-align:left}.more>.menu label{padding:7px}header #progress{margin-right:auto}button:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}</style></head><body>
<header><button data-action="previous" class="secondary">上一项</button><button data-action="next" class="secondary">下一项</button><span id="progress"></span><button data-action="mathMode" class="secondary" id="mathMode" aria-pressed="false" title="切换审核页公式预览／完整 LaTeX 源码，不保存、不编译">LaTeX 源码</button><button data-action="reopen">打开 PDF 窗口</button><button data-action="locate">定位 PDF</button><button data-action="pdf">更新 PDF</button><details class="more"><summary>更多</summary><div class="menu"><button data-action="start">开始 AI 论文任务</button><button data-action="connect">连接 Codex</button><button data-action="translate">翻译／重试当前项</button><button data-action="provider">切换翻译来源</button><button data-action="toggleChinese">显示／收起中文</button><label><input type="checkbox" id="compare">PDF 对比本项全部方案</label><button data-action="source">定位 LaTeX 原文</button><button data-action="copy">复制 AI 三方案规则</button><button data-action="handoff">全部批注加入 Codex</button><button data-action="finish">本批审完</button></div></details><span id="pdfStatus">PDF 尚未核对</span></header>
<div id="layout"><main><div id="empty" hidden>本批没有可操作的待审项。已接收成果请在本批审完后备份。</div><div id="review"><h3 id="title"></h3>
<section><h4>原文</h4><div id="original" class="text" data-side="original"></div><div id="originalZh" class="zh"></div><details><summary>完整原文源码</summary><pre id="originalSource"></pre></details></section>
<div id="translateStatus"></div>
<section id="options"></section><p id="fewer"></p><section><h4>关联原始审稿问题</h4><div id="questions"></div></section>
<section><h4>返修批注</h4><label>范围 <select id="scopeChoice"><option value="group">本项全部方案（默认）</option><option value="original">完整原文</option></select></label><p id="scope">未划词时可以直接填写整项要求。</p><button data-action="whole" class="secondary">取消选区／整项批注</button><textarea id="note" placeholder="例如：以 B 为基础，保留 A 的限定条件，删除推测。"></textarea><button data-action="note" data-write>保存返修批注</button><button data-action="reject" data-write class="secondary">拒绝本项全部候选</button><div id="notes"></div></section></div><p id="status" role="status" aria-live="polite"></p></main></div>
${assets.script ? `<script nonce="${nonce}" src="${assets.script}"></script>` : ''}<script nonce="${nonce}">${math}</script><script nonce="${nonce}">${client}</script></body></html>`;
}

function createWorkbench(vscode, context, services) {
    let panel, active, loaded, dirty = false, noteDirty = false, handling = false, pending, hasPending = false;
    const translations = new Map();
    let translationRun, translationRequested = false, retryTranslation = false, translationEpoch = 0;
    let lastRecords = new Map(), sourceSelection;
    const post = message => panel?.webview.postMessage(message);
    const key = c => JSON.stringify([c.repo, c.owner, c.id, c.version]);
    const options = data => data.options || [{label: 'A', after: data.candidate, reason: '已有单方案', changes: data.changes}];
    const directory = () => services.directory();
    function packet() {
        return {type: 'content', c: active, data: loaded, options: options(loaded), directory: directory(), style: services.style(),
            sourceSelection,
            preview: services.selection(active), pdfStatus: services.pdfStatus(active)};
    }
    const valid = c => active && key(active) === key(c);
    function sendContent() {post(packet()); autoTranslate();}
    async function allowSwitch() {
        if (!dirty && !noteDirty) return true;
        return await vscode.window.showWarningMessage('当前审核页有未保存的候选或返修要求，切换会丢失它们。', {modal: true}, '放弃未保存内容并切换') === '放弃未保存内容并切换';
    }
    async function show(c) {
        if (active && key(active) === key(c) && panel) {panel.reveal(); return;}
        if (!await allowSwitch()) return;
        const data = await services.read(c);
        active = {...c}; loaded = data; dirty = noteDirty = false; hasPending = false; sourceSelection = undefined;
        if (!panel) {
            panel = vscode.window.createWebviewPanel('texscholarReview', '论文审核', vscode.ViewColumn.One,
                {enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(__dirname, 'vendor', 'katex'))], retainContextWhenHidden: true});
            panel.webview.onDidReceiveMessage(receive);
            panel.onDidDispose(() => {panel = undefined; active = undefined; translationEpoch++;});
            const asset = name => panel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'vendor', 'katex', name))).toString();
            panel.webview.html = html(crypto.randomBytes(16).toString('hex'), {source: panel.webview.cspSource, css: asset('katex.min.css'), script: asset('katex.min.js')});
        } else {panel.reveal(); sendContent();}
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
        } else {active = {...next.c}; loaded = next.data; sendContent();}
    }
    function autoTranslate(force = false) {
        if (!active || (!force && !services.autoTranslate())) return;
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
    async function translate(retry) {
        const c = {...active}, data = loaded, epoch = translationEpoch, provider = services.provider();
        const items = [{key: 'original', text: data.original}, ...options(data).map(o => ({key: o.label, text: o.after})),
            ...(data.edit.questions || []).map((q, i) => ({key: 'question' + i, text: q.quote}))];
        let failure;
        for (const item of items) {
            if (!valid(c) || epoch !== translationEpoch) return;
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
            if (valid(c)) post({type: 'translation', key: item.key, ...translated});
        }
        if (valid(c)) post({type: 'translationStatus', message: provider + '：本项翻译已处理，失败项可手动重试'});
    }
    async function receive(message) {
        if (message.type === 'ready') {if (active) sendContent(); return;}
        if (!active || !panel) return;
        if (message.type === 'dirty' && message.version === active.version && message.id === active.id) {
            dirty = message.dirty === true; noteDirty = message.noteDirty === true; return;
        }
        if (handling) return post({type: 'result', error: true, message: '本次保存尚未结束，内容仍保留。'});
        handling = true;
        try {
            if (message.type === 'connect' || message.type === 'start') {await services[message.type](); return post({type: 'result', message: '操作已返回；请核对 Codex 连接提示。'});}
            if (message.type === 'reopen') {await services.reopen(); return post({type: 'result', message: '已打开现有审核 PDF；未触发编译。'});}
            if (message.type === 'copy') {await services.copy(); return post({type: 'result', message: '已复制三方案规则，不修改 SKILL。'});}
            if (message.type === 'handoff') {await services.handoff(); return post({type: 'result', message: '批注已加入输入区，由你自行发送。'});}
            if (message.type === 'finish') {await services.finish(); return post({type: 'result', message: '结束审核操作已返回，请核对备份结果。'});}
            if (message.version !== active.version || message.id !== active.id) throw new Error('当前项已更新，旧操作已停止；请核对新版。');
            const c = {...active};
            if (message.type === 'switch' || message.type === 'next' || message.type === 'previous') {
                const list = directory().filter(e => lastRecords.has(e.id)), index = list.findIndex(e => e.id === active.id);
                const id = message.type === 'switch' ? message.target : list[index + (message.type === 'next' ? 1 : -1)]?.id;
                const next = lastRecords.get(id);
                if (next) await show(next.c);
                else return post({type: 'result', message: '没有下一个可操作项；已接收成果可查 Git，未重新创建候选。'});
            } else if (message.type === 'latest') {
                if (!await allowSwitch()) return;
                const data = await services.read({...c, version: pending?.c.version || c.version});
                active = {...c, version: data.version}; loaded = data; dirty = noteDirty = false; hasPending = false; sendContent();
            } else if (message.type === 'save') {
                const option = options(loaded).find(o => o.label === message.option);
                if (!option || typeof message.value !== 'string') throw new Error('请选择现有候选方案。');
                const value = option.after.includes('\r\n') ? message.value.replace(/\r?\n/g, '\r\n') : message.value;
                loaded = await services.save(c, message.option, value);
                active = {...c, version: loaded.version}; dirty = false;
                post({...packet(), type: 'saved', option: message.option}); autoTranslate();
                services.saved(active, message.option, !!message.compare);
            } else if (message.type === 'note') {
                if (dirty) throw new Error('请先保存候选编辑，再绑定返修选区。');
                const option = options(loaded).find(o => o.label === message.option);
                let selected;
                if (message.side === 'candidate') {
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
            } else if (message.type === 'accept' || message.type === 'reject') {
                if (dirty || noteDirty) throw new Error('请先保存候选和返修要求，再接收或拒绝。');
                if (message.type === 'accept' && !options(loaded).some(o => o.label === message.option)) throw new Error('请选择具体接收方案。');
                const list = [...lastRecords.values()], index = list.findIndex(r => r.c.id === c.id);
                await services[message.type]({...c, option: message.option, workbench: true});
                const next = list.slice(index + 1).concat(list.slice(0, index)).find(r => lastRecords.has(r.c.id));
                hasPending = false;
                if (next) await show(lastRecords.get(next.c.id).c);
                else post({type: 'unavailable', message: '本批可操作项目已处理。未自动提交 Git 或判定科学问题完成。'});
            } else if (message.type === 'preview' || message.type === 'pdf') {
                if (dirty) throw new Error('请先保存候选编辑再预览 PDF。');
                const option = message.option || services.selection(c);
                if (!options(loaded).some(o => o.label === option)) throw new Error('预览方案不存在。');
                services.preview(c, option, !!message.compare, message.type === 'pdf');
                post({type: 'preview', option});
            } else if (message.type === 'locate') await services.locate(c, services.selection(c));
            else if (message.type === 'source') await services.source(c);
            else if (message.type === 'question') {
                const q = loaded.edit.questions?.[message.index];
                if (!q) throw new Error('原始问题关联不存在。');
                await services.question(c, q);
            } else if (message.type === 'related') await services.related(c, loaded.edit.questions?.[message.index]);
            else if (message.type === 'provider') {await services.changeProvider(); translationEpoch++; autoTranslate();}
            else if (message.type === 'translate') autoTranslate(true);
            else throw new Error('不支持的审核操作。');
            post({type: 'result', message: ''});
        } catch (error) {post({type: 'result', error: true, message: error.message});}
        finally {
            handling = false;
            if (hasPending && !dirty && !noteDirty) {const next = pending; hasPending = false; sync(next ? new Map(lastRecords) : lastRecords, {repo: active.repo, owner: active.owner});}
        }
    }
    context.subscriptions.push({dispose() {panel?.dispose();}});
    return {show, sync, setRecords(records) {lastRecords = records;},
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
module.exports = {createWorkbench, html};
