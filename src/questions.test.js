'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {activate, links, blockLinks, validateTarget, jump, notifyProblem} = require('./questions');
test('structured question containers preserve precise associations without source metadata comments', () => {
    const id = '8b481c85-f8fa-46bb-88eb-c303a5e25a07';
    const q = {id:'R1-Q2', file:'review.tex', quote:'Actual reviewer wording.'};
    const text = `Before.\n% TS-BLOCK-BEGIN id=${id} kind=question\nReviewer comment.\nResponse.\n% TS-BLOCK-END id=${id}\nAfter.`;
    const state = {schema:3, blocks:{[id]:{file:'reply.tex', kind:'question', questions:[q]}}};
    const rows = blockLinks(text, 'reply.tex', state);
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].question, q);
    assert(text.indexOf('Reviewer comment.') > rows[0].start);
    assert(text.indexOf('Response.') < rows[0].end);
    assert(text.indexOf('After.') > rows[0].end);
    assert.deepEqual(blockLinks(text, 'other.tex', state), []);
    assert.throws(() => blockLinks(text.replace(`% TS-BLOCK-END id=${id}`, ''), 'reply.tex', state), /标记缺失/);
    assert.throws(() => blockLinks(text + '\n' + text, 'reply.tex', state), /标记缺失或重复/);
    assert.equal(blockLinks(text, 'reply.tex', {schema:3, blocks:{[id]:{...state.blocks[id],questions:[q,q]}}}).length, 2);
    assert.throws(() => blockLinks(text, 'reply.tex', {schema:3, blocks:{[id]:{...state.blocks[id],questions:'invalid'}}}), /无效/);
});
test('hover reads the registered question container from sidecar state', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'question-container-'));
    fs.mkdirSync(path.join(root, '.codex-review'));
    const id = '8b481c85-f8fa-46bb-88eb-c303a5e25a07';
    const q = {id:'R1-Q2', file:'review.tex', quote:'Actual reviewer wording.'};
    fs.writeFileSync(path.join(root, '.codex-review', 'state.json'), JSON.stringify({schema:3,blocks:{[id]:{file:'reply.tex',kind:'question',questions:[q]}}}), 'utf8');
    const text = `% TS-BLOCK-BEGIN id=${id} kind=question\nReviewer Comment.\n% TS-BLOCK-END id=${id}\n`;
    const document = {uri:{fsPath:path.join(root,'reply.tex')},getText:()=>text,
        lineAt:()=>({text:'Reviewer Comment.'}),offsetAt:()=>text.indexOf('Reviewer Comment.')};
    let provider;
    const vscode = {commands:{registerCommand:()=>({})},languages:{registerHoverProvider:(_, p)=>(provider=p,{})},
        workspace:{getWorkspaceFolder:()=>({uri:{fsPath:root}})},
        MarkdownString:class {constructor(){this.value='';} appendText(s){this.value+=s;} appendMarkdown(s){this.value+=s;}},
        Hover:class {constructor(value){this.value=value;}}};
    activate({subscriptions:[]}, vscode);
    const hover = await provider.provideHover(document, {line:1});
    assert(hover.value.value.includes(q.id)); assert(hover.value.value.includes(q.quote));
    assert(hover.value.value.includes('localLatex.jumpQuestion'));
});
test('AI-authored explicit question markers are recognized without guessing question numbering', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'questions-'));
    const q = {id: 'Reviewer 2, Comment 3', file: '原始意见.txt', quote: 'Please clarify the selection rule.'};
    const text = '% CODEX-QUESTION ' + JSON.stringify(q) + '\n\\textbf{Comment 3}\nResponse text.';
    assert.deepEqual(links(text)[0].question, q);
    assert.deepEqual(links('Comment 3 without any explicit source mapping'), []);
    assert.throws(() => validateTarget(root, {...q, file: '../outside.txt'}), /当前论文/);
    const file = path.join(root, q.file), source = 'Reviewer 2\n' + q.quote + '\n';
    fs.writeFileSync(file, source, 'utf8');
    const doc = {getText: () => source, positionAt: offset => offset};
    const editor = {revealRange() {}};
    const warnings = [];
    const api = {Uri: {file: file => file}, Selection: class {constructor(start, end) {Object.assign(this, {start, end});}},
        TextEditorRevealType: {InCenterIfOutsideViewport: 1}, workspace: {openTextDocument: async target => {assert.equal(target, file); return doc;}},
        window: {showTextDocument: async () => editor, showWarningMessage: async value => {warnings.push(value);}}};
    await jump(api, root, q);
    assert.equal(warnings.length, 0, 'valid associations must not notify');
    assert.equal(editor.selection.start, source.indexOf(q.quote));
    assert.equal(editor.selection.end - editor.selection.start, q.quote.length);
    doc.getText = () => 'Author changed the reviewer source.';
    await jump(api, root, q);
    assert.equal(warnings.length, 1, 'a stale quote opens the source without inventing a new exact position');
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    const embedded = '% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-DATA ' + JSON.stringify({questions: [q]})
        + '\n% CODEX-REVIEW-STATE-END\n% CODEX-QUESTION ' + JSON.stringify(q) + '\nReviewer 2\n' + q.quote + '\n';
    doc.getText = () => embedded;
    await jump(api, root, q);
    assert.equal(editor.selection.start, embedded.lastIndexOf(q.quote), 'select the original, not its stored metadata copy');
    doc.getText = () => embedded + q.quote;
    await jump(api, root, q);
    assert.equal(warnings.length, 2, 'two real original matches remain ambiguous');
});

test('association warning copies plugin-owned task rules without modifying skills, only after the author clicks', async () => {
    let copied, choices;
    const api = {window: {showWarningMessage: async (...args) => {choices = args; return '一键复制给 AI';}},
        env: {clipboard: {writeText: async text => {copied = text;}}}};
    await notifyProblem(api, '尚未关联');
    assert(choices.includes('查看规则'));
    assert(copied.includes('不要修改全局科研 SKILL'));
    assert(copied.includes('link_questions'));
    assert(copied.includes('apply 默认 true'));
    assert(copied.includes('不能按候选编号'));
    assert(copied.includes('最多一个自然段'));
});
