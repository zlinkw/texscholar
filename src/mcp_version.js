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
    return {state: report.version === VERSION && path.resolve(report.server) === path.join(__dirname, 'mcp_server.py') ? 'matched' : 'mismatch',
        expected: VERSION, actual: report.version, pid: report.pid};
}
function prompt(status) {
    return ['# TeXScholar MCP 版本核对与恢复',
        '本机 VS Code 插件要求版本：' + VERSION,
        status.actual ? '最近活动 MCP 服务报告版本：' + status.actual : '当前活动 MCP 版本尚未核实。',
        '在当前论文会话保留任务和未保存输入，先核对 Codex 的 TeXScholar MCP 连接。插件已更新自己的启动指向。',
        '请在 Codex 的 MCP 设置中对 texscholar 执行 Restart；客户端没有此入口时，保存输入并正常重启该 Codex 客户端。不要关闭或删除聊天。',
        '重启后先使用 texscholar.read_context，expected_plugin_version 传 ' + VERSION + '，沿用本会话已经确认的 project、state 和目标 ids/scopes。',
        '检查返回 plugin_version 与上述版本一致，再继续原任务。若仍不一致，报告实际版本和启动路径，停止写入。',
        '不要改用旧 CLI、修改全局 SKILL、删除审核数据、重放已成功项或把重启当成接收候选。只复制提示词不表示已经通过检查。'].join('\n');
}
function publish(status) {for (const listener of listeners) listener(status);}
function subscribe(listener) {listeners.add(listener); return {dispose() {listeners.delete(listener);}};}
module.exports = {inspect, prompt, publish, subscribe};
