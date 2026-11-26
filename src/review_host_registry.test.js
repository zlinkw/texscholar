'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const {openRegistry} = require('./review_host_registry');

function fixture() {
    const root = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'host-registry-'));
    fs.mkdirSync(path.join(root, '.codex-review'));
    const suffix = crypto.randomUUID();
    const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\ts-registry-test-' + suffix : path.join(root, 'socket');
    return {root, pipe, journal:path.join(root, 'host-lifecycle.json')};
}
async function operation(pipe, root) {
    const socket = net.createConnection(pipe);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const response = new Promise((resolve,reject)=>{
        let text = ''; socket.on('data', chunk => {text += chunk.toString('utf8'); const at = text.indexOf('\n');
            if (at >= 0) {const value = JSON.parse(text.slice(0,at)); value.ok ? resolve(value) : reject(new Error(value.error));}});
        socket.once('error',reject);
    });
    socket.write(JSON.stringify({id:1,type:'apply-review-transaction',root,state_sha:'a'.repeat(64),commit:'b'.repeat(64)})+'\n');
    return {socket,response};
}

test('second connected host invalidates a reservation and a lost host fails closed', async () => {
    const f = fixture(), first = await openRegistry(f.pipe, f.journal);
    await first.join([f.root]);
    assert.equal(fs.existsSync(path.join(f.root, '.codex-review', 'host-live.json')), false);
    const reservation = await first.acquire(f.root);
    await first.check(f.root, reservation.generation);
    const second = await openRegistry(f.pipe, f.journal); await second.join([f.root]);
    await assert.rejects(first.check(f.root, reservation.generation), /资格已失效/);
    await assert.rejects(second.acquire(f.root), /多个宿主/);
    await assert.rejects(first.resolveStale(f.root), /不满足人工核对条件/);
    const lost = new Promise(resolve => first.onState(value => {if (value.uncertain) resolve();}));
    await second.disconnect(); await lost;
    await assert.rejects(first.acquire(f.root), /资格已失效/);
    await first.close();
    const reopened = await openRegistry(f.pipe, f.journal); await reopened.join([f.root]);
    await assert.rejects(reopened.acquire(f.root), /资格已失效/);
    await assert.rejects(reopened.resolveStale(f.root), /不满足人工核对条件/);
    await reopened.close();
});

test('legacy registration requires manual review once before recording a lifetime', async () => {
    const f = fixture(), key = process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
    fs.writeFileSync(f.journal, JSON.stringify({[key]:true}));
    const host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    await host.resolveStale(f.root); await host.acquire(f.root);
    const saved = JSON.parse(fs.readFileSync(f.journal,'utf8'))[key];
    assert.equal(saved.leases.length, 1); assert.equal(saved.leases[0].pid, process.pid);
    await host.close();
});

test('manual legacy recovery cannot dismiss a known surviving host', async () => {
    const f = fixture(), key = process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
    fs.writeFileSync(f.journal, JSON.stringify({[key]:true}));
    const first = await openRegistry(f.pipe, f.journal); await first.join([f.root]);
    const second = await openRegistry(f.pipe, f.journal);
    let target = Infinity, resolveJoined;
    const joined = new Promise(resolve => {resolveJoined = resolve; first.onState(value => {if (value.generation >= target) resolve();});});
    await second.join([f.root]); target = second.state(f.root).generation;
    if (first.state(f.root).generation >= target) resolveJoined();
    await joined;
    const generation = first.state(f.root).generation;
    const changed = new Promise(resolve => first.onState(value => {if (value.generation > generation) resolve();}));
    try {await second.disconnect(); await changed; await assert.rejects(first.resolveStale(f.root), /存活宿主/);}
    finally {await first.close();}
});

test('published independent host blocks writing before its delayed join', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const old = await host.acquire(f.root);
    const script = `const net=require('net');const [pipe,root]=process.argv.slice(1);const life=net.createServer(s=>s.destroy());life.listen(0,'127.0.0.1',()=>{const s=net.createConnection(pipe);s.on('connect',()=>s.write(JSON.stringify({id:1,type:'publish',roots:[root],pid:process.pid,port:life.address().port})+'\\n'));let buf='';s.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(m.id===1)console.log(m.ok?'published':'error');if(m.id===2)console.log(m.ok?'joined':'error');}});process.stdin.on('data',v=>{if(v.toString().includes('join'))s.write(JSON.stringify({id:2,type:'join',roots:[root]})+'\\n');else process.exit(0);});});`;
    const child = spawn(process.execPath, ['-e', script, f.pipe, f.root], {stdio:['pipe','pipe','pipe']});
    const next = () => new Promise((resolve, reject) => {child.stdout.once('data', data => resolve(data.toString().trim())); child.once('error', reject);});
    assert.equal(await next(), 'published');
    await assert.rejects(host.check(f.root, old.generation), /资格已失效/);
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    const joined = next(); child.stdin.write('join\n'); assert.equal(await joined, 'joined');
    await assert.rejects(host.acquire(f.root), /多个宿主/);
    const exited = new Promise(resolve => child.once('exit', resolve)); child.stdin.write('exit\n'); await exited;
    await host.close();
});

test('a published host that exits before join permits recovery after its lifetime ends', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const script = `const net=require('net');const [pipe,root]=process.argv.slice(1);const life=net.createServer(s=>s.destroy());life.listen(0,'127.0.0.1',()=>{const s=net.createConnection(pipe);s.on('connect',()=>s.write(JSON.stringify({id:1,type:'publish',roots:[root],pid:process.pid,port:life.address().port})+'\\n'));s.on('data',c=>{const m=JSON.parse(c.toString().trim());if(m.id===1)console.log(m.ok?'published':'error');});process.stdin.once('data',()=>process.exit(0));});`;
    const child = spawn(process.execPath, ['-e', script, f.pipe, f.root], {stdio:['pipe','pipe','pipe']});
    assert.equal(await new Promise((resolve,reject) => {child.stdout.once('data', value => resolve(value.toString().trim())); child.once('error',reject);}), 'published');
    const lost = new Promise(resolve => host.onState(value => {if (value.uncertain) resolve();}));
    const exited = new Promise(resolve => child.once('exit',resolve)); child.stdin.write('exit\n');
    assert.equal(await exited, 0); await lost;
    await host.acquire(f.root); await host.close();
});

test('a reviewed legacy registration recovers after its independent host exits', async () => {
    const f = fixture(), key = process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
    fs.writeFileSync(f.journal, JSON.stringify({[key]:true}));
    const script = `const {openRegistry}=require(process.argv[1]);(async()=>{const [root,pipe,journal]=process.argv.slice(2);const h=await openRegistry(pipe,journal);await h.join([root]);await h.resolveStale(root);await h.acquire(root);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});`;
    await promisify(execFile)(process.execPath, ['-e', script, require.resolve('./review_host_registry'), f.root, f.pipe, f.journal]);
    const host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    await host.acquire(f.root); await host.close();
});

test('a surviving independent host blocks broker recovery until its lifetime ends', async () => {
    const f = fixture();
    const script = `const {openRegistry}=require(process.argv[1]);(async()=>{const [root,pipe,journal]=process.argv.slice(2);const h=await openRegistry(pipe,journal);h.onState(s=>{if(s.disconnected)console.log('disconnected')});await h.join([root]);console.log('ready');process.stdin.once('data',()=>process.exit(0));})().catch(e=>{console.error(e);process.exit(1)});`;
    const start = () => spawn(process.execPath, ['-e', script, require.resolve('./review_host_registry'), f.root, f.pipe, f.journal], {stdio:['pipe','pipe','pipe']});
    const line = child => new Promise((resolve, reject) => {child.stdout.once('data', data => resolve(data.toString().trim())); child.once('error', reject);});
    const first = start(); assert.equal(await line(first), 'ready');
    const second = start(); assert.equal(await line(second), 'ready');
    const lost = line(second), firstExit = new Promise(resolve => first.once('exit', resolve)); first.stdin.write('exit\n');
    assert.equal(await firstExit, 0); assert.equal(await lost, 'disconnected');
    const host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    const secondExit = new Promise(resolve => second.once('exit', resolve)); second.stdin.write('exit\n'); assert.equal(await secondExit, 0);
    await host.acquire(f.root); await host.close();
});

test('a published host still blocks recovery if the broker exits before its join', async () => {
    const f = fixture();
    const brokerScript = `const {openRegistry}=require(process.argv[1]);(async()=>{const [root,pipe,journal]=process.argv.slice(2);const h=await openRegistry(pipe,journal);await h.join([root]);console.log('ready');process.stdin.once('data',()=>process.exit(0));})().catch(e=>{console.error(e);process.exit(1)});`;
    const delayedScript = `const net=require('net');const [pipe,root]=process.argv.slice(1);const life=net.createServer(s=>s.destroy());life.listen(0,'127.0.0.1',()=>{const s=net.createConnection(pipe);s.on('connect',()=>s.write(JSON.stringify({id:1,type:'publish',roots:[root],pid:process.pid,port:life.address().port})+'\\n'));s.on('data',c=>{const m=JSON.parse(c.toString().trim());if(m.id===1)console.log(m.ok?'published':'error');});s.on('close',()=>console.log('disconnected'));process.stdin.once('data',()=>process.exit(0));});`;
    const line = child => new Promise((resolve,reject) => {child.stdout.once('data', value => resolve(value.toString().trim())); child.once('error',reject);});
    const broker = spawn(process.execPath, ['-e', brokerScript, require.resolve('./review_host_registry'), f.root, f.pipe, f.journal], {stdio:['pipe','pipe','pipe']});
    assert.equal(await line(broker), 'ready');
    const delayed = spawn(process.execPath, ['-e', delayedScript, f.pipe, f.root], {stdio:['pipe','pipe','pipe']});
    assert.equal(await line(delayed), 'published');
    const lost = line(delayed), brokerExit = new Promise(resolve => broker.once('exit',resolve)); broker.stdin.write('exit\n');
    assert.equal(await brokerExit, 0); assert.equal(await lost, 'disconnected');
    const host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    const delayedExit = new Promise(resolve => delayed.once('exit',resolve)); delayed.stdin.write('exit\n'); assert.equal(await delayedExit, 0);
    await host.acquire(f.root); await host.close();
});

test('a damaged lifetime registration fails closed without rewriting it', async () => {
    const f = fixture(), key = process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
    const damaged = JSON.stringify({[key]:{leases:[{pid:0,port:1234}]}});
    fs.writeFileSync(f.journal, damaged);
    await assert.rejects(openRegistry(f.pipe, f.journal), /登记损坏/);
    assert.equal(fs.readFileSync(f.journal,'utf8'), damaged);
});

test('an unregistered connection blocks writes and requires explicit review after disconnect', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const old = await host.acquire(f.root), unknown = net.createConnection(f.pipe);
    await new Promise((resolve,reject) => {unknown.once('connect',resolve); unknown.once('error',reject);});
    await assert.rejects(host.check(f.root, old.generation), /资格已失效/);
    const uncertain = new Promise(resolve => host.onState(value => {if (value.uncertain) resolve();}));
    unknown.end(); await uncertain;
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    await host.resolveStale(f.root); await host.acquire(f.root); await host.close();
});

test('a rejected reservation followed by damaged protocol is not treated as known', async () => {
    const f = fixture(), first = await openRegistry(f.pipe,f.journal); await first.join([f.root]);
    const second = await openRegistry(f.pipe,f.journal); await second.join([f.root]);
    const socket = net.createConnection(f.pipe);
    await new Promise((resolve,reject) => {socket.once('connect',resolve);socket.once('error',reject);});
    const response = new Promise(resolve => socket.once('data', raw => resolve(JSON.parse(raw.toString()))));
    socket.write(JSON.stringify({id:1,type:'reserve-review-transaction',root:f.root})+'\n');
    assert.equal((await response).ok, false);
    const uncertain = new Promise(resolve => first.onState(value => {if (value.uncertain) resolve();}));
    socket.end('{'); await uncertain; await second.close();
    await assert.rejects(first.acquire(f.root), /资格已失效/);
    await first.resolveStale(f.root); await first.close();
});

test('a non-object protocol message remains unknown and does not disable the broker', async () => {
    const f = fixture(), host = await openRegistry(f.pipe,f.journal); await host.join([f.root]);
    const unknown = net.createConnection(f.pipe);
    await new Promise((resolve,reject) => {unknown.once('connect',resolve);unknown.once('error',reject);});
    const uncertain = new Promise(resolve => host.onState(value => {if (value.uncertain) resolve();}));
    unknown.write('null\n'); await uncertain;
    await assert.rejects(host.acquire(f.root), /资格已失效/);
    await host.resolveStale(f.root); await host.acquire(f.root); await host.close();
});

test('an orderly single-host close allows a fresh session', async () => {
    const f = fixture(), first = await openRegistry(f.pipe, f.journal);
    await first.join([f.root]); await first.acquire(f.root); await first.close();
    const next = await openRegistry(f.pipe, f.journal); await next.join([f.root]);
    await next.acquire(f.root); await next.close();
});

test('a clean second host departure permits a newly checked reservation', async () => {
    const f = fixture(), first = await openRegistry(f.pipe, f.journal);
    await first.join([f.root]); const old = await first.acquire(f.root);
    const second = await openRegistry(f.pipe, f.journal); await second.join([f.root]);
    await second.close();
    await assert.rejects(first.check(f.root, old.generation), /资格已失效/);
    const renewed = await first.acquire(f.root);
    assert.notEqual(renewed.generation, old.generation);
    await first.close();
});

test('a disconnected host cannot retain a cached eligible state', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal);
    await host.join([f.root]); await host.acquire(f.root);
    const lost = new Promise(resolve => host.onState(value => {if (value.disconnected) resolve();}));
    await host.disconnect(); await lost;
    assert.equal(host.state(f.root), undefined);
    await assert.rejects(host.acquire(f.root), /连接已断开/);
});

test('a project rejoining a live broker is recorded as active again', async () => {
    const f = fixture(), secondRoot = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'host-other-'));
    const first = await openRegistry(f.pipe, f.journal); await first.join([f.root]);
    const second = await openRegistry(f.pipe, f.journal); await second.join([secondRoot]); await second.close();
    const key = process.platform === 'win32' ? fs.realpathSync(secondRoot).toLowerCase() : fs.realpathSync(secondRoot);
    assert.equal(JSON.parse(fs.readFileSync(f.journal,'utf8'))[key], undefined);
    const third = await openRegistry(f.pipe, f.journal); await third.join([secondRoot]);
    assert.equal(JSON.parse(fs.readFileSync(f.journal,'utf8'))[key].leases.length, 1);
    await third.close(); await first.close();
});

test('workspace changes withdraw removed roots and invalidate their old reservations', async () => {
    const f = fixture(), other = fs.mkdtempSync(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'host-change-'));
    const host = await openRegistry(f.pipe,f.journal); await host.join([f.root]);
    const before = await host.acquire(f.root);
    await host.join([other]);
    await assert.rejects(host.check(f.root,before.generation), /资格已失效/);
    const key = process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
    assert.equal(JSON.parse(fs.readFileSync(f.journal,'utf8'))[key], undefined);
    await host.acquire(other);
    await host.close();
});

test('a second host invalidates a transaction reservation before intent creation', async () => {
    const f = fixture(), host = await openRegistry(f.pipe,f.journal); await host.join([f.root]);
    const socket = net.createConnection(f.pipe);
    await new Promise((resolve,reject) => {socket.once('connect',resolve);socket.once('error',reject);});
    const exchange = value => new Promise(resolve => {
        let raw = ''; const receive = chunk => {raw += chunk.toString(); const at = raw.indexOf('\n'); if (at >= 0) {socket.off('data',receive);resolve(JSON.parse(raw.slice(0,at)));}};
        socket.on('data',receive); socket.write(JSON.stringify(value)+'\n');
    });
    assert.equal((await exchange({id:1,type:'reserve-review-transaction',root:f.root})).ok,true);
    const second = await openRegistry(f.pipe,f.journal); await second.join([f.root]);
    assert.equal((await exchange({id:2,type:'check-review-reservation',root:f.root})).ok,false);
    socket.end(); await second.close(); await host.close();
});

test('only the registered host handles a scoped review transaction', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    host.onTransaction(async message => {assert.equal(message.state_sha,'a'.repeat(64));return {files:['paper.tex']};});
    const request = await operation(f.pipe,f.root), result = await request.response;
    assert.deepEqual(result.result.files,['paper.tex']); request.socket.end(); await host.close();
});

test('successful header transaction notifies its host after the operation closes', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const seen = new Promise(resolve => host.onHeaderSettled(resolve));
    host.onTransaction(async message => {assert.equal(message.role_plan.kind,'header-metadata'); return {files:[]};});
    const socket = net.createConnection(f.pipe);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const response = new Promise((resolve,reject)=>{
        let text=''; socket.on('data',chunk=>{text+=chunk.toString('utf8'); const at=text.indexOf('\n');
            if(at>=0){const value=JSON.parse(text.slice(0,at)); value.ok?resolve(value):reject(new Error(value.error));}});
        socket.once('error',reject);
    });
    socket.write(JSON.stringify({id:1,type:'apply-role-metadata',root:f.root,role_plan:{kind:'header-metadata'}})+'\n');
    await response; socket.end();
    assert.equal(await seen,process.platform === 'win32' ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root));
    await host.close();
});

test('failed header transaction does not signal a completed refresh', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    let count=0; host.onHeaderSettled(()=>{count++;});
    host.onTransaction(async()=>{throw new Error('refused');});
    const socket=net.createConnection(f.pipe);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const response=new Promise(resolve=>{let raw='';socket.on('data',chunk=>{raw+=chunk.toString();const at=raw.indexOf('\n');if(at>=0)resolve(JSON.parse(raw.slice(0,at)));});});
    socket.write(JSON.stringify({id:1,type:'apply-role-metadata',root:f.root,role_plan:{kind:'header-metadata'}})+'\n');
    assert.equal((await response).ok,false);
    const previous=host.state(f.root).generation;
    const changed=new Promise(resolve=>host.onState(value=>{if(value.generation>previous)resolve();}));
    socket.end();await changed;assert.equal(count,0);await host.close();
});

test('a second host invalidates a running transaction before its receipt', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    let release, started;
    const ready = new Promise(resolve=>{started=resolve;});
    host.onTransaction(async () => {started();await new Promise(resolve=>{release=resolve;});return {files:['paper.tex']};});
    const request = await operation(f.pipe,f.root); await ready;
    const second = await openRegistry(f.pipe,f.journal); await second.join([f.root]); release();
    await assert.rejects(request.response,/资格已变化/);
    request.socket.end(); await second.close(); await host.close();
});

test('finalization is confined to the completed transaction and invalidated by another host', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const objects = path.join(f.root,'.codex-review','objects'); fs.mkdirSync(objects);
    const source = path.join(f.root,'paper.tex'); fs.writeFileSync(source,'Old.\n');
    const object = Buffer.from(JSON.stringify({files:{'0-old':Buffer.from('Old.\n').toString('base64'),'0-new':Buffer.from('New.\n').toString('base64')}}));
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const commit = sha(object); fs.writeFileSync(path.join(objects,commit+'.json'),object);
    const state = Buffer.from(JSON.stringify({schema:3,transaction:{commit,files:['paper.tex'],owner:false}}));
    const statePath = path.join(f.root,'.codex-review','state.json'); fs.writeFileSync(statePath,state);
    host.onTransaction(async () => {fs.writeFileSync(source,'New.\n'); return {files:['paper.tex']};});
    const socket = net.createConnection(f.pipe);
    await new Promise((resolve,reject) => {socket.once('connect',resolve);socket.once('error',reject);});
    const exchange = value => new Promise((resolve,reject) => {
        let raw = ''; const receive = chunk => {raw += chunk.toString(); const at = raw.indexOf('\n'); if (at >= 0) {socket.off('data',receive); resolve(JSON.parse(raw.slice(0,at)));}};
        socket.on('data',receive); socket.once('error',reject); socket.write(JSON.stringify(value)+'\n');
    });
    const request = {root:f.root,state_sha:sha(state),commit};
    assert.equal((await exchange({id:1,type:'apply-review-transaction',...request})).ok,true);
    const second = await openRegistry(f.pipe,f.journal); await second.join([f.root]);
    const final = Buffer.from('{"schema":3}').toString('base64');
    assert.equal((await exchange({id:2,type:'finalize-review-transaction',...request,final})).ok,false);
    assert.deepEqual(fs.readFileSync(statePath),state);
    socket.end(); await second.close(); await host.close();
});

test('Python client completes a persisted transaction over the registered host connection', async () => {
    const f = fixture(), host = await openRegistry(f.pipe, f.journal); await host.join([f.root]);
    const objects = path.join(f.root,'.codex-review','objects'); fs.mkdirSync(objects);
    const source = path.join(f.root,'paper.tex'); fs.writeFileSync(source,'Old.\n');
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const object = Buffer.from(JSON.stringify({files:{'0-old':Buffer.from('Old.\n').toString('base64'),'0-new':Buffer.from('New.\n').toString('base64')}}));
    const commit = sha(object); fs.writeFileSync(path.join(objects,commit+'.json'),object);
    const state = Buffer.from(JSON.stringify({schema:3,transaction:{commit,files:['paper.tex'],owner:false}}));
    const statePath = path.join(f.root,'.codex-review','state.json'); fs.writeFileSync(statePath,state);
    host.onTransaction(async () => {fs.writeFileSync(source,'New.\n'); return {files:['paper.tex']};});
    const second = await openRegistry(f.pipe, f.journal); await second.join([f.root]);
    const denied = "import os,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from review_host_client import HostSession,HostError,endpoint; assert Path(sys.argv[2]).resolve().is_relative_to(Path(os.environ['LOCAL_LATEX_TEST_ROOT']).resolve()); assert sys.argv[3] != endpoint() and ('ts-registry-test-' in sys.argv[3] if os.name == 'nt' else Path(sys.argv[3]).parent.resolve() == Path(sys.argv[2]).resolve()); exec(\"try:\\n with HostSession(sys.argv[2],pipe=sys.argv[3]): pass\\nexcept HostError: print('reservation refused')\\nelse: raise AssertionError('reservation unexpectedly granted')\")";
    await promisify(execFile)(process.env.LOCAL_LATEX_PYTHON || 'python', ['-X','utf8','-c',denied,__dirname,f.root,f.pipe]);
    assert.deepEqual(fs.readFileSync(statePath),state); assert.equal(fs.readFileSync(source,'utf8'),'Old.\n');
    await second.close();
    const script = "import os,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from review_host_client import apply_review_transaction,endpoint; assert Path(sys.argv[2]).resolve().is_relative_to(Path(os.environ['LOCAL_LATEX_TEST_ROOT']).resolve()); assert sys.argv[5] != endpoint(); assert ('ts-registry-test-' in sys.argv[5] if os.name == 'nt' else Path(sys.argv[5]).parent.resolve() == Path(sys.argv[2]).resolve()); apply_review_transaction(sys.argv[2],sys.argv[3],sys.argv[4],b'{\\\"schema\\\":3}',pipe=sys.argv[5])";
    await promisify(execFile)(process.env.LOCAL_LATEX_PYTHON || 'python', ['-X','utf8','-c',script,__dirname,f.root,sha(state),commit,f.pipe]);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath,'utf8')),{schema:3});
    assert.equal(fs.readFileSync(source,'utf8'),'New.\n');
    await host.close();
});
