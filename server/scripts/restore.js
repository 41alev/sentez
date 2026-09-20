// @ts-nocheck
/**
 * Yedekten geri yükleme.
 *
 * Yedek almanın işe yarayan yarısı geri yükleyebilmektir. Bu script yedeği
 * doğrular, mevcut veritabanını güvenlik kopyası olarak saklar ve ancak ondan
 * sonra üzerine yazar.
 *
 *   node server/scripts/restore.js --list
 *   node server/scripts/restore.js --latest
 *   node server/scripts/restore.js data/backups/depo-takip-2026-09-10T07-00-00-000Z.sqlite
 *   node server/scripts/restore.js --verify <dosya>     (yazmaz, sadece kontrol eder)
 *
 * Sunucu çalışırken geri yükleme yapılmamalıdır: WAL dosyaları tutarsız kalır.
 * Bakım kilidi ve WAL denetimi geri yüklemeyi engeller; --force bunu aşamaz.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
if (require.main === module) require('dotenv').config({ quiet: true });
const { acquireMaintenanceLock } = require('../lib/maintenance-lock');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');
const backupDir = process.env.BACKUP_DIR || path.join(dataDir, 'backups');

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith('depo-takip-') && f.endsWith('.sqlite'))
    .map(f => {
      const full = path.join(backupDir, f);
      const st = fs.statSync(full);
      return { file: f, path: full, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Yedeğin gerçekten geri yüklenebilir olduğunu kontrol eder.
 * Dosyanın var olması yetmez: bozuk bir SQLite dosyası da yerinde durur.
 */
function verifyBackup(file) {
  const result = { file, ok: false, checks: [], tables: 0, rows: {}, error: null };
  const add = (name, ok, detail = '') => result.checks.push({ name, ok, detail });

  if (!fs.existsSync(file)) { result.error = 'Dosya bulunamadı / File not found'; return result; }
  const size = fs.statSync(file).size;
  add('dosya var / file exists', true, `${Math.round(size / 1024)} KB`);
  add('dosya boş değil / not empty', size > 4096, `${size} bayt`);

  // SQLite dosyaları "SQLite format 3\0" ile başlar.
  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  add('SQLite başlığı doğru / valid header', header.toString('utf8', 0, 15) === 'SQLite format 3');

  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });

    // integrity_check bozuk sayfaları ve kırık indeksleri yakalar.
    const integrity = db.pragma('integrity_check', { simple: true });
    add('bütünlük kontrolü / integrity_check', integrity === 'ok', String(integrity));

    // foreign_key_check yetim kayıtları bulur.
    const fkErrors = db.pragma('foreign_key_check');
    add('yabancı anahtar tutarlılığı / foreign keys', fkErrors.length === 0,
      fkErrors.length ? `${fkErrors.length} yetim kayıt` : '');

    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
    result.tables = tables.length;
    add('tablolar mevcut / tables present', tables.length > 40, `${tables.length} tablo`);

    // Şema sürümü: eski bir yedeği yeni koda geri yüklemek sessizce çalışmaz.
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
    add('migration kaydı var / migration record', migrations.length > 0, migrations.join(', '));
    result.migrations = migrations;

    // Çekirdek tablolarda veri olup olmadığı: boş bir yedek teknik olarak geçerlidir
    // ama geri yüklendiğinde işletmeyi durdurur.
    for (const t of ['users', 'items', 'stock_lots', 'movements', 'warehouses']) {
      try { result.rows[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { result.rows[t] = null; }
    }
    add('kullanıcı kaydı var / has users', (result.rows.users || 0) > 0, `${result.rows.users} kullanıcı`);
    add('en az bir yönetici var / has an admin',
      db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1").get().c > 0);

    // Stok toplamı: geri yükleme sonrası karşılaştırma için referans değer.
    try {
      result.stockValue = db.prepare("SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status='available'").get().v;
    } catch { result.stockValue = null; }

    db.close();
    result.ok = result.checks.every(c => c.ok);
  } catch (e) {
    result.error = e.message;
    add('veritabanı açılabiliyor / database opens', false, e.message);
    try { if (db) db.close(); } catch {}
  }
  return result;
}

/** Refuse unresolved WAL state even when an older server has no maintenance lock. */
function assertNoActiveWal() {
  const wal = dbPath + '-wal';
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error('WAL dosyası boş değil; sunucuyu durdurun ve WAL kurtarmasını tamamlayın / Nonempty WAL: stop the server and complete WAL recovery before restore');
  }
  return false;
}

/**
 * Geri yükler. Mevcut veritabanı silinmez, `.pre-restore-<zaman>` uzantısıyla
 * yeniden adlandırılır: yanlış yedeği yüklerseniz geri dönüş yolu kalır.
 */
function restore(file, { force = false } = {}) {
  const release = acquireMaintenanceLock(dbPath);
  try { return restoreOffline(file, { force }); } finally { release(); }
}

function restoreOffline(file, { force = false } = {}) {
  if (path.resolve(file) === path.resolve(dbPath)) throw new Error('Kaynak ve hedef aynı olamaz / Source and destination must differ');
  const v = verifyBackup(file);
  if (!v.ok && !force) {
    throw new Error(`Yedek doğrulamayı geçemedi / Backup failed verification:\n` +
      v.checks.filter(c => !c.ok).map(c => `  - ${c.name} ${c.detail}`).join('\n'));
  }

  assertNoActiveWal();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = `${dbPath}.pre-restore-${stamp}`;
  const moved = [];

  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, safety);
    moved.push(safety);
  }
  // WAL ve SHM dosyaları eski veritabanına aittir; kalırlarsa yeni dosyayı bozarlar.
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext);
  }

  try {
    fs.copyFileSync(file, dbPath);
  } catch (e) {
    // Kopyalama başarısızsa eski veritabanını geri koy: sistemi yarım bırakma.
    if (moved.length) fs.renameSync(safety, dbPath);
    throw new Error(`Geri yükleme başarısız, eski veritabanı korundu / Restore failed, previous database kept: ${e.message}`, { cause: e });
  }

  const after = verifyBackup(dbPath);
  if (!after.ok) {
    fs.unlinkSync(dbPath);
    if (moved.length) fs.renameSync(safety, dbPath);
    throw new Error('Geri yüklenen dosya doğrulamayı geçemedi, eski veritabanı geri alındı / Restored file failed verification, rolled back');
  }

  return { restored: file, safetyCopy: moved[0] || null, verification: after };
}

function printVerification(v) {
  console.log(`\nDosya / File: ${path.basename(v.file)}`);
  v.checks.forEach(c => console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`));
  if (v.tables) console.log(`  · ${v.tables} tablo, kayıtlar: ${JSON.stringify(v.rows)}`);
  if (v.stockValue != null) console.log(`  · stok değeri / stock value: ₺${Math.round(v.stockValue).toLocaleString('tr-TR')}`);
  console.log(v.ok ? '\n✓ Yedek geri yüklenebilir / Backup is restorable\n' : '\n✗ Yedek KULLANILAMAZ / Backup is NOT usable\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.length === 0) {
    const list = listBackups();
    if (!list.length) { console.log('Yedek bulunamadı / No backups found:', backupDir); process.exit(0); }
    console.log(`\nYedekler / Backups (${backupDir}):\n`);
    list.forEach((b, i) => console.log(
      `  ${String(i + 1).padStart(2)}. ${b.file}  ${String(Math.round(b.size / 1024)).padStart(6)} KB  ${new Date(b.mtime).toLocaleString('tr-TR')}`));
    console.log('\nGeri yükleme / Restore:  node server/scripts/restore.js --latest');
    console.log('Doğrulama  / Verify:     node server/scripts/restore.js --verify <dosya>\n');
    process.exit(0);
  }

  if (args[0] === '--verify') {
    const target = args[1] === '--latest' || !args[1] ? (listBackups()[0] || {}).path : args[1];
    if (!target) { console.error('Doğrulanacak yedek yok / No backup to verify'); process.exit(1); }
    const v = verifyBackup(target);
    printVerification(v);
    process.exit(v.ok ? 0 : 1);
  }

  const force = args.includes('--force');
  const target = args.includes('--latest') ? (listBackups()[0] || {}).path : args.find(a => !a.startsWith('--'));
  if (!target) { console.error('Yedek belirtilmedi / No backup specified'); process.exit(1); }

  try {
    const r = restore(target, { force });
    console.log(`\n✓ Geri yüklendi / Restored: ${path.basename(r.restored)}`);
    if (r.safetyCopy) console.log(`  Önceki veritabanı saklandı / Previous database kept at:\n  ${r.safetyCopy}`);
    printVerification(r.verification);
    console.log('Sunucuyu şimdi başlatabilirsiniz / You can start the server now.\n');
  } catch (e) {
    console.error(`\n✗ ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { listBackups, verifyBackup, restore, dbPath, backupDir };
