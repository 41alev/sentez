const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const heldLocks = new Map();

function lease(lockPath, entry) {
  entry.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.users) return;
    heldLocks.delete(lockPath);
    try { entry.lock.exec('ROLLBACK'); } finally { entry.lock.close(); }
  };
}

/** A separate SQLite lock survives normal operation and releases on process death.
 * The database being restored is never used as the lock file because it is replaced.
 */
function acquireMaintenanceLock(dbPath) {
  const resolved = path.resolve(dbPath);
  const lockPath = (fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved) + '.maintenance-lock.sqlite';
  if (heldLocks.has(lockPath)) return lease(lockPath, heldLocks.get(lockPath));
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = new Database(lockPath, { timeout: 0 });
    lock.pragma('journal_mode = DELETE');
    lock.exec('BEGIN EXCLUSIVE');
    lock.exec('CREATE TABLE IF NOT EXISTS owner (pid INTEGER)');
    lock.prepare('INSERT INTO owner(pid) VALUES(?)').run(process.pid);
  } catch (error) {
    try { lock?.close(); } catch {}
    throw new Error('Sunucu veya bakım işlemi çalışıyor; önce durdurun / Server or maintenance is active; stop it before proceeding', { cause: error });
  }
  const entry = { lock, users: 0 };
  heldLocks.set(lockPath, entry);
  return lease(lockPath, entry);
}
module.exports = { acquireMaintenanceLock };
