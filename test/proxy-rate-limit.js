#!/usr/bin/env node
// T03 (saha kısmı): login brute-force limiter behind a reverse proxy.
// Starts the app with TRUST_PROXY=loopback and a small HTTP proxy in front
// of it that behaves like the shipped nginx.conf (X-Forwarded-For is
// OVERWRITTEN with the connecting address). A client rotating spoofed
// X-Forwarded-For values must still be limited. The "append" proxy variant
// ($proxy_add_x_forwarded_for) is exercised too, to document why the shipped
// configuration overwrites the header.
// Standalone: node test/run-all.js proxy-rate-limit
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createSandbox } = require('./helpers/sandbox');

const ROOT = path.join(__dirname, '..');

function startApp(env) {
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 20000);
    proc.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    proc.on('message', (/** @type {any} */ msg) => {
      if (msg && msg.type === 'listening') { clearTimeout(timer); resolve({ proc, port: msg.port }); }
    });
  });
}

function startProxy(targetPort, mode) {
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers };
    const client = req.socket.remoteAddress;
    headers['x-forwarded-for'] = mode === 'overwrite' || !headers['x-forwarded-for']
      ? client : `${headers['x-forwarded-for']}, ${client}`;
    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, up => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', e => { res.statusCode = 502; res.end(String(e.message)); });
    req.pipe(upstream);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function failedLogins(port, count) {
  const statuses = [];
  for (let i = 0; i < count; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 1}` },
      body: JSON.stringify({ username: `nobody${i}`, password: 'wrong-pass-1' })
    });
    statuses.push(r.status);
  }
  return statuses;
}

(async () => {
  const sandbox = createSandbox();
  const { proc, port } = await startApp({ ...sandbox.env, TRUST_PROXY: 'loopback', LOGIN_RATE_LIMIT: '5' });
  const proxies = [];
  try {
    const overwrite = await startProxy(port, 'overwrite');
    proxies.push(overwrite);
    const statuses = await failedLogins(overwrite.address().port, 8);
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert(statuses.slice(5).every(s => s === 429), 'spoofed X-Forwarded-For bypassed the limiter behind the proxy: ' + statuses);
    console.log('✓ nginx-style proxy (overwrite): rotating spoofed X-Forwarded-For still hits 429 after the limit');

    // Fresh app instance for the counter, same trust settings, append-style proxy.
    const secondSandbox = createSandbox();
    const second = await startApp({ ...secondSandbox.env, TRUST_PROXY: 'loopback', LOGIN_RATE_LIMIT: '5' });
    try {
      const append = await startProxy(second.port, 'append');
      proxies.push(append);
      const appended = await failedLogins(append.address().port, 8);
      assert(appended.every(s => s === 401), 'append-style forwarding is expected to let spoofed addresses through');
      console.log('✓ documented risk: an append-style proxy ($proxy_add_x_forwarded_for) lets spoofed addresses bypass the limit — shipped nginx.conf overwrites');
    } finally {
      second.proc.kill();
      await new Promise(r => setTimeout(r, 500));
      try { secondSandbox.cleanup(); } catch (e) { console.warn('cleanup:', e.message); }
    }
  } finally {
    proxies.forEach(p => p.close());
    proc.kill();
    await new Promise(r => setTimeout(r, 500));
    try { sandbox.cleanup(); } catch (e) { console.warn('cleanup:', e.message); }
  }
  console.log('proxy-rate-limit: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
