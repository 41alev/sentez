const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createSandbox } = require('./helpers/sandbox');
const { acquireMaintenanceLock } = require('../server/lib/maintenance-lock');

async function main() {
  const sandbox = createSandbox();
  const root = path.resolve(__dirname, '..');
  let server;
  try {
    const invalid = spawnSync(process.execPath, ['server/index.js'], { cwd: root,
      env: { ...sandbox.env, NODE_ENV: 'production', JWT_SECRET: '' }, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert(!fs.existsSync(sandbox.env.DB_PATH), 'Invalid startup must not create or migrate a database');
    server = fork(path.join(root, 'server/index.js'), [], { cwd: root, env: sandbox.env, silent: true });
    server.stdout.resume(); server.stderr.resume();
    await Promise.race([
      once(server, 'message'),
      once(server, 'exit').then(() => { throw new Error('Server failed to start'); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timeout')), 20000); timer.unref(); })
    ]);
    assert.throws(() => acquireMaintenanceLock(sandbox.env.DB_PATH), /maintenance is active/);
    const restore = spawnSync(process.execPath, ['server/scripts/restore.js', path.join(sandbox.dir, 'missing.sqlite'), '--force'],
      { cwd: root, env: sandbox.env, encoding: 'utf8' });
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /maintenance is active/);
    const upgrade = spawnSync(process.execPath, ['server/scripts/upgrade.js', '--yes', '--force'],
      { cwd: root, env: sandbox.env, encoding: 'utf8' });
    assert.notEqual(upgrade.status, 0);
    assert.match(upgrade.stderr, /maintenance is active/);
    const stopped = once(server, 'exit'); server.kill('SIGKILL'); await stopped;
    // No stale PID cleanup needed: the OS releases SQLite's lock after a crash.
    const release = acquireMaintenanceLock(sandbox.env.DB_PATH); release();
    fs.writeFileSync(sandbox.env.DB_PATH + '-wal', Buffer.alloc(100, 1));
    const wal = spawnSync(process.execPath, ['server/scripts/restore.js', path.join(sandbox.dir, 'missing.sqlite'), '--force'],
      { cwd: root, env: sandbox.env, encoding: 'utf8' });
    assert.notEqual(wal.status, 0);
    assert.match(wal.stderr, /Nonempty WAL/);
    console.log('✓ Invalid startup leaves DB untouched; active server blocks forced restore; crash releases lock; nonempty WAL blocks restore');
  } finally {
    if (server && server.exitCode == null && server.signalCode == null) {
      const stopped = once(server, 'exit'); server.kill(); await stopped;
    }
    sandbox.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
