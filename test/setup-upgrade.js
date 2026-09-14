// @ts-nocheck
/**
 * Kurulum ve sürüm yükseltme testleri.
 *
 * En kritik iki senaryo:
 *   1. Temiz bir kurulum gerçekten kullanılabilir mi — demo verisi olmadan,
 *      girilebilen bir hesapla, çalışan bir sistem çıkıyor mu?
 *   2. Yükseltme yarıda kalırsa ne oluyor — veritabanı yükseltme öncesi haline
 *      dönüyor mu, yoksa ne eski ne yeni şemada mı kalıyor?
 *
 * İkincisi için kasıtlı olarak bozuk bir migration yazılır ve geri dönüş ölçülür.
 *
 *   node test/setup-upgrade.js   (sunucu gerektirmez)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const ROOT = path.join(__dirname, '..');

/** Scripti izole bir veri klasöründe çalıştırır. */
function run(script, args = [], env = {}, dataDir) {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'server', 'scripts', script), ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'depo-takip.sqlite'),
             BACKUP_DIR: path.join(dataDir, 'backups'), ...env }
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

function openDb(dataDir) {
  const Database = require('better-sqlite3');
  return new Database(path.join(dataDir, 'depo-takip.sqlite'), { fileMustExist: true });
}

(async () => {
  console.log('=== TEMİZ KURULUM / CLEAN SETUP ===');
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-setup-'));

  // Şifre ve kullanıcı adı kuralları kurulumda da geçerli olmalı
  const weak = run('setup.js', ['--company', 'X A.Ş.', '--admin-user', 'admin'],
    { ADMIN_PASSWORD: '123' }, d1);
  ok('zayıf şifre kurulumda reddediliyor', !weak.ok && /8 karakter/.test(weak.out),
    weak.out.slice(0, 120).replace(/\n/g, ' '));

  const common = run('setup.js', ['--company', 'X A.Ş.', '--admin-user', 'admin'],
    { ADMIN_PASSWORD: 'Admin123!' }, d1);
  ok('yaygın şifre reddediliyor', !common.ok && /yaygın/.test(common.out),
    'kurulumda zayıf şifreye izin vermek, hiç değiştirilmeyen bir yönetici şifresi bırakır');

  const noCompany = run('setup.js', ['--admin-user', 'x'], { ADMIN_PASSWORD: 'Gucl3Sifre!' }, d1);
  ok('firma unvanı olmadan kurulum yapılmıyor', !noCompany.ok && /Firma unvanı/.test(noCompany.out));

  const badUser = run('setup.js', ['--company', 'X', '--admin-user', 'a b c'],
    { ADMIN_PASSWORD: 'Gucl3Sifre!' }, d1);
  ok('geçersiz kullanıcı adı reddediliyor', !badUser.ok, badUser.out.slice(0, 80).replace(/\n/g, ' '));

  const good = run('setup.js',
    ['--company', 'Deneme Metal A.Ş.', '--admin-user', 'mehmet', '--warehouse', 'Ana Depo',
     '--tax-no', '1234567890', '--currency', 'TRY'],
    { ADMIN_PASSWORD: 'Fabrika2026!' }, d1);
  ok('kurulum tamamlanıyor', good.ok, good.out.slice(-200).replace(/\n/g, ' '));
  // Not: "yedeği" içinde "yedek" geçmez (ünsüz yumuşaması). Metin yerine
  // kullanıcının çalıştıracağı komutu aramak daha sağlam bir ölçüt.
  ok('kurulum sonrası ne yapılacağı anlatılıyor',
    /Veri Aktarımı/.test(good.out) && /npm run backup/.test(good.out),
    'kullanıcı kurulumdan sonra ne yapacağını bilmeli');

  const db1 = openDb(d1);
  ok('firma kaydı oluştu',
    db1.prepare('SELECT name FROM companies WHERE id=1').get().name === 'Deneme Metal A.Ş.');
  ok('yönetici hesabı oluştu',
    db1.prepare("SELECT COUNT(*) c FROM users WHERE username='mehmet' AND role='admin' AND is_active=1").get().c === 1);
  ok('depo oluştu', db1.prepare('SELECT COUNT(*) c FROM warehouses').get().c === 1);

  // Asıl mesele: temiz kurulumda demo verisi OLMAMALI
  ok('demo kullanıcıları yok',
    db1.prepare("SELECT COUNT(*) c FROM users WHERE username IN ('admin','operator','kalite','viewer','mudur')").get().c === 0,
    'şifresi belgelerde yazan hesaplar üretime gitmemeli');
  ok('demo ürünleri yok', db1.prepare('SELECT COUNT(*) c FROM items').get().c === 0);
  ok('demo tedarikçileri yok', db1.prepare('SELECT COUNT(*) c FROM suppliers').get().c === 0);
  ok('demo stoğu yok', db1.prepare('SELECT COUNT(*) c FROM stock_lots').get().c === 0);

  // Sistem çalışabilir durumda mı: eksik temel kayıt varsa ilk işlemde patlar
  ok('para birimi ayarı yazıldı',
    db1.prepare("SELECT value FROM settings WHERE key='baseCurrency'").get().value === 'TRY');
  ok('kur tablosu boş bırakılmadı',
    db1.prepare('SELECT COUNT(*) c FROM exchange_rates').get().c >= 1,
    'boş kur tablosu ilk dövizli işlemde hata verir');
  ok('belge şablonları hazır geliyor',
    db1.prepare('SELECT COUNT(*) c FROM document_templates').get().c === 8,
    'kullanıcı önce şablon tanımlamak zorunda kalmamalı');
  ok('tüm migration\'lar uygulandı',
    db1.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c >= 5);

  const bcrypt = require('bcryptjs');
  const hash = db1.prepare("SELECT password_hash h FROM users WHERE username='mehmet'").get().h;
  ok('şifre bcrypt ile saklandı', /^\$2[aby]\$/.test(hash), hash.slice(0, 7));
  ok('şifre doğrulanabiliyor', bcrypt.compareSync('Fabrika2026!', hash),
    'giriş yapılamayan bir kurulum işe yaramaz');
  ok('bcrypt maliyeti yeterli (≥12)', Number(hash.split('$')[2]) >= 12, hash.split('$')[2]);
  db1.close();

  // İkinci kurulum mevcut veriyi ezmemeli
  const second = run('setup.js', ['--company', 'Başka Firma', '--admin-user', 'ikinci'],
    { ADMIN_PASSWORD: 'Baska2026!' }, d1);
  ok('ikinci kurulum reddediliyor', !second.ok && /zaten kullanıcı var/.test(second.out),
    'yanlışlıkla çalıştırılan kurulum mevcut sistemi silmemeli');
  ok('reddederken önce yedek alması söyleniyor', /npm run backup/.test(second.out));
  const db1b = openDb(d1);
  ok('reddedilen kurulum veriye dokunmadı',
    db1b.prepare('SELECT name FROM companies WHERE id=1').get().name === 'Deneme Metal A.Ş.');
  db1b.close();

  console.log('\n=== YÜKSELTME / UPGRADE ===');
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-upg-'));
  run('setup.js', ['--company', 'Yükseltme Testi', '--admin-user', 'admin2', '--warehouse', 'D'],
    { ADMIN_PASSWORD: 'Yukselt2026!' }, d2);

  const upToDate = run('upgrade.js', ['--yes'], {}, d2);
  ok('güncel veritabanında yapacak bir şey yok diyor',
    upToDate.ok && /güncel/.test(upToDate.out), upToDate.out.slice(-150).replace(/\n/g, ' '));

  // Bekleyen migration varken deneme modu hiçbir şey değiştirmemeli
  const migDir = path.join(ROOT, 'server', 'migrations');
  const tempMigration = path.join(migDir, '900_test_upgrade.js');
  fs.writeFileSync(tempMigration, `module.exports = { name: 'test upgrade',
    up(db) { db.exec('CREATE TABLE upgrade_test_table (id INTEGER PRIMARY KEY, note TEXT)'); } };\n`);

  try {
    const dry = run('upgrade.js', ['--dry-run'], {}, d2);
    ok('deneme modu bekleyen migration\'ı listeliyor',
      dry.ok && /900_test_upgrade/.test(dry.out), dry.out.slice(-200).replace(/\n/g, ' '));
    ok('deneme modu değişiklik yapmadığını söylüyor', /deneme modu/.test(dry.out));
    const dbDry = openDb(d2);
    ok('deneme modu gerçekten hiçbir şey değiştirmedi',
      !dbDry.prepare("SELECT name FROM sqlite_master WHERE name='upgrade_test_table'").get());
    dbDry.close();

    const upg = run('upgrade.js', ['--yes'], {}, d2);
    ok('yükseltme tamamlandı', upg.ok, upg.out.slice(-200).replace(/\n/g, ' '));
    ok('yükseltme önce yedek alıyor', /Yedek alınıyor/.test(upg.out));
    ok('alınan yedek doğrulanıyor', /Yedek doğrulandı/.test(upg.out),
      'bozuk yedekle yükseltmeye başlamak, dönüş yolu olmadan ilerlemektir');
    ok('sonuç doğrulanıyor', /Sonuç doğrulanıyor/.test(upg.out));
    ok('geri dönüş komutu gösteriliyor', /npm run restore/.test(upg.out),
      'sorun sonradan fark edilebilir');

    const dbUp = openDb(d2);
    ok('migration uygulandı',
      !!dbUp.prepare("SELECT name FROM sqlite_master WHERE name='upgrade_test_table'").get());
    ok('migration kaydedildi',
      dbUp.prepare("SELECT COUNT(*) c FROM schema_migrations WHERE version='900'").get().c === 1);
    ok('veriler korundu',
      dbUp.prepare("SELECT COUNT(*) c FROM users WHERE username='admin2'").get().c === 1);
    dbUp.close();

    const backups = fs.readdirSync(path.join(d2, 'backups'));
    ok('yükseltme öncesi yedek etiketli saklandı',
      backups.some(f => /pre-upgrade/.test(f)), backups.join(', '));
  } finally {
    fs.unlinkSync(tempMigration);
  }

  console.log('\n=== BOZUK MIGRATION\'DA GERİ DÖNÜŞ / ROLLBACK ===');
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-roll-'));
  run('setup.js', ['--company', 'Geri Dönüş Testi', '--admin-user', 'admin3', '--warehouse', 'D'],
    { ADMIN_PASSWORD: 'GeriDonus2026!' }, d3);

  const dbBefore = openDb(d3);
  const companyBefore = dbBefore.prepare('SELECT name FROM companies WHERE id=1').get().name;
  const migrationsBefore = dbBefore.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c;
  dbBefore.close();

  // Kasıtlı olarak yarıda patlayan migration: önce bir tablo oluşturur, sonra hata verir.
  // Gerçek hayatta bu, son adımı tutmayan bir migration'dır ve en tehlikeli durumdur.
  const badMigration = path.join(migDir, '901_broken.js');
  fs.writeFileSync(badMigration, `module.exports = { name: 'broken migration',
    up(db) {
      db.exec('CREATE TABLE yarim_kalan (id INTEGER PRIMARY KEY)');
      throw new Error('Bu migration kasıtlı olarak başarısız');
    } };\n`);

  try {
    const broken = run('upgrade.js', ['--yes'], {}, d3);
    ok('bozuk migration yükseltmeyi durduruyor', !broken.ok,
      'başarısız bir yükseltme "başarılı" diyemez');
    ok('geri dönüş yapıldığı bildiriliyor', /geri dönülüyor/i.test(broken.out),
      broken.out.slice(-250).replace(/\n/g, ' '));
    ok('eski sürümle çalışmaya devam edilebileceği söyleniyor',
      /eski sürümle çalışmaya devam/.test(broken.out));

    const dbAfter = openDb(d3);
    ok('veritabanı yükseltme öncesi haline döndü',
      dbAfter.prepare('SELECT name FROM companies WHERE id=1').get().name === companyBefore);
    ok('yarım kalan tablo geride bırakılmadı',
      !dbAfter.prepare("SELECT name FROM sqlite_master WHERE name='yarim_kalan'").get(),
      'ne eski ne yeni şemada kalmak en kötü sonuçtur');
    ok('migration kaydı geri alındı',
      dbAfter.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c === migrationsBefore,
      `${dbAfter.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c} vs ${migrationsBefore}`);
    ok('bütünlük bozulmadı', dbAfter.pragma('integrity_check', { simple: true }) === 'ok');
    dbAfter.close();
  } finally {
    fs.unlinkSync(badMigration);
  }

  console.log('\n=== ÇALIŞAN SUNUCU KORUMASI / RUNNING SERVER GUARD ===');
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-wal-'));
  run('setup.js', ['--company', 'WAL Testi', '--admin-user', 'admin4', '--warehouse', 'D'],
    { ADMIN_PASSWORD: 'WalTest2026!' }, d4);
  // Dolu bir WAL dosyası, çalışan sunucunun işaretidir
  fs.writeFileSync(path.join(d4, 'depo-takip.sqlite-wal'), Buffer.alloc(4096, 1));
  const guarded = run('upgrade.js', ['--yes'], {}, d4);
  ok('sunucu çalışırken yükseltme engelleniyor',
    !guarded.ok && /Sunucu çalışıyor/.test(guarded.out),
    'çalışırken şema değiştirmek açık işlemleri bozar');
  ok('zorlama seçeneği açıkça sunuluyor', /--force/.test(guarded.out));

  [d1, d2, d3, d4].forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
