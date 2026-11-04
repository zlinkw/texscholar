'use strict';
// One shared native webview for manuscript and reply candidates. Selection
// coordinates refer to the immutable TeX text, not rendered Markdown or guesses.
const crypto = require('node:crypto');

const normalized = text => text.replace(/\r\n/g, '\n');
function selection(candidate, value, start, end) {
    if (typeof value !== 'string' || value !== normalized(candidate)) throw new Error('请先保存候选修改，再选中文字添加批注。');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > value.length)
        throw new Error('请在候选内容中选中需要返修的单词或句子。');
    // Textarea uses UTF-16 and normalizes CRLF. Backend uses Unicode code points
    // in the original immutable excerpt, including both characters of CRLF.
    const boundaries = new Map([[0, 0]]);
    let browser = 0, raw = 0;
    const chars = Array.from(candidate);
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        raw++;
        if (char === '\r' && chars[i + 1] === '\n') {raw++; i++; browser++;}
        else browser += char.length;
        boundaries.set(browser, raw);
    }
    if (!boundaries.has(start) || !boundaries.has(end)) throw new Error('选区不能切开 Unicode 字符，请重新选择。');
    const a = boundaries.get(start), b = boundaries.get(end);
    return {side: 'candidate', start: a, end: b, quote: chars.slice(a, b).join('')};
}

function html(nonce) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
*{box-sizing:border-box}body{padding:10px 14px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.5 var(--vscode-font-family)}
h3,p{margin:5px 0 8px}textarea{display:block;width:100%;resize:vertical;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;tab-size:2;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:8px;font:var(--vscode-editor-font-size)/1.5 var(--vscode-editor-font-family)}
#candidate{height:42vh;min-height:150px}#note{height:80px;min-height:50px}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:5px 0}button{margin:5px 6px 5px 0;padding:5px 9px;border:0;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}button:disabled{opacity:.5;cursor:default}#status{color:var(--vscode-descriptionForeground)}#status.error{color:var(--vscode-errorForeground)}#quote{max-height:100px;overflow:auto;border-left:2px solid var(--vscode-focusBorder);padding-left:8px}details{margin-bottom:10px}small{color:var(--vscode-descriptionForeground)}
</style></head><body><h3 id="title">候选编辑与精确批注</h3>
<details><summary>查看原文（只读）</summary><pre id="original"></pre></details>
<label for="candidate">候选完整源码 · 可编辑，可划选单词或句子</label><textarea id="candidate" spellcheck="false" wrap="soft"></textarea>
<button id="save">保存候选</button><button id="back">返回审核卡片</button>
<p><small>仅保存待审版本，不替换正式正文。保存新版将清除旧版批注；先保存，再划选并添加新批注。关闭面板前请保存候选。</small></p>
<strong>已选候选内容</strong><pre id="quote">尚未选中</pre>
<label for="note">返修要求</label><textarea id="note" placeholder="针对所选文字填写返修要求" spellcheck="false"></textarea>
<button id="annotate">保存选区批注</button><p id="status" role="status" aria-live="polite">正在读取候选…</p>
<script nonce="${nonce}">
const api=acquireVsCodeApi(), byId=id=>document.getElementById(id), candidate=byId('candidate'), note=byId('note');
let version, saved='', chosen, waiting=false;
function update(){byId('save').disabled=waiting||candidate.value===saved;byId('annotate').disabled=waiting||candidate.value!==saved||!chosen||!note.value.trim();byId('back').disabled=waiting;candidate.readOnly=waiting;note.readOnly=waiting;}
function select(){if(candidate.selectionStart!==candidate.selectionEnd){chosen={start:candidate.selectionStart,end:candidate.selectionEnd};byId('quote').textContent=candidate.value.slice(chosen.start,chosen.end);}update();}
function send(type,extra={}){waiting=true;update();api.postMessage({type,version,...extra});}
candidate.addEventListener('select',select);candidate.addEventListener('mouseup',select);candidate.addEventListener('keyup',select);
candidate.addEventListener('input',()=>{chosen=undefined;byId('quote').textContent='内容已修改，请先保存候选再选择。';api.postMessage({type:'dirty',version,dirty:candidate.value!==saved});update();});note.addEventListener('input',update);
byId('save').addEventListener('click',()=>send('save',{value:candidate.value}));
byId('annotate').addEventListener('click',()=>send('note',{value:candidate.value,...chosen,text:note.value}));
byId('back').addEventListener('click',()=>send('back'));
window.addEventListener('message',({data})=>{waiting=false;byId('status').className=data.error?'error':'';byId('status').textContent=data.message||'';
if(data.candidate!==undefined){version=data.version;candidate.value=data.candidate;saved=candidate.value;byId('original').textContent=data.original;byId('title').textContent=data.title;chosen=undefined;byId('quote').textContent='尚未选中';}
if(data.clearNote)note.value='';update();});api.postMessage({type:'ready'});update();
</script></body></html>`;
}

function createCandidatePanel(vscode, context, services) {
    let panel, active;
    context.subscriptions.push({dispose() {panel?.dispose();}});
    async function show(c) {
        let loaded = await services.read(c), current = {...c};
        if (panel && active.c.repo === c.repo && active.c.owner === c.owner && active.c.id === c.id && active.c.version === c.version) {
            panel.reveal(); return;
        }
        if (panel && active.dirty && await vscode.window.showWarningMessage('当前候选有未保存的手动编辑。切换候选将丢失这些编辑。', {modal: true}, '放弃未保存编辑并切换') !== '放弃未保存编辑并切换') return;
        if (panel) panel.dispose();
        const view = vscode.window.createWebviewPanel('texscholarCandidate', `候选 ${c.id} · 编辑与批注`,
            vscode.ViewColumn.Beside, {enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true});
        panel = view;
        active = {c: current, dirty: false};
        const post = message => view.webview.postMessage(message);
        const content = message => ({title: `${current.id} · ${loaded.edit.file} · 候选 v${loaded.edit.versions.length}`,
            version: current.version, original: loaded.original, candidate: loaded.candidate, message});
        view.webview.onDidReceiveMessage(async message => {
            try {
                if (message.type === 'ready') return post(content('候选尚未接收。可以直接编辑，或划选文字添加批注。'));
                if (view !== panel || message.version !== current.version) throw new Error('该面板版本已更新，请重新打开当前候选。');
                if (message.type === 'dirty') {active.dirty = message.dirty === true; return;}
                if (message.type === 'save') {
                    if (typeof message.value !== 'string') throw new Error('候选内容必须为文本。');
                    // Follow the immutable excerpt's existing line-ending convention.
                    const after = loaded.candidate.includes('\r\n') ? normalized(message.value).replace(/\n/g, '\r\n') : message.value;
                    loaded = await services.save(current, after);
                    current = {...current, version: loaded.version};
                    if (view === panel) active = {c: current, dirty: false};
                    return post(content('新版候选已保存，旧批注已清除；正文未接收、未替换。'));
                }
                if (message.type === 'note') {
                    const selected = selection(loaded.candidate, message.value, message.start, message.end);
                    await services.note(current, selected, message.text);
                    return post({clearNote: true, message: '选区批注已保存；未发送给 Codex。'});
                }
                if (message.type === 'back') {await services.back(current); return post({message: '已定位原审核卡片。'});}
                throw new Error('不支持的候选面板操作。');
            } catch (error) {await post({error: true, message: error.message});}
        });
        view.onDidDispose(() => {if (panel === view) {panel = undefined; active = undefined;}});
        view.webview.html = html(crypto.randomBytes(16).toString('hex'));
    }
    return {show};
}
module.exports = {createCandidatePanel, selection, html};
