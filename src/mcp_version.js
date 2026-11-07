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
    const reports = report.instances || [report];
    for (const item of reports) if (!Number.isInteger(item.pid) || item.pid <= 0 || typeof item.version !== 'string' || typeof item.server !== 'string')
        throw new Error('MCP 运行版本记录格式无效。');
    const live = reports.filter(item => alive(item.pid));
    const clients = inventory?.available ? inventory.clients : live.map(item => ({pid: item.pid, client: 'unknown'}));
    const current = clients.map(client => ({...client, report: live.find(item => item.pid === client.pid)}));
    const wrong = current.filter(item => item.report && (item.report.version !== VERSION || !require('./tools').samePath(path.resolve(item.report.server), path.join(__dirname, 'mcp_server.py'))));
    const missing = current.filter(item => !item.report);
    const selected = wrong[0]?.report || live.find(item => clients.some(client => client.pid === item.pid));
    const state = wrong.length ? 'mismatch' : !clients.length || missing.length || inventory?.available === false ? 'unknown' : 'matched';
    const affected = wrong.length ? wrong : missing;
    const desktop = affected.some(item => item.client === 'desktop');
    let reason = state === 'mismatch' ? `${wrong.length} 条连接报告的版本或启动位置不一致。`
        : state === 'unknown' ? missing.length ? `${missing.length} 条连接尚未报告版本；等待其首次请求核验，不要求仅因连接数量重启。` : '尚无当前活动连接的有效报告，等待首次请求核验。' : undefined;
    if (inventory?.available === false) reason = [reason, inventory.reason].filter(Boolean).join(' ');
    if (desktop) reason += ' 涉及 Codex 桌面端连接；若实际会话返回旧版本，应在桌面应用中重启该 MCP。仅重启 VS Code 不会重启桌面端连接。';
    return {state, expected: VERSION, actual: selected?.version, pid: selected?.pid, reason, desktop,
        verified: current.length - missing.length, clients: current.map(({report, ...client}) => ({...client, version: report?.version}))};
}
function describe(status, inventory) {
    if (!inventory) return status;
    return {...status, clients: inventory.clients || [], desktop: (inventory.clients || []).some(item => item.client === 'desktop'),
        reason: [status.reason, inventory.reason, '等待活动连接首次报告，连接数量本身不表示需要重启。'].filter(Boolean).join(' ')};
}
function publish(status) {for (const listener of listeners) listener(status);}
function subscribe(listener) {listeners.add(listener); return {dispose() {listeners.delete(listener);}};}
module.exports = {inspect, publish, subscribe};
