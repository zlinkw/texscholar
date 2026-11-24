'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {applyTransaction, finishTransaction} = require('./review_host_transaction');
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');

function fixture(names, invalid = -1) {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'host-transaction-'));
    const objects = path.join(root,'.codex-review','objects'); fs.mkdirSync(objects,{recursive:true});
    const entries = {};
    names.forEach((name,index) => {entries[index+'-old'] = Buffer.from('Old.\n').toString('base64');entries[index+'-new'] = (index === invalid ? Buffer.from([0xff]) : Buffer.from('New.\n')).toString('base64');
        if (!name.includes('..')) fs.writeFileSync(path.join(root,name),'Old.\n','utf8');});
    const object = Buffer.from(JSON.stringify({files:entries})), commit = sha(object);
    fs.writeFileSync(path.join(objects,commit+'.json'),object);
    const state = Buffer.from(JSON.stringify({schema:3,transaction:{commit,files:names,owner:false}}));
    fs.writeFileSync(path.join(root,'.codex-review','state.json'),state);
    const vscode = {Uri:{file:fsPath=>({fsPath,scheme:'file'})},workspace:{isTrusted:true,textDocuments:[],getWorkspaceFolder:()=>({uri:{fsPath:root}})},window:{visibleTextEditors:[]}};
    const registry = {state:()=>({eligible:true,generation:1}),check:async()=>{}};
    return {root,commit,state,vscode,registry};
}

test('transaction rejects traversal before any source writes', async () => {
    const f = fixture(['paper.tex','../outside.tex']);
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(f.state),f.commit),/路径无效/);
    assert.equal(fs.readFileSync(path.join(f.root,'paper.tex'),'utf8'),'Old.\n');
});

test('a dirty later file prevents every source write', async () => {
    const f = fixture(['first.tex','second.tex']);
    f.vscode.workspace.textDocuments.push({uri:{scheme:'file',fsPath:path.join(f.root,'second.tex')},isDirty:true});
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(f.state),f.commit),/未保存编辑/);
    assert.equal(fs.readFileSync(path.join(f.root,'first.tex'),'utf8'),'Old.\n');
    assert.deepEqual(fs.readFileSync(path.join(f.root,'.codex-review','state.json')),f.state);
});

test('invalid UTF-8 in a later file is rejected before any source write', async () => {
    const f = fixture(['first.tex','second.tex'], 1);
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(f.state),f.commit),/encoded data|编码/i);
    assert.equal(fs.readFileSync(path.join(f.root,'first.tex'),'utf8'),'Old.\n');
});

test('finalization requires the intended state and exact saved source', () => {
    const f = fixture(['paper.tex']);
    const statePath = path.join(f.root,'.codex-review','state.json');
    const final = Buffer.from(JSON.stringify({schema:3})).toString('base64');
    assert.throws(() => finishTransaction(f.root,sha(f.state),f.commit,final), /正文已变化/);
    fs.writeFileSync(path.join(f.root,'paper.tex'),'New.\n','utf8');
    assert.throws(() => finishTransaction(f.root,sha(f.state),f.commit,Buffer.from('{"schema":3,"extra":1}').toString('base64')), /最终状态/);
    assert.deepEqual(fs.readFileSync(statePath),f.state);
    finishTransaction(f.root,sha(f.state),f.commit,final);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath,'utf8')),{schema:3});
});

test('recovery checks all source bytes before trying to complete any file', async () => {
    const f = fixture(['first.tex','second.tex']);
    fs.writeFileSync(path.join(f.root,'first.tex'),'New.\n');
    fs.writeFileSync(path.join(f.root,'second.tex'),'Author edit.\n');
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(f.state),f.commit,true),/正文已变化：second.tex/);
    assert.equal(fs.readFileSync(path.join(f.root,'first.tex'),'utf8'),'New.\n');
    assert.equal(fs.readFileSync(path.join(f.root,'second.tex'),'utf8'),'Author edit.\n');
    assert.deepEqual(fs.readFileSync(path.join(f.root,'.codex-review','state.json')),f.state);
});

test('save refusal keeps the transaction even when the target bytes reached disk', async () => {
    const f=fixture(['paper.tex']), file=path.join(f.root,'paper.tex');
    let text='Old.\n';
    const doc={uri:{scheme:'file',fsPath:file},version:1,isDirty:false,isClosed:false,eol:1,getText:()=>text,positionAt:n=>n,
        async save(){fs.writeFileSync(file,text,'utf8');return false;}};
    f.vscode.EndOfLine={LF:1,CRLF:2}; f.vscode.Range=class {constructor(start,end){this.start=start;this.end=end;}};
    f.vscode.WorkspaceEdit=class {replace(_uri,_range,value){this.text=value;}};
    f.vscode.workspace.openTextDocument=async()=>doc;
    f.vscode.workspace.applyEdit=async edit=>{text=edit.text;doc.version++;doc.isDirty=true;return true;};
    f.vscode.window.showTextDocument=()=>{throw new Error('source editor must stay hidden');};
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(f.state),f.commit),/编辑器保存失败/);
    assert.equal(fs.readFileSync(file,'utf8'),'New.\n');
    assert.equal(doc.isDirty,true);
    assert.deepEqual(fs.readFileSync(path.join(f.root,'.codex-review','state.json')),f.state);
});

test('a changed linked question stops the transaction before opening or writing source', async () => {
    const f = fixture(['paper.tex']);
    const object = {files:{'0-old':Buffer.from('Old.\n').toString('base64'),'0-new':Buffer.from('New.\n').toString('base64'),'check-0':Buffer.from('Question.\n').toString('base64')}};
    const raw = Buffer.from(JSON.stringify(object)), commit = sha(raw);
    fs.writeFileSync(path.join(f.root,'.codex-review','objects',commit+'.json'),raw);
    fs.writeFileSync(path.join(f.root,'questions.md'),'Changed.\n');
    const state = Buffer.from(JSON.stringify({schema:3,transaction:{commit,files:['paper.tex'],checks:['questions.md'],owner:false}}));
    fs.writeFileSync(path.join(f.root,'.codex-review','state.json'),state);
    await assert.rejects(applyTransaction(f.vscode,f.registry,f.root,1,sha(state),commit),/核对文件已变化：questions.md/);
    assert.equal(fs.readFileSync(path.join(f.root,'paper.tex'),'utf8'),'Old.\n');
});
