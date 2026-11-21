'use strict';
// Real commits/fetch/push use isolated local repositories; only GitHub transport metadata is substituted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {inspectBackup,backupProject,finishReview,automaticBackup,enqueueAutomatic,activateAutomatic,run} = require('./backup');
const GIT = process.env.LOCAL_LATEX_GIT;
async function fixture(label) {
    const parent = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT,label+'-'));
    const root = path.join(parent,'paper'), remote = path.join(parent,'origin.git');
    fs.mkdirSync(root);
    const git = (args,input) => run(GIT,args,root,input);
    await run(GIT,['init','--bare',remote],parent);
    await git(['init','-b','master']);
    assert.equal(path.resolve((await git(['rev-parse','--show-toplevel'])).trim()),path.resolve(root));
    for (const arg of ['--absolute-git-dir','--git-common-dir']) assert.equal(path.resolve(root,(await git(['rev-parse',arg])).trim()),path.join(root,'.git'));
    assert.equal(path.resolve(root,(await git(['rev-parse','--git-path','index'])).trim()),path.join(root,'.git/index'));
    await git(['config','user.name','Backup fixture']); await git(['config','user.email','backup@example.invalid']);
    await git(['config','core.autocrlf','false']);
    fs.writeFileSync(path.join(root,'main.tex'),'Original sentence.\n','utf8');
    await git(['add','main.tex']); await git(['commit','-m','baseline']);
    await git(['remote','add','origin',remote]); await git(['push','-u','origin','master']);
    const baseline = (await git(['rev-parse','HEAD'])).trim();
    let privacy = true;
    const execute = async (executable,args,cwd,input) => {
        if (executable === 'fixture-gh') return JSON.stringify({private:privacy,full_name:'fixture/paper'});
        if (args[0] === 'remote' && args[1] === 'get-url') return 'https://github.com/fixture/paper.git\n';
        return run(executable,args,cwd,input);
    };
    const inspect = () => inspectBackup(root,{git:GIT,gh:'fixture-gh'},execute);
    const edit = () => fs.writeFileSync(path.join(root,'main.tex'),'Revised sentence.\n','utf8');
    return {root,remote,baseline,git,inspect,edit,execute,setPrivacy:value=>{privacy=value;}};
}

const PYTHON = process.env.LOCAL_LATEX_PYTHON;
const SCRIPTS = fs.existsSync(path.join(__dirname,'source_review.py')) ? __dirname : path.resolve(__dirname,'../../scripts');
async function savedLocal(f, files, trigger='保存') {
    const parent = (await f.git(['rev-parse','HEAD'])).trim();
    return JSON.parse(await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'auto_backup.py'),'--project',f.root,'--git',GIT,'saved-local'],
        f.root,JSON.stringify({parent,files,trigger})));
}
async function reviewFixture(label, dependency = false, previousFeedback = false, crlf = false) {
    const f = await fixture(label);
    fs.writeFileSync(path.join(f.root,'main.tex'),'% CODEX-RULES-BEGIN\n% 保留写作规则。\n% CODEX-RULES-END\n\\documentclass{article}\n\\begin{document}\nThe model is strong and fast.\n\\end{document}\n','utf8');
    fs.writeFileSync(path.join(f.root,'reply.tex'),'% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n\\documentclass{article}\n\\begin{document}\nThank you.\n\\end{document}\n','utf8');
    fs.writeFileSync(path.join(f.root,'.gitignore'),'.codex-review/\n.latex-build/\nclean_dir/\n','utf8');
    if (crlf) {
        await f.git(['config','core.autocrlf','true']);
        for (const name of ['main.tex','reply.tex']) fs.writeFileSync(path.join(f.root,name),'\uFEFF'+fs.readFileSync(path.join(f.root,name),'utf8').replace(/\n/g,'\r\n'),'utf8');
    }
    await f.git(['add','--','main.tex','reply.tex','.gitignore']);
    await f.git(['commit','-m','paper sources before local review']); await f.git(['push','origin','master']);
    f.baseline = (await f.git(['rev-parse','HEAD'])).trim();
    const common = ['-X','utf8',path.join(SCRIPTS,'source_review.py'),'--project',f.root,'--state','reply.tex','--git',GIT];
    const status = async () => JSON.parse(await run(PYTHON,[...common,'status'],f.root));
    const backend = async (args,input) => {
        const state = await status();
        // Fixtures exercise the current public group interface, including when
        // only one alternative is needed to isolate a backup boundary.
        if (args[0] === 'propose' || args[0] === 'rework') {
            input = {...input, options: [{label:'A', after:input.after, reason:'隔离备份测试'}], fewer_options_reason:'此用例只检查备份边界'};
            args = [args[0] === 'propose' ? 'propose-options' : 'rework-options', ...args.slice(1)];
            if (args[0] === 'rework-options') args.push('--version', state.edits[args[args.indexOf('--id') + 1]].versions.at(-1));
        }
        if (args[0] === 'decide' && args.includes('--accept')) args = [...args, '--option', 'A'];
        return JSON.parse(await run(PYTHON,[...common,'--apply','--expect',state.sha256,...args],f.root,input===undefined?undefined:JSON.stringify(input)));
    };
    await backend(['begin','--round','round-1','--files','main.tex','reply.tex']);
    await backend(['propose'],{file:'main.tex',kind:'manuscript',before:'strong',after:'reliable'});
    if (previousFeedback) {
        await backend(['rework','--id','1'],{after:'dependable'});
        const prior = (await status()).edits['1'].versions.at(-1);
        await backend(['feedback'],{id:'1',version:prior,side:'original',start:0,end:6,quote:'strong',text:'PRIVATE previous feedback'});
        await backend(['rework','--id','1'],{after:'reliable',discard_annotations:true});
    }
    await backend(['propose'],{file:'main.tex',kind:'manuscript',before:'fast',after:'compact',deps:dependency?['1']:[]});
    const data = JSON.parse(await run(PYTHON,[...common,'inspect','--id','2'],f.root));
    await backend(['feedback'],{id:'2',version:data.version,side:'original',start:0,end:4,quote:'fast',text:'PRIVATE pending feedback: 保留原文，继续返修。'});
    await backend(['propose'],{file:'reply.tex',kind:'response',before:'Thank you.',after:'Thank you for this useful comment.'});
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON,checkpointScript:path.join(SCRIPTS,'review_checkpoint.py')};
    return {...f,status,backend,common,options};
}
test('saved backup commits author edits and keeps unrelated staging with legacy review privacy', async () => {
    const f = await reviewFixture('saved-private');
    await f.backend(['decide','--accept','1']);
    const main = path.join(f.root,'main.tex'), reply = path.join(f.root,'reply.tex');
    const owner = fs.readFileSync(reply);
    fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('The model','Author model'),'utf8');
    await f.git(['add','--','main.tex']);
    fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('Author model','Latest author model'),'utf8');
    fs.writeFileSync(path.join(f.root,'unrelated.txt'),'private staged choice','utf8'); await f.git(['add','--','unrelated.txt']);
    const staged = await f.git(['show',':unrelated.txt']); const before = await f.status();
    const result = await savedLocal(f,['main.tex','reply.tex']);
    assert((await f.git(['show','HEAD:main.tex'])).includes('Latest author model'));
    assert(!(await f.git(['show','HEAD:reply.tex'])).includes('CODEX-REVIEW-DATA'));
    assert.equal(await f.git(['show',':unrelated.txt']),staged);
    assert.equal((await f.git(['diff','--cached','--name-only'])).trim(),'unrelated.txt');
    assert(fs.readFileSync(reply).equals(owner));
    assert.deepEqual((await f.status()).edits,before.edits);
    const message = await f.git(['log','-1','--format=%B']);
    assert(message.includes('触发：保存') && message.includes('main.tex') && !message.includes('PRIVATE'));
    await f.git(['push','origin','master']);
    await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'auto_backup.py'),'--project',f.root,'--git',GIT,'saved-update'],
        f.root,JSON.stringify({token:result.token,commit:result.commit,done:true}));
    assert.equal((await savedLocal(f,['main.tex','reply.tex'])).unchanged,true);
    assert(result.commit);
});

test('saved backup uses the normal path commit without review state and preserves partial staging', async () => {
    const f = await fixture('saved-native');
    const main = path.join(f.root,'main.tex');
    fs.writeFileSync(main,'First staged sentence.\n','utf8'); await f.git(['add','--','main.tex']);
    fs.writeFileSync(main,'\\section{Method}\nLatest saved sentence.\n','utf8');
    fs.writeFileSync(path.join(f.root,'outside.txt'),'staged','utf8'); await f.git(['add','--','outside.txt']);
    const result = await savedLocal(f,['main.tex'],'定时');
    assert.equal(await f.git(['show','HEAD:main.tex']),'\\section{Method}\nLatest saved sentence.\n');
    assert.equal((await f.git(['diff','--cached','--name-only'])).trim(),'outside.txt');
    assert.equal((await f.git(['show',':outside.txt'])),'staged');
    assert((await f.git(['log','-1','--format=%B'])).includes('触发：定时'));
    assert((await f.git(['log','-1','--format=%B'])).includes('\\section{Method}'));
    assert(result.commit);
});

test('saved backup restores old inline pending proposals only in the committed copy', async () => {
    const f = await reviewFixture('saved-inline-legacy');
    const main = path.join(f.root,'main.tex'), owner = path.join(f.root,'reply.tex');
    let text = fs.readFileSync(owner,'utf8');
    text = text.replace(/^(% CODEX-REVIEW-DATA )(.*)$/m, (_,prefix,json) => {
        const state = JSON.parse(json); state.edits['2'].deferred = false; return prefix + JSON.stringify(state);
    });
    fs.writeFileSync(owner,text,'utf8');
    fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('fast','compact'),'utf8');
    const work = fs.readFileSync(main); await savedLocal(f,['main.tex','reply.tex']);
    assert((await f.git(['show','HEAD:main.tex'])).includes('strong and fast'));
    assert(!(await f.git(['show','HEAD:main.tex'])).includes('compact'));
    assert(fs.readFileSync(main).equals(work));
    assert(!(await f.git(['show','HEAD:reply.tex'])).includes('CODEX-REVIEW-DATA'));
});

test('saved backup preserves BOM and Git EOL rules in a sanitized review file', async () => {
    const f = await reviewFixture('saved-bom',false,false,true);
    const main = path.join(f.root,'main.tex');
    fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('The model','Author model'),'utf8');
    const work = fs.readFileSync(main); await savedLocal(f,['main.tex','reply.tex']);
    const saved = await f.git(['show','HEAD:main.tex']);
    assert.equal(saved.charCodeAt(0),0xFEFF); assert(!saved.includes('\r\n'));
    assert(saved.includes('Author model')); assert(fs.readFileSync(main).equals(work));
});

test('saved backup respects a rejecting Git hook and preserves staged files', async () => {
    const f = await fixture('saved-hook'); f.edit();
    fs.writeFileSync(path.join(f.root,'outside.txt'),'keep staged','utf8'); await f.git(['add','--','outside.txt']);
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho saved-hook-denied >&2\nexit 1\n','utf8');
    await assert.rejects(savedLocal(f,['main.tex']),/saved-hook-denied/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert.equal((await f.git(['diff','--cached','--name-only'])).trim(),'outside.txt');
    assert.equal(await f.git(['show',':outside.txt']),'keep staged');
});

test('saved backup schedules startup save and five-minute checks without UI prompts and disposes timers', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT,'backup-events-'));
    fs.mkdirSync(path.join(root,'.git')); fs.writeFileSync(path.join(root,'main.tex'),'saved','utf8');
    const uri = fsPath => ({scheme:'file',fsPath}), folder = {uri:uri(root)}, calls = [], logs = [], intervals = [];
    let saved, folders;
    const disposable = () => ({dispose() {}});
    const vscode = {RelativePattern:class {constructor(base,pattern) {Object.assign(this,{base,pattern});}},
        window:{createOutputChannel:() => ({appendLine:value=>logs.push(value),dispose() {}})},
        workspace:{isTrusted:true, workspaceFolders:[folder], getConfiguration:()=>({get:(_,fallback)=>fallback}),
            findFiles:async()=>[uri(path.join(root,'main.tex'))], getWorkspaceFolder:()=>folder,
            onDidSaveTextDocument:handler=>{saved=handler;return disposable();},
            onDidGrantWorkspaceTrust:disposable,
            onDidChangeWorkspaceFolders:handler=>{folders=handler;return disposable();}}};
    const subscriptions = [], timers = {setInterval(fn,ms) {const timer = {fn,ms,cleared:false}; intervals.push(timer); return timer;},
        clearInterval(timer) {timer.cleared=true;}};
    activateAutomatic(vscode,{subscriptions},(...args)=>calls.push(args),timers);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(intervals.length,1); assert.equal(intervals[0].ms,300000);
    assert.equal(calls[0][5],'启动'); assert.equal(calls[0][1],null);
    saved({uri:uri(path.join(root,'main.tex'))}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls[1][5],'保存');
    saved({uri:uri(path.join(root,'.codex-review','state.json'))}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,2);
    intervals[0].fn(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls[2][5],'定时');
    vscode.workspace.workspaceFolders = [];
    folders({added:[],removed:[folder]}); assert(intervals[0].cleared);
    saved({uri:uri(path.join(root,'main.tex'))}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,3); assert.deepEqual(logs,[]);
    subscriptions.forEach(subscription=>subscription.dispose());
});

test('saved backup starts after a first TeX file is saved in an existing workspace', async () => {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT,'backup-first-tex-'));
    fs.mkdirSync(path.join(root,'.git'));
    const uri = fsPath => ({scheme:'file',fsPath}), folder = {uri:uri(root)}, calls = [];
    let saved, hasTex = false;
    const disposable = () => ({dispose() {}});
    const vscode = {RelativePattern:class {},window:{createOutputChannel:()=>({appendLine() {},dispose() {}})},
        workspace:{isTrusted:true,workspaceFolders:[folder],getConfiguration:()=>({get:(_,fallback)=>fallback}),
            findFiles:async()=>hasTex?[uri(path.join(root,'main.tex'))]:[],getWorkspaceFolder:()=>folder,
            onDidSaveTextDocument:handler=>{saved=handler;return disposable();},
            onDidChangeWorkspaceFolders:disposable,onDidGrantWorkspaceTrust:disposable}};
    const subscriptions = [], timers = {setInterval:()=>1,clearInterval() {}};
    activateAutomatic(vscode,{subscriptions},(...args)=>calls.push(args),timers);
    await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls.length,0);
    hasTex = true; fs.writeFileSync(path.join(root,'main.tex'),'saved','utf8');
    saved({uri:uri(path.join(root,'main.tex'))}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,1); assert.equal(calls[0][5],'保存');
    subscriptions.forEach(subscription=>subscription.dispose());
});

test('saved backup keeps separate timers and save events for different projects', async () => {
    const parent = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT,'backup-multi-'));
    const roots = ['first','second'].map(name=>path.join(parent,name));
    for (const root of roots) {fs.mkdirSync(path.join(root,'.git'),{recursive:true}); fs.writeFileSync(path.join(root,'main.tex'),'saved','utf8');}
    const uri = fsPath=>({scheme:'file',fsPath}), folders = roots.map(root=>({uri:uri(root)})), calls = [], timers = [];
    let saved; const disposable = ()=>({dispose() {}});
    const vscode = {RelativePattern:class {constructor(base) {this.base=base;}},window:{createOutputChannel:()=>({appendLine() {},dispose() {}})},
        workspace:{isTrusted:true,workspaceFolders:folders,getConfiguration:()=>({get:(_,fallback)=>fallback}),
            findFiles:async pattern=>[uri(path.join(pattern.base,'main.tex'))],
            getWorkspaceFolder:file=>folders.find(folder=>path.dirname(file.fsPath)===folder.uri.fsPath),
            onDidSaveTextDocument:handler=>{saved=handler;return disposable();},onDidChangeWorkspaceFolders:disposable,onDidGrantWorkspaceTrust:disposable}};
    const subscriptions = [], clock = {setInterval(fn,ms) {const timer = {fn,ms}; timers.push(timer); return timer;},clearInterval(timer) {timer.cleared=true;}};
    activateAutomatic(vscode,{subscriptions},(...args)=>calls.push(args),clock);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(timers.length,2); assert.deepEqual(new Set(calls.map(call=>call[0])),new Set(roots));
    saved({uri:uri(path.join(roots[1],'main.tex'))}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.at(-1)[0],roots[1]); assert.equal(calls.at(-1)[5],'保存');
    subscriptions.forEach(subscription=>subscription.dispose()); assert(timers.every(timer=>timer.cleared));
});

test('saved backup preserves a later source write during a commit hook for the next check', async () => {
    const f = await fixture('saved-concurrent-hook'); f.edit();
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),"#!/bin/sh\nprintf 'later save\\n' >> main.tex\n",'utf8');
    const result = await savedLocal(f,['main.tex']);
    assert.equal((await f.git(['rev-parse','origin/master'])).trim(),f.baseline);
    assert.equal(await f.git(['show','HEAD:main.tex']),'Revised sentence.\n');
    assert(fs.readFileSync(path.join(f.root,'main.tex'),'utf8').includes('later save'));
    await f.git(['push','origin','master']);
    await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'auto_backup.py'),'--project',f.root,'--git',GIT,'saved-update'],
        f.root,JSON.stringify({token:result.token,commit:result.commit,done:true}));
    const next = await savedLocal(f,['main.tex']);
    assert.notEqual(next.commit,result.commit);
    assert((await f.git(['show','HEAD:main.tex'])).includes('later save'));
});

test('saved backup restores a pending legacy checkpoint before backing up later author edits', async () => {
    const f = await reviewFixture('saved-legacy-resume');
    await f.backend(['decide','--accept','1']);
    const helper = (operation,input) => run(PYTHON,['-X','utf8',path.join(SCRIPTS,'auto_backup.py'),'--project',f.root,
        '--state','reply.tex','--git',GIT,operation],f.root,input === undefined ? undefined : JSON.stringify(input));
    await helper('prepare',{parent:f.baseline});
    const before = await f.status();
    const owner = fs.readFileSync(path.join(f.root,'reply.tex'));
    fs.writeFileSync(path.join(f.root,'unrelated.txt'),'staged outside','utf8'); await f.git(['add','--','unrelated.txt']);
    const main = path.join(f.root,'main.tex');
    fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('The model','The author model'),'utf8');
    await automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute);
    const history = (await f.git(['log','--format=%s',f.baseline+'..HEAD'])).trim().split('\n');
    assert.equal(history.length,2); assert(history[1].includes('已接收成果')); assert(history[0].includes('自动备份'));
    assert((await f.git(['show','HEAD:main.tex'])).includes('The author model'));
    assert.equal(await f.git(['show',':unrelated.txt']),'staged outside');
    const after = await f.status();
    assert.deepEqual(after.edits['2'],before.edits['2']); assert.deepEqual(after.edits.a,before.edits.a);
    assert.equal(after.edits['1'].status,before.edits['1'].status);
    assert.deepEqual(after.edits['1'].versions,before.edits['1'].versions);
    assert(fs.readFileSync(path.join(f.root,'reply.tex')).equals(owner));
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),(await f.git(['rev-parse','origin/master'])).trim());
});

test('saved backup works without a review and ignores damaged independent review metadata', async () => {
    const f = await fixture('saved-bad-sidecar'); f.edit();
    fs.mkdirSync(path.join(f.root,'.codex-review')); fs.writeFileSync(path.join(f.root,'.codex-review','state.json'),'{broken','utf8');
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON};
    const result = await automaticBackup(f.root,null,options,()=>{},f.execute,'保存');
    assert.equal(await f.git(['show',result.commit+':main.tex']),'Revised sentence.\n');
    assert.equal(fs.readFileSync(path.join(f.root,'.codex-review','state.json'),'utf8'),'{broken');
    assert.equal((await automaticBackup(f.root,null,options,()=>{},f.execute)).skipped,true);
});

test('saved backup retains its local commit when the target is not verified private', async () => {
    const f = await fixture('saved-public'); f.edit(); f.setPrivacy(false);
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON};
    await assert.rejects(automaticBackup(f.root,null,options,()=>{},f.execute),/未确认目标为对应的私有 GitHub 仓库/);
    assert.notEqual((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert.equal((await f.git(['rev-parse','origin/master'])).trim(),f.baseline);
});

test('saved backup status supersedes legacy failure without changing legacy history or review data', async () => {
    const f = await reviewFixture('saved-status-legacy');
    await f.backend(['decide','--accept','1']);
    const before = await f.status(), owner = fs.readFileSync(path.join(f.root,'reply.tex'));
    const journal = path.join(f.root,'.codex-review','automatic-backup.json');
    const legacy = {session:before.session,status:{status:'failed',message:'旧投影备份失败记录'},done:'old-source-id'};
    fs.writeFileSync(journal,JSON.stringify({...legacy,saved_done:{commit:'prior-commit',files:{}}}),'utf8');
    assert.equal((await f.status()).auto_backup.commit,'prior-commit','pre-upgrade completed saved jobs remain readable');
    fs.writeFileSync(journal,JSON.stringify(legacy),'utf8');
    const result = await automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute);
    const after = await f.status();
    assert.equal(after.auto_backup.status,'done'); assert.equal(after.auto_backup.commit,result.commit);
    assert.equal(after.auto_backup_done,'old-source-id'); assert.equal(after.saved_backup_done.commit,result.commit);
    assert.equal(JSON.parse(fs.readFileSync(journal,'utf8')).status.message,'旧投影备份失败记录');
    assert.deepEqual(after.edits['2'],before.edits['2']); assert(fs.readFileSync(path.join(f.root,'reply.tex')).equals(owner));
    const cards = JSON.parse(await run(PYTHON,[...f.common,'cards'],f.root));
    assert.equal(cards.auto_backup.status,'done'); assert.equal(cards.saved_backup_done.commit,result.commit);
});

test('saved backup records offline failure and reads saved status without a review session', async () => {
    const f = await reviewFixture('saved-status-no-session');
    const journal = path.join(f.root,'.codex-review','automatic-backup.json');
    fs.writeFileSync(journal,JSON.stringify({status:{status:'failed',message:'older session failure'}}),'utf8');
    fs.writeFileSync(path.join(f.root,'main.tex'),fs.readFileSync(path.join(f.root,'main.tex'),'utf8').replace('The model','Author model'),'utf8');
    const offline = (exe,args,cwd,input) => args[0]==='fetch' ? Promise.reject(new Error('offline status test')) : f.execute(exe,args,cwd,input);
    await assert.rejects(automaticBackup(f.root,'reply.tex',f.options,()=>{},offline),/offline status test/);
    const result = await f.status();
    assert.equal(result.auto_backup.status,'failed'); assert.match(result.auto_backup.message,/offline status test/);
    assert.equal(result.auto_backup.commit,result.saved_backup_job.commit);
    assert.equal(result.auto_backup_done,null); assert.equal(JSON.parse(fs.readFileSync(journal,'utf8')).status.message,'older session failure');
});

test('saved backup status is readable before a review batch exists', async () => {
    const f = await fixture('saved-status-uninitialized'); f.edit();
    const result = await automaticBackup(f.root,null,{git:GIT,gh:'fixture-gh',python:PYTHON},()=>{},f.execute);
    fs.writeFileSync(path.join(f.root,'reply.tex'),'% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n','utf8');
    const state = JSON.parse(await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'source_review.py'),'--project',f.root,'--state','reply.tex','--git',GIT,'status'],f.root));
    assert.equal(state.initialized,false); assert.equal(state.auto_backup.status,'done'); assert.equal(state.saved_backup_done.commit,result.commit);
});

test('saved backup pushes only its verified commit if HEAD advances during privacy verification', async () => {
    const f = await fixture('saved-head-race'); f.edit();
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON}; let checks = 0;
    const execute = async (exe,args,cwd,input) => {
        if (exe === 'fixture-gh' && ++checks === 2) {
            fs.writeFileSync(path.join(f.root,'outside.txt'),'unrelated local commit','utf8');
            await f.git(['add','--','outside.txt']); await f.git(['commit','-m','unrelated concurrent commit']);
        }
        return f.execute(exe,args,cwd,input);
    };
    await assert.rejects(automaticBackup(f.root,null,options,()=>{},execute),/推送后本地与 origin\/master 不一致/);
    assert.equal((await f.git(['rev-parse','origin/master'])).trim(),(await f.git(['rev-parse','HEAD^'])).trim());
    assert.equal((await f.git(['ls-tree','--name-only','origin/master','--','outside.txt'])).trim(),'');
});

test('saved backup refuses to push when a hook changes the commit scope', async () => {
    const f = await fixture('saved-hook-scope'); f.edit();
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),"#!/bin/sh\nprintf 'unexpected' > outside.txt\ngit add -- outside.txt\n",'utf8');
    await assert.rejects(savedLocal(f,['main.tex']),/Git hook 改变了提交范围/);
    assert.equal((await f.git(['rev-parse','origin/master'])).trim(),f.baseline);
});

test('automatic saved checkpoint preserves delayed notes, manual source and staging', async () => {
    const f = await reviewFixture('auto-partial');
    await f.backend(['decide','--accept','1']);
    const rawOwner = fs.readFileSync(path.join(f.root,'reply.tex'));
    const source = fs.readFileSync(path.join(f.root,'main.tex'),'utf8');
    fs.writeFileSync(path.join(f.root,'main.tex'),source.replace('The model','The author manually edited model'),'utf8');
    const before = await f.status();
    const events = [];
    const result = await automaticBackup(f.root,'reply.tex',f.options,e=>events.push(e),f.execute);
    const committed = await f.git(['show',result.commit+':main.tex']);
    assert(committed.includes('reliable')); assert(committed.includes('strong') === false);
    assert(committed.includes('fast')); assert(committed.includes('manually edited'));
    assert(fs.readFileSync(path.join(f.root,'main.tex'),'utf8').includes('manually edited'));
    const after = await f.status();
    assert.deepEqual(after.edits['2'],before.edits['2']);
    assert.deepEqual(after.edits.a,before.edits.a);
    assert(after.edits['2'].requests[0].text.includes('PRIVATE'));
    assert(fs.readFileSync(path.join(f.root,'reply.tex')).equals(rawOwner), 'background progress never invalidates a foreground state-file receipt');
    assert(events.some(e=>e.status==='local')); assert.equal(events.at(-1).status,'done');
    assert.equal((await f.git(['diff','--cached','--name-only'])).trim(),'');
    const again = await automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute);
    assert.equal(again.skipped,true);
});

test('offline automatic push preserves one local commit and retries while later acceptance remains queued', async () => {
    const f = await reviewFixture('auto-offline');
    await f.backend(['decide','--accept','1']);
    const offline = (exe,args,cwd,input) => args[0]==='fetch' ? Promise.reject(new Error('fixture offline credentials')) : f.execute(exe,args,cwd,input);
    await assert.rejects(automaticBackup(f.root,'reply.tex',f.options,()=>{},offline),/offline credentials/);
    const local = (await f.git(['rev-parse','HEAD'])).trim();
    const ledger = JSON.parse(fs.readFileSync(path.join(f.root,'.codex-review/automatic-backup.json'),'utf8'));
    assert.equal(ledger.saved_job.commit,local);
    await f.backend(['decide','--accept','a']);
    const next = await automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute);
    assert.notEqual(next.commit,local);
    assert.equal((await f.git(['rev-parse','HEAD^'])).trim(),local,'retry reuses the original commit');
    assert.equal((await f.status()).edits['2'].status,'rework');
    assert((await f.git(['show',next.commit+':reply.tex'])).includes('Thank you for this useful comment.'));
    assert(!(await f.git(['show',next.commit+':reply.tex'])).includes('CODEX-REVIEW-DATA'));
});

test('a later backup failure after offline recovery reports its own failure once', async () => {
    const f = await fixture('saved-retry-failure'); f.edit();
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON};
    const offline = (exe,args,cwd,input) => args[0]==='fetch' ? Promise.reject(new Error('offline first')) : f.execute(exe,args,cwd,input);
    await assert.rejects(automaticBackup(f.root,null,options,()=>{},offline),/offline first/);
    fs.writeFileSync(path.join(f.root,'main.tex'),'Later saved change.\n','utf8');
    let checks = 0; const events = [];
    const laterFailure = (exe,args,cwd,input) => exe === 'fixture-gh' && ++checks === 3
        ? Promise.reject(new Error('later credentials')) : f.execute(exe,args,cwd,input);
    await assert.rejects(automaticBackup(f.root,null,options,value=>events.push(value),laterFailure),/later credentials/);
    assert.equal(events.filter(value=>value.status==='failed').length,1);
    assert(events.at(-1).message.includes('later credentials'));
});

test('saved backup skips an unchanged project without fetching or pushing', async () => {
    const f = await fixture('saved-unchanged'); let networks = 0;
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON};
    const execute = (exe,args,cwd,input) => {if (args[0]==='fetch' || args[0]==='push') networks++; return f.execute(exe,args,cwd,input);};
    assert.equal((await automaticBackup(f.root,null,options,()=>{},execute)).skipped,true);
    assert.equal(networks,0); assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert(!fs.existsSync(path.join(f.root,'.codex-review','automatic-backup.json')));
});

test('automatic backup refuses manual ahead commits and preserves unrelated staging without blocking decisions', async () => {
    const f = await reviewFixture('auto-ahead');
    await f.backend(['decide','--accept','1']);
    fs.writeFileSync(path.join(f.root,'unrelated.txt'),'unrelated','utf8');
    await f.git(['add','unrelated.txt']); await f.git(['commit','-m','unrelated local commit']);
    const head = (await f.git(['rev-parse','HEAD'])).trim();
    await assert.rejects(automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute),/不会连带上传/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),head);
    await f.backend(['decide','--accept','a']);
    assert.equal((await f.status()).edits.a.status,'accepted');
    const g = await reviewFixture('auto-staging');
    await g.backend(['decide','--accept','1']);
    fs.writeFileSync(path.join(g.root,'unrelated.txt'),'manual staging','utf8');
    await g.git(['add','unrelated.txt']);
    await automaticBackup(g.root,'reply.tex',g.options,()=>{},g.execute);
    assert.equal(await g.git(['show',':unrelated.txt']),'manual staging');
    assert.equal((await g.git(['diff','--cached','--name-only'])).trim(),'unrelated.txt');
    assert(!fs.existsSync(path.join(g.root,'.git/index.lock')));
});

test('automatic checkpoint refuses remote advancement and hook rejection with a visible recoverable status', async () => {
    const f = await reviewFixture('auto-remote');
    await f.backend(['decide','--accept','1']);
    const other = path.join(path.dirname(f.root),'remote-editor');
    await run(GIT,['clone',f.remote,other],path.dirname(f.root));
    await run(GIT,['config','user.name','Remote author'],other);
    await run(GIT,['config','user.email','remote@example.invalid'],other);
    fs.writeFileSync(path.join(other,'remote.txt'),'Remote advance','utf8');
    await run(GIT,['add','remote.txt'],other); await run(GIT,['commit','-m','remote advance'],other); await run(GIT,['push','origin','master'],other);
    const events = [];
    await assert.rejects(automaticBackup(f.root,'reply.tex',f.options,value=>events.push(value),f.execute),/远端 master 已推进/);
    assert.equal(events.at(-1).status,'failed');
    await f.backend(['decide','--accept','a']);
    assert.equal((await f.status()).edits.a.status,'accepted');
    const g = await reviewFixture('auto-hook');
    await g.backend(['decide','--accept','1']);
    const head = (await g.git(['rev-parse','HEAD'])).trim();
    fs.writeFileSync(path.join(g.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho fixture-hook-denied >&2\nexit 1\n','utf8');
    await assert.rejects(automaticBackup(g.root,'reply.tex',g.options,()=>{},g.execute),/fixture-hook-denied/);
    assert.equal((await g.git(['rev-parse','HEAD'])).trim(),head);
    assert(!fs.existsSync(path.join(g.root,'.git/index.lock')));
});

test('acceptance during a background network wait completes and the queue backs up both checkpoints', async () => {
    const f = await reviewFixture('auto-continuous');
    await f.backend(['decide','--accept','1']);
    let entered, release, queued, secondStart, releaseSecond, held = false, queuedCount = 0, startCount = 0;
    const waiting = new Promise(resolve=>{entered=resolve;});
    const secondQueued = new Promise(resolve=>{queued=resolve;});
    const waitingSecondStart = new Promise(resolve=>{secondStart=resolve;});
    const secondGate = new Promise(resolve=>{releaseSecond=resolve;});
    const gate = new Promise(resolve=>{release=resolve;});
    const execute = async (exe,args,cwd,input) => {
        if (args[0]==='fetch' && !held) {held=true;entered();await gate;}
        if (args.at(-1)==='saved-event' && input && JSON.parse(input).action==='start' && ++startCount===2) {secondStart(); await secondGate;}
        const result = await f.execute(exe,args,cwd,input);
        if (args.at(-1)==='saved-event' && input && JSON.parse(input).action==='queued' && ++queuedCount===2) queued();
        return result;
    };
    const events = [];
    const queue = enqueueAutomatic(f.root,'reply.tex',f.options,value=>events.push(value),execute);
    await Promise.race([waiting,queue.then(()=>{throw new Error('backup ended before the network gate');})]);
    const before = await f.status();
    assert.equal(before.auto_backup.status,'local'); assert(before.auto_backup.commit);
    await f.backend(['decide','--accept','a']);
    assert.equal((await f.status()).edits.a.status,'accepted','foreground writer is not held by a network wait');
    enqueueAutomatic(f.root,'reply.tex',f.options,()=>{},execute);
    await secondQueued; assert.equal((await f.status()).auto_backup.status,'queued');
    release(); await waitingSecondStart;
    assert.equal((await f.status()).auto_backup.status,'queued','an older completed push cannot claim the newer save is backed up');
    releaseSecond(); await queue;
    const after = await f.status();
    assert.equal(events.at(-1).status,'done');
    assert.equal(after.auto_backup.status,'done');
    assert.deepEqual(after.edits['2'],before.edits['2']);
    assert((await f.git(['show','HEAD:reply.tex'])).includes('Thank you for this useful comment.'));
    assert.equal(Number((await f.git(['rev-list','--count',f.baseline+'..HEAD'])).trim()),2);
});

test('a save arriving during local backup metadata is serialized and checked afterward', async () => {
    const f = await fixture('saved-metadata-race'); f.edit();
    let entered, release, held = false;
    const waiting = new Promise(resolve=>{entered=resolve;}), gate = new Promise(resolve=>{release=resolve;});
    const execute = async (exe,args,cwd,input) => {
        if (args.at(-1)==='saved-local' && !held) {held=true; entered(); await gate;}
        return f.execute(exe,args,cwd,input);
    };
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON}, events = [];
    const queue = enqueueAutomatic(f.root,null,options,value=>events.push(value),execute);
    await Promise.race([waiting,queue.then(()=>{throw new Error('backup ended before local gate');})]);
    fs.writeFileSync(path.join(f.root,'main.tex'),'Saved during backup.\n','utf8');
    enqueueAutomatic(f.root,null,options,()=>{},execute);
    release(); await queue;
    assert.equal(await f.git(['show','HEAD:main.tex']),'Saved during backup.\n');
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),(await f.git(['rev-parse','origin/master'])).trim());
    assert(!events.some(value=>value.status==='failed'));
    assert.equal(events.at(-1).status,'idle');
});

test('a failed queued commit records the real hook error even when its metadata operation failed', async () => {
    const f = await fixture('saved-status-hook'); f.edit();
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho durable-hook-error >&2\nexit 1\n','utf8');
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON}, events = [];
    await enqueueAutomatic(f.root,null,options,value=>events.push(value),f.execute);
    const ledger = JSON.parse(fs.readFileSync(path.join(f.root,'.codex-review','automatic-backup.json'),'utf8'));
    assert.equal(ledger.saved_status.status,'failed'); assert.match(ledger.saved_status.message,/durable-hook-error/);
    assert.equal(events.at(-1).status,'failed');
});

test('automatic checkpoint preserves UTF-8 BOM and honors existing Git CRLF normalization', async () => {
    const f = await reviewFixture('auto-crlf',false,false,true);
    await f.backend(['decide','--accept','1']);
    const result = await automaticBackup(f.root,'reply.tex',f.options,()=>{},f.execute);
    const committed = await f.git(['show',result.commit+':main.tex']);
    assert.equal(committed.charCodeAt(0),0xFEFF);
    assert(committed.includes('reliable'));
    assert(!committed.includes('\r\n'));
    const working = fs.readFileSync(path.join(f.root,'main.tex'),'utf8');
    assert.equal(working.charCodeAt(0),0xFEFF); assert(working.includes('\r\n'));
    assert.equal((await f.git(['diff','--cached','--name-only'])).trim(),'');
});

test('project backup commits meaningful searchable notes, pushes normally and excludes private review/build files',async () => {
    const f = await fixture('backup-success'); f.edit();
    fs.writeFileSync(path.join(f.root,'refs.bib'),'@article{fixture,title={Fixture}}\n','utf8');
    fs.mkdirSync(path.join(f.root,'.codex-review/objects'),{recursive:true});
    fs.writeFileSync(path.join(f.root,'.codex-review/objects/private.json'),'private review','utf8');
    fs.mkdirSync(path.join(f.root,'.latex-build'),{recursive:true});
    fs.writeFileSync(path.join(f.root,'.latex-build/main.pdf'),'generated','utf8');
    const plan = await f.inspect();
    assert.deepEqual(plan.entries.map(x=>x.file).sort(),['main.tex','refs.bib']);
    const result = await backupProject(plan,plan.entries,'澄清方法依据，并同步对应回复');
    assert.equal(result.head,(await f.git(['rev-parse','origin/master'])).trim());
    const message = await f.git(['log','-1','--format=%B']);
    for (const part of ['backup(paper): 澄清方法依据','文件范围','main.tex','refs.bib','变更统计','不代表接收候选','未接收候选与批注保留本地','成功成果通过 Git 回溯']) assert(message.includes(part));
    assert(!message.includes('需单独本地归档'));
    assert(!(await f.git(['ls-tree','-r','--name-only','HEAD'])).includes('.codex-review'));
    const again = await f.inspect();
    const second = await backupProject(again,[],'核对当前备份');
    assert.equal(second.commit,null); assert.equal(second.head,result.head);
});
test('existing manual staging and edits after selection stop without discarding work',async () => {
    const f = await fixture('backup-author-work'); f.edit();
    await f.git(['add','main.tex']);
    const index = fs.readFileSync(path.join(f.root,'.git/index'));
    await assert.rejects(f.inspect(),/暂存区已有手动选择/);
    assert(fs.readFileSync(path.join(f.root,'.git/index')).equals(index));
    const g = await fixture('backup-concurrent'); g.edit(); const plan = await g.inspect();
    fs.writeFileSync(path.join(g.root,'main.tex'),'Author edit after selection.\n','utf8');
    await assert.rejects(backupProject(plan,plan.entries,'方法更新'),/内容发生变化/);
    assert.equal((await g.git(['rev-parse','HEAD'])).trim(),g.baseline);
    assert.equal(fs.readFileSync(path.join(g.root,'main.tex'),'utf8'),'Author edit after selection.\n');
});
test('public or unverified target never receives the new local backup commit',async () => {
    const f = await fixture('backup-public'); f.edit();
    const plan = await f.inspect(); f.setPrivacy(false);
    await assert.rejects(backupProject(plan,plan.entries,'完成本地记录'),/本地备份提交[\s\S]*未确认目标/);
    assert.notEqual((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert.equal((await run(GIT,['--git-dir='+f.remote,'rev-parse','refs/heads/master'],f.root)).trim(),f.baseline);
});
test('commit hooks remain enforced and push rejection preserves the local backup',async () => {
    const f = await fixture('backup-hook'); f.edit(); const plan = await f.inspect();
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho fixture-hook-refused >&2\nexit 1\n','utf8');
    await assert.rejects(backupProject(plan,plan.entries,'有意义的备份说明'),/fixture-hook-refused/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    const g = await fixture('backup-push'); g.edit(); const next = await g.inspect();
    fs.writeFileSync(path.join(g.remote,'hooks/pre-receive'),'#!/bin/sh\necho fixture-push-refused >&2\nexit 1\n','utf8');
    await assert.rejects(backupProject(next,next.entries,'保留本地备份'),/本地备份提交[\s\S]*fixture-push-refused/);
    assert.notEqual((await g.git(['rev-parse','HEAD'])).trim(),g.baseline);
    assert.equal((await run(GIT,['--git-dir='+g.remote,'rev-parse','refs/heads/master'],g.root)).trim(),g.baseline);
});

test('accepted checkpoint excludes pending material, compacts terminal history and preserves dependency/rework/acceptance',async () => {
    const f = await reviewFixture('checkpoint-success',true,true);
    assert.equal((await f.status()).edits['1'].previous_feedback.requests[0].text,'PRIVATE previous feedback');
    await f.backend(['decide','--accept','1','--reject','a']);
    const before = await f.status(), pending = before.edits['2'];
    const source = fs.readFileSync(path.join(f.root,'main.tex'));
    const untouched=['.codex-review/requests/keep.txt','.latex-build/review-diff/keep.pdf','author-note.json'];
    for (const name of untouched) {fs.mkdirSync(path.dirname(path.join(f.root,name)),{recursive:true});fs.writeFileSync(path.join(f.root,name),'not an object-cache target','utf8');}
    const result = await finishReview(f.root,'reply.tex',f.options,'澄清已接收的方法用语',f.execute);
    assert.equal(result.head,(await f.git(['rev-parse','origin/master'])).trim());
    assert.deepEqual(result.removed_ids,['a']); assert.deepEqual(result.dependency_ids,['1']);
    const committedMain = await f.git(['show','HEAD:main.tex']), committedReply = await f.git(['show','HEAD:reply.tex']);
    assert(committedMain.includes('reliable and fast')); assert(!committedMain.includes('compact'));
    assert(committedMain.includes('保留写作规则'));
    for (const text of [committedMain,committedReply]) for (const secret of ['CODEX-REVIEW-DATA','PRIVATE pending feedback','PRIVATE previous feedback','useful comment','.codex-review/objects']) assert(!text.includes(secret));
    assert(committedReply.includes('CODEX-REVIEW-NEXT manuscript=3 response=b'));
    assert(committedReply.includes('CODEX-REVIEW-SOURCE-ONLY: accepted-content'));
    assert(!fs.readFileSync(path.join(f.root,'reply.tex'),'utf8').includes('closed-by-author-rejection'));
    const after = await f.status();
    assert.deepEqual(after.edits['2'],pending);
    assert.deepEqual(after.edits['1'].versions,[]); assert.equal(after.edits['1'].status,'accepted');
    assert(!after.edits['1'].previous_feedback, 'finished comparison notes do not retain disposable cache versions');
    const identity = JSON.parse(await run(PYTHON,[...f.common,'inspect','--id','1','--source'],f.root));
    assert.equal(identity.archived,true); assert.equal(identity.checkpoint,result.head); assert(!('candidate' in identity));
    assert(!after.edits.a); assert.equal(after.next[0],3);
    assert(fs.readFileSync(path.join(f.root,'main.tex')).equals(source));
    assert.equal(result.files_deleted,true); assert(result.unused_objects.length>0);
    assert.deepEqual(result.deleted_objects.sort(),result.unused_objects.sort());
    assert(result.deleted_objects.every(p=>!fs.existsSync(p)));
    assert(untouched.every(name=>fs.readFileSync(path.join(f.root,name),'utf8')==='not an object-cache target'));
    const archive = path.join(path.dirname(f.root),'active-review.zip'), restored = path.join(path.dirname(f.root),'active-review-restored');
    await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'review_archive.py'),'backup','--repo',f.root,'--state','reply.tex','--output',archive],f.root);
    const members = JSON.parse(await run(PYTHON,['-X','utf8','-c','import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',archive],f.root));
    assert(result.unused_objects.every(p=>!members.includes('working/.codex-review/objects/'+path.basename(p))));
    await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'review_archive.py'),'restore','--archive',archive,'--destination',restored],f.root);
    const restoredPending = JSON.parse(await run(PYTHON,['-X','utf8',path.join(SCRIPTS,'source_review.py'),'--project',restored,'--state','reply.tex','inspect','--id','2'],restored));
    assert.equal(restoredPending.candidate,'compact'); assert.equal(restoredPending.edit.requests[0].text,pending.requests[0].text);
    const index = await f.git(['diff','--cached','--name-only']); assert.equal(index,'');
    const second = await finishReview(f.root,'reply.tex',f.options,'没有新成果时不重复提交',f.execute);
    assert.equal(second.skipped,true); assert.equal((await f.git(['rev-parse','HEAD'])).trim(),result.head);
    await f.backend(['rework','--id','2'],{after:'efficient'});
    await f.backend(['decide','--accept','2']);
    await finishReview(f.root,'reply.tex',f.options,'完成后续返修并接收',f.execute);
    const final = await f.status(); assert.deepEqual(final.edits,{}); assert.equal(final.next[0],3);
    assert((await f.git(['show','HEAD:main.tex'])).includes('reliable and efficient'));
    const clone = path.join(path.dirname(f.root),'restored-success-only');
    await run(GIT,['clone',f.remote,clone],path.dirname(f.root));
    const init = ['-X','utf8',path.join(SCRIPTS,'source_review.py'),'--project',clone,'--state','reply.tex','--git',GIT];
    const empty = JSON.parse(await run(PYTHON,[...init,'status'],clone)); assert.equal(empty.initialized,false);
    await run(PYTHON,[...init,'--apply','--expect',empty.sha256,'begin','--round','new-local-round','--files','main.tex','reply.tex'],clone);
    const resumed = JSON.parse(await run(PYTHON,[...init,'status'],clone)); assert.equal(resumed.next[0],1);
});

test('pending-only checkpoint and raw state backup never publish candidates',async () => {
    const f = await reviewFixture('checkpoint-no-accepted');
    const raw = fs.readFileSync(path.join(f.root,'reply.tex'));
    const result = await finishReview(f.root,'reply.tex',f.options,'审核一遍但尚未接收',f.execute);
    assert.equal(result.skipped,true); assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert(fs.readFileSync(path.join(f.root,'reply.tex')).equals(raw));
    const plan = await f.inspect();
    await assert.rejects(backupProject(plan,plan.entries,'不能上传运行状态'),/审核状态不能/);
});

test('failed push retains full records and the same local commit resumes without duplicate success commits',async () => {
    const f = await reviewFixture('checkpoint-retry');
    await f.backend(['decide','--accept','1']);
    const objects=fs.readdirSync(path.join(f.root,'.codex-review/objects')).map(n=>path.join(f.root,'.codex-review/objects',n));
    let rejectPush = true;
    const execute = async (exe,args,cwd,input) => {
        if (rejectPush && exe===GIT && args[0]==='push') throw new Error('fixture-checkpoint-push-refused');
        return f.execute(exe,args,cwd,input);
    };
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'保留已接收成果等待推送',execute),/fixture-checkpoint-push-refused/);
    const failed = await f.status(), commit = failed.pending_backup.commit;
    assert(objects.every(p=>fs.existsSync(p)));
    assert.equal(failed.edits['1'].versions.length,1);
    assert.equal((await run(GIT,['--git-dir='+f.remote,'rev-parse','refs/heads/master'],f.root)).trim(),f.baseline);
    rejectPush=false;
    const result = await finishReview(f.root,'reply.tex',f.options,'继续上次成果备份',execute);
    assert.equal(result.head,commit); assert(!(await f.status()).pending_backup);
    assert.equal((await f.git(['rev-list','--count',f.baseline+'..HEAD'])).trim(),'1');
});

test('checkpoint preserves hooks and backs up explicit manual source edits with accepted results',async () => {
    const f = await reviewFixture('checkpoint-hook'); await f.backend(['decide','--accept','1']);
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho checkpoint-hook-refused >&2\nexit 1\n','utf8');
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'验证 hook 不被绕过',f.execute),/checkpoint-hook-refused/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline); assert((await f.status()).edits['1'].versions.length);
    const g = await reviewFixture('checkpoint-manual'); await g.backend(['decide','--accept','1']);
    fs.appendFileSync(path.join(g.root,'main.tex'),'% 作者额外手动修改。\n','utf8');
    fs.appendFileSync(path.join(g.root,'reply.tex'),'Author manual reply sentence.\n','utf8');
    const raw = fs.readFileSync(path.join(g.root,'main.tex'));
    const before = await g.status();
    const result = await finishReview(g.root,'reply.tex',g.options,'备份已接收成果及作者手动补充',g.execute);
    assert(fs.readFileSync(path.join(g.root,'main.tex')).equals(raw));
    assert.deepEqual(result.manual_files.sort(),['main.tex','reply.tex']);
    assert((await g.git(['show','HEAD:main.tex'])).includes('作者额外手动修改'));
    const reply = await g.git(['show','HEAD:reply.tex']);
    assert(reply.includes('Author manual reply sentence.'));
    for (const text of [reply, await g.git(['show','HEAD:main.tex'])]) {
        assert(!text.includes('PRIVATE pending feedback')); assert(!text.includes('useful comment'));
        assert(!text.includes('CODEX-REVIEW-DATA')); assert(!text.includes('compact'));
    }
    const after = await g.status();
    assert.deepEqual(after.edits['2'],before.edits['2']); assert.deepEqual(after.edits.a,before.edits.a);
    assert.deepEqual(after.next,before.next);
    assert((await g.git(['log','-1','--format=%B'])).includes('手动修改文件'));
    const again = await finishReview(g.root,'reply.tex',g.options,'无新增成果时不重复提交',g.execute);
    assert.equal(again.skipped,true); assert.equal((await g.git(['rev-parse','HEAD'])).trim(),result.head);
});

test('manual-only checkpoint keeps pending review work and uses current source for the next candidate',async () => {
    const f = await reviewFixture('checkpoint-manual-only');
    fs.appendFileSync(path.join(f.root,'reply.tex'),'Manual source sentence.\n','utf8');
    const before = await f.status();
    const result = await finishReview(f.root,'reply.tex',f.options,'备份手动补充的回复',f.execute);
    assert.equal(result.skipped,undefined); assert.deepEqual(result.accepted_ids,[]);
    assert.deepEqual(result.manual_files,['reply.tex']);
    assert((await f.git(['show','HEAD:reply.tex'])).includes('Manual source sentence.'));
    const after = await f.status();
    assert.deepEqual(after.edits,before.edits); assert.deepEqual(after.next,before.next);
    await f.backend(['propose'],{file:'reply.tex',kind:'response',before:'Manual source sentence.',after:'Updated manual source sentence.'});
    await f.backend(['decide','--accept','b']);
    assert(fs.readFileSync(path.join(f.root,'reply.tex'),'utf8').includes('Updated manual source sentence.'));
    await finishReview(f.root,'reply.tex',f.options,'备份基于手动原文接收的下一次修改',f.execute);
    assert((await f.git(['show','HEAD:reply.tex'])).includes('Updated manual source sentence.'));
});

test('source changes during a manual checkpoint stop without committing or overwriting the author',async () => {
    const f = await reviewFixture('checkpoint-manual-race');
    fs.appendFileSync(path.join(f.root,'reply.tex'),'Manual source sentence.\n','utf8');
    let changed = false;
    const execute = async (exe,args,cwd,input) => {
        const result = await f.execute(exe,args,cwd,input);
        if (!changed && args.some(a=>String(a).endsWith('review_checkpoint.py')) && args.at(-1)==='plan') {
            changed = true; fs.appendFileSync(path.join(f.root,'reply.tex'),'Concurrent author edit.\n','utf8');
        }
        return result;
    };
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'不覆盖并发手改',execute),/备份期间源码或状态变化/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
    assert(fs.readFileSync(path.join(f.root,'reply.tex'),'utf8').includes('Concurrent author edit.'));
});

test('notes saved during push remain intact after compaction',async () => {
    const f = await reviewFixture('checkpoint-concurrent-note'); await f.backend(['decide','--accept','1']);
    let added = false;
    const execute = async (exe,args,cwd,input) => {
        const result = await f.execute(exe,args,cwd,input);
        if (exe===GIT && args[0]==='push' && !added) {
            added=true;
            const state=await f.status();
            await f.backend(['feedback'],{id:'2',version:state.edits['2'].versions.at(-1),side:'original',start:0,end:4,quote:'fast',text:'推送期间新增的批注不能丢失。'});
        }
        return result;
    };
    const result=await finishReview(f.root,'reply.tex',f.options,'只提交已接收成果',execute);
    assert.equal(result.head,(await f.git(['rev-parse','origin/master'])).trim());
    const state=await f.status(); assert.equal(state.edits['2'].requests.length,2);
    assert.equal(state.edits['2'].requests[1].text,'推送期间新增的批注不能丢失。');
});

test('unpublished raw review state is blocked instead of silently pushed as history',async () => {
    const f=await reviewFixture('checkpoint-unsafe-history');
    await f.git(['add','--','reply.tex']); await f.git(['commit','-m','raw ledger deliberately staged in isolated fixture']);
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'不能连带上传旧运行状态',f.execute),/待推送历史包含源码内的审核运行状态/);
    assert.equal((await run(GIT,['--git-dir='+f.remote,'rev-parse','refs/heads/master'],f.root)).trim(),f.baseline);
});

test('already published accepted records retained for stale dependencies are not backed up repeatedly',async () => {
    const f=await reviewFixture('checkpoint-stale');
    await f.backend(['rework','--id','1'],{after:'robust',deps:['a']});
    await f.backend(['decide','--accept','1','--reject','a']);
    assert.equal((await f.status()).edits['1'].freshness,'needs-recheck');
    const first=await finishReview(f.root,'reply.tex',f.options,'备份已接收文字但保留待复核依赖',f.execute);
    const retained=(await f.status()).edits['1']; assert(retained.versions.length);
    const second=await finishReview(f.root,'reply.tex',f.options,'没有新增接收成果',f.execute);
    assert.equal(second.skipped,true);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),first.head);
});

test('accepted files omitted from a later round cannot be falsely marked published',async () => {
    const f=await reviewFixture('checkpoint-round-scope');
    await f.backend(['decide','--accept','1','--reject','2','a']);
    const before=await f.status();
    await assert.rejects(f.backend(['begin','--round','reply-only','--files','reply.tex']),/提交与推送/);
    assert.deepEqual(await f.status(),before,'new-batch replacement stops before dropping unpublished accepted records');
    // Retained malformed/legacy scope still fails at the checkpoint boundary.
    await run(PYTHON,['-X','utf8','-c','import sys;from source_review import Review,digest;r=Review(sys.argv[1],"reply.tex");r.state["rounds"][-1]["files"]=["reply.tex"];r.persist({},digest(r.raw))',f.root],SCRIPTS);
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'不能遗漏已接收的手稿文件',f.execute),/已接收文件不在当前轮投影范围/);
    const state=await f.status(); assert(!state.edits['1'].published_version);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline);
});

test('an in-flight candidate object is protected by the shared writer lock and cleanup can resume afterward',async () => {
    const f=await reviewFixture('checkpoint-writer-lock'); await f.backend(['decide','--accept','1','--reject','a']);
    let child, closed, candidate, started=false;
    const execute=async (exe,args,cwd,input) => {
        if (args.some(a=>String(a).endsWith('review_checkpoint.py')) && args.at(-1)==='cleanup' && !started) {
            started=true;
            const code='import sys,json; from source_review import Review,digest; r=Review(sys.argv[1],"reply.tex");\nwith r.writer_lock():\n updated,result=r.propose({"file":"reply.tex","kind":"response","before":"Thank you.","after":"Thank you for the careful review."}); extra=r.snapshot({"issue-evidence":b"unresolved scientific issue"},"active issue fixture"); r.state["scientific_issues"]={"still_open":{"object":extra}}; print(json.dumps({"id":result["id"],"version":r.state["edits"][result["id"]]["versions"][-1],"extra":extra}),flush=True); sys.stdin.readline(); r.persist(updated,digest(r.raw))';
            child=cp.spawn(PYTHON,['-X','utf8','-c',code,f.root],{cwd:SCRIPTS,env:require('./core').environment(),windowsHide:true});
            const errors=[]; child.stderr.on('data',b=>errors.push(b));
            closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(Buffer.concat(errors).toString('utf8'))));});
            candidate=await new Promise((resolve,reject)=>{child.stdout.once('data',b=>resolve(JSON.parse(b.toString('utf8'))));child.on('error',reject);child.once('close',code=>reject(new Error('candidate writer exited before readiness: '+code)));});
        }
        return f.execute(exe,args,cwd,input);
    };
    try {
        await assert.rejects(finishReview(f.root,'reply.tex',f.options,'成功备份后保护并发候选',execute),/另一个审核写入或缓存清理正在进行/);
        assert(fs.existsSync(path.join(f.root,'.codex-review/objects',candidate.version+'.json')));
    } finally {if(child && child.exitCode===null) child.stdin.end('persist\n'); if(closed) await closed;}
    const state=await f.status(); assert.equal(state.edits[candidate.id].status,'pending');
    const head=(await f.git(['rev-parse','HEAD'])).trim();
    const resumed=await finishReview(f.root,'reply.tex',f.options,'继续已成功推送后的缓存清理',f.execute);
    assert.equal(resumed.skipped,true); assert.equal(resumed.cleanup_complete,true); assert(resumed.deleted_objects.length>0);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),head);
    assert(fs.existsSync(path.join(f.root,'.codex-review/objects',candidate.version+'.json')));
    assert(fs.existsSync(path.join(f.root,'.codex-review/objects',candidate.extra+'.json')));
    const data=JSON.parse(await run(PYTHON,[...f.common,'inspect','--id',candidate.id],f.root));
    assert.equal(data.candidate,'Thank you for the careful review.'); assert.equal(data.source_match,true);
});

test('cleanup preflights all objects before deleting and refuses a newly staged cache',async () => {
    const f=await reviewFixture('checkpoint-staged-cache'); await f.backend(['decide','--accept','1']);
    let candidates;
    const execute=async (exe,args,cwd,input) => {
        const result=await f.execute(exe,args,cwd,input);
        if (args.some(a=>String(a).endsWith('review_checkpoint.py')) && args.at(-1)==='compact') {
            candidates=JSON.parse(result).unused_objects; assert(candidates.length>0);
            await f.git(['add','-f','--',path.relative(f.root,candidates.at(-1))]);
        }
        return result;
    };
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'不删除已暂存缓存',execute),/待清理缓存已进入 Git 索引/);
    assert(candidates.every(p=>fs.existsSync(p)));
});

test('partial deletion failure reports actual deletions, restores cwd and resumes without a new commit',async () => {
    const f=await reviewFixture('checkpoint-partial-cleanup'); await f.backend(['decide','--accept','1']);
    const first=await finishReview(f.root,'reply.tex',f.options,'先完成成功检查点',f.execute);
    const code='import sys,json; from pathlib import Path; from unittest.mock import patch; from source_review import Review; from review_checkpoint import cleanup,CleanupFailure; r=Review(sys.argv[1],"reply.tex",sys.argv[2]); start=Path.cwd(); original=Path.unlink; calls=[]\ndef fail_second(p,*a,**k):\n assert not p.is_absolute() and p.parent==Path("."); calls.append(str(p));\n if len(calls)==2: raise OSError("fixture-file-busy")\n return original(p,*a,**k)\nwith r.writer_lock():\n r.snapshot({"leftover":b"first"},"completed cache fixture"); r.snapshot({"leftover":b"second"},"completed cache fixture")\n with patch.object(Path,"unlink",fail_second):\n  try: cleanup(r,True); raise AssertionError("expected deletion failure")\n  except CleanupFailure as e: print(json.dumps({"deleted":e.deleted,"error":str(e),"cwd_restored":Path.cwd()==start}))';
    const failed=JSON.parse(await run(PYTHON,['-X','utf8','-c',code,f.root,GIT],SCRIPTS));
    assert.equal(failed.deleted.length,1); assert(failed.deleted.every(p=>!fs.existsSync(p)));
    assert.equal(failed.cwd_restored,true); assert(failed.error.includes('fixture-file-busy'));
    const second=await finishReview(f.root,'reply.tex',f.options,'继续删除余下已完结缓存',f.execute);
    assert.equal(second.skipped,true); assert.equal(second.deleted_objects.length,1);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),first.head);
    assert.equal((await f.status()).edits['2'].requests[0].text,'PRIVATE pending feedback: 保留原文，继续返修。');
});
