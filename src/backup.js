'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {environment} = require('./core');
const EXTENSIONS = new Set(['.tex','.bib','.bst','.sty','.cls','.clo','.bbx','.cbx','.cfg','.def','.fd',
    '.pdf','.png','.jpg','.jpeg','.eps','.svg','.drawio','.otf','.ttf','.tfm','.map','.enc','.csv','.dat']);
function run(executable, args, cwd, input) {
    return new Promise((resolve, reject) => {
        const child = cp.spawn(executable, args, {cwd, env: environment(), windowsHide: true, shell: false});
        const stdout = [], stderr = [];
        child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
        child.on('error', reject);
        child.on('close', code => {
            const output = Buffer.concat(stdout).toString('utf8');
            if (code === 0) resolve(output);
            else {const error = new Error(Buffer.concat(stderr).toString('utf8').trim() || output.trim() || `Git 工具退出码 ${code}`); error.code = code; reject(error);}
        });
        child.stdin.end(input);
    });
}
function privatePath(name) {
    return name.split('/').some(part => ['.git','.codex-review','.latex-build','clean_dir','node_modules','.semantic-researcher-overleaf'].includes(part))
        || /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$|(?:^|\/)(?:auth|credentials)\.json$/i.test(name);
}
function paperPath(name) {
    if (privatePath(name) || /[\r\n\0]/.test(name)) return false;
    if (['.gitignore','.gitattributes','.latexmkrc','latexmkrc'].includes(name)) return true;
    return EXTENSIONS.has(path.posix.extname(name).toLowerCase());
}
function parseStatus(raw) {
    const rows = raw.split('\0').filter(Boolean), result = [];
    for (let i = 0; i < rows.length; i++) {
        const status = rows[i].slice(0,2), file = rows[i].slice(3);
        const files = /[RC]/.test(status) ? [file, rows[++i]] : [file];
        result.push({status, file, files});
    }
    return result;
}
function githubRepository(url) {
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
    if (!match) throw new Error('备份只推送到已配置的 github.com 私有仓库；请核对 origin，不会自动改远端。');
    return match[1] + '/' + match[2];
}
async function inspectBackup(root, options, execute = run) {
    root = fs.realpathSync(root);
    const git = (args, input) => execute(options.git, args, root, input);
    const actual = fs.realpathSync((await git(['rev-parse','--show-toplevel'])).trim());
    if (!require('./tools').samePath(actual, root)) throw new Error('论文文件夹与 Git 根目录不一致，停止备份，避免提交其他项目。');
    if ((await git(['symbolic-ref','--short','HEAD'])).trim() !== 'master') throw new Error('当前不是 master；请先核对项目分支，本按钮不会自动切换。');
    if ((await git(['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'])).trim() !== 'origin/master') throw new Error('请先为 master 配置 origin/master 上游。');
    if ((await git(['diff','--cached','--name-only','-z'])).length) throw new Error('暂存区已有手动选择，请先处理；本按钮不会覆盖暂存选择。');
    const fetchUrls = (await git(['remote','get-url','--all','origin'])).trim().split(/\r?\n/);
    const pushUrls = (await git(['remote','get-url','--push','--all','origin'])).trim().split(/\r?\n/);
    if (fetchUrls.length !== 1 || pushUrls.length !== 1 || githubRepository(fetchUrls[0]).toLowerCase() !== githubRepository(pushUrls[0]).toLowerCase()) throw new Error('origin 的获取和推送目标不唯一或不一致，停止备份。');
    for (const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','BISECT_LOG','index.lock']) {
        const location = (await git(['rev-parse','--git-path',name])).trim();
        if (fs.existsSync(path.resolve(root,location))) throw new Error('Git 正在进行其他操作：' + name);
    }
    await git(['var','GIT_AUTHOR_IDENT']);
    await git(['fetch','origin','master']);
    try {await git(['merge-base','--is-ancestor','origin/master','HEAD']);}
    catch (error) {if (error.code === 1) throw new Error('远端 master 已前进或分叉，请先处理同步；没有自动合并或改写历史。'); throw error;}
    const history = (await git(['log','--format=','--name-only','--no-renames','-z','origin/master..HEAD'])).split('\0').map(x => x.trim()).filter(Boolean);
    if (history.some(privatePath)) throw new Error('尚未推送的提交包含私有审核对象、缓存或凭据路径；请先检查，未上传。');
    for (const name of new Set(history.filter(name=>/\.tex$/i.test(name)))) {
        const commits = (await git(['log','--format=%H','origin/master..HEAD','--',name])).trim().split(/\r?\n/).filter(Boolean);
        for (const commit of commits) {
            const exists = await git(['ls-tree','--name-only',commit,'--',name]);
            if (exists && /^% CODEX-REVIEW-DATA /m.test(await git(['show',commit+':'+name]))) throw new Error('待推送历史包含源码内的审核运行状态：'+name+'；请先核对，不改写历史或上传。');
        }
    }
    const head = (await git(['rev-parse','HEAD'])).trim();
    const status = await git(['status','--porcelain=v1','-z','--untracked-files=all']);
    const entries = parseStatus(status).filter(row => row.files.every(paperPath));
    const bytes = new Map();
    for (const row of entries) for (const name of row.files) {
        const file = path.join(root,name);
        if (fs.existsSync(file)) {
            if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('备份不处理链接或特殊文件：' + name);
            bytes.set(name,fs.readFileSync(file));
        } else bytes.set(name,null);
    }
    const remoteHead = (await git(['rev-parse','origin/master'])).trim();
    return {root,git,execute,options,head,remoteHead,status,entries,bytes,repository:githubRepository(pushUrls[0])};
}
function commitMessage(note, files, stat) {
    const categories = new Set(files.map(file => /\.bib$/i.test(file) ? '参考文献' : /\.(?:pdf|png|jpe?g|eps|svg|drawio)$/i.test(file) ? '图表' : /\.tex$/i.test(file) ? '手稿或回复信' : '模板与配置'));
    return `backup(paper): ${note.trim()}\n\n备份目的：${note.trim()}\n改动类别：${[...categories].join('、')}\n文件范围：\n${files.map(f => '- '+f).join('\n')}\n\n变更统计：\n${stat.trim()}\n\n审核边界：仅记录当前已保存源码，不代表接收候选、处理完批注或科学问题闭合。\n私有审核对象：.codex-review 不在本次上传范围；未接收候选与批注保留本地，成功成果通过 Git 回溯。`;
}
async function verifyPrivate(plan) {
    const {git,execute,root,options} = plan;
    const fetchUrls = (await git(['remote','get-url','--all','origin'])).trim().split(/\r?\n/);
    const pushUrls = (await git(['remote','get-url','--push','--all','origin'])).trim().split(/\r?\n/);
    if (fetchUrls.length!==1 || pushUrls.length!==1 || [fetchUrls[0],pushUrls[0]].some(url=>githubRepository(url).toLowerCase()!==plan.repository.toLowerCase())) throw new Error('备份期间 origin 目标变化；未推送。');
    const metadata = JSON.parse(await execute(options.gh || 'gh',['api','--hostname','github.com','repos/'+plan.repository,'--jq','{private:.private,full_name:.full_name}'],root));
    if (metadata.private !== true || typeof metadata.full_name !== 'string' || metadata.full_name.toLowerCase() !== plan.repository.toLowerCase()) throw new Error('未确认目标为对应的私有 GitHub 仓库，未推送。');
}
async function pushPrivate(plan) {
    const {git} = plan;
    await verifyPrivate(plan);
    await git(['push','origin','HEAD:refs/heads/master']);
    await git(['fetch','origin','master']);
    const head = (await git(['rev-parse','HEAD'])).trim(), remote = (await git(['rev-parse','origin/master'])).trim();
    if (head !== remote) throw new Error('推送后本地与 origin/master 不一致，请检查；不自动改写历史。');
    return head;
}
async function backupProject(plan, entries, note) {
    const {git,execute,root,options} = plan;
    if (!note?.trim()) throw new Error('请填写本次改动目的，便于之后检索版本。');
    if ((await git(['rev-parse','HEAD'])).trim() !== plan.head || (await git(['status','--porcelain=v1','-z','--untracked-files=all'])) !== plan.status) throw new Error('备份选择后文件或 Git 状态发生变化，请重新点备份；没有覆盖内容。');
    const files = [...new Set(entries.flatMap(row => row.files))];
    if (files.some(name => !plan.bytes.has(name))) throw new Error('备份文件不属于刚才核对的范围。');
    if (files.some(name => /\.tex$/i.test(name) && plan.bytes.get(name)?.includes(Buffer.from('% CODEX-REVIEW-DATA ')))) throw new Error('审核状态不能随整份源码提交；请使用“Git 备份已接收修改”。');
    for (const name of files) {
        const file = path.join(root,name), before = plan.bytes.get(name);
        if (before === null ? fs.existsSync(file) : !fs.existsSync(file) || !fs.readFileSync(file).equals(before)) throw new Error('备份期间内容发生变化：' + name);
    }
    let commit = null;
    try {
        if (files.length) {
            const attrs = await git(['check-attr','filter','working-tree-encoding','--',...files]);
            if (attrs.split(/\r?\n/).filter(Boolean).some(line => !line.endsWith(': unspecified') && !line.endsWith(': unset'))) throw new Error('备份范围含自定义 Git 内容转换规则，请先核对；未提交。');
            // Compare verified working bytes with staged/committed blobs before uploading.
            const expected = new Map();
            for (const name of files) if (plan.bytes.get(name) !== null) expected.set(name,(await git(['hash-object','--path='+name,'--stdin'],plan.bytes.get(name))).trim());
            await git(['add','-A','--',...files]);
            const staged = (await git(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
            if (staged.some(name => !files.includes(name))) throw new Error('暂存区出现范围外修改，停止提交，请检查暂存区。');
            const stat = await git(['diff','--cached','--stat','--',...files]);
            if (staged.length) {
                for (const [name,oid] of expected) if ((await git(['rev-parse',':'+name])).trim() !== oid) throw new Error('暂存内容已变化：'+name+'；未提交。');
                await git(['commit','--only','-m',commitMessage(note,files,stat),'--',...files]);
                commit = (await git(['rev-parse','HEAD'])).trim();
                if ((await git(['rev-parse','HEAD^'])).trim() !== plan.head) throw new Error('提交父版本不符合预期，请检查本地历史；未推送。');
                const changed = (await git(['diff-tree','--no-commit-id','--name-only','-r','-z','HEAD'])).split('\0').filter(Boolean);
                if (changed.some(name => !files.includes(name))) throw new Error('提交包含备份范围外的文件，未推送；请检查 Git hook。');
                for (const [name,oid] of expected) if ((await git(['rev-parse','HEAD:'+name])).trim() !== oid) throw new Error('提交内容与核对的源码不同：'+name+'；未推送。');
            }
        }
        const head = await pushPrivate(plan);
        return {commit,head,repository:plan.repository,files};
    } catch (error) {
        throw new Error((commit ? `本地备份提交 ${commit.slice(0,8)} 已保留；远端备份未确认完成。` : '备份未完成，请检查暂存区；未自动回退。') + '\n' + error.message);
    }
}
async function finishReview(root, owner, options, note, execute = run) {
    if (!note?.trim()) throw new Error('请填写本次正文成果的实际改动目的。');
    const plan = await inspectBackup(root, options, execute), {git} = plan;
    const helper = async (operation, input, expect) => {
        const args = ['-X','utf8',options.checkpointScript || path.join(__dirname,'review_checkpoint.py'),
            '--project',plan.root,'--state',owner,'--git',options.git];
        if (expect) args.push('--apply','--expect',expect);
        return JSON.parse(await execute(options.python || 'python',[...args,operation],plan.root,input === undefined ? undefined : JSON.stringify(input)));
    };
    const data = await helper('plan');
    let saved = data.resume, commit = saved?.commit || null;
    if (!saved && !Object.keys(data.accepted).length && !data.manual_files.length) {
        if (data.checkpoint?.commit === plan.head && plan.head === plan.remoteHead) {
            await verifyPrivate(plan);
            const cleaned = await helper('cleanup',undefined,data.sha256);
            return {...cleaned,skipped:true,head:plan.head,reason:`没有新增已接收或手动修改成果，未创建空提交或重复推送；已清理 ${cleaned.deleted_objects.length} 个无引用旧缓存。`};
        }
        return {skipped:true, reason:'没有新增已接收或手动修改成果，也无可核对的成功检查点；未提交或清理。'};
    }
    try {
        if (!saved) {
            if (plan.head !== plan.remoteHead) throw new Error('存在未归属本次成果备份的本地提交，请先核对；不会连带上传。');
            const names = Object.keys(data.sources), expected = {};
            const attrs = await git(['check-attr','filter','working-tree-encoding','--',...names]);
            if (attrs.split(/\r?\n/).filter(Boolean).some(line => !line.endsWith(': unspecified') && !line.endsWith(': unset'))) throw new Error('成果源码含自定义 Git 内容转换规则，请先核对；未提交。');
            function unchanged() {
                for (const name of names) if (crypto.createHash('sha256').update(fs.readFileSync(path.join(plan.root,name))).digest('hex') !== data.sources[name].working_sha256) throw new Error('成果备份期间源码或状态变化：'+name+'；不覆盖或精简。');
            }
            unchanged();
            if ((await git(['rev-parse','HEAD'])).trim() !== plan.head || (await git(['diff','--cached','--name-only','-z'])).length) throw new Error('Git HEAD 或暂存选择发生变化；停止成果提交。');
            for (const name of names) {
                expected[name] = (await git(['hash-object','-w','--stdin'],Buffer.from(data.sources[name].content,'base64'))).trim();
                const tracked = (await git(['ls-files','--stage','-z','--',name])).split('\0').filter(Boolean);
                const mode = tracked.length ? tracked[0].split(' ')[0] : '100644';
                if (!['100644','100755'].includes(mode) || tracked.length > 1) throw new Error('源码不是普通、无冲突的 Git 文件：'+name);
                await git(['update-index','--add','--cacheinfo',mode,expected[name],name]);
            }
            unchanged();
            const staged = (await git(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
            if (staged.some(name => !names.includes(name))) throw new Error('暂存区出现范围外修改；停止提交，不重置作者选择。');
            for (const name of names) if ((await git(['rev-parse',':'+name])).trim() !== expected[name]) throw new Error('暂存成果内容发生变化：'+name);
            if (staged.length) {
                const stat = await git(['diff','--cached','--stat']);
                const message = `accepted(paper): ${note.trim()}\n\n改动目的：${note.trim()}\n已接收编号：${Object.keys(data.accepted).join(', ') || '无'}\n手动修改文件：${data.manual_files.join(', ') || '无'}\n文件范围：\n${names.map(n=>'- '+n).join('\n')}\n\n${stat.trim()}\n\n记录已接收成果及作者直接修改的当前源码；未接收候选、作者批注及运行状态不在提交中。\n本次备份不代表未决项或科学问题已解决。`;
                await git(['commit','-m',message]);
                commit = (await git(['rev-parse','HEAD'])).trim();
                if ((await git(['rev-parse','HEAD^'])).trim() !== plan.head) throw new Error('成果提交父版本变化；未推送。');
                const changed = (await git(['diff-tree','--no-commit-id','--name-only','-r','-z','HEAD'])).split('\0').filter(Boolean);
                if (changed.some(name => !names.includes(name))) throw new Error('提交包含范围外文件，请检查 Git hook；未推送。');
            } else commit = plan.head;
            unchanged();
            for (const name of names) if ((await git(['rev-parse','HEAD:'+name])).trim() !== expected[name]) throw new Error('提交中的成果内容变化：'+name+'；未推送。');
            const marked = await helper('record',{commit,files:expected,purpose:note.trim()},data.sha256);
            saved = {commit,files:expected,accepted:data.accepted,manual_files:data.manual_files};
            if (!marked.applied) throw new Error('成果提交未记录，停止推送和精简。');
        } else {
            if (plan.head !== saved.commit) throw new Error('HEAD 已不是上次保留的成果提交，请先核对；不自动合并。');
            for (const [name,oid] of Object.entries(saved.files)) if ((await git(['rev-parse',saved.commit+':'+name])).trim() !== oid) throw new Error('上次成果提交内容不一致：'+name);
        }
        const head = await pushPrivate(plan);
        if (head !== saved.commit) throw new Error('同步后的提交并非本次成果；不精简历史。');
        const current = await helper('plan');
        if (current.resume?.commit !== head) throw new Error('成果记录已变化，请刷新后核对；不精简历史。');
        const result = await helper('compact',undefined,current.sha256);
        const cleaned = await helper('cleanup',undefined,result.sha256);
        return {...result,...cleaned,head,repository:plan.repository,accepted_ids:Object.keys(saved.accepted),manual_files:saved.manual_files || []};
    } catch (error) {
        throw new Error((commit ? `本地成果提交 ${commit.slice(0,8)} 已保留；本轮备份收尾未全部完成，实际已删除缓存以错误详情为准。` : '成果备份未完成；未接收候选或精简历史。')+'\n'+error.message);
    }
}
function activate(context) {
    const vscode = require('vscode');
    let busy = false;
    async function finishAction() {
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || editor?.document.uri.scheme !== 'file') throw new Error('请在受信任的本地论文文件夹打开 .tex。');
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!folder) throw new Error('请先打开论文文件夹。');
        for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() === folder.uri.toString() && doc.isDirty && !await doc.save()) throw new Error('论文保存失败，未开始成果提交。');
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder.uri.fsPath,'**/*.tex'),'**/{.git,.codex-review,.latex-build,clean_dir,node_modules}/**');
        const owners = files.filter(file => /^% CODEX-REVIEW-DATA /m.test(fs.readFileSync(file.fsPath,'utf8')));
        if (owners.length !== 1) throw new Error('需先核对唯一的本地审核状态，不能猜测提交范围。');
        const note = await vscode.window.showInputBox({title:'Git 备份已接收修改',prompt:'备份已接收成果及当前轮源码中的手动修改；未接收候选和批注保留本地。请填写改动目的',validateInput:value => value.trim() ? undefined : '请填写成果说明。'});
        if (note === undefined) return;
        const cfg = vscode.workspace.getConfiguration('localLatex');
        const result = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'备份已接收成果及手动修改，推送成功后精简已完结记录'},() => finishReview(folder.uri.fsPath,path.relative(folder.uri.fsPath,owners[0].fsPath).split(path.sep).join('/'),
            {git:cfg.get('gitPath','git'),gh:cfg.get('ghPath','gh'),python:cfg.get('pythonPath','python')},note));
        if (result.skipped) return vscode.window.showInformationMessage(result.reason);
        vscode.window.showInformationMessage(`已接收成果 ${result.accepted_ids.join(', ') || '无'}；手动修改文件 ${result.manual_files.join(', ') || '无'}。源码已推送至私有 GitHub；已精简 ${result.removed_ids.length} 条已完结记录，删除 ${result.deleted_objects.length} 个无引用旧缓存；未决候选和批注保留。`);
    }
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.finishReview',async () => {
        if (busy) return vscode.window.showWarningMessage('Git 备份尚未结束。');
        busy = true;
        try {await finishAction();} catch(error) {vscode.window.showErrorMessage(error.message);} finally {busy=false;}
    }));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.backupProject',async () => {
        if (busy) return vscode.window.showWarningMessage('Git 备份尚未结束。');
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || editor?.document.uri.scheme !== 'file') return vscode.window.showWarningMessage('请在受信任的本地论文文件夹打开 .tex。');
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!folder) return;
        busy = true;
        try {
            for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() === folder.uri.toString() && doc.isDirty && !await doc.save()) throw new Error('论文文件保存失败，未开始备份。');
            const cfg = vscode.workspace.getConfiguration('localLatex');
            const plan = await inspectBackup(folder.uri.fsPath,{git:cfg.get('gitPath','git'),gh:cfg.get('ghPath','gh')});
            if ([...plan.bytes].some(([name,raw]) => /\.tex$/i.test(name) && raw?.includes(Buffer.from('% CODEX-REVIEW-DATA ')))) return await finishAction();
            if (!plan.entries.length && plan.head === plan.remoteHead) return vscode.window.showInformationMessage('没有符合备份范围的论文文件变更，也没有待推送提交；未创建空提交。');
            const picked = plan.entries.length ? await vscode.window.showQuickPick(plan.entries.map(entry => ({label:entry.status+' '+entry.file,picked:true,entry})),{canPickMany:true,placeHolder:'备份整个论文项目的这些文件；可取消勾选，不包含私有审核对象与编译缓存'}) : [];
            if (!picked) return;
            if (!picked.length && plan.head === plan.remoteHead) return vscode.window.showInformationMessage('未选择文件，也没有待推送提交；没有创建提交。');
            const note = await vscode.window.showInputBox({title:'Git 备份说明',prompt:'概括本轮修改的目的和内容，写入提交标题和正文供 AI 检索；不会自动接收修订',placeHolder:'例如：澄清伪标签筛选流程，并同步审稿人 1 的回复',validateInput:value => value.trim() ? undefined : '请填写本轮改动说明。'});
            if (note === undefined) return;
            const result = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'提交并备份到已配置的私有 GitHub'},() => backupProject(plan,picked.map(x=>x.entry),note));
            vscode.window.showInformationMessage(`已备份所选 ${result.files.length} 个论文文件或同步已有提交：${result.head.slice(0,8)} → ${result.repository}（私有）；未选中的修改未上传，未接收任何修订。`);
        } catch (error) {vscode.window.showErrorMessage(error.message);}
        finally {busy = false;}
    }));
}
module.exports = {activate,inspectBackup,backupProject,finishReview,commitMessage,run};
if (require.main === module) {
    if (process.argv.length !== 3 || process.argv[2] !== '--finish-review') {
        process.stderr.write('使用 --finish-review，并通过 UTF-8 stdin 提供 {project,state,purpose,git,gh,python}。\n');
        process.exitCode = 2;
    } else {
        const chunks = [];
        process.stdin.on('data',chunk=>chunks.push(chunk));
        process.stdin.on('end',async () => {
            try {
                const spec = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const result = await finishReview(spec.project,spec.state,{git:spec.git || 'git',gh:spec.gh || 'gh',python:spec.python || 'python'},spec.purpose);
                process.stdout.write(JSON.stringify(result)+'\n');
            } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=2;}
        });
    }
}
