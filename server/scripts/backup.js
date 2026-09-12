const fs = require('fs');
const path = require('path');
const db = require('../db');

/**
 * Consistent online backup: uses SQLite's backup API rather than copying the file,
 * so a backup taken while the server is running is never half-written.
 * Old backups are rotated so the disk cannot fill up silently.
 */
async function runBackup({ keep = Number(process.env.BACKUP_KEEP || 14), dir, label } = {}) {
  const backupDir = dir || process.env.BACKUP_DIR || path.join(db.dataDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Etiketli yedekler (ör. yükseltme öncesi) rotasyonda silinmez: bir sorun
  // haftalar sonra fark edilebilir ve o yedek tek dönüş yolu olabilir.
  const safeLabel = label ? '-' + String(label).replace(/[^a-z0-9-]/gi, '') : '';
  const target = path.join(backupDir, `depo-takip-${stamp}${safeLabel}.sqlite`);

  await db.backup(target);

  // Rotasyon yalnızca etiketsiz (rutin) yedekleri kapsar. Yükseltme öncesi
  // alınan yedek silinirse, haftalar sonra fark edilen bir sorunda dönüş yolu kalmaz.
  const files = fs.readdirSync(backupDir)
    .filter(f => /^depo-takip-[\d T:.Z-]+\.sqlite$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  const removed = [];
  files.slice(keep).forEach(({ f }) => {
    fs.unlinkSync(path.join(backupDir, f));
    removed.push(f);
  });

  return { file: target, sizeBytes: fs.statSync(target).size, kept: Math.min(files.length, keep), removed };
}

/** Schedule periodic backups inside the server process. */
function startBackupScheduler() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (!hours || hours <= 0) return null;
  const run = () => runBackup().then(
    r => console.log(`[backup] ${path.basename(r.file)} (${Math.round(r.sizeBytes / 1024)} KB)`),
    e => console.error('[backup] failed:', e.message)
  );
  const timer = setInterval(run, hours * 3600 * 1000);
  timer.unref?.();
  return timer;
}

if (require.main === module) {
  runBackup()
    .then(r => {
      console.log(`Yedek alındı / Backup created: ${r.file}`);
      console.log(`Boyut / Size: ${Math.round(r.sizeBytes / 1024)} KB · Saklanan / kept: ${r.kept}` +
        (r.removed.length ? ` · Silinen / removed: ${r.removed.length}` : ''));
    })
    .catch(e => { console.error('Yedekleme hatası / Backup failed:', e.message); process.exit(1); });
}

module.exports = { runBackup, startBackupScheduler };
