'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const VERSION = require('../package.json').version;
const listeners = new Set();

function processAlive(pid) {
    try {process.kill(pid, 0); return true;}
    catch (error) {if (error.code === 'ESRCH') return false; throw error;}
}
async function inspect(storage, alive = processAlive) {
    const file = path.join(storage, 'mcp-runtime.json');
    let report;
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('MCP 运行版本记录不是普通文件。');
        report = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {state: 'unknown', expected: VERSION, reason: '尚无运行服务的版本报告，旧版服务需先重启一次。'};
        throw error;
    }
    if (!Number.isInteger(report.pid) || report.pid <= 0 || typeof report.version !== 'string' || typeof report.server !== 'string')
        throw new Error('MCP 运行版本记录格式无效。');
    if (!alive(report.pid)) return {state: 'unknown', expected: VERSION, reason: '上次报告的 MCP 进程已退出，等待当前服务报告版本。'};
    return {state: report.version === VERSION && require('./tools').samePath(path.resolve(report.server), path.join(__dirname, 'mcp_server.py')) ? 'matched' : 'mismatch',
        expected: VERSION, actual: report.version, pid: report.pid};
}
function publish(status) {for (const listener of listeners) listener(status);}
function subscribe(listener) {listeners.add(listener); return {dispose() {listeners.delete(listener);}};}
module.exports = {inspect, publish, subscribe};
