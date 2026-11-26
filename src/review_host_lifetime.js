'use strict';
const net = require('node:net');

// The listening port is held by this host process and released by the OS when it exits.
async function openLifetime() {
    const server = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    return {port, pid:process.pid, close: () => new Promise(resolve => server.close(resolve))};
}

// PID or port reuse conservatively counts as live; both must be absent.
async function isLive({pid, port}) {
    try {process.kill(pid, 0); return true;}
    catch (error) {if (error.code !== 'ESRCH') return true;}
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({host:'127.0.0.1', port});
        socket.once('connect', () => {socket.destroy(); resolve(true);});
        socket.once('error', error => {
            if (error.code === 'ECONNREFUSED') resolve(false);
            else reject(error);
        });
    });
}

module.exports = {openLifetime, isLive};
