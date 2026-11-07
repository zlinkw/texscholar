'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const VERSION = require('../package.json').version;
const listeners = new Set();

function processAlive(pid) {
    try {process.kill(pid, 0); return true;}
    catch (error) {if (error.code === 'ESRCH') return false; throw error;}
}
async function inspect(storage, alive = processAlive, inventory) {
    const file = path.join(storage, 'mcp-runtime.json');
    let report;
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('MCP 运行版本记录不是普通文件。');
        report = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return describe({state: 'unknown', expected: VERSION, reason: '尚无运行服务的版本报告，旧版服务需先重启一次。'}, inventory);
        throw error;
    }
    if (!Number.isInteger(report.pid) || report.pid <= 0 || typeof report.version !== 'string' || typeof report.server !== 'string')
        throw new Error('MCP 运行版本记录格式无效。');
    if (!alive(report.pid)) return describe({state: 'unknown', expected: VERSION, reason: '上次报告的 MCP 进程已退出，等待当前服务报告版本。'}, inventory);
    return describe({state: report.version === VERSION && require('./tools').samePath(path.resolve(report.server), path.join(__dirname, 'mcp_server.py')) ? 'matched' : 'mismatch',
        expected: VERSION, actual: report.version, pid: report.pid}, inventory);
}
function describe(status, inventory) {
    if (!inventory) return status;
    const clients = inventory.clients || [];
    status.clients = clients;
    status.desktop = clients.some(item => item.client === 'desktop');
    if (!inventory.available) {
        if (status.state === 'matched') status.state = 'unknown';
        status.reason = [status.reason, inventory.reason].filter(Boolean).join(' ');
        return status;
    }
    if (status.state === 'matched' && (clients.length !== 1 || clients[0].pid !== status.pid)) status.state = 'unknown';
    if (clients.length > 1) status.reason = [status.reason, `发现 ${clients.length} 条独立 MCP 连接，最近一条的报告不能证明当前论文会话已更新。`].filter(Boolean).join(' ');
    if (status.desktop && status.state !== 'matched') status.reason = [status.reason, '检测到 Codex 桌面端拥有的连接；若当前会话返回旧版本，请在桌面应用中重启 TeXScholar MCP，或保存输入后正常退出并重开 Codex／ChatGPT 桌面应用。仅重启 VS Code 不会重启桌面端连接。'].filter(Boolean).join(' ');
    else if (status.state === 'unknown') status.reason = [status.reason, '请在实际论文会话核对版本，不把配置或其他进程的版本当作本会话已更新。'].filter(Boolean).join(' ');
    return status;
}
function publish(status) {for (const listener of listeners) listener(status);}
function subscribe(listener) {listeners.add(listener); return {dispose() {listeners.delete(listener);}};}
module.exports = {inspect, publish, subscribe};
