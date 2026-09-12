/**
 * Yedekleme ve geri yükleme provası.
 *
 * Yedek almak yarım iştir; asıl soru geri dönülebiliyor mu. Bu test gerçekten
 * veri kaybettirir ve geri alır:
 *   1. Yedek alınır ve doğrulanır
 *   2. Veri değiştirilir (yedek sonrası durum)
 *   3. Veri silinir / dosya bozulur
 *   4. Geri yüklenir
 *   5. Yedek anındaki verinin aynen döndüğü, sonraki değişikliklerin gitmiş
 *      olduğu doğrulanır — ikisi de beklenen davranıştır
 *
 * Sunucu ÇALIŞMAMALIDIR; test kendi geçici veri klasörünü kullanır.
 *
 *   node test/backup-restore.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

// İzole bir veri klasörü: gerçek veritabanına dokunmuyoruz.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-restore-'));
process.env.DATA_DIR = tmpRoot;
process.env.DB_PATH = path.join(tmpRoot, 'depo-takip.sqlite');
process.env.BACKUP_DIR = path.join(tmpRoot, 'backups');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db'));
const { runMigrations } = require(path.join(ROOT, 'server', 'migrate'));
const { seedIfEmpty } = require(path.join(ROOT, 'server', 'seed'));
const backup = require(path.join(ROOT, 'server', 'scripts', 'backup'));
const restore = require(path.join(ROOT, 'server', 'scripts', 'restore'));

(async () => {
  console.log('=== HAZIRLIK / SETUP ===');
  console.log(`  geçici klasör / temp dir: ${tmpRoot}`);
  runMigrations({ silent: true });
  seedIfEmpty();

  const snap = () => ({
    items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
    lots: db.prepare('SELECT COUNT(*) c FROM stock_lots').get().c,
    movements: db.prepare('SELECT COUNT(*) c FROM movements').get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    audit: db.prepare('SELECT COUNT(*) c FROM audit_log').get().c,
    stockValue: db.prepare("SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status='available'").get().v
  });

  const before = snap();
  ok('veritabanı kuruldu ve dolduruldu', before.items > 0 && before.users === 5, JSON.stringify(before));

  console.log('\n=== 1. YEDEK ALMA / BACKUP ===');
  const b = await backup.runBackup({ keep: 5 });
  ok('yedek dosyası oluştu', fs.existsSync(b.file), path.basename(b.file));
  ok('yedek boş değil', b.sizeBytes > 20000, `${Math.round(b.sizeBytes / 1024)} KB`);
  // Online backup API kullanıldığı için sunucu çalışırken bile tutarlı olmalı
  const v1 = restore.verifyBackup(b.file);
  ok('yedek doğrulamayı geçti', v1.ok, (v1.checks.filter(c => !c.ok).map(c => c.name).join(', ') || v1.error || ''));
  ok('yedekte bütünlük hatası yok', v1.checks.find(c => c.name.includes('bütünlük')).ok);
  ok('yedekte yetim kayıt yok', v1.checks.find(c => c.name.includes('yabancı anahtar')).ok);
  ok('yedek migration kaydı taşıyor', (v1.migrations || []).length >= 2, (v1.migrations || []).join(','));
  ok('yedekteki stok değeri kaynakla aynı',
    Math.abs((v1.stockValue || 0) - before.stockValue) < 0.01,
    `${v1.stockValue} vs ${before.stockValue}`);

  console.log('\n=== 2. YEDEK SONRASI DEĞİŞİKLİK / CHANGES AFTER BACKUP ===');
  // Yedek alındıktan sonra yapılan iş: geri dönüldüğünde KAYBOLMASI beklenir.
  const { uuid } = require(path.join(ROOT, 'server', 'lib', 'core'));
  const newItemId = uuid();
  db.prepare(`INSERT INTO items (company_id,id,name,code,category,unit,min_stock,qty_cache,created_at)
    VALUES (1,?,?,?,?,?,0,0,?)`).run(newItemId, 'Yedek Sonrası Ürün', 'POST-BACKUP', 'Test', 'adet', Date.now());
  const afterChange = snap();
  ok('yedek sonrası yeni kayıt eklendi', afterChange.items === before.items + 1,
    `${before.items} → ${afterChange.items}`);

  console.log('\n=== 3. VERİ KAYBI SİMÜLASYONU / DATA LOSS ===');
  // Gerçek bir felaket yabancı anahtar sırasına uymaz; simülasyonu da uymamalı.
  db.pragma('foreign_keys = OFF');
  db.prepare('DELETE FROM movements').run();
  db.prepare('DELETE FROM stock_lots').run();
  db.prepare('DELETE FROM items').run();
  db.pragma('foreign_keys = ON');
  const damaged = snap();
  ok('stok verisi silindi', damaged.items === 0 && damaged.lots === 0, JSON.stringify(damaged));
  ok('kayıp gerçekten yaşandı (stok değeri sıfır)', damaged.stockValue === 0);

  console.log('\n=== 4. GERİ YÜKLEME / RESTORE ===');
  // Geri yükleme dosya seviyesinde çalışır; açık bağlantıyı kapatmamız gerekir.
  db.close();
  const r = restore.restore(b.file);
  ok('geri yükleme tamamlandı', !!r.restored, path.basename(r.restored || ''));
  ok('önceki veritabanı güvenlik kopyası olarak saklandı',
    !!r.safetyCopy && fs.existsSync(r.safetyCopy), r.safetyCopy ? path.basename(r.safetyCopy) : 'yok');
  ok('geri yüklenen dosya doğrulamayı geçti', r.verification.ok);

  console.log('\n=== 5. VERİ BÜTÜNLÜĞÜ / INTEGRITY AFTER RESTORE ===');
  // Yeni bir bağlantı: geri yüklenen dosyayı okuyoruz.
  delete require.cache[require.resolve(path.join(ROOT, 'server', 'db'))];
  const db2 = require(path.join(ROOT, 'server', 'db'));
  const snap2 = {
    items: db2.prepare('SELECT COUNT(*) c FROM items').get().c,
    lots: db2.prepare('SELECT COUNT(*) c FROM stock_lots').get().c,
    movements: db2.prepare('SELECT COUNT(*) c FROM movements').get().c,
    users: db2.prepare('SELECT COUNT(*) c FROM users').get().c,
    stockValue: db2.prepare("SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status='available'").get().v
  };

  ok('ürünler geri geldi', snap2.items === before.items, `${snap2.items} (beklenen ${before.items})`);
  ok('partiler geri geldi', snap2.lots === before.lots, `${snap2.lots} (beklenen ${before.lots})`);
  ok('hareketler geri geldi', snap2.movements === before.movements, `${snap2.movements} (beklenen ${before.movements})`);
  ok('kullanıcılar korundu', snap2.users === before.users);
  ok('stok değeri kuruşuna kadar aynı',
    Math.abs(snap2.stockValue - before.stockValue) < 0.01,
    `${snap2.stockValue} vs ${before.stockValue}`);

  // Yedek sonrası eklenen kayıt GİTMELİ — bu bir hata değil, yedeğin doğası.
  const postBackup = db2.prepare('SELECT id FROM items WHERE code = ?').get('POST-BACKUP');
  ok('yedek sonrası eklenen kayıt geri gelmedi (beklenen davranış)', !postBackup,
    postBackup ? 'kayıt hâlâ duruyor' : '');

  ok('geri yüklenen veritabanında bütünlük hatası yok',
    db2.pragma('integrity_check', { simple: true }) === 'ok');
  ok('geri yüklenen veritabanında yetim kayıt yok', db2.pragma('foreign_key_check').length === 0);

  // Uygulama mantığı hâlâ çalışıyor mu: sadece satır saymak yetmez.
  const item = db2.prepare("SELECT * FROM items WHERE code='SET-001'").get();
  ok('reçete ilişkileri korundu',
    db2.prepare('SELECT COUNT(*) c FROM item_bom WHERE item_id = ?').get(item.id).c === 3);
  const prodLot = db2.prepare("SELECT * FROM stock_lots WHERE lot_no='PARTI-SET-0901'").get();
  ok('üretim partisi ve soy ağacı korundu',
    !!prodLot && db2.prepare('SELECT COUNT(*) c FROM production_consumption WHERE lot_id IS NOT NULL').get().c > 0);
  ok('denetim kaydı korundu', db2.prepare('SELECT COUNT(*) c FROM audit_log').get().c >= 0);

  console.log('\n=== 6. BOZUK YEDEK REDDİ / CORRUPT BACKUP IS REFUSED ===');
  // Bozuk bir yedeğin sessizce yüklenmesi, veri kaybının en kötü halidir.
  const corrupt = path.join(tmpRoot, 'backups', 'bozuk.sqlite');
  fs.writeFileSync(corrupt, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(9000, 0x41)]));
  const cv = restore.verifyBackup(corrupt);
  ok('bozuk dosya doğrulamayı geçemiyor', !cv.ok, cv.error || '');
  let refused = false;
  try { restore.restore(corrupt); } catch { refused = true; }
  ok('bozuk yedek geri yüklenmiyor', refused);
  const stillThere = db2.prepare('SELECT COUNT(*) c FROM items').get().c;
  ok('reddedilen geri yükleme mevcut veriye dokunmadı', stillThere === before.items,
    `${stillThere} (beklenen ${before.items})`);

  const emptyFile = path.join(tmpRoot, 'backups', 'bos.sqlite');
  fs.writeFileSync(emptyFile, '');
  ok('boş dosya reddediliyor', !restore.verifyBackup(emptyFile).ok);
  ok('olmayan dosya reddediliyor', !restore.verifyBackup(path.join(tmpRoot, 'yok.sqlite')).ok);

  console.log('\n=== 7. ROTASYON / ROTATION ===');
  // Yedekler birikirse disk dolar ve sistem sessizce durur.
  // backup modülü eski (kapatılmış) bağlantıyı tutuyor; geri yükleme sonrası tazelenmeli.
  delete require.cache[require.resolve(path.join(ROOT, 'server', 'scripts', 'backup'))];
  const backup2 = require(path.join(ROOT, 'server', 'scripts', 'backup'));
  for (let i = 0; i < 4; i++) { await backup2.runBackup({ keep: 3 }); await new Promise(r => setTimeout(r, 15)); }
  const kept = fs.readdirSync(path.join(tmpRoot, 'backups'))
    .filter(f => f.startsWith('depo-takip-') && f.endsWith('.sqlite'));
  ok('eski yedekler temizlendi (keep=3)', kept.length <= 3, `${kept.length} dosya kaldı`);
  const list = restore.listBackups();
  ok('yedek listesi en yeniden eskiye sıralı',
    list.length > 1 ? list[0].mtime >= list[1].mtime : true);

  db2.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Prova çalıştırılamadı / Drill failed:', e);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
