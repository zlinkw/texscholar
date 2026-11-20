'use strict';
// The registry runs inside an existing extension host. It never edits paper text.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {finishTransaction} = require('./review_host_transaction');

function endpoint() {
    return process.platform === 'win32'
        ? '\\\\.\\pipe\\texscholar-review-' + encodeURIComponent(os.userInfo().username)
        : path.join(os.tmpdir(), 'texscholar-review-' + process.getuid() + '.sock');
}
function canonical(root) {
    const real = fs.realpathSync(root);
    return process.platform === 'win32' ? real.toLowerCase() : real;
}
function defaultJournal() {
    const state = process.platform === 'win32' ? process.env.LOCALAPPDATA : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    if (!state || !path.isAbsolute(state)) throw new Error('无法确定本机宿主登记目录。');
    return path.join(state, 'TeXScholar', 'host-lifecycle.json');
}

function lines(socket, callback) {
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
        pending += chunk;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            try {callback(JSON.parse(line));} catch (_) {socket.destroy(); return;}
        }
    });
}
const send = (socket, value) => socket.write(JSON.stringify(value) + '\n');

async function openRegistry(pipe = endpoint(), journal = defaultJournal()) {
    const projects = new Map(), sockets = new Set(), transactions = new Map();
    let unregistered = 0, ownedServer, persisted;
    function record(root, active) {
        const next = Object.assign(Object.create(null), persisted);
        if (active) next[root] = true;
        else delete next[root];
        const temporary = journal + '.write-' + crypto.randomUUID();
        fs.writeFileSync(temporary, JSON.stringify(next), {encoding:'utf8', flag:'wx'});
        fs.renameSync(temporary, journal);
        persisted = next;
    }
    const server = net.createServer(socket => {
        sockets.add(socket); unregistered++;
        for (const entry of projects.values()) entry.generation++;
        let joined = false, orderly = false, operationRoot, operationGeneration, completed;
        const roots = new Set();
        function state(root) {
            const entry = projects.get(root);
            return {eligible: !!entry && !entry.uncertain && unregistered === 0 && entry.members.size === 1,
                    uncertain: entry?.uncertain, generation: entry?.generation};
        }
        function broadcast(root) {
            const entry = projects.get(root);
            if (entry) for (const peer of entry.members) send(peer, {type:'state', root, ...state(root)});
        }
        lines(socket, message => {
            try {
                if (message.type === 'join') {
                    if (operationRoot || !Array.isArray(message.roots)) throw new Error('宿主登记请求无效。');
                    const requested = [...new Set(message.roots.map(canonical))];
                    const requestedSet = new Set(requested);
                    const staged = new Map();
                    for (const root of requested) {
                        let entry = projects.get(root);
                        if (!entry) {
                            const uncertain = persisted[root] === true;
                            if (!uncertain) record(root, true);
                            entry = {members:new Set(), generation:0, uncertain, marked:true};
                        } else if (!entry.members.size && !entry.uncertain) record(root, true);
                        staged.set(root, entry);
                    }
                    for (const root of roots) {
                        if (requestedSet.has(root)) continue;
                        const entry = projects.get(root);
                        entry.members.delete(socket); entry.generation++; roots.delete(root);
                        if (!entry.members.size && !entry.uncertain && entry.marked) {
                            try {record(root, false);} catch (error) {entry.uncertain = true; throw error;}
                        }
                    }
                    for (const [root, entry] of staged) {
                        projects.set(root, entry);
                        if (!roots.has(root)) {entry.members.add(socket); entry.generation++; roots.add(root);}
                    }
                    if (!joined) {joined = true; unregistered--;}
                    for (const root of projects.keys()) broadcast(root);
                    send(socket, {id:message.id, ok:true});
                } else if (message.type === 'reserve-review-transaction') {
                    if (joined || unregistered !== 1) throw new Error('审核事务请求无效或宿主资格不明。');
                    const root = canonical(message.root), entry = projects.get(root);
                    if (!entry || entry.uncertain || entry.members.size !== 1) throw new Error('宿主资格已失效或存在多个宿主；未提交正文。');
                    joined = true; operationRoot = root; operationGeneration = entry.generation; unregistered--;
                    for (const project of projects.keys()) broadcast(project);
                    send(socket, {id:message.id, ok:true, generation:operationGeneration});
                } else if (message.type === 'apply-review-transaction' || message.type === 'apply-legacy-review' || message.type === 'apply-review-migration' || message.type === 'apply-role-metadata') {
                    const legacy = message.type === 'apply-legacy-review', migration = message.type === 'apply-review-migration', role = message.type === 'apply-role-metadata';
                    if ((!legacy && !migration && !role && !/^[a-f0-9]{64}$/.test(message.state_sha || '')) || (!role && !/^[a-f0-9]{64}$/.test(message.commit || '')) || (role && (!message.role_plan || typeof message.role_plan !== 'object')) || (message.recover !== undefined && typeof message.recover !== 'boolean'))
                        throw new Error('审核事务请求无效或宿主资格不明。');
                    const root = canonical(message.root), entry = projects.get(root);
                    if (joined ? operationRoot !== root || operationGeneration !== entry?.generation || unregistered !== 0 : unregistered !== 1)
                        throw new Error('宿主资格已变化；未提交正文。');
                    if (!entry || entry.uncertain || entry.members.size !== 1) throw new Error('宿主资格已失效或存在多个宿主；未提交正文。');
                    if (!joined) {joined = true; operationRoot = root; operationGeneration = entry.generation; unregistered--;}
                    for (const project of projects.keys()) broadcast(project);
                    const host = [...entry.members][0], request = crypto.randomUUID();
                    transactions.set(request, {host, operation:socket, id:message.id, root, generation:entry.generation, stateSha:message.state_sha, commit:message.commit, legacy, migration, role});
                    send(host, {type:'transaction', request, root, generation:entry.generation, state_sha:message.state_sha, commit:message.commit, legacy, migration, role, role_plan:message.role_plan, recover:message.recover === true});
                } else if (message.type === 'check-review-reservation') {
                    const root = canonical(message.root), current = state(root);
                    if (!joined || operationRoot !== root || !current.eligible || operationGeneration !== current.generation)
                        throw new Error('宿主资格已变化；未提交正文。');
                    send(socket, {id:message.id, ok:true, generation:operationGeneration});
                } else if (message.type === 'transaction-result') {
                    const transaction = transactions.get(message.request);
                    if (!transaction || transaction.host !== socket) throw new Error('审核事务回执无效。');
                    transactions.delete(message.request);
                    const current = state(transaction.root);
                    if (!current.eligible || current.generation !== transaction.generation)
                        send(transaction.operation, {id:transaction.id, ok:false, error:'宿主资格已变化；事务保留待核对。'});
                    else {
                        if (message.ok === true && !transaction.legacy && !transaction.migration && !transaction.role) transaction.operation.completedReview = transaction;
                        send(transaction.operation, {id:transaction.id, ok:message.ok === true,
                            ...(message.ok === true ? {result:message.result, generation:transaction.generation} : {error:message.error || '宿主事务失败。'})});
                    }
                } else if (message.type === 'finalize-review-transaction') {
                    completed = socket.completedReview;
                    if (!completed || completed.operation !== socket || completed.stateSha !== message.state_sha || completed.commit !== message.commit)
                        throw new Error('审核事务最终提交请求无效。');
                    const current = state(completed.root);
                    if (!current.eligible || current.generation !== completed.generation)
                        throw new Error('宿主资格已变化；事务保留待核对。');
                    const result = finishTransaction(completed.root, completed.stateSha, completed.commit, message.final);
                    delete socket.completedReview;
                    send(socket, {id:message.id, ok:true, result});
                } else if (message.type === 'acquire' || message.type === 'check') {
                    const root = canonical(message.root), entry = projects.get(root), current = state(root);
                    if (!joined || !roots.has(root) || !current.eligible || (message.type === 'check' && message.generation !== current.generation))
                        throw new Error('宿主资格已失效或存在多个宿主；未提交正文。');
                    if (message.type === 'acquire' && !entry.marked) {record(root, true); entry.marked = true;}
                    send(socket, {id:message.id, ok:true, generation:entry.generation});
                } else if (message.type === 'resolve-stale') {
                    const root = canonical(message.root), entry = projects.get(root);
                    if (!joined || !roots.has(root) || !entry?.uncertain || unregistered !== 0 || entry.members.size !== 1)
                        throw new Error('宿主状态不满足人工核对条件；未恢复写入。');
                    entry.uncertain = false; entry.generation++; broadcast(root);
                    send(socket, {id:message.id, ok:true, generation:entry.generation});
                } else if (message.type === 'leave') {
                    let failure;
                    for (const root of roots) {
                        const entry = projects.get(root); entry.members.delete(socket); entry.generation++;
                        if (!entry.members.size && !entry.uncertain && entry.marked) {
                            try {record(root, false);} catch (error) {entry.uncertain = true; failure = error;}
                        }
                        broadcast(root);
                    }
                    roots.clear(); orderly = true;
                    send(socket, failure ? {id:message.id, ok:false, error:failure.message} : {id:message.id, ok:true});
                    socket.end();
                } else throw new Error('未知宿主登记请求。');
            } catch (error) {
                if (message.type === 'join') {
                    for (const root of roots) {const entry = projects.get(root); entry.uncertain = true; entry.generation++;}
                    for (const root of projects.keys()) broadcast(root);
                }
                send(socket, {id:message.id, ok:false, error:error.message});
            }
        });
        socket.on('error', () => {});
        socket.on('close', () => {
            sockets.delete(socket);
            for (const [request, transaction] of transactions) {
                if (transaction.host === socket) {
                    send(transaction.operation, {id:transaction.id, ok:false, error:'宿主连接已断开；事务保留待核对。'});
                    transactions.delete(request);
                } else if (transaction.operation === socket) {
                    transactions.delete(request);
                }
            }
            if (operationRoot && projects.has(operationRoot)) projects.get(operationRoot).generation++;
            if (!joined) {
                unregistered--;
                for (const entry of projects.values()) entry.uncertain = true;
            }
            for (const root of roots) {
                const entry = projects.get(root); entry.members.delete(socket); entry.generation++;
                if (!orderly) entry.uncertain = true;
                broadcast(root);
            }
            for (const root of projects.keys()) broadcast(root);
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error));
        server.listen(pipe, () => {ownedServer = server; resolve();});
    });
    if (ownedServer) {
        try {
            const directory = path.dirname(journal);
            fs.mkdirSync(directory, {recursive:true});
            const entry = fs.lstatSync(directory);
            if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('宿主登记目录不是普通目录。');
            try {
                const file = fs.lstatSync(journal);
                if (!file.isFile() || file.isSymbolicLink()) throw new Error('宿主登记不是普通文件。');
                const value = JSON.parse(fs.readFileSync(journal, 'utf8'));
                if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(value => value !== true))
                    throw new Error('宿主登记损坏，请先核对。');
                persisted = Object.assign(Object.create(null), value);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                persisted = Object.create(null);
                fs.writeFileSync(journal, '{}', {encoding:'utf8', flag:'wx'});
            }
        } catch (error) {await new Promise(resolve => ownedServer.close(resolve)); throw error;}
    }
    const socket = net.createConnection(pipe);
    await new Promise((resolve, reject) => {socket.once('connect', resolve); socket.once('error', reject);});
    let serial = 0, closed = false;
    const waiting = new Map(), states = new Map(), events = new EventEmitter();
    lines(socket, message => {
        if (message.type === 'state') {states.set(message.root, message); events.emit('state', message); return;}
        if (message.type === 'transaction') {
            if (!events.emit('transaction', message)) send(socket, {type:'transaction-result', request:message.request, ok:false, error:'宿主事务处理器不可用。'});
            return;
        }
        const request = waiting.get(message.id);
        if (!request) return;
        waiting.delete(message.id);
        message.ok ? request.resolve(message) : request.reject(new Error(message.error));
    });
    socket.on('error', () => {});
    socket.on('close', () => {
        closed = true;
        for (const root of states.keys()) events.emit('state', {type:'state', root, eligible:false, uncertain:true, disconnected:true});
        states.clear();
        for (const item of waiting.values()) item.reject(new Error('宿主连接已断开；未提交正文。'));
        waiting.clear();
    });
    function request(type, data = {}) {
        if (closed) return Promise.reject(new Error('宿主连接已断开；未提交正文。'));
        const id = ++serial;
        return new Promise((resolve, reject) => {waiting.set(id, {resolve,reject}); send(socket, {id,type,...data});});
    }
    return {
        join: roots => request('join', {roots}),
        acquire: root => request('acquire', {root}),
        check: (root, generation) => request('check', {root,generation}),
        resolveStale: root => request('resolve-stale', {root}),
        state: root => states.get(canonical(root)),
        onState: callback => {events.on('state', callback); return () => events.off('state', callback);},
        onTransaction: callback => {
            if (events.listenerCount('transaction')) throw new Error('宿主事务处理器已登记。');
            const listener = message => Promise.resolve().then(() => callback(message)).then(
                result => send(socket, {type:'transaction-result', request:message.request, ok:true, result}),
                error => send(socket, {type:'transaction-result', request:message.request, ok:false, error:error.message}));
            events.on('transaction', listener); return () => events.off('transaction', listener);
        },
        async disconnect() {
            if (!closed) await new Promise(resolve => {socket.once('close', resolve); socket.destroy();});
            if (ownedServer) await new Promise(resolve => ownedServer.close(resolve));
        },
        async close() {
            try {if (!closed) await request('leave');}
            finally {
                if (ownedServer) {
                    for (const peer of sockets) peer.destroy();
                    await new Promise(resolve => ownedServer.close(resolve));
                }
            }
        }
    };
}

module.exports = {openRegistry};
