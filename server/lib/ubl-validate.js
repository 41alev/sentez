// @ts-nocheck
/**
 * UBL-TR XML'ini GİB'in KENDİ resmi XSD şemasına karşı doğrular.
 *
 * Şema dosyaları `server/lib/ubl-schema/` altında — GİB'in resmi e-Belge
 * portalından (https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/UBL-TR1.2.1_Paketi.zip)
 * indirilen UBL-TR 1.2.1 paketinin `xsdrt/` klasörü, aynı dizin yapısıyla
 * (maindoc/common) kopyalanmıştır. Bu, ubl.js'in KENDİ iç tutarlılık
 * kontrolünden (validateInvoiceInput) FARKLI bir katman: o alan bazlı iş
 * kurallarını kontrol eder, bu XML'in gerçekten GİB'in beklediği YAPIYA
 * (eleman sırası, zorunlu alanlar) uyduğunu kanıtlar.
 *
 * libxmljs2 native bir bağımlılıktır ve ikili dosyası .npmrc'deki
 * ignore-scripts=true yüzünden otomatik kurulmaz — bkz. package.json
 * "native:rebuild" script'i ve docs/KURULUM.md. Bu modül ikili eksikse
 * (npm run native:rebuild hiç çalıştırılmamışsa) ilk kullanımda net bir
 * hatayla durur, sessizce "doğrulama atlandı" demez.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.join(__dirname, 'ubl-schema', 'maindoc');

let libxmljs;
try { libxmljs = require('libxmljs2'); }
catch (e) {
  libxmljs = null;
}

const xsdCache = new Map();

function loadSchema(fileName) {
  if (xsdCache.has(fileName)) return xsdCache.get(fileName);
  const xsdPath = path.join(SCHEMA_DIR, fileName);
  const doc = libxmljs.parseXml(fs.readFileSync(xsdPath, 'utf8'), { baseUrl: xsdPath });
  xsdCache.set(fileName, doc);
  return doc;
}

const SCHEMA_BY_ROOT = {
  Invoice: 'UBL-Invoice-2.1.xsd',
  DespatchAdvice: 'UBL-DespatchAdvice-2.1.xsd'
};

/**
 * @param {string} xml
 * @returns {{ valid: boolean, errors: string[], skipped?: boolean, reason?: string }}
 */
function validateXml(xml) {
  if (!libxmljs) {
    return {
      valid: false, errors: [], skipped: true,
      reason: 'libxmljs2 ikili dosyası kurulu değil — sunucuda "npm run native:rebuild" çalıştırın (bkz. docs/KURULUM.md)'
    };
  }
  let doc;
  try { doc = libxmljs.parseXml(xml); }
  catch (e) { return { valid: false, errors: [`XML ayrıştırılamadı / XML parse error: ${e.message}`] }; }

  const rootName = doc.root().name();
  const schemaFile = SCHEMA_BY_ROOT[rootName];
  if (!schemaFile) return { valid: false, errors: [`Bilinmeyen kök eleman / Unknown root element: ${rootName}`] };

  const xsdDoc = loadSchema(schemaFile);
  const ok = doc.validate(xsdDoc);
  return {
    valid: ok,
    errors: ok ? [] : doc.validationErrors.map(e => `Satır ${e.line}: ${e.message.trim()}`)
  };
}

module.exports = { validateXml };
