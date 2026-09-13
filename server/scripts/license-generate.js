#!/usr/bin/env node
// @ts-nocheck
/**
 * Müşteri için lisans dosyası üretir. YALNIZCA SATICI (bu depoyu işleten kişi)
 * çalıştırır — özel anahtar müşteriye asla verilmez, yalnızca üretilen
 * lisans dosyası (imzalı, genel anahtarla doğrulanabilir) verilir.
 *
 * Özel anahtar `license-signing-key.pem` dosyasında (repo kökünde, .gitignore
 * ile korunuyor) veya LICENSE_PRIVATE_KEY ortam değişkeninde (PEM içeriği)
 * bulunur. İkisi de yoksa script yeni bir anahtar çifti üretip kaydeder —
 * bu durumda YENİ genel anahtarın server/lib/license.js içine elle
 * kopyalanması gerekir (script bunu hatırlatır).
 *
 * Kullanım:
 *   npm run license:generate -- --licensee "Örnek Metal A.Ş."
 *   npm run license:generate -- --licensee "Örnek Metal A.Ş." --expires 2027-12-31
 *   npm run license:generate -- --licensee "Örnek Metal A.Ş." --out musteri-lisans.json
 *
 * --expires verilmezse süresiz (ömür boyu) lisans üretilir — bugünkü
 * varsayılan satış modeli budur.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sign } = require('../lib/license');

const KEY_PATH = path.join(__dirname, '..', '..', 'license-signing-key.pem');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function loadOrCreatePrivateKey() {
  if (process.env.LICENSE_PRIVATE_KEY) return process.env.LICENSE_PRIVATE_KEY;
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH, 'utf8');

  console.log('⚠ Özel anahtar bulunamadı, yeni bir Ed25519 anahtar çifti üretiliyor…');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(KEY_PATH, privPem, { mode: 0o600 });
  console.log(`✓ Özel anahtar kaydedildi: ${KEY_PATH} (bu dosyayı YEDEKLEYİN ve ASLA paylaşmayın)`);
  console.log('\n⚠ ÖNEMLİ: server/lib/license.js içindeki PUBLIC_KEY_PEM sabitini');
  console.log('  aşağıdaki YENİ genel anahtarla değiştirin, yoksa üretilen lisanslar');
  console.log('  eski anahtarla doğrulanamaz:\n');
  console.log(pubPem);
  return privPem;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.licensee) {
    console.error('Kullanım: npm run license:generate -- --licensee "Firma Adı" [--expires YYYY-MM-DD] [--out dosya.json]');
    process.exit(1);
  }
  if (args.expires && !/^\d{4}-\d{2}-\d{2}$/.test(args.expires)) {
    console.error('✗ --expires biçimi YYYY-MM-DD olmalı');
    process.exit(1);
  }

  const privateKeyPem = loadOrCreatePrivateKey();
  const payload = {
    licenseId: `SNT-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    licensee: args.licensee,
    product: 'Sentez ERP',
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: args.expires || null
  };

  const licenseFile = sign(payload, privateKeyPem);
  const outPath = args.out || `lisans-${payload.licenseId}.json`;
  fs.writeFileSync(outPath, JSON.stringify(licenseFile, null, 2));

  console.log(`\n✓ Lisans üretildi: ${outPath}`);
  console.log(`  Lisans no:  ${payload.licenseId}`);
  console.log(`  Müşteri:    ${payload.licensee}`);
  console.log(`  Süre:       ${payload.expiresAt ? payload.expiresAt + ' tarihine kadar' : 'süresiz (ömür boyu)'}`);
  console.log('\nMüşteriye teslim:');
  console.log(`  1. ${path.basename(outPath)} dosyasını müşterinin sunucusuna kopyalayın (ör. data/license.json)`);
  console.log('  2. .env dosyasına şu satırı ekleyin: LICENSE_FILE=data/license.json');
  console.log('  3. Sunucuyu yeniden başlatın\n');
}

if (require.main === module) main();

module.exports = { parseArgs, loadOrCreatePrivateKey };
