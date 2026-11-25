'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {selection} = require('./candidate_panel');
const reviewStyle = require('./review_style');
const reviewMath = require('./review_math');
const toolbarActions = ['previous','next','handoff','source','mathMode','reopen','locate','pdf','sourcePDF','translate','provider','toggleChinese','paperBackground','personalPrompts','configuration','start','checkUpdates','finish','stashClose'];
const defaultToolbar = {order: toolbarActions, visible: ['previous','next']};
function validToolbar(value) {
    return value && Array.isArray(value.order) && Array.isArray(value.visible) && value.order.length === toolbarActions.length &&
        new Set(value.order).size === toolbarActions.length && value.order.every(id => toolbarActions.includes(id)) &&
        new Set(value.visible).size === value.visible.length && value.visible.every(id => toolbarActions.includes(id));
}

function filterItems(items, filter) {
    const query = filter.query.trim().toLocaleLowerCase(), kind = filter.kind;
    const exactQuestion = /^r\d+-q\d+$/i.test(query);
    return items.filter(i => (filter.queue === 'all' || (filter.queue === 'deferred' ? i.postponed : !i.postponed))
        && (!kind || i.kind === kind) && (!filter.notes || i.requests > 0)
        && (exactQuestion ? (i.questions || []).some(q => q.toLocaleLowerCase() === query)
            : [i.id, i.file, i.location, i.summary, ...(i.questions || [])].join(' ').toLocaleLowerCase().includes(query)))
        .sort((a, b) => Number(b.id.toLocaleLowerCase() === query) - Number(a.id.toLocaleLowerCase() === query));
}

function staleBatchSelections(selection, directory) {
    return [...selection.values()].filter(selected => !directory.some(item => item.id === selected.id && item.version === selected.version && !item.postponed && item.source_match !== false && (item.options || ['A','B','C']).includes(selected.option)));
}

function sameQuestionSnapshot(previous, current) {
    if (previous === current) return true;
    const oldRows = JSON.parse(previous), newRows = JSON.parse(current);
    if (oldRows.length !== newRows.length) return false;
    return oldRows.every((old, i) => {
        const now = newRows[i], a = old.location, b = now.location;
        const {location:ignoredOld, ...oldData} = old, {location:ignoredNew, ...newData} = now;
        if (JSON.stringify(oldData) !== JSON.stringify(newData) || !a !== !b) return false;
        if (!a) return true;
        if (a.block !== b.block || a.parent !== b.parent || a.anchor !== b.anchor || a.heading !== b.heading || b.crossed) return false;
        if (a.before.some(id => b.after.includes(id)) || a.after.some(id => b.before.includes(id))) return false;
        return !(a.left && a.left === b.right || a.right && a.right === b.left);
    });
}

const questionExcerptChanges = new WeakMap();
function questionTranslationSource(data, question, side, label, style) {
    const choices=data.options || [{label:'A',after:data.candidate}], option=choices.find(item=>item.label===label);
    const text=side==='question' ? question?.quote : side==='original' ? data.original : side==='candidate' ? option?.after : undefined;
    if (typeof text!=='string') return;
    if (side==='question' || style==='full') return {text,start:0,end:Array.from(text).length};
    let cached=questionExcerptChanges.get(data);
    if (!cached || cached.original!==data.original || cached.after.length!==choices.length || choices.some((item,i)=>cached.after[i]!==item.after)) {
        cached={original:data.original,after:choices.map(item=>item.after),changes:choices.map(item=>reviewMath.wordChanges(data.original,item.after))};
        questionExcerptChanges.set(data,cached);
    }
    const changes=cached.changes;
    return side==='original' ? reviewMath.questionExcerptRange(text,changes.flat(),'old') :
        reviewMath.questionExcerptRange(text,changes[choices.indexOf(option)],'new');
}

function html(nonce, assets = {}) {
    const client = fs.readFileSync(path.join(__dirname, 'review_workbench_client.js'), 'utf8');
    const math = fs.readFileSync(path.join(__dirname, 'review_math.js'), 'utf8');
    const diff = fs.readFileSync(path.join(__dirname, 'vendor', 'diff', 'diff.min.js'), 'utf8');
    const purposes = '<option value="revision">普通返修</option><option value="skill">完善通用 SKILL</option><option value="personal">完善我的习惯（跨论文）</option><option value="paper_requirements">完善本论文要求</option><option value="paper_background">补充或纠正论文背景</option><option value="discussion">仅提问或讨论</option>';
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
.navigation,#toolbarCustom,#toolbarExtras,#pdfActions,.optionActions,.dialogHeading,.questionHeading{display:flex;align-items:center;gap:.3em;min-width:0}
.navigation{flex:1;min-width:8em;flex-wrap:wrap}#toolbarCustom{flex-wrap:wrap}#toolbarChoices>div{display:flex;align-items:center;gap:.4em;margin:.35em 0}#toolbarChoices label{flex:1}#progress{overflow:hidden;text-overflow:ellipsis;max-width:24em}#toolbarExtras{flex:none}#pdfActions{gap:.1em}#pdfStatus{font-size:inherit;max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#layout{display:grid;grid-template-columns:minmax(0,1fr)}main{min-width:0;padding:.4em .65em}h3,h4,p{margin:var(--space) 0}h3{font-size:1.05em}h4{font-size:1em}small,#status,#pdfStatus{color:var(--vscode-descriptionForeground)}#pdfError{padding:.3em .65em;font-size:var(--control-font-size,13px)}#pdfError,#status.error,#appearanceStatus.error{color:var(--vscode-errorForeground)}#pageFeedback:empty,#status:empty,#translateStatus:empty,#fewer:empty,.zh:empty{display:none}
section{margin:0 0 var(--section-space)}#options,.questionOptions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55em}article{min-width:0;padding:var(--space);border-radius:.45em;background:var(--vscode-sideBar-background,var(--vscode-editor-background));box-shadow:0 4px 14px #0002,0 1px 3px #0002}article.selected,.questionOption.selected{background:color-mix(in srgb,var(--vscode-editor-background) 60%,var(--vscode-list-activeSelectionBackground) 40%)}article.focused{grid-column:1/-1}article.focused>.optionHeading{position:sticky;top:var(--toolbar-height,2.5em);z-index:1;background:var(--vscode-editor-background);padding:.2em 0}article.folded .detail,article.folded .reason{display:none}
.review-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}:is(.review-text,.zh) .old{color:var(--removed);text-decoration:var(--strike)}:is(.review-text,.zh) .new{color:var(--added)}:is(.review-text,.zh) .same{color:var(--unchanged,inherit)}
.excerptViews{margin:.55em 0;padding:.45em .6em;border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-editor-background)}.excerptViews small{display:block;overflow-wrap:anywhere}.excerptViews .excerptError{color:var(--vscode-errorForeground)}
::highlight(review-location){background:var(--vscode-editor-findMatchHighlightBackground,#e5c07b66);text-decoration:underline}
::highlight(review-selection){background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,inherit)}
.zh{font-size:var(--translation-font-size,15px);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:var(--space);border-left:2px solid var(--vscode-panel-border);padding-left:.5em;color:var(--vscode-descriptionForeground)}
textarea{width:100%;min-height:6em;resize:vertical;padding:.5em;white-space:pre-wrap;overflow-wrap:anywhere}textarea.edit{min-height:11em;font-family:var(--vscode-editor-font-family,monospace)}details{margin:var(--space) 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:var(--space) 0;font:inherit}.question,.note{border-top:1px solid var(--vscode-panel-border);padding:var(--space) 0}.note{font-size:.94em}.questionHeading{justify-content:space-between;flex-wrap:wrap}.questionHeading>div{display:flex;gap:.3em}#scope{overflow-wrap:anywhere}#translateStatus{font-size:.8em}[hidden]{display:none!important}#empty{padding:1em}
.formula{display:inline;vertical-align:baseline}.math-preview{display:inline;vertical-align:baseline;white-space:normal;color:var(--unchanged,inherit);overflow-wrap:normal;word-break:normal}.display-formula{display:block;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:.45em .2em}.display-formula>.math-preview{display:block}.math-preview .katex-display{margin:.3em 0}.math-error{font-size:.8em;color:var(--vscode-descriptionForeground)}
.reviewHeading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.4em}.comparisonControl{font-size:var(--control-font-size,13px)}.draftLabel{display:block;font-size:.85em;color:var(--vscode-descriptionForeground)}#rankingNotice{display:block;margin-bottom:.4em;color:var(--vscode-descriptionForeground)}.optionHeading{display:flex;align-items:center;justify-content:space-between;gap:.3em;flex-wrap:wrap}.optionHeading h4{white-space:nowrap;margin:0}.optionActions{flex-wrap:wrap;margin-left:auto}.tradeoff,.scopeSummary,.intent{font-size:.85em;overflow-wrap:anywhere;margin:.2em 0}.scopeSummary{color:var(--vscode-descriptionForeground)}.reason{font-size:.85em;margin:var(--space) 0}.reason summary{cursor:pointer;color:var(--vscode-descriptionForeground)}
.more{position:relative;display:inline-block;margin:0}.more summary{list-style:none}.more summary::-webkit-details-marker{display:none}.more>.menu{position:absolute;right:0;top:100%;z-index:10;min-width:17em;max-width:calc(100vw - 1em);max-height:65vh;overflow-y:auto;padding:.5em;border:1px solid var(--vscode-panel-border);border-radius:.45em;background:var(--vscode-editor-background);box-shadow:0 3px 12px #0003;display:flex;flex-direction:column;gap:.3em;font-size:var(--control-font-size,13px)}.more>.menu button{text-align:left;white-space:normal}.more>.menu label{padding:.3em}#overflowActions:empty{display:none}#overflowActions{display:flex;flex-direction:column;gap:.3em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:.4em}
#staleSelections>div{display:flex;align-items:start;gap:.3em}#staleSelections button{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere;text-align:left}
dialog{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:0;border-radius:.5em;padding:.8em;width:fit-content;min-width:min(24em,calc(100vw - 1em));max-width:min(48em,calc(100vw - 1em));max-height:calc(100vh - 1em);overflow:auto;box-shadow:0 12px 32px #0004,0 2px 8px #0003;font-size:var(--control-font-size,13px)}#directoryDialog{width:min(48em,calc(100vw - 1em))}dialog::backdrop{background:#0005}.dialogHeading{justify-content:space-between;margin-bottom:.7em}.appearanceFields{display:grid;grid-template-columns:1fr 1fr;gap:.6em}.appearanceFields label{display:flex;flex-direction:column;gap:.2em}.appearanceFields label:first-child{grid-column:1/-1}.appearanceFields input,.appearanceFields select{width:100%;padding:.3em}dialog small{display:block;margin:.7em 0}.directoryCurrent{background:var(--vscode-list-activeSelectionBackground)!important;color:var(--vscode-list-activeSelectionForeground)!important}#pageFeedback{position:sticky;top:var(--toolbar-height,2.5em);z-index:2;background:var(--vscode-editor-background);padding:0 .65em;font-size:var(--control-font-size,13px)}#status{overflow-wrap:anywhere}#status.error{color:var(--vscode-errorForeground)}.directoryFilters{display:flex;gap:.4em;flex-wrap:wrap;margin-bottom:.5em}#directoryQuery{flex:1;min-width:10em}.directoryFilters input,.directoryFilters select{padding:.3em}#directoryResults{display:flex;flex-direction:column;gap:.2em}#directoryResults button{text-align:left;white-space:normal}.note.editing>.review-text,.note.editing>details,.note.editing>button{display:none}.noteQuote{white-space:pre-wrap!important;overflow-wrap:anywhere;text-align:left;max-width:100%}#noteComposer{margin:var(--space) 0}#noteComposer button{margin:.2em .2em .2em 0}
#questionModeQuote{margin:.55em 0;padding:.7em;border-radius:.45em;background:var(--vscode-textBlockQuote-background,var(--vscode-sideBar-background));white-space:pre-wrap} .questionFilters,.questionBatch{display:flex;gap:.45em;align-items:center;flex-wrap:wrap;margin:.7em 0} #questionModeScope:empty{display:none} #questionModeCards>section>article{margin:.8em 0}.reference,.questionReference{background:var(--vscode-textBlockQuote-background,var(--vscode-sideBar-background));border-radius:.45em;padding:.6em;min-width:0}.questionOptions{margin:.5em 0}.questionOption{min-width:0;padding:.6em;border-radius:.45em;background:var(--vscode-editor-background);box-shadow:0 3px 12px #0002,0 1px 3px #0002}.questionOption.selected{outline:2px solid var(--vscode-focusBorder)}.questionOption:focus-visible{outline:2px dashed var(--vscode-focusBorder);outline-offset:2px}.questionOption pre{margin:.4em 0}#options .optionHeading{flex-direction:column;align-items:stretch}#options .optionActions{margin-left:0;justify-content:flex-start}.intent{padding:.5em .7em;background:var(--vscode-editor-findMatchHighlightBackground);border-radius:.4em}.modeActions{display:flex;gap:.3em}.modeActions button[aria-pressed=true]{background:color-mix(in srgb,var(--vscode-button-secondaryBackground) 75%,var(--vscode-list-activeSelectionBackground) 25%)}@media(max-width:600px){header{flex-wrap:wrap}.appearanceFields,.questionOptions{grid-template-columns:1fr}.optionHeading{align-items:flex-start}.optionActions{margin-left:0}.questionOption{padding:.3em}}
</style></head><body>
<header><div class="modeActions" role="group" aria-label="审核模式"><button data-action="paragraphMode" class="secondary">段落审核</button><button data-action="questionMode" class="secondary">问题审核</button></div><div class="navigation"><span id="toolbarCustom"></span><button data-action="previous" class="secondary" title="上一审核项（Alt+←）" aria-label="上一审核项">‹</button><button data-action="next" class="secondary" title="下一审核项（Alt+→）" aria-label="下一审核项">›</button><button id="progress" data-action="directory" class="secondary" title="按编号、位置、文件或关联问题查找（Alt+F）">审核项</button><button id="backRelated" data-action="backRelated" class="secondary" hidden>返回原审核项</button></div><div id="toolbarExtras"><button id="sourceLocation" data-action="source" class="secondary" title="打开当前审核项的真实源文件并定位到原文；不保存、不接收、不编译">定位源文件</button><button data-action="mathMode" class="secondary" id="mathMode" aria-pressed="false" title="切换审核页公式预览／完整 LaTeX 源码，不保存、不编译">LaTeX 源码</button><div id="pdfActions" role="group" aria-label="审核 PDF"><button data-action="reopen" title="打开已有审核 PDF 窗口，不编译">打开 PDF</button><button data-action="locate" title="定位到当前审核项">定位</button><button data-action="pdf" title="更新完整审核 PDF">更新</button><button data-action="sourcePDF" class="secondary" title="独立编译正式源码，不应用未接收候选">正式 PDF</button></div><span id="pdfStatus" role="status">PDF 未核对</span></div><button data-action="handoff" title="选择具体批注后加入 Codex 输入区，不自动发送">批注 → Codex</button><details class="more"><summary>更多</summary><div class="menu" id="mainMenu"><div id="overflowActions"></div><button data-action="stashClose">暂存并关闭</button><button data-action="appearance">外观设置</button><button data-action="toolbarSettings">自定义工具栏</button><button data-action="manageNotes">批注管理</button><button data-action="paperBackground">当前论文背景</button><button data-action="personalPrompts">个人论文提示词</button><button id="configuration" data-action="configuration" class="secondary">检查配置</button><button data-action="start">AI 论文助手</button><button data-action="checkUpdates" title="立即检查 GitHub 正式版，发现新版后可下载并安装">检查插件更新</button><button data-action="translate">翻译／重试当前项</button><button data-action="provider">切换翻译来源</button><button data-action="toggleChinese">显示／收起中文</button><label><input type="checkbox" id="compare">PDF 对比本项全部方案</label><button data-action="finish">Git 备份已接收修改</button></div></details></header><div id="pdfError" role="alert" hidden></div><div id="pageFeedback"></div><details id="backupDetails"><summary>后台 Git 备份</summary><p id="backupStatus" role="status"></p><button data-action="retryBackup" class="secondary">重试后台备份／查看阻断</button></details>
<dialog id="toolbarDialog" aria-labelledby="toolbarTitle"><div class="dialogHeading"><strong id="toolbarTitle">自定义工具栏</strong><button data-action="toolbarCancel" class="secondary">取消</button></div><p>选择显示的操作并调整顺序。其余操作仍在更多菜单中。</p><div id="toolbarChoices"></div><button data-action="toolbarReset" class="secondary">恢复默认</button><button data-action="toolbarSave">保存</button><span id="toolbarStatus" role="status"></span></dialog>
<dialog id="appearanceDialog" aria-labelledby="appearanceTitle"><form method="dialog"><div class="dialogHeading"><strong id="appearanceTitle">审核页外观</strong><button aria-label="关闭外观设置" class="secondary">关闭</button></div></form><div class="appearanceFields"><label>阅读字体<input id="style-fontFamily" data-style="fontFamily" list="fontChoices" placeholder="留空跟随 VS Code，或输入自定义字体"></label><button data-action="followFont" class="secondary">字体跟随 VS Code</button><datalist id="fontChoices"><option value="Microsoft YaHei, sans-serif"></option><option value="Arial, sans-serif"></option><option value="Georgia, serif"></option></datalist><label>阅读字号<input type="number" id="style-candidateFontSize" data-style="candidateFontSize" list="sizeChoices" min="10" max="32" step="1"></label><label>文字行高<input type="number" id="style-candidateLineHeight" data-style="candidateLineHeight" list="lineChoices" min="1" max="2.5" step="0.1"></label><label>按钮字号<input type="number" id="style-controlFontSize" data-style="controlFontSize" list="sizeChoices" min="10" max="24" step="1"></label><label>中文字号<input type="number" id="style-translationFontSize" data-style="translationFontSize" list="sizeChoices" min="10" max="32" step="1"></label><datalist id="sizeChoices"><option value="12"></option><option value="14"></option><option value="16"></option><option value="18"></option><option value="20"></option></datalist><datalist id="lineChoices"><option value="1.2"></option><option value="1.5"></option><option value="1.8"></option><option value="2"></option></datalist><label>内容间距<select id="style-cardLayout" data-style="cardLayout"><option value="compact">紧凑</option><option value="comfortable">宽松</option></select></label></div><small>更改后即时生效并保存。仅影响审核页，不修改论文、PDF 字号或全局 SKILL。源码编辑保持等宽字体。</small><div><button data-action="resetAppearance" class="secondary">恢复默认外观</button><span id="appearanceStatus" role="status"></span></div></dialog>

<dialog id="directoryDialog" aria-labelledby="directoryTitle"><form method="dialog"><div class="dialogHeading"><strong id="directoryTitle">跳转审核项</strong><button class="secondary">关闭</button></div></form><div class="directoryFilters"><input id="directoryQuery" aria-describedby="directoryHint" aria-label="搜索审核项" placeholder="编号、位置、文件、R1-Q3…"><select id="directoryKind" aria-label="筛选文档"><option value="">全部文档</option><option value="manuscript">正文</option><option value="response">回复信</option></select><select id="directoryQueue" aria-label="审核队列"><option value="active">活跃</option><option value="deferred">暂缓</option><option value="all">全部</option></select><label><input id="directoryNotes" type="checkbox">有待处理批注</label></div><button data-action="clearFilter" class="secondary">清除筛选</button><small>上一项、下一项及接收后跳转遵循此筛选。</small><small id="titleStatus" role="status"></small><small id="directoryHint" role="status" aria-live="polite"></small><div><button data-action="selectAll" class="secondary">当前范围全选</button><button data-action="clearSelection" class="secondary">取消全选</button><span id="selectedCount" role="status">已选 0 项</span><button data-action="handoffSelected">所选批注 → Codex</button><button data-action="acceptBatch" data-write>接收所选方案</button></div><details><summary>为所选项写共同返修要求</summary><label>作用范围 <select id="batchNoteScope"><option value="whole">每项整项</option><option value="chosen">每项已选方案</option></select></label><label>意见用途 <select id="batchPurpose">${purposes}</select></label><textarea id="batchNote" aria-label="共同返修要求"></textarea><button data-action="batchNote" data-write>保存共同要求</button><small>每项单独保存一条批注；不接收、不发送。</small></details><div id="staleSelections"></div><div id="directoryResults"></div></dialog>
<div id="layout"><main><section id="questionModeView" hidden><label>问题 <select id="questionModeChoice" aria-label="选择完整审稿问题"></select></label><div id="questionModeQuote" class="review-text"></div><div id="questionComposerDock"></div><div class="questionFilters"><label>显示 <select id="questionViewStyle"><option value="snippets">变更片段</option><option value="full">全文对照</option></select></label><label>变化标记 <select id="questionType"><option value="">全部变化</option><option value="number">数字</option><option value="citation">引用键</option><option value="math">公式或符号</option><option value="term">保留术语</option><option value="rework">返修</option><option value="conflict">定位冲突</option></select></label></div><p id="questionModeScope"></p><div class="questionBatch"><button data-action="questionSelectAll" class="secondary">选择当前问题可操作项</button><button data-action="questionAccept" data-write>接收当前问题已选</button><button data-action="questionAcceptAll" data-write>接收全部已选</button><button data-action="directory" class="secondary">查看所选与共同返修</button></div><div id="questionModeCards"></div><details><summary>问题核对</summary><small>记录本轮核对，不自动认定科学问题已解决。</small><div id="questionTableRows"></div></details></section><div id="empty" hidden>当前没有可显示的审核项；可通过顶部编号目录清除筛选、选择其他项目，或用“Git 备份已接收修改”备份成果。</div><div id="review"><div class="reviewHeading"><h3 id="title"></h3><div class="optionActions"><button id="postpone" data-action="postpone" class="secondary">先放一边</button><button id="restorePostponed" data-action="restorePostponed" class="secondary" hidden>恢复到活跃队列</button><button data-action="previousChange" class="secondary" title="定位当前可见内容中的上一处实际差异">上处差异</button><button data-action="nextChange" class="secondary" title="定位当前可见内容中的下一处实际差异">下处差异</button><label class="comparisonControl">对照 <select id="comparisonChoice" aria-label="审核页对照方式"><option value="original">原文对照</option></select></label></div></div><small id="rankingNotice" hidden></small><p id="comparisonNotice" class="scopeSummary" hidden></p>
<details id="stashedDrafts" hidden><summary>本机暂存草稿</summary><label>选择暂存 <select id="stashChoice"></select></label><p id="stashStatus"></p><div class="appearanceFields"><label>暂存时原文<pre id="stashOriginal" class="review-text"></pre></label><label>当前原文<pre id="stashCurrent" class="review-text"></pre></label></div><label>暂存内容<pre id="stashContents" class="review-text"></pre></label><button data-action="restoreStash" class="secondary">恢复草稿</button><button data-action="discardStash" class="secondary">放弃暂存</button></details><p id="locationConflict" role="alert" hidden></p><button data-action="relocate" class="secondary">用源文件当前选区修复位置</button><button id="repairBlock" data-action="repairBlock" class="secondary" hidden>修复或重新关联审核块</button><button id="syncBlock" data-action="syncBlock" class="secondary" hidden>重试自动同步</button><p id="intent" class="intent" hidden></p><section><h4>当前重点要求</h4><div id="questions"></div></section><details id="previousFeedback" open hidden><summary>上轮返修批注（只读对照）</summary><small>用来核对本版是否落实要求；不会自动成为本版待处理批注。</small><div id="previousNotes"></div></details><section class="reference"><h4>原文</h4><details id="oldBaseline" hidden><summary>草稿原有基准</summary><pre id="oldBaselineText"></pre></details><div id="original" class="review-text" data-side="original"></div><div id="originalZh" class="zh"></div><div id="currentBlockPanel" hidden><label for="currentBlock">最新正文块（选择范围以人工更新候选）</label><textarea id="currentBlock" readonly spellcheck="false"></textarea><button data-action="manualRebase" class="secondary">用选区人工更新候选</button></div><p id="draftStale" role="alert" hidden></p><button id="resetSourceDraft" data-action="resetSourceDraft" class="secondary" hidden>放弃原文草稿并载入最新</button><details id="blockEditor" hidden><summary>编辑当前原文块</summary><small>保存将修改正式正文，不代表接收候选；之后需核对受影响批注。</small><textarea id="blockSource" spellcheck="false"></textarea><button data-action="saveSource">保存当前原文</button></details></section>
<div id="translateStatus"></div>
<section id="options"></section><div id="composerDock"></div><p id="fewer"></p>
<section><h4>返修批注</h4><button data-action="newNote" title="新增返修批注（Alt+N）" class="secondary">新增返修批注</button><button data-action="reject" data-write class="secondary">拒绝本项全部候选</button><div id="noteComposer" hidden><p id="noteMode">新增返修批注</p><div id="noteScopeControls"><label>范围 <select id="scopeChoice"><option value="group">本项全部方案（默认）</option><option value="original">完整原文</option></select></label><button data-action="whole" class="secondary">取消选区／整项批注</button></div><p id="scope">未划词时可以直接填写整项要求。</p><button id="useSelection" data-action="useSelection" class="secondary" hidden>改用新选区</button><label>意见用途 <select id="notePurpose">${purposes}</select></label><textarea id="note" placeholder="填写返修要求"></textarea><button title="保存当前批注（Ctrl/Cmd+Enter）" id="saveNote" data-action="note" data-write>保存返修批注</button><button data-action="noteHandoff" data-write title="先保存，再把这条批注加入 Codex 输入区；不自动发送">保存并加入 Codex</button><button data-action="cancelNote" class="secondary">取消</button></div><div id="notes"></div></section></div><small id="operationStatus" role="status" aria-live="polite"></small><p id="status" role="status" aria-live="polite"></p><button id="retryHandoff" data-action="retryHandoff" data-write hidden>重试本项交接</button></main></div>
<dialog id="notesDialog"><div class="dialogHeading"><h3>批注管理</h3><button data-action="closeNotes" class="secondary">关闭</button></div><label>范围 <select id="notesScope"><option value="all">全部批注</option><option value="current">当前项</option><option value="selected">所选审核项</option></select></label><button data-action="selectNotes" class="secondary">全选当前范围</button><button data-action="clearNotes" class="secondary">清除当前范围</button><span id="notesCount"></span><div id="notesRows"></div><button data-action="sendSelectedNotes">所选批注 → Codex</button><button data-action="holdNotes" data-write>暂留</button><button data-action="releaseNotes" data-write>取消暂留</button><button data-action="deleteNotes" data-write>删除所选批注</button><p id="notesStatus" role="status"></p></dialog>
${assets.script ? `<script nonce="${nonce}" src="${assets.script}"></script>` : ''}<script nonce="${nonce}">${diff}</script><script nonce="${nonce}">${math}</script><script nonce="${nonce}">${filterItems.toString()}\n${staleBatchSelections.toString()}\n${client}</script></body></html>`;
}

function createWorkbench(vscode, context, services) {
    let panel, active, loaded, dirty = false, noteDirty = false, handling = false, pending, hasPending = false;
    let noteSelectionScope, noteItems = [];
    const pendingSynchronized = new Map();
    const translations = new Map();
    let translationRun, translationRequested = false, retryTranslation = false, translationEpoch = 0;
    let questionTranslationRun = Promise.resolve(), questionTranslationPending = [], questionTranslationTimer;
    const questionTranslationInflight = new Map();
    const questionTranslations = new Map();
    let questionVisible = new Set(), questionView = '';
    let lastRecords = new Map(), sourceSelection;
    let reviewMode = context.globalState?.get('reviewMode', 'paragraph') || 'paragraph', paragraphVisible = new Set();
    let questionPosition = '';
    let ready = false, client, uiState, notice, reading, handoffRetry, restoredDraft, pendingQuestion;
    let batchScope, batchItems = [];
    const selectionScope = (c, session) => JSON.stringify([c.repo, c.owner, session]);
    let appearanceWork = Promise.resolve(), draftWork = Promise.resolve();
    const observedDraftSessions = new Map();
    let navigationFilter = {query: '', kind: '', notes: false};
    let relatedReturn, showRequest = 0, coordinatingScope, pendingCardAction;
    // Reading preferences only: never revive drafts, notes or old review decisions.
    function readingState(state) {
        if (!state) return;
        return {...state, c: {...active}, drafts: {}, blockDraft: undefined, note: '', selected: undefined, selectionStale: false,
            editingNote: undefined, composer: false, scope: 'group', purpose:'revision', batchNote:'', batchPurpose:'revision', expandedNotes: []};
    }
    function post(message) {
        if (['result', 'saved', 'noteSaved', 'noteEdited', 'conflict'].includes(message.type)) message.action = handling || undefined;
        if ((message.type === 'noteSaved' || message.type === 'noteEdited') && !message.preserveInput) {
            noteDirty = false;
            if (uiState) Object.assign(uiState, {note: '', purpose:'revision', editingNote: undefined, selected: undefined, composer: false});
        }
        if (message.type === 'saved' && uiState) {
            uiState.c = {...active};
            if (!message.preserveInput) delete uiState.drafts[message.option];
            if (uiState.selected) {
                const chosen = uiState.selected;
                const text = chosen.side === 'candidate' ? options(loaded).find(o => o.label === chosen.option)?.after : loaded.original;
                uiState.selectionStale = text === undefined || text.replace(/\r\n/g, '\n') !== chosen.value;
            }
            message.resume = uiState;
            dirty = Object.entries(uiState.drafts).some(([label, value]) => options(loaded).some(o => o.label === label && o.after.replace(/\r\n/g, '\n') !== value)) ||
                uiState.blockDraft !== undefined && (uiState.sourceDraftStale || uiState.blockDraft !== loaded.block?.text.replace(/\r\n/g, '\n'));
        }
        if (['result', 'noteSaved', 'noteEdited'].includes(message.type)) notice = message;
        if (ready && panel?.visible) return panel.webview.postMessage(message);
    }
    const configuration = require('./ai_setup');
    context.subscriptions.push(configuration.subscribe(value => post({type: 'configuration', ...value})));
    const key = c => JSON.stringify([c.repo, c.owner, c.id, c.version]);
    const options = data => data.options || [{label: 'A', after: data.candidate, reason: '已有单方案', changes: data.changes}];
    const queueKey = c => JSON.stringify([c.repo, c.owner, services.session(c)]);
    const postponed = c => context.workspaceState.get('reviewPostponed', {})[queueKey(c)] || [];
    const directory = () => {
        const set = new Set(active && services.session && context.workspaceState ? postponed(active) : []);
        return services.directory().filter(item => lastRecords.has(item.id)).map(item => {
            const record = lastRecords.get(item.id), unbound = !(record.data.edit.questions || []).length;
            return {...item, postponed: set.has(item.id), ...(unbound ? {card:{original:record.data.original,options:options(record.data),fact_evidence:record.data.fact_evidence || [],excerpt_views:record.data.excerpt_views || [],excerpt_conflict:record.data.excerpt_conflict,postponed:set.has(item.id)}} : {})};
        });
    };
    async function setPostponed(c, value) {
        const session = services.session(c);
        if (!session || !context.workspaceState) throw new Error('当前审核批次无法保存暂缓队列。');
        const k = queueKey(c), stored = {...context.workspaceState.get('reviewPostponed', {})};
        const ids = new Set(stored[k] || []);
        if (value) ids.add(c.id); else ids.delete(c.id);
        stored[k] = [...ids];
        await context.workspaceState.update('reviewPostponed', stored);
    }
    const draftKey = (c, session) => JSON.stringify([c.repo, c.owner, session, c.id]);
    function rollDrafts(saved, c, session) {
        const scope = JSON.stringify([c.repo,c.owner]), entries = Object.entries(saved).filter(([k,d]) => k !== '_batches' && d.c.repo === c.repo && d.c.owner === c.owner);
        const known = saved._batches?.[scope];
        if (!entries.length && !known) return saved;
        const seen = [...new Set(entries.map(([,d]) => d.session))];
        const previous = known?.[0] === session ? known[1] : known?.[0] || seen.filter(s => s !== session).at(-1);
        const batches = [session, ...(previous && previous !== session ? [previous] : [])];
        const remove = entries.filter(([,d]) => !batches.includes(d.session)).map(([k]) => k);
        if (!remove.length && JSON.stringify(known) === JSON.stringify(batches)) return saved;
        const next = {...saved, _batches:{...saved._batches, [scope]:batches}};
        for (const k of remove) delete next[k];
        return next;
    }
    function updateDrafts(c, session, change = value => value, observed = false) {
        const task = draftWork.then(async () => {
            if (!observed && services.session(c) !== session) {
                throw new Error('审核批次已变化，未修改暂存草稿。');
            }
            const old = context.workspaceState.get('reviewDrafts', {}), next = change(rollDrafts(old, c, session));
            if (next !== old) await context.workspaceState.update('reviewDrafts', next);
        });
        draftWork = task.catch(() => {});
        return task;
    }
    function observeSession(c, session) {
        if (!session || !context.workspaceState) return;
        const scope = JSON.stringify([c.repo, c.owner]);
        if (observedDraftSessions.get(scope) === session) return;
        observedDraftSessions.set(scope, session);
        const task = updateDrafts(c, session, undefined, true);
        task.catch(error => {
            if (observedDraftSessions.get(scope) === session) observedDraftSessions.delete(scope);
            vscode.window.showErrorMessage('草稿批次更新失败：' + error.message);
        });
        return task;
    }
    function consumeRestoredDraft(token, component, option) {
        if (!token) return Promise.resolve();
        const task = draftWork.then(async () => {
            const saved = context.workspaceState.get('reviewDrafts', {}), current = saved[token.id];
            if (!current || JSON.stringify(current) !== token.snapshot) return;
            const record = structuredClone(current), state = record.state;
            if (component === 'candidate') delete state.drafts[option];
            else if (component === 'source') delete state.blockDraft;
            else if (component === 'batchNote') {state.batchNote=''; state.batchPurpose='revision'; delete state.batchItems;}
            else {state.note = ''; state.purpose = 'revision'; delete state.editingNote; delete state.selected; state.composer = false;}
            const next = {...saved};
            const hasCandidates = Object.entries(state.drafts || {}).some(([label, value]) => state.candidateDraftStale ||
                value !== record.options.find(([name]) => name === label)?.[1].replace(/\r\n/g, '\n'));
            const hasSource = state.blockDraft !== undefined && (state.sourceDraftStale || state.blockDraft !== record.block?.text.replace(/\r\n/g, '\n'));
            if (!hasCandidates && !hasSource && !state.note?.trim() && !state.batchNote?.trim() && !state.editingNote) delete next[token.id];
            else next[token.id] = record;
            try {await context.workspaceState.update('reviewDrafts', next);}
            catch (error) {throw new Error('内容已保存，但本机暂存更新失败：' + error.message + '；请勿重复保存。');}
            if (restoredDraft === token) {
                if (next[token.id]) token.snapshot = JSON.stringify(next[token.id]);
                else restoredDraft = undefined;
                if (active && active.repo === current.c.repo && active.owner === current.c.owner && active.id === current.c.id)
                    post({type:'stashes', stashes:storedDrafts(active)});
            }
        });
        draftWork = task.catch(() => {});
        return task;
    }
    function storedDrafts(c) {
        if (!context.workspaceState || !services.session) return [];
        const session = services.session(c);
        return Object.entries(context.workspaceState.get('reviewDrafts', {})).filter(([k, d]) => k !== '_batches' &&
            d.c.repo === c.repo && d.c.owner === c.owner && d.c.id === c.id).map(([id, d]) => {
            const selected = d.state.selected;
            const question = selected?.question && (loaded.edit.questions || []).find(q =>
                q.id === selected.question.id && q.file === selected.question.file && q.quote === selected.question.quote);
            const selectedText = selected?.side === 'question' ? question?.quote : selected?.side === 'candidate'
                ? d.state.drafts[selected.option] ?? options(loaded).find(o => o.label === selected.option)?.after : selected?.side === 'original' ? loaded.original : undefined;
            let selectionMatches = !selected || (!selected.question || !!question) && (selected.side === 'translation'
                || selectedText?.replace(/\r\n/g, '\n') === selected.value);
            if (selected?.questionSourceKey) {
                const rows=questionTable(c), row=rows.find(item=>item.key===selected.questionKey);
                const linked=selected.questionKey==='__unbound__' ? !rows.some(item=>item.entries.some(entry=>entry.id===selected.questionTarget)) && directory().some(item=>item.id===selected.questionTarget && item.version===selected.questionTargetVersion && item.card)
                    : row?.entries.some(item=>item.id===selected.questionTarget && item.version===selected.questionTargetVersion);
                const record=linked && lastRecords.get(selected.questionTarget);
                const excerpt=record && questionTranslationSource(record.data,row?.question,selected.side,selected.option,selected.questionViewStyle);
                const sourceKey=JSON.stringify([d.session,selected.questionKey,selected.questionTarget,selected.questionTargetVersion,selected.side,
                    selected.option || '',selected.questionViewStyle,selected.questionSource]);
                selectionMatches=selected.session===d.session && record?.c.version===selected.questionTargetVersion &&
                    selected.questionSourceKey===sourceKey && excerpt?.text===selected.questionSource &&
                    selected.value===excerpt.text.replace(/\r\n/g,'\n');
            }
            const exact = !d.state.candidateDraftStale && !d.state.sourceDraftStale && !d.state.selectionStale
                && d.session === session && d.c.version === c.version && loaded.source_match !== false && d.original === loaded.original
                && JSON.stringify(d.block) === JSON.stringify(loaded.block)
                && JSON.stringify(d.options) === JSON.stringify(options(loaded).map(o => [o.label, o.after])) && selectionMatches;
            return {id, session: d.session, version:d.c.version, original:d.original, block:d.block, state:d.state, exact};
        });
    }
    function questionTable(c) {
        if (!services.questions || !services.session || !context.workspaceState) return [];
        const session = services.session(c);
        if (!session) return [];
        const scope = JSON.stringify([c.repo, c.owner, session]);
        const checked = context.workspaceState.get('reviewQuestionChecks', {})[scope] || {};
        const rows = services.questions(c, checked);
        for (const key of Object.keys(checked)) if (!rows.some(row => row.key === key)) {
            const [id,file,quote] = JSON.parse(key);
            rows.push({key, question:{id,file,quote}, entries:[], snapshot:'[]'});
        }
        return rows.map(row => {
            const previous = checked[row.key], equal = previous !== undefined && sameQuestionSnapshot(previous, row.snapshot);
            return {...row, entries: row.entries.map(entry => {
                const record = lastRecords.get(entry.id);
                return record && record.c.version === entry.version ? {...entry, card: {original:record.data.original,
                    options:options(record.data), fact_evidence:record.data.fact_evidence || [], excerpt_views:record.data.excerpt_views || [], excerpt_conflict:record.data.excerpt_conflict, postponed:postponed(c).includes(entry.id)}} : entry;
            }), checked: equal, recheck: previous !== undefined && !equal};
        });
    }
    function packet() {
        const toolbar = services.toolbar?.() ?? defaultToolbar;
        if (!validToolbar(toolbar)) throw new Error('工具栏设置无效，请在 VS Code 设置中修正。');
        const session = services.session?.(active), scope = selectionScope(active, session);
        if (batchScope !== scope) {batchScope = scope; batchItems = [];}
        if (noteSelectionScope !== scope) {noteSelectionScope = scope; noteItems = [];}
        const {file, kind, block_id, location: originalLocation, display_location, versions, generation, requests, questions, previous_feedback} = loaded.edit;
        const location = display_location || originalLocation;
        return {type: 'content', c: active, data: {original: loaded.original, source_match: loaded.source_match, conflict: loaded.conflict, block: loaded.block, edit: {file, kind, block_id, location, versions, generation, requests, questions, previous_feedback}, intent: loaded.intent, fulfillment: loaded.fulfillment || [], fact_evidence: loaded.fact_evidence || [], excerpt_views: loaded.excerpt_views || [], excerpt_conflict: loaded.excerpt_conflict, fewer_options_reason: loaded.fewer_options_reason},
            options: options(loaded), directory: directory(), session, batchItems, noteItems, feedbackRows: services.feedbackRows?.(active) || [], navigationFilter, style: services.style(), toolbar, stashes: storedDrafts(active), questions: questionTable(active),
            sourceSelection, resume: uiState, reading, mode: context.globalState?.get('reviewMode', 'paragraph') || 'paragraph', questionViewStyle:context.globalState?.get('reviewQuestionViewStyle','snippets') || 'snippets',
            questionPosition: services.session?.(active) && services.session(active) === context.workspaceState?.get('reviewQuestionPosition', {})[JSON.stringify([active.repo,active.owner])]?.session
                ? context.workspaceState.get('reviewQuestionPosition', {})[JSON.stringify([active.repo,active.owner])].key : '',
            busy: handling, coordinating: !!coordinatingScope && active.repo === coordinatingScope.repo && active.owner === coordinatingScope.owner, relatedReturn: relatedReturn?.c.id, pendingCardAction,
            preview: services.selection(active), pdfStatus: services.pdfStatus(active)};
    }
    const valid = c => active && key(active) === key(c);
    const validHandoff = c => c && active && c.repo===active.repo && c.owner===active.owner &&
        services.session?.(c)===services.session?.(active) && lastRecords.get(c.id)?.c.version===c.version;
    function annotationSelection(value) {
        if (value.questionSourceKey) {
            const rows=questionTable(active), row=rows.find(item=>item.key===value.questionKey);
            const linked=value.questionKey==='__unbound__' && !rows.some(item=>item.entries.some(entry=>entry.id===value.questionTarget))
                ? directory().find(item=>item.id===value.questionTarget && item.version===value.questionTargetVersion && item.card)
                : row?.entries.find(item=>item.id===value.questionTarget && item.version===value.questionTargetVersion);
            const record=linked && lastRecords.get(linked.id);
            const key=JSON.stringify([value.session,value.questionKey,value.questionTarget,value.questionTargetVersion,value.side,
                value.option || '',value.questionViewStyle,value.questionSource]);
            if (!record || value.session!==services.session(active) || value.questionSourceKey!==key ||
                questionView!==JSON.stringify([value.session,value.questionKey,value.questionViewStyle,'question']) ||
                !['original','candidate','question'].includes(value.side) || !['full','snippets'].includes(value.questionViewStyle))
                throw new Error('审核项、问题或选区已变化，请重新选择。');
            const excerpt=questionTranslationSource(record.data,row?.question,value.side,value.option,value.questionViewStyle);
            if (!excerpt || excerpt.text!==value.questionSource) throw new Error('原文或候选片段已变化，请重新选择。');
            const span=selection(excerpt.text,value.value,value.start,value.end);
            if (value.side==='question') return {target:record.c,selection:{side:'original',start:0,end:Array.from(record.data.original).length,quote:record.data.original,
                display_context:{kind:'question',source_side:'question',source:row.question.quote,text:row.question.quote,
                    start:span.start,end:span.end,quote:span.quote,question:row.question}}};
            return {target:record.c,selection:{side:value.side,option:value.side==='candidate' ? value.option : undefined,
                start:excerpt.start+span.start,end:excerpt.start+span.end,quote:span.quote}};
        }
        if (value.questionTranslationKey) {
            const rows=questionTable(active), row=rows.find(item=>item.key===value.questionKey);
            const linked=value.questionKey==='__unbound__' && !rows.some(item=>item.entries.some(entry=>entry.id===value.questionTarget))
                ? directory().find(item=>item.id===value.questionTarget && item.version===value.questionTargetVersion && item.card)
                : row?.entries.find(item=>item.id===value.questionTarget && item.version===value.questionTargetVersion);
            const record=linked && lastRecords.get(linked.id), data=record?.data;
            const option=data && value.option && options(data).find(item=>item.label===value.option);
            const key=JSON.stringify([value.session,value.questionKey,value.questionTarget,value.questionTargetVersion,value.questionSide,
                value.option || '',value.questionViewStyle,value.questionSource]);
            if (!record || value.session!==services.session(active) || value.questionTranslationKey!==key || value.provider!==services.provider() ||
                questionView!==JSON.stringify([value.session,value.questionKey,value.questionViewStyle,'question'])) throw new Error('译文的审核项或问题已变化，请重新选择。');
            const result=questionTranslations.get(JSON.stringify([...JSON.parse(key),value.provider]));
            if (!result || result.error || result.noTranslation) throw new Error('译文已变化或未就绪，请重新翻译并选择。');
            const span=selection(result.text,value.value,value.start,value.end), isQuestion=value.questionSide==='question';
            const side=value.questionSide==='candidate' ? 'candidate' : 'original';
            const anchor=side==='candidate' ? option?.after : data.original;
            if (anchor===undefined) throw new Error('译文来源已变化，请重新选择。');
            const excerpt=questionTranslationSource(data,row?.question,value.questionSide,value.option,value.questionViewStyle);
            if (!excerpt || excerpt.text!==value.questionSource) throw new Error('译文片段已变化，请重新选择。');
            return {target:record.c,selection:{side,option:side==='candidate' ? option.label : undefined,start:0,end:Array.from(anchor).length,quote:anchor,
                display_context:{kind:'translation',source_side:isQuestion ? 'question' : side,source:isQuestion ? row.question.quote : anchor,text:result.text,
                    ...(value.questionSource !== (isQuestion ? row.question.quote : anchor) ? {source_excerpt:value.questionSource,source_start:excerpt.start,source_end:excerpt.end} : {}),
                    start:span.start,end:span.end,quote:span.quote,provider:value.provider,...(row ? {review_question:row.question} : {}),...(isQuestion ? {question:row.question} : {})}}};
        }
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
            const item = option && !question ? {text:source, kind:'candidate', option:option.label} : {text:source};
            const entry = translations.get(translationKey(value.provider, item));
            if (value.provider !== services.provider() || !entry || entry.error || entry.noTranslation) throw new Error('译文已变化或未就绪，请重新翻译并选择。');
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
        const list = filterItems(directory(), {...navigationFilter, queue:'active'}), index = list.findIndex(r => r.id === c.id);
        const request = showRequest;
        await services[action]({...c, option, workbench: true});
        if (request !== showRequest) return;
        const eligible = new Set(filterItems(directory(), {...navigationFilter, queue:'active'}).map(r => r.id));
        const next = list.slice(index + 1).concat(list.slice(0, Math.max(0, index))).find(r => eligible.has(r.id) && r.id !== c.id);
        hasPending = false;
        if (next) await show(lastRecords.get(next.id).c, undefined, true);
        else {const items = directory(); post({type: 'unavailable', message: `当前筛选范围没有下一活跃项；暂缓 ${items.filter(i => i.postponed).length} 项，定位冲突 ${items.filter(i => i.source_match === false).length} 项。未判定科学问题完成。`});}
    }
    async function handoffSavedNote(c, row, session) {
        try {
            await services.handoff(c, [row], session);
            handoffRetry = undefined;
            post({type: 'handoffRetry', available: false});
            post({type: 'result', message: '批注已保存并加入 Codex 输入区；请自行发送。'});
        } catch (error) {
            handoffRetry = {c:{...c}, row, session};
            post({type: 'handoffRetry', available: true});
            throw new Error('批注已保存，但加入 Codex 失败：' + error.message + '；可点“重试本项交接”，无需重复保存。');
        }
    }
    function sendContent(translate = true) {
        if (!ready || !panel?.visible) return;
        post(packet()); post({type: 'backupStatus', ...services.backupStatus?.()}); post({type: 'configuration', ...configuration.status()});
        post({type: 'handoffRetry', available: !!handoffRetry && validHandoff(handoffRetry.c) && handoffRetry.session===services.session?.(active)});
        if (hasPending && pending && pending.c.version !== active.version && (dirty || noteDirty)) post({type: 'conflict', message: 'AI 已生成新版。未保存编辑仍保留；请保存到别处或放弃后载入最新。'});
        if (!lastRecords.has(active.id)) post({type: 'unavailable', message: '当前项已处理或原文冲突；未覆盖任何未保存内容。'});
        if (notice?.message) post(notice);
        if (translations.size) for (const item of translationItems(loaded)) {
            const entry = translations.get(translationKey(services.provider(), item));
            if (entry) post({type: 'translation', key: item.key, source: item.text, provider: services.provider(), ...entry});
        }
        if (translate) autoTranslate();
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
        const operationPanel = panel;
        if (!state) throw new Error('尚未收到当前草稿，请返回审核页后重试。');
        if (state.batchNote?.trim()) throw new Error('请先保存或暂存共同返修意见，再切换。');
        if (state.candidateDraftStale) throw new Error('候选草稿基于旧原文；请先人工更新候选。');
        if (loaded.block && state.blockDraft !== undefined && state.blockDraft !== loaded.block.text.replace(/\r\n/g, '\n')) throw new Error('请先明确点击“保存当前原文”，再切换。');
        const ownLock = !handling;
        if (ownLock) {handling = 'saveSwitch'; post({type: 'busy', action: handling});}
        try {
            // Save an existing version's note before draft edits create a new version.
            if (noteDirty) {
                const restored = restoredDraft, target = {...active}, noteBefore = uiState?.note, purposeBefore=uiState?.purpose || 'revision';
                if (state.selectionStale) throw new Error('批注所选文字已变化，请重新选择范围或明确改为整项批注。');
                if (state.editingNote) {
                    const note = loaded.edit.requests.find(n => n.id === state.editingNote.id);
                    if (!note || note.version !== active.version || note.status !== 'open') throw new Error('批注版本已变化，未覆盖新版。');
                    await services.editNote({...active}, note, state.note, state.editingNote.previousText, state.purpose || 'revision', state.editingNote.previousPurpose || 'revision');
                } else {
                    let selected;
                    const chosen = state.selected;
                    if (chosen) {
                        selected = annotationSelection(chosen);
                    } else selected = {side: 'original', start: 0, end: Array.from(loaded.original).length, quote: loaded.original,
                        option: /^[ABC]$/.test(state.scope) ? state.scope : undefined};
                    await services.note(selected.target || {...active}, {...(selected.selection || selected),purpose:state.purpose || 'revision'}, state.note);
                }
                await consumeRestoredDraft(restored, 'note');
                if (panel !== operationPanel || !valid(target)) throw new Error('批注已保存，审核页已改变');
                const refreshed = await services.read(target);
                if (panel !== operationPanel || !valid(target)) throw new Error('批注已保存，审核页已改变');
                loaded = refreshed;
                if (uiState?.note !== noteBefore || (uiState?.purpose || 'revision') !== purposeBefore) throw new Error('批注已保存，保存期间产生的新输入仍未保存');
                post({type: 'noteEdited', requests: loaded.edit.requests || [], previous_feedback: loaded.edit.previous_feedback, message: '批注已保存，继续保存候选。'});
            }
            for (const [label, text] of Object.entries({...state.drafts})) {
                const option = options(loaded).find(o => o.label === label);
                if (!option) throw new Error('草稿对应方案已不存在：' + label);
                if (text === option.after.replace(/\r\n/g, '\n')) continue;
                const value = option.after.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
                const restored = restoredDraft, target = {...active}, candidateBefore = uiState?.drafts?.[label];
                const saved = await services.save(target, label, value);
                await consumeRestoredDraft(restored, 'candidate', label);
                if (panel !== operationPanel || !valid(target)) throw new Error('候选已保存，审核页已改变');
                loaded = saved;
                active = {...active, version: loaded.version};
                const preserveInput = uiState?.drafts?.[label] !== candidateBefore;
                post({...packet(), type: 'saved', option: label, preserveInput});
                if (preserveInput) throw new Error('候选已保存，保存期间产生的新草稿仍未保存');
            }
            dirty = noteDirty = false;
            services.saved({...active}, services.selection(active), !!state.compare);
        } catch (error) {
            throw new Error('未切换：' + error.message + '；已成功保存的内容保留，其余草稿仍在当前页。');
        } finally {
            if (ownLock) {handling = false; post({type: 'busy', action: false});}
        }
    }
    async function show(c, restore, advance = false, switchApproved = false) {
        pendingCardAction = undefined;
        const request = ++showRequest;
        if (active && key(active) === key(c) && panel && !restore) {panel.reveal(); sendContent(false); await services.activeChanged?.(active); return;}
        if (!switchApproved && !await allowSwitch()) {if (active) await services.activeChanged?.(active); return;}
        const data = await (advance && services.readNext ? services.readNext(c) : services.read(c));
        if (request !== showRequest) return;
        if (data.id !== undefined && data.id !== c.id || data.version !== undefined && data.version !== c.version) throw new Error('读取卡片身份不一致；未切换或接收。');
        const session = services.session?.(c);
        if (session && context.workspaceState) await updateDrafts(c, session);
        if (request !== showRequest || session && services.session(c) !== session) return;
        const scope = selectionScope(c, session);
        if (batchScope !== scope) {batchScope = scope; batchItems = [];}
        active = {...c}; loaded = data; dirty = noteDirty = false; hasPending = false; sourceSelection = undefined;
        paragraphVisible.clear(); questionVisible.clear(); questionView=''; translationEpoch++;
        uiState = notice = handoffRetry = restoredDraft = undefined;
        if (restore) {uiState = readingState(restore.state); navigationFilter = restore.filter;}
        if (!panel) {
            panel = vscode.window.createWebviewPanel('texscholarReview', '论文审核', vscode.ViewColumn.One,
                {enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(__dirname, 'vendor', 'katex'))], retainContextWhenHidden: false});
            panel.webview.onDidReceiveMessage(receive);
            panel.onDidChangeViewState(({webviewPanel}) => {if (!webviewPanel.visible) {ready = false; translationRequested = retryTranslation = false;paragraphVisible.clear();questionVisible.clear();questionView='';translationEpoch++;}});
            panel.onDidDispose(() => {panel = undefined; active = loaded = pending = sourceSelection = undefined;
                lastRecords = new Map(); hasPending = dirty = noteDirty = ready = handling = false; pendingSynchronized.clear(); showRequest++;
                uiState = notice = client = reading = relatedReturn = restoredDraft = batchScope = pendingCardAction = pendingQuestion = undefined; batchItems = []; translationEpoch++; translations.clear(); questionTranslations.clear(); questionVisible.clear(); paragraphVisible.clear(); questionView='';});
            const asset = name => panel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'vendor', 'katex', name))).toString();
            panel.webview.html = html(crypto.randomBytes(16).toString('hex'), {source: panel.webview.cspSource, css: asset('katex.min.css'), script: asset('katex.min.js')});
        } else {panel.reveal(); sendContent();}
        const selected = services.activeChanged?.(active);
        if (advance) Promise.resolve(selected).catch(error => vscode.window.showErrorMessage('论文评论定位失败：' + error.message));
        else await selected;
    }
    function sync(records, scope, synchronized = new Set()) {
        if (!active || active.repo !== scope.repo || active.owner !== scope.owner) return;
        lastRecords = records;
        const next = records.get(active.id);
        post({type: 'directory', directory: directory()});
        post({type: 'feedbackRows', rows: services.feedbackRows?.(active) || []});
        post({type: 'questionRows', questions:questionTable(active)});
        post({type: 'pdfStatus', message: services.pdfStatus(active)});
        if (handling) {
            pending = next; hasPending = true;
            for (const id of synchronized) if (records.has(id)) {
                const c = records.get(id).c;
                pendingSynchronized.set(JSON.stringify([c.repo, c.owner, id]), {...c});
            }
            return;
        }
        if (!next) {post({type: 'unavailable', message: '当前项已处理或原文冲突；未覆盖任何未保存内容。'}); return;}
        if (next.c.version === active.version) {
            const questionsChanged = JSON.stringify(loaded.edit.questions) !== JSON.stringify(next.data.edit.questions);
            const evidenceChanged = JSON.stringify(loaded.fact_evidence) !== JSON.stringify(next.data.fact_evidence);
            const excerptsChanged = JSON.stringify(loaded.excerpt_views) !== JSON.stringify(next.data.excerpt_views) || loaded.excerpt_conflict !== next.data.excerpt_conflict;
            const locationChanged = loaded.source_match !== next.data.source_match || loaded.conflict !== next.data.conflict ||
                JSON.stringify(loaded.block) !== JSON.stringify(next.data.block);
            loaded = next.data;
            if (excerptsChanged) post({type:'excerptViews', views:loaded.excerpt_views || [], conflict:loaded.excerpt_conflict});
            if (evidenceChanged) post({type:'factEvidence', evidence:loaded.fact_evidence || []});
            if (locationChanged) post({type:'locationStatus', source_match:loaded.source_match, conflict:loaded.conflict, excerpt_conflict:loaded.excerpt_conflict, block:loaded.block});
            post({type: 'notes', requests: loaded.edit.requests || [], previous_feedback: loaded.edit.previous_feedback, questions: loaded.edit.questions || []});
            if (questionsChanged) autoTranslate();
        } else if (synchronized.has(active.id)) {
            const old = loaded;
            active = {...next.c}; loaded = next.data;
            paragraphVisible.clear();questionVisible.clear();questionView='';translationEpoch++;
            if (dirty || noteDirty) {
                uiState = {...uiState, c:active, oldOriginal:uiState?.oldOriginal || old.original,
                    candidateDraftStale:!!Object.keys(uiState?.drafts || {}).length,
                    sourceDraftStale:!!(uiState?.blockDraft !== undefined && old.block && uiState.blockDraft !== old.block.text.replace(/\r\n/g, '\n')),
                    selectionStale:!!uiState?.selected};
            } else uiState = readingState(uiState);
            sourceSelection = undefined; notice = {type:'result', message:'已自动同步；未接收候选。'}; sendContent(false);
        } else if (dirty || noteDirty) {
            pending = next; hasPending = true;
            post({type: 'conflict', message: 'AI 已生成新版。未保存编辑仍保留；请保存到别处或放弃后载入最新。'});
        } else {active = {...next.c}; loaded = next.data; paragraphVisible.clear();questionVisible.clear();questionView='';translationEpoch++;uiState = readingState(uiState); sourceSelection = notice = undefined; sendContent();}
    }
    function autoTranslate(force = false) {
        if (!active || !ready || !panel?.visible || reviewMode === 'question' || (!force && (!services.autoTranslate() || !paragraphVisible.size))) return;
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
        const keep = data => {for (const item of translationItems(data)) texts.add(translationKey(services.provider(), item));};
        for (const record of lastRecords.values()) keep(record.data);
        if (loaded) keep(loaded);
        for (const key of translations.keys()) if (!texts.has(key)) translations.delete(key);
    }
    async function translate(retry) {
        trimTranslations();
        const c = {...active}, data = loaded, epoch = translationEpoch, provider = services.provider();
        const items = translationItems(data).filter(item=>retry || paragraphVisible.has(item.key));
        let failure, warning;
        for (const item of items) {
            if (!valid(c) || epoch !== translationEpoch || !ready || !panel?.visible) return;
            if (!retry && !paragraphVisible.has(item.key)) continue;
            if (!item.text.trim()) continue;
            const cacheKey = translationKey(provider, item);
            let translated = translations.get(cacheKey);
            if (!translated || (retry && translated.error)) {
                post({type: 'translationStatus', message: provider + '：正在翻译 ' + item.key});
                try {const value = failure ? undefined : await services.translate(item.text, provider, item);
                    translated = failure ? {error: failure} : typeof value === 'string' ? {text:value} : value;}
                catch (error) {failure = error.message; translated = {error: failure};}
                if (epoch !== translationEpoch || !valid(c)) return;
                if (!retry && !paragraphVisible.has(item.key)) continue;
                translations.set(cacheKey, translated);
            }
            if (translated.warning) warning = translated.warning;
            if (valid(c)) post({type: 'translation', key: item.key, source: item.text, provider, ...translated});
        }
        if (valid(c)) post({type: 'translationStatus', message: provider + '：本项翻译已处理，失败项可手动重试' + (warning ? '；' + warning : '')});
    }
    function translationItems(data) {
        return [{key: 'original', text: data.original}, ...options(data).map(o => ({key: o.label, text: o.after, kind:'candidate', option:o.label})),
            ...(data.edit.questions || []).map((q, i) => ({key: 'question' + i, text: q.quote}))];
    }
    function translationKey(provider, item) {return JSON.stringify([provider,item.text,item.kind || '',item.option || '']);}
    function requestQuestionTranslation(item, provider, repo, stillValid) {
        return new Promise(resolve => {
            questionTranslationPending.push({item, provider, repo, stillValid, resolve});
            if (questionTranslationTimer) return;
            questionTranslationTimer = setTimeout(async () => {
                questionTranslationTimer = undefined;
                const pending = questionTranslationPending; questionTranslationPending = [];
                const groups = new Map();
                for (const entry of pending) {
                    if (!entry.stillValid()) {entry.resolve(); continue;}
                    const groupKey = JSON.stringify([entry.provider, entry.repo]);
                    if (!groups.has(groupKey)) groups.set(groupKey, []);
                    groups.get(groupKey).push(entry);
                }
                await Promise.all([...groups.values()].map(async group => {
                    const unique = new Map();
                    for (const entry of group) unique.set(translationKey(entry.provider, entry.item), entry.item);
                    const items = [...unique.values()];
                    try {
                        const results = services.translateMany ? await services.translateMany(items, group[0].provider, group[0].repo) :
                            await Promise.all(items.map(item => services.translate(item.text, group[0].provider, item)));
                        const mapped = new Map(items.map((item, i) => [translationKey(group[0].provider, item), typeof results[i] === 'string' ? {text:results[i]} : results[i]]));
                        for (const entry of group) entry.resolve(mapped.get(translationKey(entry.provider, entry.item)));
                    } catch (error) {for (const entry of group) entry.resolve({error:error.message});}
                }));
            }, 0);
        });
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
            client = message.instance; ready = true; sendContent();
            if (pendingQuestion) {
                const target = pendingQuestion; pendingQuestion = undefined;
                try {focusQuestion(target);} catch (error) {vscode.window.showErrorMessage(error.message);}
            }
            return;
        }
        if (!active || !panel) return;
        if (message.type === 'questionTranslateBatch') {
            if (message.instance !== client || !Array.isArray(message.requests)) return;
            await Promise.all(message.requests.map(request => receive({...message, ...request, type:'questionTranslate', requests:undefined})));
            return;
        }
        if (message.type === 'paragraphTranslationView') {
            if (message.instance!==client || message.repo!==active.repo || message.owner!==active.owner || message.id!==active.id || message.version!==active.version ||
                !Array.isArray(message.visible) || message.visible.some(key=>typeof key!=='string')) return;
            paragraphVisible=new Set(message.visible); autoTranslate(); return;
        }
        if (message.type === 'translateCard') {
            if (message.instance!==client || message.repo!==active.repo || message.owner!==active.owner || message.id!==active.id || message.version!==active.version) return;
            const option=options(loaded).find(item=>item.label===message.option), c={...active}, epoch=translationEpoch, provider=services.provider();
            if (!option || uiState?.drafts?.[option.label] !== undefined && uiState.drafts[option.label] !== option.after.replace(/\r\n/g,'\n')) return;
            const item={key:option.label,text:option.after,kind:'candidate',option:option.label}, cacheKey=translationKey(provider,item);
            await translationRun;
            if (!valid(c) || epoch!==translationEpoch || provider!==services.provider()) return;
            let result=translations.get(cacheKey);
            if (!result || result.error) {
                try {const value=await services.translate(item.text,provider,item);result=typeof value==='string' ? {text:value} : value;}
                catch(error) {result={error:error.message};}
                if (!valid(c) || epoch!==translationEpoch || provider!==services.provider()) return;
                translations.set(cacheKey,result);
            }
            post({type:'translation',key:item.key,source:item.text,provider,...result}); return;
        }
        if (message.type === 'questionTranslationView') {
            if (message.instance !== client || message.repo !== active.repo || message.owner !== active.owner ||
                message.id !== active.id || message.version !== active.version || message.session !== services.session?.(active) ||
                typeof message.view !== 'string' || !Array.isArray(message.visible) || message.visible.some(value=>typeof value!=='string')) return;
            if (questionView !== message.view) translationEpoch++;
            questionView = message.view; questionVisible = new Set(message.visible); return;
        }
        if (message.type === 'questionTranslate') {
            if (message.instance !== client || message.repo !== active.repo || message.owner !== active.owner ||
                message.id !== active.id || message.version !== active.version || message.session !== services.session?.(active)) return;
            const rows = questionTable(active), row = rows.find(item => item.key === message.questionKey);
            const linked = message.questionKey === '__unbound__' && !rows.some(item=>item.entries.some(entry=>entry.id===message.target))
                ? directory().find(item=>item.id===message.target && item.version===message.targetVersion && item.card)
                : row?.entries.find(item => item.id === message.target && item.version === message.targetVersion);
            const record = linked && lastRecords.get(linked.id);
            const option = record && options(record.data).find(item => item.label === message.option);
            if (!record || !['full','snippets'].includes(message.viewStyle)) return;
            const source = questionTranslationSource(record.data,row?.question,message.side,message.option,message.viewStyle)?.text;
            if (source===undefined) return;
            const view = JSON.stringify([message.session,message.questionKey,message.viewStyle,'question']);
            const displayKey = JSON.stringify([message.session,message.questionKey,message.target,message.targetVersion,message.side,message.option || '',message.viewStyle,source]);
            if (message.source !== source || message.displayKey !== displayKey || message.view !== view || questionView !== view ||
                message.auto && (!services.autoTranslate() || !questionVisible.has(displayKey))) return;
            const epoch = translationEpoch, provider = services.provider(), origin = {...active};
            const originalSnapshot=record.data.original, candidateSnapshot=option?.after;
            const identity = JSON.stringify([message.session,message.questionKey,message.target,message.targetVersion,message.side,message.option || '',message.viewStyle,source,provider]);
            const item = {text:source, ...(message.side === 'candidate' ? {kind:'candidate',option:message.option} : {})};
            const cacheKey = translationKey(provider,item);
            const run = (async () => {
                const stillValid = () => {
                    if (!valid(origin) || epoch!==translationEpoch || !panel?.visible || provider!==services.provider() || services.session(active)!==message.session || questionView!==view) return false;
                    const latest=lastRecords.get(message.target), latestRows=questionTable(active), latestRow=latestRows.find(item=>item.key===message.questionKey);
                    const linkedNow=message.questionKey==='__unbound__' ? !latestRows.some(item=>item.entries.some(entry=>entry.id===message.target))
                        : latestRow?.entries.some(item=>item.id===message.target && item.version===message.targetVersion);
                    const hasDraft=message.target===active.id && (uiState?.sourceDraftStale || uiState?.candidateDraftStale ||
                        Object.entries(uiState?.drafts || {}).some(([label,value])=>options(loaded).some(item=>item.label===label && item.after.replace(/\r\n/g,'\n')!==value)) ||
                        uiState?.blockDraft!==undefined && uiState.blockDraft!==loaded.block?.text.replace(/\r\n/g,'\n'));
                    return (!message.auto || questionVisible.has(displayKey)) && linkedNow && !hasDraft &&
                        latest?.c.version===message.targetVersion && latest.data.original===originalSnapshot &&
                        (!message.option || options(latest.data).find(item=>item.label===message.option)?.after===candidateSnapshot);
                };
                if (!stillValid()) return;
                let result = translations.get(cacheKey);
                if (result?.error) result = undefined;
                result ||= questionTranslations.get(identity);
                if (!result || message.retry && result.error) {
                    const flightKey=JSON.stringify([epoch, identity, !!message.auto]);
                    try {
                        let flight=questionTranslationInflight.get(flightKey);
                        if (!flight) {
                            flight=requestQuestionTranslation(item, provider, origin.repo, stillValid);
                            questionTranslationInflight.set(flightKey,flight);
                            flight.finally(()=>{if (questionTranslationInflight.get(flightKey)===flight) questionTranslationInflight.delete(flightKey);});
                        }
                        result = await flight;
                    }
                    catch (error) {result = {error:error.message};}
                    if (!stillValid()) return;
                    if (!result.error) translations.set(cacheKey,result);
                }
                questionTranslations.set(identity,result);
                post({type:'questionTranslation', questionKey:message.questionKey,target:message.target,targetVersion:message.targetVersion,
                    side:message.side,option:message.option,viewStyle:message.viewStyle,source,provider,displayKey,view,...result});
            })();
            questionTranslationRun = Promise.all([questionTranslationRun, run]);
            await run;
            return;
        }
        if (message.type === 'cardActionClaim') {
            const action = pendingCardAction, latest = action && lastRecords.get(action.c.id);
            if (message.instance === client && action?.token === message.token && !handling && valid(action.c) &&
                services.session(active) === action.session && latest && key(latest.c) === key(action.c)) {
                pendingCardAction = undefined;
                post({type:'cardActionGrant', action});
            }
            return;
        }
        if (message.type === 'batchSelection') {
            if (message.instance !== client || message.repo !== active.repo || message.owner !== active.owner || message.session !== services.session?.(active) || batchScope !== selectionScope(active, message.session)) return;
            if (!Array.isArray(message.items) || message.items.some(i => !i || typeof i.id !== 'string' || typeof i.option !== 'string' || i.version === undefined) || new Set(message.items.map(i => i.id)).size !== message.items.length) return;
            batchItems = message.items.map(({id, version, option}) => ({id, version, option}));
            return;
        }
        if (message.type === 'noteSelection') {
            if (message.instance !== client || message.repo !== active.repo || message.owner !== active.owner || message.session !== services.session?.(active) || noteSelectionScope !== selectionScope(active, message.session) || !Array.isArray(message.items)) return;
            noteItems = message.items;
            return;
        }
        if (message.type === 'rendered') {services.trace?.({stage:'webview_render',id:message.id,version:message.version,ms:message.ms}); return;}
        if (['accept','acceptBatch','saveAccept','reject'].includes(message.type)) services.trace?.({stage:'webview_request',id:message.id,version:message.version,
            displayed_id:active.id,displayed_version:active.version,roundtrip_to_host_ms:message.sentAt ? Date.now()-message.sentAt : undefined});
        if (message.type === 'filter') {
            const f = message.filter;
            if (!f || typeof f.query !== 'string' || !['', 'manuscript', 'response'].includes(f.kind) || typeof f.notes !== 'boolean' || ![undefined, 'active', 'deferred', 'all'].includes(f.queue)) return;
            navigationFilter = {query: f.query, kind: f.kind, notes: f.notes, ...(f.queue ? {queue:f.queue} : {})};
            return;
        }
        if (message.type === 'toolbarSave') {
            const value = message.toolbar;
            if (!validToolbar(value)) {
                post({type:'toolbarResult', error:true, message:'工具栏设置无效，未保存。'}); return;
            }
            try {
                await services.saveToolbar({order:value.order, visible:value.visible});
                post({type:'toolbarResult', toolbar:value});
            } catch (error) {post({type:'toolbarResult', error:true, message:'工具栏未保存：' + error.message});}
            return;
        }
        if (message.type === 'reviewMode') {
            if (!['paragraph','question'].includes(message.mode) || !['snippets','full'].includes(message.viewStyle) || typeof message.questionKey !== 'string') return;
            if (message.repo !== active.repo || message.owner !== active.owner || message.id !== active.id || message.version !== active.version) return;
            if (reviewMode!==message.mode) {reviewMode=message.mode; translationEpoch++;paragraphVisible.clear();}
            questionPosition = message.questionKey;
            try {
                await context.globalState?.update('reviewMode', message.mode);
                await context.globalState?.update('reviewQuestionViewStyle', message.viewStyle);
                if (context.workspaceState && services.session(active)) {
                    const positions = {...context.workspaceState.get('reviewQuestionPosition', {})};
                    positions[JSON.stringify([active.repo,active.owner])] = {session:services.session(active),key:message.questionKey};
                    await context.workspaceState.update('reviewQuestionPosition', positions);
                }
                if (reviewMode==='paragraph') autoTranslate();
                services.modeChanged?.();
            } catch (error) {post({type:'result', error:true, message:'审核模式未保存：' + error.message});}
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
        if (['reopen', 'locate', 'source', 'sourcePDF', 'question', 'translate', 'handoff', 'configuration', 'paperBackground', 'personalPrompts', 'start'].includes(message.type)) {
            try {
                if (!valid({...active, id: message.id, version: message.version})) throw new Error('当前项已更新，请核对新版。');
                const c = {...active};
                if (message.type === 'reopen') await services.reopen();
                else if (message.type === 'locate') await services.locate(c, services.selection(c));
                else if (message.type === 'source') await services.source(c);
                else if (message.type === 'sourcePDF') services.preview(c, services.selection(c), false, true, true);
                else if (message.type === 'translate') autoTranslate(true);
                else if (message.type === 'handoff') await services.handoff();
                else if (message.type === 'paperBackground') await vscode.commands.executeCommand('localLatex.paperBackground');
                else if (message.type === 'personalPrompts') await vscode.commands.executeCommand('localLatex.personalPrompts');
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
        const operationPanel = panel;
        handling = message.type; notice = undefined;
        post({type: 'busy', action: handling});
        try {
            if (message.type === 'connect') {await services.connect(); return post({type: 'result', message: ''});}
            if (message.type === 'copy') {await services.copy(); return post({type: 'result', message: '已复制三方案规则，不修改 SKILL。'});}
            if (message.type === 'finish') {await services.finish(); return post({type: 'result', message: '结束审核操作已返回，请核对备份结果。'});}
            if (client !== undefined && message.instance !== client || message.repo !== undefined && message.repo !== active.repo || message.owner !== undefined && message.owner !== active.owner || message.version !== active.version || message.id !== active.id) throw new Error('当前项已更新，旧操作已停止；请核对新版。');
            const c = {...active};
            if (message.type === 'manageFeedback') {
                if (message.session !== services.session(c) || !Array.isArray(message.items) || !message.items.length || !['hold','release','delete'].includes(message.action)) throw new Error('批注选择或审核批次无效。');
                const items = message.items;
                const rows = services.feedbackRows?.(c) || [];
                if (items.some(item => !rows.some(row => JSON.stringify(row) === JSON.stringify(item)))) throw new Error('所选批注已变化，请清选后重新核对。');
                if (message.action === 'delete') {
                    const detail = items.map(item => `${item.id} · ${item.file} · ${item.note.option ? '方案 ' + item.note.option : '整项／原文'} · ${item.note.version}\n选区：${item.note.display_context?.quote ?? item.note.quote}\n批注：${item.note.text}`).join('\n\n');
                    const answer = await vscode.window.showWarningMessage(`删除所选 ${items.length} 条批注？此操作不会删除正文或候选。`, {modal:true, detail}, '删除批注');
                    if (answer !== '删除批注') return post({type:'feedbackManaged', cancelled:true});
                    if (panel !== operationPanel || !valid(c) || services.session(c) !== message.session) throw new Error('审核位置或批次已变化；未删除批注。');
                }
                await services.manageFeedback(c, items.map(({id,version,file,note,source}) => ({id,version,file,note,source})), message.session, message.action);
                if (panel !== operationPanel || !valid(c)) return;
                const done = new Set(items.map(item => JSON.stringify(item)));
                noteItems = noteItems.filter(item => !done.has(JSON.stringify(item)));
                return post({type:'feedbackManaged', items:noteItems, rows:services.feedbackRows?.(c) || [], message:'已处理 ' + items.length + ' 条批注。'});
            }
            if (message.type === 'questionCard') {
                const session = services.session(c);
                const row = message.questionKey === '__unbound__'
                    ? {entries:directory().filter(item => item.card && !questionTable(c).some(row=>row.entries.some(entry=>entry.id===item.id)))}
                    : questionTable(c).find(item => item.key === message.questionKey);
                const entry = row?.entries.find(item => item.id === message.target && item.version === message.targetVersion);
                const record = entry && lastRecords.get(entry.id);
                if (!session || message.session !== session || !['open','preview','editToggle','optionNote','accept'].includes(message.intent) ||
                    !entry?.card || message.intent !== 'open' && !entry.card.options.some(option => option.label === message.option) || !record ||
                    record.c.repo !== c.repo || record.c.owner !== c.owner || record.c.version !== entry.version)
                    throw new Error('问题卡片身份或版本已变化，请重新核对。');
                if (message.intent==='accept' && entry.card.postponed) throw new Error('本项已暂缓，请先打开并恢复到活跃队列。');
                const target = {...record.c}, request = showRequest, originClient = client;
                await show(target);
                const latest = lastRecords.get(target.id);
                if (showRequest !== request + 1 || panel !== operationPanel || client !== originClient || !valid(target) ||
                    services.session(target) !== session || !latest || key(latest.c) !== key(target))
                    throw new Error('切换已取消或问题卡片已变化；未执行操作。');
                pendingCardAction = {token:crypto.randomBytes(16).toString('hex'), c:target, session, option:message.option, intent:message.intent};
                sendContent(false);
                return;
            }
            if (message.type === 'handoffSelected') {
                const session = services.session(c);
                if (!session || message.session !== session || !Array.isArray(message.items) || !message.items.length || message.items.some(item => !(services.feedbackRows?.(c) || []).some(row => JSON.stringify(row) === JSON.stringify(item)))) throw new Error('所选批注已变化，请重新选择。');
                await services.handoff(c, message.items, session);
                post({type:'feedbackManaged', message:'所选批注已加入 Codex 输入区，请自行发送。'});
                return post({type:'result', message:'所选批注已加入 Codex 输入区，请自行发送。'});
            }
            if (message.type === 'batchNote') {
                const session = services.session(c), items = message.items;
                if (!session || session !== message.session || !Array.isArray(items) || !items.length || items.some(item => {
                    const record = lastRecords.get(item.id);
                    return !record || record.c.repo !== c.repo || record.c.owner !== c.owner || record.c.version !== item.version;
                })) throw new Error('所选审核项已变化，请重新选择；未保存批注。');
                const restored = restoredDraft;
                await services.batchNote(c, items, session, message.text, message.purpose);
                await consumeRestoredDraft(restored, 'batchNote');
                if (valid(c) && panel === operationPanel && services.session(c) === session)
                    return post({type:'batchNoteSaved', text:message.text, purpose:message.purpose === undefined ? 'revision' : message.purpose, scope:message.scope || 'whole', items, message:'共同要求已逐项保存；未发送或接收。'});
                return vscode.window.showInformationMessage('共同要求已逐项保存；未发送或接收。');
            }
            if (message.type === 'checkQuestion') {
                const row = questionTable(c).find(item => item.key === message.questionKey);
                if (!row || row.snapshot !== message.snapshot) throw new Error('关联或批注已变化，请重新核对问题。');
                const session = services.session(c), scope = JSON.stringify([c.repo,c.owner,session]);
                const saved = {...context.workspaceState.get('reviewQuestionChecks', {})};
                saved[scope] = {...saved[scope], [row.key]:row.snapshot};
                await context.workspaceState.update('reviewQuestionChecks', saved);
                if (valid(c) && panel === operationPanel && services.session(c) === session) post({type:'questionRows', questions:questionTable(c)});
                return;
            }
            if (message.type === 'questionEntry') {
                const row = questionTable(c).find(item => item.key === message.questionKey);
                const entry = row?.entries.find(item => item.id === message.target && item.version === message.targetVersion);
                if (!entry || !['pending','rework'].includes(entry.status)) throw new Error('关联条目已变化，请重新查看问题。');
                const record = lastRecords.get(entry.id);
                if (record && record.c.version === entry.version) await show(record.c);
                else await services.openQuestionEntry(c, entry.id, entry.version);
                return;
            }
            if (message.type === 'stashClose') {
                const session = services.session?.(c), state = message.state;
                if (!session || !context.workspaceState || !state || !state.c || key(state.c) !== key(c)) throw new Error('当前草稿身份不完整，未关闭。');
                const k = draftKey(c, session), existing = context.workspaceState.get('reviewDrafts', {})[k];
                if (existing) {
                    const answer = await vscode.window.showWarningMessage('本项已有暂存草稿；替换后原暂存内容将不可恢复。', {modal:true}, '替换暂存');
                    if (answer !== '替换暂存') return;
                    if (!valid(c) || panel !== operationPanel || services.session(c) !== session) return;
                }
                const record = {c, session, revision:crypto.randomBytes(16).toString('hex'), original:loaded.original, block:loaded.block, options:options(loaded).map(o => [o.label,o.after]), state};
                await updateDrafts(c, session, saved => {
                    if (JSON.stringify(existing) !== JSON.stringify(saved[k])) throw new Error('暂存草稿已变化，未覆盖。');
                    const next = {...saved, [k]:record};
                    return rollDrafts(next, c, session);
                });
                if (valid(c) && panel === operationPanel && services.session(c) === session) operationPanel.dispose();
                return;
            }
            if (message.type === 'restoreStash' || message.type === 'discardStash') {
                const draft = storedDrafts(c).find(item => item.id === message.stash);
                if (!draft) throw new Error('暂存草稿不存在或不属于当前项。');
                if (message.type === 'discardStash') {
                    const snapshot = JSON.stringify(context.workspaceState.get('reviewDrafts', {})[draft.id]);
                    const answer = await vscode.window.showWarningMessage('确定放弃这份暂存草稿？', {modal:true}, '放弃暂存');
                    if (answer !== '放弃暂存') return;
                    if (!valid(c) || panel !== operationPanel) return;
                    const session = services.session(c);
                    await updateDrafts(c, session, saved => {
                        if (JSON.stringify(saved[draft.id]) !== snapshot) throw new Error('暂存草稿已变化，未放弃新版。');
                        const next = {...saved}; delete next[draft.id]; return next;
                    });
                    if (valid(c) && panel === operationPanel) sendContent(false);
                } else {
                    if (!draft.exact) throw new Error('暂存的批次、版本或正文基准已变化；请对照旧草稿人工处理，不能直接恢复。');
                    if (dirty || noteDirty) throw new Error('当前页已有未保存内容，请先保存或暂存后再恢复。');
                    restoredDraft = {id:draft.id, snapshot:JSON.stringify(context.workspaceState.get('reviewDrafts', {})[draft.id])};
                    uiState = {...draft.state, c:{...active}};
                    if (uiState.batchNote?.trim() && Array.isArray(uiState.batchItems)) batchItems = uiState.batchItems.map(item => ({...item}));
                    if (uiState.selected?.side === 'translation') uiState.selectionStale = true;
                    dirty = Object.keys(uiState.drafts).length > 0 || uiState.blockDraft !== undefined && uiState.blockDraft !== loaded.block?.text.replace(/\r\n/g, '\n');
                    noteDirty = !!uiState.note?.trim() || !!uiState.editingNote;
                    sendContent(false);
                    post({type:'result',message:'草稿已恢复到当前页；尚未保存或接收。'});
                }
                return;
            }
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
                if (!validHandoff(handoffRetry?.c) || handoffRetry.session!==services.session?.(c)) throw new Error('交接目标已改变，请核对当前项；未重复保存批注。');
                return await handoffSavedNote(handoffRetry.c, handoffRetry.row, handoffRetry.session);
            }
            if (message.type === 'postpone' || message.type === 'restorePostponed') {
                const isPostponing = message.type === 'postpone';
                const list = filterItems(directory(), {...navigationFilter, queue:'active'});
                const index = list.findIndex(item => item.id === c.id);
                const next = list.slice(index + 1).concat(list.slice(0, Math.max(0, index))).find(item => item.id !== c.id);
                const request = showRequest;
                const session = services.session(c);
                if (isPostponing && !await allowSwitch()) return;
                if (!active || active.repo !== c.repo || active.owner !== c.owner || active.id !== c.id || panel !== operationPanel) return;
                const target = {...active};
                await setPostponed(target, isPostponing);
                if (!valid(target) || panel !== operationPanel || services.session(target) !== session) return;
                post({type:'directory', directory:directory()});
                if (isPostponing && request !== showRequest) return;
                if (isPostponing && next) await show(lastRecords.get(next.id).c, undefined, true, true);
                else if (isPostponing) {
                    dirty = noteDirty = false; uiState = undefined;
                    const items = directory();
                    post({type:'unavailable', message:`活跃队列没有下一项；暂缓 ${items.filter(i => i.postponed).length} 项，定位冲突 ${items.filter(i => i.source_match === false).length} 项。可在目录中打开或恢复暂缓项。`});
                } else {sendContent(false); post({type:'result', message:'已恢复到活跃队列。'});}
            } else if (message.type === 'switch' || message.type === 'next' || message.type === 'previous') {
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
                if (uiState?.candidateDraftStale) throw new Error('候选草稿基于旧原文；请在最新正文块中选择范围并人工更新候选。');
                const option = options(loaded).find(o => o.label === message.option);
                if (!option || typeof message.value !== 'string') throw new Error('请选择现有候选方案。');
                if (message.type === 'saveAccept' && (noteDirty || Object.entries(uiState?.drafts || {}).some(([label, value]) =>
                    label !== message.option && options(loaded).some(o => o.label === label && o.after.replace(/\r\n/g, '\n') !== value)))) {
                    throw new Error('请先保存其他方案草稿和返修批注，再保存并接收本方案。');
                }
                const value = option.after.includes('\r\n') ? message.value.replace(/\r?\n/g, '\r\n') : message.value;
                if (message.type === 'save' && value === option.after) return post({type: 'result', message: '候选未修改，无需保存。'});
                if (value !== option.after) {
                    const restored = restoredDraft, candidateBefore = uiState?.drafts?.[message.option];
                    const saved = await services.save(c, message.option, value);
                    await consumeRestoredDraft(restored, 'candidate', message.option);
                    if (panel !== operationPanel || !valid(c)) return;
                    loaded = saved;
                    active = {...c, version: loaded.version}; dirty = false; paragraphVisible.clear();questionVisible.clear();questionView='';translationEpoch++;
                    post({...packet(), type: 'saved', option: message.option, preserveInput:uiState?.drafts?.[message.option] !== candidateBefore, message: '方案 ' + message.option + ' 已保存；尚未接收。'});
                }
                if (message.type === 'saveAccept') {
                    if (dirty || noteDirty) throw new Error('候选已保存；保存期间产生的新草稿尚未保存，未接收。');
                    try {await decideAndAdvance({...active}, 'accept', message.option);}
                    catch (error) {throw new Error('候选保存步骤已完成，接收或跳转返回错误：' + error.message + '；请核对当前状态，不要重复保存。');}
                } else {
                    autoTranslate(); services.saved(active, message.option, !!message.compare);
                }
            } else if (message.type === 'editNote') {
                const savedSession = services.session?.(c);
                const note = (loaded.edit.requests || []).find(n => n.id === message.request);
                if (!note || note.status !== 'open' || note.version !== c.version) throw new Error('该批注已更新或不是当前版本的待处理批注，请核对新版。');
                const restored = restoredDraft, noteBefore = uiState?.note, purposeBefore=uiState?.purpose || 'revision';
                const saved = await services.editNote(c, note, message.text, message.previousText, message.purpose === undefined ? 'revision' : message.purpose, message.previousPurpose);
                await consumeRestoredDraft(restored, 'note');
                if (panel !== operationPanel || !valid(c)) return;
                const refreshed = await services.read(c);
                if (panel !== operationPanel || !valid(c)) return;
                loaded = refreshed;
                post({type: 'noteEdited', preserveInput:uiState?.note !== noteBefore || (uiState?.purpose || 'revision') !== purposeBefore, request: note.id, requests: loaded.edit.requests || [], previous_feedback: loaded.edit.previous_feedback, message: '批注已修改；编号、选区与候选保持不变。'});
                if (message.handoff) return await handoffSavedNote(c, saved, savedSession);
            } else if (message.type === 'note') {
                const savedSession = services.session?.(c);
                if (dirty) throw new Error('请先保存候选编辑，再绑定返修选区。');
                if (uiState?.selectionStale && message.start !== undefined) throw new Error('批注选区已变化；请重新选择或明确改为整项批注。');
                const option = options(loaded).find(o => o.label === message.option);
                let selected;
                if (message.questionSourceKey || ['question', 'translation'].includes(message.side)) selected = annotationSelection(message);
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
                const restored = restoredDraft, noteBefore = uiState?.note, purposeBefore=uiState?.purpose || 'revision';
                const noteTarget=selected.target || c, noteSelection=selected.selection || selected;
                const saved = await services.note(noteTarget, {...noteSelection,purpose:message.purpose === undefined ? 'revision' : message.purpose}, message.text);
                await consumeRestoredDraft(restored, 'note');
                if (panel !== operationPanel || !valid(c)) return;
                const preserveInput = uiState?.note !== noteBefore || (uiState?.purpose || 'revision') !== purposeBefore;
                if (!preserveInput) noteDirty = false;
                sourceSelection = undefined;
                post({type: 'noteSaved', preserveInput, message: '返修要求已保存，可继续添加；未发送 AI。'});
                if (message.handoff) return await handoffSavedNote(noteTarget, saved, savedSession);
            } else if (message.type === 'saveSource') {
                if (uiState?.sourceDraftStale) throw new Error('原文草稿基于旧正文；请先复制或放弃后载入最新。');
                if (!loaded.block || typeof message.value !== 'string') throw new Error('当前块不可编辑，请先核对标记。');
                const restored = restoredDraft;
                await services.saveSource(c, loaded.block, message.value);
                await consumeRestoredDraft(restored, 'source');
                if (panel !== operationPanel || !valid(c)) return;
                const savedText = message.value.replace(/\r\n/g, '\n');
                if (uiState?.blockDraft === savedText) uiState.blockDraft = undefined;
                dirty = uiState?.blockDraft !== undefined && uiState.blockDraft !== savedText ||
                    Object.entries(uiState?.drafts || {}).some(([label, value]) => options(loaded).some(o => o.label === label && o.after.replace(/\r\n/g, '\n') !== value));
                if (!hasPending) {
                    const refreshed = await services.read(c);
                    if (panel !== operationPanel || !valid(c)) return;
                    loaded = refreshed; sendContent();
                }
                return post({type: 'result', message: '原文已保存；受影响的候选将自动协调。'});
            } else if (message.type === 'manualRebase') {
                if (!loaded.block || message.block_id !== loaded.block.id || message.source_revision !== loaded.block.source_revision)
                    throw new Error('显示的正文块已变化；请重新选择范围。');
                const rebased = await services.manualRebase(c, loaded.block, message);
                if (!rebased) return post({type:'result', message:'未更新候选，草稿已保留。'});
                active = {...c, version:rebased.version}; loaded = rebased;
                uiState = {...uiState, c:active, drafts:{}, candidateDraftStale:false, selectionStale:!!uiState?.selected};
                dirty = !!uiState.sourceDraftStale; sendContent();
                return post({type:'result', message:'已人工更新候选基准；旧版本和批注保留，尚未接收。'});
            } else if (message.type === 'syncBlock') {
                if (dirty || noteDirty) throw new Error('请先保存候选和批注，再同步。');
                const synced = await services.syncBlock(c, loaded.block);
                if (synced) {active = {...c, version: synced.version}; loaded = synced; uiState = readingState(uiState); sendContent();}
                return post({type: 'result', message: synced ? '已生成新版候选，请核对后重新选择；未接收。' : '未同步。'});
            } else if (message.type === 'repairBlock') {
                if (dirty || noteDirty) throw new Error('请先保存候选和批注。');
                const repaired = await services.repairBlock(c, loaded);
                if (repaired) {loaded = repaired; uiState = readingState(uiState); sendContent();}
                return post({type:'result', message:repaired ? '审核块已重新关联；候选和批注保留。' : '未修改审核块。'});
            } else if (message.type === 'relocate') {
                if (dirty || noteDirty) throw new Error('请先保存候选和批注。');
                loaded = await services.relocate(c); sendContent();
            } else if (message.type === 'retryBackup') {
                services.retryBackup();
            } else if (message.type === 'acceptBatch') {
                if (dirty || noteDirty) throw new Error('请先保存候选和批注，再批量接收。');
                const items = message.items;
                const session = services.session(c);
                if (!session || message.session !== session) throw new Error('审核批次已变化，请重新选择；未接收任何项。');
                if (!Array.isArray(items) || !items.length || items.some(i => !lastRecords.has(i.id) || lastRecords.get(i.id).c.version !== i.version)) throw new Error('选中项已过期，请重新核对。');
                const deferred=context.workspaceState ? postponed(c) : [];
                if (items.some(i=>deferred.includes(i.id) || lastRecords.get(i.id).data.source_match===false)) throw new Error('所选项已暂缓或定位冲突；请先恢复或修复，未接收任何项。');
                const question = message.questionKey && questionTable(c).find(row => row.key === message.questionKey);
                const questionIds = message.questionKey === '__unbound__' ? new Set(directory().filter(item => !questionTable(c).some(row => row.entries.some(entry => entry.id === item.id))).map(item=>item.id)) : new Set(question?.entries.map(entry=>entry.id) || []);
                if (message.questionOnly && (!message.questionKey || items.some(item=>!questionIds.has(item.id)))) throw new Error('问题范围已变化，请重新选择；未接收任何项。');
                const request = showRequest;
                const accepted = await services.acceptBatch(items.map(i => ({...c, ...i, repo: c.repo, owner: c.owner})), session);
                if (batchScope === selectionScope(c, session)) batchItems = batchItems.filter(selected => !items.some(item => item.id === selected.id && item.version === selected.version && item.option === selected.option));
                if (panel === operationPanel) post({type:'batchAccepted', items, session, repo:c.repo, owner:c.owner});
                if (accepted?.refresh_error) return post({type:'unavailable', transaction:true, message:'接收已保存，但刷新审核页失败；请重新读取状态，勿重复接收：' + accepted.refresh_error});
                if (request !== showRequest) return;
                try {
                const remaining = directory();
                const eligible = filterItems(remaining, {...navigationFilter, queue:'active'}).filter(item=>item.source_match!==false && lastRecords.has(item.id));
                let next = message.questionKey ? eligible.find(item=>questionIds.has(item.id)) : eligible[0];
                if (!next && message.questionKey && message.questionKey!=='__unbound__') {
                    const rows=questionTable(c), index=rows.findIndex(row=>row.key===message.questionKey);
                    const following=rows.slice(index+1).find(row=>row.entries.some(entry=>eligible.some(item=>item.id===entry.id)));
                    if (following) {
                        next=eligible.find(item=>following.entries.some(entry=>entry.id===item.id));
                        if (context.workspaceState) {
                            const positions={...context.workspaceState.get('reviewQuestionPosition', {})};
                            positions[JSON.stringify([c.repo,c.owner])]={session,key:following.key};
                            await context.workspaceState.update('reviewQuestionPosition',positions);
                        }
                    }
                }
                if (next) await show(lastRecords.get(next.id).c, undefined, true);
                else post({type:'unavailable', message:`接收已保存；当前筛选范围没有下一可审核项。暂缓 ${remaining.filter(i => i.postponed).length} 项，定位冲突 ${remaining.filter(i => i.source_match === false).length} 项；可在目录调整筛选或恢复暂缓项。其他批注与科学问题状态独立保留。`});
                } catch (error) {return post({type:'unavailable', transaction:true, message:'接收已保存，但无法进入下一项；请重新读取状态，勿重复接收：' + error.message});}
            } else if (message.type === 'accept' || message.type === 'reject') {
                if (dirty || noteDirty) throw new Error('请先保存候选和返修要求，再接收或拒绝。');
                if (message.type === 'accept' && !options(loaded).some(o => o.label === message.option)) throw new Error('请选择具体接收方案。');
                await decideAndAdvance(c, message.type, message.option);
            } else if (message.type === 'preview' || message.type === 'pdf') {
                if (dirty) throw new Error('请先保存候选编辑再预览 PDF。');
                const option = message.option || services.selection(c);
                if (!options(loaded).some(o => o.label === option)) throw new Error('预览方案不存在。');
                services.preview(c, option, !!message.compare, message.type === 'pdf');
                post({type: 'preview', option}); post({type:'directory',directory:directory()});
            } else if (message.type === 'related') {
                const origin = {c, state: readingState(uiState), filter: {...navigationFilter}};
                await services.related(c, loaded.edit.questions?.[message.index]);
                if (active.repo === c.repo && active.owner === c.owner && active.id !== c.id) {
                    relatedReturn = origin; post({type: 'relatedReturn', id: c.id});
                }
            }
            else if (message.type === 'provider') {await services.changeProvider(); translationEpoch++; questionVisible.clear(); post({type:'questionTranslationReset'}); autoTranslate();}
            else throw new Error('不支持的审核操作。');
            post({type: 'result', message: ''});
        } catch (error) {
            const interrupted = message.type === 'acceptBatch' && error.message.includes('审核宿主事务失败');
            if (panel === operationPanel) post({type: interrupted ? 'unavailable' : ['manageFeedback','handoffSelected'].includes(message.type) ? 'feedbackManaged' : 'result', transaction:interrupted, error: true, message: error.message});
            else vscode.window.showErrorMessage(error.message);
        }
        finally {
            if (panel === operationPanel && active) {
                handling = false;
                const synchronized = new Set([...pendingSynchronized.values()].filter(c => c.repo === active.repo && c.owner === active.owner &&
                    lastRecords.get(c.id)?.c.version === c.version && lastRecords.get(c.id)?.c.repo === c.repo && lastRecords.get(c.id)?.c.owner === c.owner).map(c => c.id));
                pendingSynchronized.clear();
                if (hasPending && (!dirty && !noteDirty || pending?.c.version === active.version || synchronized.has(active.id))) {
                    hasPending = false; sync(lastRecords, {repo: active.repo, owner: active.owner}, synchronized);
                }
                post({type: 'busy', action: false});
            }
        }
    }
    function focusQuestion(target) {
        if (!active || reviewMode !== 'question' || target.repo !== active.repo || target.owner !== active.owner || target.session !== services.session(active))
            throw new Error('审核模式或批次已变化，请重新选择问题。');
        const rows = questionTable(active);
        const entries = target.questionKey === '__unbound__' ? directory().filter(item => !rows.some(row => row.entries.some(entry => entry.id === item.id))) :
            rows.find(row => row.key === target.questionKey)?.entries.filter(entry => entry.card);
        if (!entries?.length || target.id && !entries.some(entry => entry.id === target.id && entry.version === target.version))
            throw new Error('问题或审核项已变化，请重新选择。');
        panel.reveal();
        if (!ready || !panel.visible) pendingQuestion = {...target};
        else post({type:'focusQuestion', session:target.session, questionKey:target.questionKey, target:target.id, version:target.version});
    }
    context.subscriptions.push({dispose() {panel?.dispose();}});
    return {show, sync, observeSession, setRecords(records) {lastRecords = records; trimTranslations();}, focusQuestion,
        coordinating(scope, busy) {
            if (busy) coordinatingScope = scope;
            else if (coordinatingScope === scope) coordinatingScope = undefined;
            if (active) post({type: 'coordinating', busy: !!coordinatingScope && active.repo === coordinatingScope.repo && active.owner === coordinatingScope.owner});
        },
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
        titles() {post({type:'titles', location: loaded?.edit.display_location || loaded?.edit.location, directory:directory()});},
        titleStatus(message) {post({type:'titleStatus',message});},
        backupStatus(value) {post({type: 'backupStatus', ...value});},
        updateStyle() {if (active) post({type: 'style', style: services.style()});},
        settingsChanged() {if (active) {translationEpoch++; questionVisible.clear(); post({type:'questionTranslationReset'}); autoTranslate();}},
        get active() {return active;}, get mode() {return reviewMode;}, get questionPosition() {return questionPosition;}, whenTranslationIdle: () => Promise.all([translationRun, questionTranslationRun])};
}
module.exports = {createWorkbench, html, filterItems, staleBatchSelections};
