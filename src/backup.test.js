'use strict';
// Real commits/fetch/push use isolated local repositories; only GitHub transport metadata is substituted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {inspectBackup,backupProject,finishReview,run} = require('./backup');
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
async function reviewFixture(label, dependency = false) {
    const f = await fixture(label);
    fs.writeFileSync(path.join(f.root,'main.tex'),'% CODEX-RULES-BEGIN\n% 保留写作规则。\n% CODEX-RULES-END\n\\documentclass{article}\n\\begin{document}\nThe model is strong and fast.\n\\end{document}\n','utf8');
    fs.writeFileSync(path.join(f.root,'reply.tex'),'% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n\\documentclass{article}\n\\begin{document}\nThank you.\n\\end{document}\n','utf8');
    fs.writeFileSync(path.join(f.root,'.gitignore'),'.codex-review/\n.latex-build/\nclean_dir/\n','utf8');
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
    await backend(['propose'],{file:'main.tex',kind:'manuscript',before:'fast',after:'compact',deps:dependency?['1']:[]});
    const data = JSON.parse(await run(PYTHON,[...common,'inspect','--id','2'],f.root));
    await backend(['feedback'],{id:'2',version:data.version,side:'original',start:0,end:4,quote:'fast',text:'PRIVATE pending feedback: 保留原文，继续返修。'});
    await backend(['propose'],{file:'reply.tex',kind:'response',before:'Thank you.',after:'Thank you for this useful comment.'});
    const options = {git:GIT,gh:'fixture-gh',python:PYTHON,checkpointScript:path.join(SCRIPTS,'review_checkpoint.py')};
    return {...f,status,backend,common,options};
}
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
    const f = await reviewFixture('checkpoint-success',true);
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
    for (const text of [committedMain,committedReply]) for (const secret of ['CODEX-REVIEW-DATA','PRIVATE pending feedback','useful comment','.codex-review/objects']) assert(!text.includes(secret));
    assert(committedReply.includes('CODEX-REVIEW-NEXT manuscript=3 response=b'));
    assert(committedReply.includes('CODEX-REVIEW-SOURCE-ONLY: accepted-content'));
    assert(!fs.readFileSync(path.join(f.root,'reply.tex'),'utf8').includes('closed-by-author-rejection'));
    const after = await f.status();
    assert.deepEqual(after.edits['2'],pending);
    assert.deepEqual(after.edits['1'].versions,[]); assert.equal(after.edits['1'].status,'accepted');
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

test('checkpoint preserves hooks and refuses unapproved manual source changes',async () => {
    const f = await reviewFixture('checkpoint-hook'); await f.backend(['decide','--accept','1']);
    fs.writeFileSync(path.join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\necho checkpoint-hook-refused >&2\nexit 1\n','utf8');
    await assert.rejects(finishReview(f.root,'reply.tex',f.options,'验证 hook 不被绕过',f.execute),/checkpoint-hook-refused/);
    assert.equal((await f.git(['rev-parse','HEAD'])).trim(),f.baseline); assert((await f.status()).edits['1'].versions.length);
    const g = await reviewFixture('checkpoint-manual'); await g.backend(['decide','--accept','1']);
    fs.appendFileSync(path.join(g.root,'main.tex'),'% 作者额外手动修改，尚未纳入投影。\n','utf8');
    const raw = fs.readFileSync(path.join(g.root,'main.tex'));
    await assert.rejects(finishReview(g.root,'reply.tex',g.options,'不夹带手动修改',g.execute),/手动修改/);
    assert(fs.readFileSync(path.join(g.root,'main.tex')).equals(raw));
    assert.equal((await g.git(['rev-parse','HEAD'])).trim(),g.baseline);
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
