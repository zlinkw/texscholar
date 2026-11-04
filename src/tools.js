'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const TOOLS = Object.freeze({
    pythonPath: ['python3.14', 'python3.13', 'python3.12', 'python3', 'python'],
    gitPath: ['git'], ghPath: ['gh'], latexmkPath: ['latexmk'], latexdiffPath: ['latexdiff'],
    texFmtPath: ['tex-fmt'], checkcitesPath: ['checkcites'],
    synctexPath: ['synctex'], chktexPath: ['chktex'], texcountPath: ['texcount'], ripgrepPath: ['rg']
});
let toolDirectories = [];
function searchDirectories(platform = process.platform, env = process.env, home = os.homedir()) {
    const win = platform === 'win32', p = win ? path.win32 : path.posix;
    const current = (env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
    const extra = win ? [
        p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Programs', 'TinyTeX', 'bin', 'windows'),
        p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'TinyTeX', 'bin', 'windows'),
        p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Programs', 'LocalLaTeXTools'),
        p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Programs', 'LocalLaTeXTools', 'ripgrep'),
        p.join(env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
        p.join(env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI')
    ] : ['/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin',
        p.join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin'),
        p.join(home, '.TinyTeX', 'bin', 'universal-darwin')];
    return [...new Set([...current, ...extra])];
}
function findExecutable(names, dirs, platform = process.platform, exists = file => {
    try {fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(file).isFile();}
    catch (error) {if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false; throw error;}
}) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    for (const name of names) {
        const candidates = p.isAbsolute(name) ? [name] : dirs.flatMap(dir =>
            platform === 'win32' && !p.extname(name) ? [p.join(dir, name + '.exe'), p.join(dir, name)] : [p.join(dir, name)]);
        for (const file of candidates) if (exists(file)) return file;
    }
}
function discover(get = () => undefined, platform = process.platform, env = process.env, home = os.homedir()) {
    const dirs = searchDirectories(platform, env, home), found = {}, missing = [];
    for (const [key, names] of Object.entries(TOOLS)) {
        const configured = get(key);
        // Explicit custom values are never silently replaced by another tool.
        found[key] = findExecutable(configured && !names.includes(configured) ? [configured] : names, dirs, platform);
        if (!found[key]) missing.push(key);
    }
    return {found, missing};
}
function configureEnvironment(found) {
    toolDirectories = [...new Set(Object.values(found).filter(Boolean).map(file => path.dirname(file)))];
}
function environment(extra = {}) {
    const env = {...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C', PYTHONUTF8: '1', ...extra};
    const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[key] = [...toolDirectories, env[key] || ''].join(path.delimiter);
    for (const k of Object.keys(env)) if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES)$/i.test(k)) delete env[k];
    return env;
}
function samePath(a, b, platform = process.platform) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const left = p.resolve(a), right = p.resolve(b);
    return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function version(executable, args = ['--version']) {
    return new Promise((resolve, reject) => cp.execFile(executable, args,
        {env: environment(), windowsHide: true, shell: false}, (error, stdout, stderr) =>
            error ? reject(error) : resolve((stdout || stderr).trim())));
}
module.exports = {TOOLS, searchDirectories, findExecutable, discover, configureEnvironment, environment, samePath, version};
