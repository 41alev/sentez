// @ts-nocheck
/**
 * Lisans doğrulama testleri.
 *
 * Bugünkü satış modeli ömür boyu lisans — bu yüzden en kritik senaryo,
 * LICENSE_FILE tanımlanmadığında sistemin HİÇBİR ŞEKİLDE kısıtlanmadığının
 * kanıtlanmasıdır (bkz. "sunucu normal açılıyor" testi). Zaman sınırlı
 * lisansa geçiş kararı alınırsa devreye giren doğrulama/reddetme mantığı da
 * ayrıca test edilir.
 *
 * Test sabitleri gerçek özel anahtarla (bu depoda YOK, .gitignore'da) önceden
 * imzalanmış örnek lisanslardır — testler bir daha asla özel anahtara ihtiyaç
 * duymaz, yalnızca server/lib/license.js'teki GERÇEK genel anahtarla doğrular.
 *
 *   node test/license.js   (sunucu gerektirmez, kendi geçici süreçlerini açar)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { verify } = require('../server/lib/license');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const ROOT = path.join(__dirname, '..');

// Gerçek özel anahtarla imzalanmış, yalnızca test için sahte müşteri kayıtları.
const PERPETUAL = { payload: { licenseId: 'SNT-TEST-0001', licensee: 'Test Firma A.S.', product: 'Sentez ERP', issuedAt: '2026-01-01', expiresAt: null }, signature: 'j1yhzV1Df1TPbXJxlnM/h5fLe9sT0eu26MqYO8DAP/UkfUu1I+zXeOpeY4ns/G9Mj0ev+Lwk/kneFf+tRYseCQ==' };
const FUTURE = { payload: { licenseId: 'SNT-TEST-0002', licensee: 'Test Firma A.S.', product: 'Sentez ERP', issuedAt: '2026-01-01', expiresAt: '2099-12-31' }, signature: 'HDCoCZyYDmglgKkHoiwXKD/5FnZ+ZUy7RcAXqz3v3PvGdgk3Uekiy11Ysmr/xkIspNMz9v/QqwcSyPusLTTICQ==' };
const EXPIRED = { payload: { licenseId: 'SNT-TEST-0003', licensee: 'Test Firma A.S.', product: 'Sentez ERP', issuedAt: '2020-01-01', expiresAt: '2020-06-30' }, signature: 'xaxNboV1i2wViRxDzGG7dIf9NAa8nhODc9+kjsPQ/imGWe06OTGLmE/fXAtHlUadFfoYSKhiRTenfnH7x3NkDg==' };

console.log('=== İMZA DOĞRULAMA (birim) / SIGNATURE VERIFICATION (unit) ===');

const r1 = verify(PERPETUAL);
ok('süresiz lisans geçerli', r1.valid === true, JSON.stringify(r1));
ok('süresiz lisansta gün sayısı yok', r1.valid && r1.daysRemaining === null);

const r2 = verify(FUTURE);
ok('ileri tarihli lisans geçerli', r2.valid === true, JSON.stringify(r2));
ok('kalan gün doğru hesaplandı', r2.valid && r2.daysRemaining > 20000, String(r2.daysRemaining));

const r3 = verify(EXPIRED);
ok('süresi dolmuş lisans reddediliyor', r3.valid === false && r3.expired === true, JSON.stringify(r3));
ok('süresi dolma sebebi açıkça bildiriliyor', /süresi doldu|expired/i.test(r3.reason || ''), r3.reason);

const tampered = JSON.parse(JSON.stringify(PERPETUAL));
tampered.payload.licensee = 'Baska Bir Firma';
const r4 = verify(tampered);
ok('tahrif edilmiş içerik (imza uyuşmuyor) reddediliyor', r4.valid === false, JSON.stringify(r4));

const { privateKey: fakePriv } = crypto.generateKeyPairSync('ed25519');
const fakeSig = crypto.sign(null, Buffer.from(JSON.stringify({
  licenseId: PERPETUAL.payload.licenseId, licensee: PERPETUAL.payload.licensee, product: PERPETUAL.payload.product,
  issuedAt: PERPETUAL.payload.issuedAt, expiresAt: PERPETUAL.payload.expiresAt
}), 'utf8'), fakePriv);
const r5 = verify({ payload: PERPETUAL.payload, signature: fakeSig.toString('base64') });
ok('yanlış özel anahtarla imzalanan lisans reddediliyor (yalnızca gerçek genel anahtar kabul ediliyor)', r5.valid === false, JSON.stringify(r5));

ok('boş girdi biçim hatasıyla reddediliyor', verify(null).valid === false);
ok('imza alanı eksikse reddediliyor', verify({ payload: PERPETUAL.payload }).valid === false);

console.log('\n=== SUNUCU AÇILIŞI / SERVER STARTUP ===');

/** Migration+seed uygulanmış izole bir veri klasörü hazırlar. */
function prepareDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentez-license-'));
  const env = { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'depo-takip.sqlite'),
                BACKUP_DIR: path.join(dir, 'backups'), PORT: '0' };
  execFileSync('node', [path.join(ROOT, 'server', 'migrate.js')], { cwd: ROOT, env, encoding: 'utf8' });
  execFileSync('node', [path.join(ROOT, 'server', 'seed.js')], { cwd: ROOT, env, encoding: 'utf8' });
  return dir;
}

/**
 * Sunucuyu geçici bir portta başlatır. Başarıyla açılırsa health-check'in
 * geçtiği andaki süreci döner; açılış sırasında çökerse (lisans reddi gibi)
 * çıkış kodunu ve ekran çıktısını döner.
 */
function tryStartServer(dataDir, extraEnv = {}, port = 3900 + Math.floor(Math.random() * 500)) {
  return new Promise((resolve) => {
    const env = { ...process.env, DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'depo-takip.sqlite'),
                  BACKUP_DIR: path.join(dataDir, 'backups'), PORT: String(port), NODE_ENV: 'test', ...extraEnv };
    const proc = spawn('node', [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env });
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.stderr.on('data', d => output += d);

    let settled = false;
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      resolve({ crashed: true, code, output });
    });

    const deadline = Date.now() + 8000;
    const poll = () => {
      if (settled) return;
      fetch(`http://127.0.0.1:${port}/health`).then(r => {
        if (settled) return;
        if (r.ok) { settled = true; resolve({ crashed: false, proc, output }); }
        else if (Date.now() < deadline) setTimeout(poll, 200);
        else { settled = true; proc.kill(); resolve({ crashed: true, code: null, output: output + '\n(zaman aşımı)' }); }
      }).catch(() => {
        if (settled) return;
        if (Date.now() < deadline) setTimeout(poll, 200);
        else { settled = true; proc.kill(); resolve({ crashed: true, code: null, output: output + '\n(zaman aşımı)' }); }
      });
    };
    setTimeout(poll, 300);
  });
}

function writeLicense(dir, licenseFile) {
  const p = path.join(dir, 'license.json');
  fs.writeFileSync(p, JSON.stringify(licenseFile));
  return p;
}

(async () => {
  const dirNoLicense = prepareDataDir();
  const r6 = await tryStartServer(dirNoLicense);
  ok('LICENSE_FILE tanımsızken sunucu normal açılıyor (bugünkü varsayılan)', r6.crashed === false, r6.output.slice(-300));
  if (!r6.crashed) r6.proc.kill();

  const dirMissing = prepareDataDir();
  const r7 = await tryStartServer(dirMissing, { LICENSE_FILE: path.join(dirMissing, 'yok-boyle-bir-dosya.json') });
  ok('LICENSE_FILE tanımlı ama dosya yoksa sunucu açılmıyor', r7.crashed === true && r7.code === 1, `code=${r7.code}`);
  ok('hata mesajı dosyanın bulunamadığını söylüyor', /bulunamadı/i.test(r7.output), r7.output.slice(-300));

  const dirExpired = prepareDataDir();
  const expiredPath = writeLicense(dirExpired, EXPIRED);
  const r8 = await tryStartServer(dirExpired, { LICENSE_FILE: expiredPath });
  ok('süresi dolmuş lisansla sunucu açılmıyor', r8.crashed === true && r8.code === 1, `code=${r8.code}`);
  ok('hata mesajı süre dolduğunu söylüyor', /süresi doldu|expired/i.test(r8.output), r8.output.slice(-300));

  const dirPerp = prepareDataDir();
  const perpPath = writeLicense(dirPerp, PERPETUAL);
  const r9 = await tryStartServer(dirPerp, { LICENSE_FILE: perpPath });
  ok('geçerli süresiz lisansla sunucu normal açılıyor', r9.crashed === false, r9.output.slice(-300));
  if (!r9.crashed) r9.proc.kill();

  const dirFuture = prepareDataDir();
  const futurePath = writeLicense(dirFuture, FUTURE);
  const r10 = await tryStartServer(dirFuture, { LICENSE_FILE: futurePath });
  ok('geçerli ileri tarihli lisansla sunucu normal açılıyor', r10.crashed === false, r10.output.slice(-300));
  if (!r10.crashed) r10.proc.kill();

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
