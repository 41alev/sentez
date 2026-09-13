// @ts-nocheck
/**
 * Lisans doğrulama.
 *
 * Bugünkü satış modeli ömür boyu lisanstır — bu yüzden bu modül VARSAYILAN
 * OLARAK devre dışıdır: `LICENSE_FILE` ortam değişkeni tanımlanmadığı sürece
 * hiçbir kontrol yapılmaz, sunucu her zamanki gibi açılır. Aylık/yıllık
 * lisansa geçiş kararı alındığında yapılması gereken TEK şey: o müşteri için
 * `npm run license:generate` ile bir lisans dosyası üretmek ve müşterinin
 * `.env` dosyasına `LICENSE_FILE=data/license.json` satırını eklemek — kod
 * değişikliği gerekmez.
 *
 * İmza şeması: Ed25519 (Node'un yerleşik crypto modülü, ek bağımlılık yok).
 * Özel anahtar yalnızca satıcıda (bu depoyu işleten kişide) durur ve ASLA
 * git'e girmez (bkz. .gitignore: license-signing-key.pem). Buradaki genel
 * anahtar herkese açık olabilir — imzayı doğrulamaya yarar, üretmeye değil.
 */
const crypto = require('crypto');
const fs = require('fs');

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgu5ZolXI45HsqQJbiwi1KpC3MSVj3hedJNJ1rg3ryck=
-----END PUBLIC KEY-----
`;

/** payload alanlarının imza öncesi/sonrası hep aynı sırada serileşmesini garanti eder. */
function canonicalPayload(payload) {
  return JSON.stringify({
    licenseId: payload.licenseId,
    licensee: payload.licensee,
    product: payload.product,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt ?? null
  });
}

function sign(payload, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const data = Buffer.from(canonicalPayload(payload), 'utf8');
  const signature = crypto.sign(null, data, privateKey);
  return { payload, signature: signature.toString('base64') };
}

/**
 * @param {object} licenseFile - { payload, signature } — bkz. license-generate.js çıktısı
 * @returns {{ valid: true, license: object, expired: boolean, daysRemaining: number|null } | { valid: false, reason: string }}
 */
function verify(licenseFile) {
  if (!licenseFile || typeof licenseFile !== 'object' || !licenseFile.payload || !licenseFile.signature) {
    return { valid: false, reason: 'Lisans dosyası biçimi geçersiz / Malformed license file' };
  }
  let publicKey;
  try { publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM); }
  catch { return { valid: false, reason: 'Genel anahtar yüklenemedi / Could not load public key' }; }

  const data = Buffer.from(canonicalPayload(licenseFile.payload), 'utf8');
  let sigOk;
  try {
    sigOk = crypto.verify(null, data, publicKey, Buffer.from(licenseFile.signature, 'base64'));
  } catch { sigOk = false; }

  if (!sigOk) return { valid: false, reason: 'İmza doğrulanamadı — lisans dosyası tahrif edilmiş olabilir / Signature invalid' };

  const { expiresAt } = licenseFile.payload;
  if (expiresAt) {
    const expiryMs = new Date(expiresAt + 'T23:59:59').getTime();
    if (Number.isNaN(expiryMs)) return { valid: false, reason: `Geçersiz son kullanma tarihi / Invalid expiry date: ${expiresAt}` };
    const daysRemaining = Math.ceil((expiryMs - Date.now()) / 86400000);
    if (daysRemaining < 0) {
      return { valid: false, reason: `Lisans süresi doldu / License expired on ${expiresAt}`, expired: true, license: licenseFile.payload };
    }
    return { valid: true, license: licenseFile.payload, expired: false, daysRemaining };
  }
  return { valid: true, license: licenseFile.payload, expired: false, daysRemaining: null };
}

/**
 * Sunucu açılışında çağrılır. `LICENSE_FILE` tanımlı değilse hiçbir şey
 * yapmaz (bugünkü ömür boyu lisans modeli). Tanımlıysa dosya okunur ve
 * doğrulanır; geçersiz/süresi dolmuşsa sunucu KASITLI OLARAK açılmaz —
 * aynı projedeki "boş veritabanıyla açılmaz, kuruluma yönlendirir" deseniyle
 * tutarlı (bkz. docs/KURULUM.md).
 *
 * @returns {{ enforced: boolean, valid?: boolean, license?: object, daysRemaining?: number|null, reason?: string }}
 */
function checkOnStartup() {
  const filePath = process.env.LICENSE_FILE;
  if (!filePath) return { enforced: false };

  if (!fs.existsSync(filePath)) {
    console.error(`\n✗ LICENSE_FILE tanımlı ama dosya bulunamadı: ${filePath}`);
    console.error('  Bu değişkeni .env dosyasından kaldırın veya geçerli bir lisans dosyası sağlayın.\n');
    process.exit(1);
  }

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) {
    console.error(`\n✗ Lisans dosyası okunamadı: ${e.message}\n`);
    process.exit(1);
  }

  const result = verify(parsed);
  if (!result.valid) {
    console.error(`\n✗ Lisans geçersiz: ${result.reason}`);
    console.error('  Yeni bir lisans dosyası için satıcınızla iletişime geçin.\n');
    process.exit(1);
  }

  console.log(result.daysRemaining == null
    ? `✓ Lisans geçerli (süresiz) — ${result.license.licensee}`
    : `✓ Lisans geçerli (${result.daysRemaining} gün kaldı) — ${result.license.licensee}`);

  return { enforced: true, valid: true, license: result.license, daysRemaining: result.daysRemaining };
}

/** Admin panelindeki "Veri Sağlığı" ekranı için — sunucuyu yeniden başlatmadan durumu okur. */
function currentStatus() {
  const filePath = process.env.LICENSE_FILE;
  if (!filePath) return { enforced: false };
  if (!fs.existsSync(filePath)) return { enforced: true, valid: false, reason: 'Lisans dosyası bulunamadı' };
  try {
    const result = verify(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    return { enforced: true, ...result };
  } catch (e) {
    return { enforced: true, valid: false, reason: e.message };
  }
}

module.exports = { verify, sign, canonicalPayload, checkOnStartup, currentStatus, PUBLIC_KEY_PEM };
