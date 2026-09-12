// @ts-nocheck
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );`);
}

function appliedVersions() {
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
}

function pendingMigrations() {
  ensureMigrationsTable();
  const applied = appliedVersions();
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(file => ({ file, version: file.split('_')[0], name: file }))
    .filter(m => !applied.has(m.version));
}

function runMigrations({ silent = false } = {}) {
  ensureMigrationsTable();
  const pending = pendingMigrations();
  if (pending.length === 0) {
    if (!silent) console.log('Veritabanı güncel / Database up to date — no pending migrations.');
    return 0;
  }
  for (const m of pending) {
    const mod = require(path.join(MIGRATIONS_DIR, m.file));
    // Bir UNIQUE/PRIMARY KEY kısıtını değiştirmek SQLite'ta tabloyu yeniden
    // oluşturmayı gerektirir (create-copy-drop-rename); bu sırada başka bir
    // tablonun ona olan yabancı anahtarı varsa `foreign_keys` AÇIKKEN DROP
    // TABLE reddedilir. SQLite'ın resmi çözümü PRAGMA foreign_keys=OFF'u
    // TRANSACTION DIŞINDA çalıştırmaktır (pragma bir transaction içindeyken
    // no-op'tur) — bu yüzden bu tek durumda migration'ı sarmalayan
    // transaction'ın dışına çıkıyoruz. Bayrağı taşımayan mevcut migration'lar
    // (hepsi) davranışını hiç değiştirmez.
    const needsFkToggle = !!mod.disableForeignKeys;
    if (needsFkToggle) db.pragma('foreign_keys = OFF');
    try {
      // Each migration runs inside its own transaction: it either fully applies or not at all.
      const runOne = db.transaction(() => {
        mod.up(db);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)')
          .run(m.version, m.name, Date.now());
      });
      runOne();
    } finally {
      if (needsFkToggle) db.pragma('foreign_keys = ON');
    }
    if (!silent) console.log(`Migration uygulandı / applied: ${m.name}`);
  }
  return pending.length;
}

if (require.main === module) {
  const count = runMigrations();
  console.log(`${count} migration uygulandı / applied.`);
}

module.exports = { runMigrations, pendingMigrations };
