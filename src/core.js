'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const MESSAGE = 'style(latex): 仅格式化，未修改内容';
const CONTENT_MESSAGE = 'docs(latex): 保存格式化前的正文修改';
function environment() {
    return require('./tools').environment();
}
function run(executable, args, cwd, input) {
    return new Promise((resolve, reject) => {
        const child = cp.spawn(executable, args, {cwd, env: environment(), windowsHide: true, shell: false});
        const stdout = [], stderr = [];
        let length = 0, settled = false;
        const timer = setTimeout(() => { child.kill(); reject(new Error('工具执行超时；未自动回退或重试。')); }, 120000);
        child.stdout.on('data', b => {
            length += b.length;
            if (length > 16 * 1024 * 1024) child.kill();
            stdout.push(b);
        });
        child.stderr.on('data', b => stderr.push(b));
        child.on('error', error => { clearTimeout(timer); settled = true; reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            if (settled) return;
            if (code !== 0) reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || '工具退出码：' + code));
            else if (length > 16 * 1024 * 1024) reject(new Error('工具输出过大。'));
            else resolve(Buffer.concat(stdout));
        });
        child.stdin.on('error', () => {});
        child.stdin.end(input);
    });
}
function lines(text) { return text.split(/(?<=\n)/); }

// Align original physical lines with unchanged formatter lines. Unique payloads
// anchor the order; equal prefixes/suffixes between anchors also cover repeated
// environment commands. Split, merged or edited payloads contribute no indent.
function indentationMatches(source, target) {
    const payloads = values => values.map(line => line.replace(/\r?\n$/, '').replace(/^[ \t]*/, ''));
    const a = payloads(source), b = payloads(target);
    const unique = values => {
        const result = new Map();
        values.forEach((value, i) => result.set(value, result.has(value) ? -1 : i));
        return result;
    };
    const original = unique(a), proposed = unique(b), candidates = [];
    a.forEach((value, i) => {
        const j = proposed.get(value);
        if (original.get(value) === i && j !== undefined && j >= 0) candidates.push([i, j]);
    });
    // Longest increasing subsequence keeps anchors monotone even when formatter
    // rewrites happen to reproduce another source payload out of order.
    const tails = [], previous = [];
    candidates.forEach((pair, i) => {
        let low = 0, high = tails.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (candidates[tails[middle]][1] < pair[1]) low = middle + 1;
            else high = middle;
        }
        previous[i] = low ? tails[low - 1] : -1;
        tails[low] = i;
    });
    const anchors = [];
    for (let i = tails.at(-1); i !== undefined && i >= 0; i = previous[i]) anchors.push(candidates[i]);
    anchors.reverse();
    anchors.unshift([-1, -1]);
    anchors.push([a.length, b.length]);
    const matches = new Map();
    for (let k = 1; k < anchors.length; k++) {
        const [endA, endB] = anchors[k];
        let i = anchors[k - 1][0] + 1, j = anchors[k - 1][1] + 1;
        while (i < endA && j < endB && a[i] === b[j]) matches.set(i++, j++);
        let lastA = endA - 1, lastB = endB - 1;
        while (lastA >= i && lastB >= j && a[lastA] === b[lastB]) matches.set(lastA--, lastB--);
        if (endA < a.length) matches.set(endA, endB);
    }
    return matches;
}

// Only borrow indentation from tex-fmt. Preserve all original non-leading
// characters, blank lines, line boundaries, comments and verbatim blocks.
function conservativeIndent(original, proposed) {
    if (/\\(?:catcode|obeyspaces|obeylines|ExplSyntaxOn|scantokens|endlinechar)\b/.test(original)) {
        throw new Error('含空格或字符类别敏感命令，已停止自动格式化；请手动检查。');
    }
    const source = lines(original);
    const target = lines(proposed.replace(/\r\n/g, '\n'));
    const matches = indentationMatches(source, target);
    const verbatim = /\\begin\{(verbatim\*?|[BL]?Verbatim\*?|SaveVerbatim|lstlisting|minted|alltt|comment|filecontents\*?|luacode\*?|pycode|pythoncode)\}/;
    let literal = null;
    const output = source.map((line, i) => {
        const body = line.replace(/\r?\n$/, '');
        const end = line.slice(body.length);
        const begin = body.match(verbatim);
        if (literal || begin) {
            literal = literal || begin[1];
            if (body.includes('\\end{' + literal + '}')) literal = null;
            return line;
        }
        if (!body.trim() || /^\s*%/.test(body)) return line;
        const matched = matches.get(i);
        if (matched === undefined) return line;
        const proposedBody = target[matched].replace(/\r?\n$/, '');
        return proposedBody.match(/^[ \t]*/)[0] + body.replace(/^[ \t]*/, '') + end;
    }).join('');
    const after = lines(output);
    if (after.length !== source.length || source.some((s, i) => s.replace(/^[ \t]*/, '') !== after[i].replace(/^[ \t]*/, ''))) {
        throw new Error('仅缩进校验失败，未写入。');
    }
    return output;
}
function ensureRealFile(file) {
    const absolute = path.resolve(file);
    if (path.extname(absolute).toLowerCase() !== '.tex') throw new Error('仅支持本地 .tex 文件。');
    for (let current = absolute; ; current = path.dirname(current)) {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不自动格式化链接路径。');
        if (path.dirname(current) === current) break;
    }
    if (!fs.statSync(absolute).isFile()) throw new Error('目标不是普通文件。');
    return absolute;
}
async function indexSnapshot(git) {
    return git(['ls-files', '--stage', '-z']);
}
function otherIndexEntries(snapshot, relative) {
    return snapshot.toString('utf8').split('\0').filter(e => e && e.slice(e.indexOf('\t') + 1) !== relative).sort().join('\0');
}
async function preflight(file, gitExecutable, policy = {}) {
    file = ensureRealFile(file);
    const git = (args, input) => run(gitExecutable, args, path.dirname(file), input);
    const root = (await git(['rev-parse', '--show-toplevel'])).toString('utf8').trim();
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('文件不在已核实仓库内。');
    await git(['symbolic-ref', '-q', 'HEAD']);
    const head = (await git(['rev-parse', 'HEAD'])).toString('utf8').trim();
    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', relative]);
    if (status.length && !policy.allowContentChanges) throw new Error('当前文件尚有未提交修改或未纳入 Git。请先提交正文修改，再仅格式化。');
    const tracked = (await git(['ls-files', '--stage', '--', relative])).toString('utf8');
    if (!/^100(?:644|755) /.test(tracked)) throw new Error('请先将此普通文件提交到 Git。');
    if (!policy.preserveOtherStaged && (await git(['diff', '--cached', '--name-only', '-z'])).length) {
        throw new Error('暂存区已有其他修改；请先处理，避免混入格式化提交。');
    }
    const index = await indexSnapshot(git);
    if (index.toString('utf8').split('\0').filter(Boolean).some(e => !/^\d+ [0-9a-f]+ 0\t/.test(e))) {
        throw new Error('Git 暂存区存在未解决的冲突，停止自动提交。');
    }
    const attrs = (await git(['check-attr', 'filter', 'working-tree-encoding', '--', relative])).toString('utf8');
    if (attrs.split('\n').filter(Boolean).some(l => !l.endsWith(': unspecified') && !l.endsWith(': unset'))) {
        throw new Error('文件使用自定义 Git 转换规则，停止自动提交。');
    }
    const operations = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock'];
    for (const name of operations) {
        const location = (await git(['rev-parse', '--git-path', name])).toString('utf8').trim();
        if (fs.existsSync(path.resolve(path.dirname(file), location))) throw new Error('Git 正在进行其他操作：' + name);
    }
    const user = await git(['var', 'GIT_AUTHOR_IDENT']);
    if (!user.length) throw new Error('Git 尚未配置提交身份。');
    const before = fs.readFileSync(file);
    const blob = await git(['show', 'HEAD:' + relative]);
    const normalize = b => b.toString('utf8').replace(/\r\n/g, '\n');
    const contentChanged = normalize(before) !== normalize(blob);
    if (contentChanged && !policy.allowContentChanges) throw new Error('文件与 HEAD 内容不一致；停止仅格式化提交。');
    if (!contentChanged && policy.preserveOtherStaged) {
        const staged = await git(['show', ':' + relative]);
        if (normalize(staged) !== normalize(before)) throw new Error('当前文件的暂存内容与工作副本不同，停止操作以保留暂存选择。');
    }
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    const text = decoder.decode(before);
    return {file, root, relative, head, before, text, git, gitExecutable, index, contentChanged};
}
async function prepare(file, options, policy) {
    const state = await preflight(file, options.git, policy);
    state.formatted = await formatText(state.text, options.formatter, state.root);
    return state;
}
async function formatText(text, formatter, cwd) {
    const proposed = (await run(formatter, ['--stdin', '--nowrap', '--noconfig', '--tabsize', '2'], cwd, text)).toString('utf8');
    return conservativeIndent(text, proposed);
}
async function assertCurrent(state, expectedBytes) {
    if (!fs.readFileSync(state.file).equals(expectedBytes)) throw new Error('文件已被其他操作修改，停止后续提交。');
    const head = (await state.git(['rev-parse', 'HEAD'])).toString('utf8').trim();
    if (head !== state.head) throw new Error('Git HEAD 已变化，停止提交。');
    if (!(await indexSnapshot(state.git)).equals(state.index)) throw new Error('暂存区发生变化，停止提交。');
}
async function commitText(state, text, message) {
    const bytes = Buffer.from(text, 'utf8');
    await assertCurrent(state, bytes);
    await state.git(['commit', '--only', '-m', message, '--', state.relative]);
    const id = (await state.git(['rev-parse', 'HEAD'])).toString('utf8').trim();
    const parent = (await state.git(['rev-parse', 'HEAD^'])).toString('utf8').trim();
    const committed = await state.git(['show', 'HEAD:' + state.relative]);
    const names = (await state.git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'])).toString('utf8').split('\0').filter(Boolean);
    if (parent !== state.head || names.length !== 1 || names[0] !== state.relative
        || committed.toString('utf8').replace(/\r\n/g, '\n') !== text.replace(/\r\n/g, '\n')
        || otherIndexEntries(await indexSnapshot(state.git), state.relative) !== otherIndexEntries(state.index, state.relative)) {
        throw new Error('提交后的核验未通过；可能有 Git hook 修改了内容。请检查，未自动重写或回退历史。');
    }
    return id;
}
async function checkpoint(state) {
    if (!state.contentChanged) return null;
    const id = await commitText(state, state.text, CONTENT_MESSAGE);
    state.head = id;
    state.index = await indexSnapshot(state.git);
    state.contentChanged = false;
    return id;
}
async function commit(state) {
    return commitText(state, state.formatted, MESSAGE);
}
module.exports = {MESSAGE, CONTENT_MESSAGE, conservativeIndent, formatText, preflight, prepare, assertCurrent, checkpoint, commit, environment};
