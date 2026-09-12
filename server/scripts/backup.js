// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('../db');

/**
 * Yerel yedek, sunucuyla AYNI diskte durur. Disk arızası, yangın veya hırsızlık
 * yerel yedeği de götürür — bu, kötü bir migration'dan çok daha büyük bir risktir
 * ve kod düzeltmesiyle kapatılamaz, yalnızca ikinci bir kopyanın BAŞKA bir yere
 * gitmesiyle kapatılır. `BACKUP_OFFSITE_CMD` ortam değişkeni tanımlıysa, her
 * başarılı yerel yedekten sonra bu komut çalıştırılır; `{file}` yer tutucusu
 * yedek dosyasının tam yoluyla değiştirilir. Örnekler `docs/KURULUM.md`'de.
 *
 * Bu komut sunucu operatörünün KENDİ ortam yapılandırmasından gelir (SMTP
 * ayarlarıyla aynı güven seviyesinde) — kullanıcı girdisinden değil.
 */
function runOffsiteSync(file) {
  const cmdTemplate = process.env.BACKUP_OFFSITE_CMD;
  if (!cmdTemplate) return Promise.resolve({ attempted: false });
  const cmd = cmdTemplate.replace(/\{file\}/g, file);
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        // Sessizce yutulan bir e-posta hatasından ders çıkarıldı (bkz. test/email.js
        // bulgusu): off-site senkronizasyon başarısız olursa AÇIKÇA görünür olmalı.
        console.error(`[backup] off-site senkronizasyon başarısız / offsite sync failed: ${err.message}`);
        if (stderr) console.error(`[backup] ${stderr.trim()}`);
        resolve({ attempted: true, ok: false, error: err.message });
      } else {
        resolve({ attempted: true, ok: true });
      }
    });
  });
}

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

  const offsite = await runOffsiteSync(target);

  return { file: target, sizeBytes: fs.statSync(target).size, kept: Math.min(files.length, keep), removed, offsite };
}

/** Schedule periodic backups inside the server process. */
function startBackupScheduler() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (!hours || hours <= 0) return null;
  const run = () => runBackup().then(
    r => {
      console.log(`[backup] ${path.basename(r.file)} (${Math.round(r.sizeBytes / 1024)} KB)`);
      if (r.offsite.attempted) console.log(`[backup] off-site: ${r.offsite.ok ? 'ok' : 'BAŞARISIZ / FAILED — ' + r.offsite.error}`);
    },
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
      if (r.offsite.attempted) {
        console.log(r.offsite.ok
          ? 'Off-site senkronizasyon / sync: OK'
          : `Off-site senkronizasyon BAŞARISIZ / sync FAILED: ${r.offsite.error}`);
      }
    })
    .catch(e => { console.error('Yedekleme hatası / Backup failed:', e.message); process.exit(1); });
}

module.exports = { runBackup, startBackupScheduler };
