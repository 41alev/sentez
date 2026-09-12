#!/usr/bin/env node
/**
 * Sürüm yükseltme.
 *
 * Yükseltmenin tehlikeli kısmı migration'ların yarıda kalmasıdır: veritabanı
 * ne eski ne yeni şemada kalır ve sistem açılmaz. Bu script sırayı garanti eder:
 *
 *   1. Sunucu çalışıyor mu — kontrol et, çalışıyorsa dur
 *   2. Yedek al ve DOĞRULA (bozuk yedekle yükseltmeye başlamak intihardır)
 *   3. Bekleyen migration'ları göster, onay al
 *   4. Uygula
 *   5. Sonucu doğrula — bütünlük, yabancı anahtarlar, çekirdek tablolar
 *   6. Doğrulama başarısızsa YEDEĞE GERİ DÖN
 *
 *   npm run upgrade
 *   npm run upgrade -- --yes      (onay sormaz, otomasyon için)
 *   npm run upgrade -- --dry-run  (hiçbir şey değiştirmez, ne yapacağını söyler)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);

function serverLooksRunning() {
  const wal = dbPath + '-wal';
  return fs.existsSync(wal) && fs.statSync(wal).size > 0;
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve((a || '').trim().toLowerCase()); });
  });
}

async function main() {
  console.log('\n╭─────────────────────────────────────────╮');
  console.log('│  Depo Takip ERP — Sürüm Yükseltme       │');
  console.log('╰─────────────────────────────────────────╯\n');

  const pkg = require('../../package.json');
  console.log(`  Uygulama sürümü / App version: ${pkg.version}`);

  if (!fs.existsSync(dbPath)) {
    console.error('\n✗ Veritabanı bulunamadı. Önce kurulum yapın: npm run setup\n');
    process.exit(1);
  }

  /* ---- 1. Sunucu kontrolü ---- */
  if (serverLooksRunning() && !flag('force')) {
    console.error('\n✗ Sunucu çalışıyor görünüyor (WAL dosyası dolu).');
    console.error('  Yükseltmeden önce sunucuyu durdurun. Çalışırken şema değiştirmek');
    console.error('  açık işlemleri bozar ve veri kaybettirir.\n');
    console.error('  Yine de devam etmek için: npm run upgrade -- --force\n');
    process.exit(1);
  }

  /* ---- 2. Bekleyen migration'lar ---- */
  const db = require('../db');
  // Sürüm anahtarı dosya adının ilk parçasıdır ('004_import.js' → '004');
  // migrate.js ile aynı kural kullanılmalı, yoksa bekleyenler yanlış sayılır.
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const files = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter(f => f.endsWith('.js')).sort();
  const pending = files.filter(f => !applied.has(f.split('_')[0]));

  console.log(`  Uygulanmış / Applied:  ${applied.size}`);
  console.log(`  Bekleyen   / Pending:  ${pending.length}\n`);

  if (!pending.length) {
    console.log('✓ Veritabanı güncel, yapılacak bir şey yok.\n');
    process.exit(0);
  }

  pending.forEach(f => {
    let name = f;
    try { name = require(path.join(__dirname, '..', 'migrations', f)).name || f; } catch {}
    console.log(`    • ${f}  —  ${name}`);
  });
  console.log('');

  if (flag('dry-run')) {
    console.log('(deneme modu — hiçbir değişiklik yapılmadı)\n');
    process.exit(0);
  }

  /* ---- 3. Onay ---- */
  if (!flag('yes')) {
    const answer = await ask('Devam edilsin mi? Önce otomatik yedek alınacak. (e/h): ');
    if (!['e', 'evet', 'y', 'yes'].includes(answer)) {
      console.log('\nİptal edildi.\n');
      process.exit(0);
    }
  }

  /* ---- 4. Yedek al ve doğrula ---- */
  console.log('\n→ Yedek alınıyor…');
  db.close();

  delete require.cache[require.resolve('../db')];
  const backup = require('./backup');
  const restore = require('./restore');

  let backupFile;
  try {
    const b = await backup.runBackup({ keep: 30, label: 'pre-upgrade' });
    backupFile = b.file;
    console.log(`  ${path.basename(backupFile)} (${Math.round(b.sizeBytes / 1024)} KB)`);
    // backup.js kendi üst seviyesinde `require('../db')` ile bağlantıyı açık tutar
    // ve hiç kapatmaz. Bu bağlantı kapanmadan bırakılırsa, aşağıda migrate.js
    // kendi bağlantısını açtığında dosyada iki açık tanıtıcı birden olur; migration
    // başarısız olup geri dönüş rename'i denendiğinde Windows'ta EBUSY ile başarısız
    // olur (POSIX'te sorun çıkmaz, bu yüzden Linux/Mac'te fark edilmemiş olabilir).
    try { require('../db').close(); } catch {}
  } catch (e) {
    console.error(`\n✗ Yedek alınamadı: ${e.message}`);
    console.error('  Yedeksiz yükseltme yapılmaz.\n');
    process.exit(1);
  }

  const verified = restore.verifyBackup(backupFile);
  if (!verified.ok) {
    console.error('\n✗ Alınan yedek doğrulamayı geçemedi. Yükseltme durduruldu.');
    verified.checks.filter(c => !c.ok).forEach(c => console.error(`  - ${c.name} ${c.detail}`));
    console.error('');
    process.exit(1);
  }
  console.log('  ✓ Yedek doğrulandı\n');

  /* ---- 5. Migration'ları uygula ---- */
  console.log('→ Migration\'lar uygulanıyor…');
  let migrationError = null;
  try {
    delete require.cache[require.resolve('../migrate')];
    delete require.cache[require.resolve('../db')];
    require('../migrate').runMigrations({ silent: false });
  } catch (e) {
    migrationError = e;
  }

  /* ---- 6. Doğrula, gerekirse geri dön ---- */
  if (!migrationError) {
    console.log('\n→ Sonuç doğrulanıyor…');
    const after = restore.verifyBackup(dbPath);
    if (!after.ok) {
      migrationError = new Error('Yükseltme sonrası doğrulama başarısız: ' +
        after.checks.filter(c => !c.ok).map(c => c.name).join(', '));
    } else {
      console.log(`  ✓ Bütünlük, yabancı anahtarlar ve çekirdek tablolar kontrol edildi`);
      console.log(`  ✓ ${after.tables} tablo · kayıtlar: ${JSON.stringify(after.rows)}`);
    }
  }

  if (migrationError) {
    console.error(`\n✗ Yükseltme başarısız: ${migrationError.message}`);
    console.error('→ Yedeğe geri dönülüyor…');
    try {
      // Migration'ı çalıştıran bağlantı (satır 136'da yeniden açılan singleton)
      // hâlâ dosyayı açık tutuyor. Windows'ta (POSIX'in aksine) açık bir
      // tanıtıcıyla dosya yeniden adlandırılamaz; restore() aşağıdaki rename'i
      // yapmaya çalıştığında EBUSY ile başarısız olur ve geri dönüş de başarısız
      // görünür. Geri dönüşten önce bağlantıyı kapatmak bunu önler.
      try { require('../db').close(); } catch {}
      restore.restore(backupFile, { force: true });
      console.error('  ✓ Veritabanı yükseltme öncesi haline döndürüldü.');
      console.error('    Sistem eski sürümle çalışmaya devam edebilir.\n');
    } catch (e) {
      console.error(`  ✗ Geri dönüş de başarısız: ${e.message}`);
      console.error(`    Yedek dosyası: ${backupFile}`);
      console.error('    Bu dosyayla elle geri yükleme yapın: npm run restore -- ' + backupFile + '\n');
    }
    process.exit(1);
  }

  console.log('\n✓ Yükseltme tamamlandı.\n');
  console.log(`  Yükseltme öncesi yedek: ${path.basename(backupFile)}`);
  console.log('  Bir sorun görürseniz geri dönebilirsiniz:');
  console.log(`    npm run restore -- ${backupFile}\n`);
  console.log('  Sunucuyu başlatabilirsiniz: npm start\n');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => {
    console.error('\n✗ Beklenmeyen hata:', e.message, '\n');
    process.exit(1);
  });
}

module.exports = { main };
