'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {legacyPlan,applyLegacy} = require('./review_host_legacy');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const b64 = value => Buffer.from(value).toString('base64');
function owner(state,body = 'Author.\n') {
    return '% CODEX-REVIEW-STATE-BEGIN\n% author comment\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-DATA ' + JSON.stringify(state) + '\n% CODEX-REVIEW-STATE-END\n' + body;
}
function fixture(mode = 'transaction') {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT,'host-legacy-'));
    const objects = path.join(root,'.codex-review','objects'); fs.mkdirSync(objects,{recursive:true});
    const before = owner({schema:2,edits:{}}), after = owner({schema:2,edits:{a:'accepted'}});
    fs.writeFileSync(path.join(root,'reply.tex'),before); fs.writeFileSync(path.join(root,'main.tex'),'Old.\n');
    const transaction = {commit:'a'.repeat(64),files:['main.tex'],owner:false};
    const plan = {kind:'legacy-review',owner:'reply.tex',owner_before:b64(before),owner_after:b64(after),
        owner_intent:mode === 'transaction' ? b64(owner({schema:2,edits:{a:'accepted'},transaction})) : null,
        files:mode === 'transaction' ? [{file:'main.tex',before:b64('Old.\n'),after:b64('New.\n')}] : [],checks:[]};
    const raw = Buffer.from(JSON.stringify({files:{'host-plan':b64(JSON.stringify(plan))}})), commit = sha(raw);
    fs.writeFileSync(path.join(objects,commit+'.json'),raw);
    const vscode = {Uri:{file:fsPath=>({fsPath,scheme:'file'})},workspace:{isTrusted:true,textDocuments:[],getWorkspaceFolder:()=>({uri:{fsPath:root}})}};
    return {root,commit,vscode,plan};
}
test('legacy transaction validates its embedded intent and metadata-only plan', () => {
    const f = fixture(), meta = fixture('metadata');
    assert.equal(legacyPlan(f.root,f.commit).files.length,1);
    assert.equal(legacyPlan(meta.root,meta.commit).files.length,0);
});
test('a changed later source prevents the first legacy owner write', async () => {
    const f = fixture(), registry = {state:()=>({eligible:true,generation:1}),check:async()=>{}};
    const ownerBefore = fs.readFileSync(path.join(f.root,'reply.tex'));
    fs.writeFileSync(path.join(f.root,'main.tex'),'Author edit.\n');
    await assert.rejects(applyLegacy(f.vscode,registry,f.root,1,f.commit),/审核文件已变化：main.tex/);
    assert.deepEqual(fs.readFileSync(path.join(f.root,'reply.tex')),ownerBefore);
});
test('role metadata transactions preserve all non-role source bytes', () => {
    const f = fixture('metadata'), before = '\\begin{document}\nAuthor.\n\\end{document}\n';
    const role = '% CODEX-FILE-ROLES-BEGIN\n% {"schema":1}\n% CODEX-FILE-ROLES-END\n';
    fs.writeFileSync(path.join(f.root,'reply.tex'),before);
    const plan = {kind:'role-metadata',owner:'reply.tex',owner_before:b64(before),owner_intent:null,owner_after:b64(role+before),files:[],checks:[]};
    const raw = Buffer.from(JSON.stringify({files:{'host-plan':b64(JSON.stringify(plan))}})), commit = sha(raw);
    fs.writeFileSync(path.join(f.root,'.codex-review','objects',commit+'.json'),raw);
    assert.equal(legacyPlan(f.root,commit).owner.relative,'reply.tex');
    plan.owner_after = b64(role+before.replace('Author.','Changed.'));
    const bad = Buffer.from(JSON.stringify({files:{'host-plan':b64(JSON.stringify(plan))}})), badId = sha(bad);
    fs.writeFileSync(path.join(f.root,'.codex-review','objects',badId+'.json'),bad);
    assert.throws(()=>legacyPlan(f.root,badId),/不能改写正文/);
});
