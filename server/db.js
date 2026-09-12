const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Run a function inside a transaction. Any thrown error rolls everything back,
 * so multi-step stock operations can never be left half-applied.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function tx(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}

/**
 * IMMEDIATE transaction: takes the write lock straight away. Use for operations
 * that read-then-write stock (production completion, receiving, shipping) so two
 * concurrent requests cannot both read the same "available" quantity.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function txImmediate(fn) {
  const wrapped = db.transaction(fn);
  return wrapped.immediate();
}

// Tek bir `module.exports = db` + ardından ayrı `module.exports.x = ...`
// satırları yerine tek seferde birleştiriyoruz: TypeScript'in checkJs modu
// bir dosyada hem "module.exports = ifade" hem ardışık "module.exports.x = y"
// gördüğünde bunları çakışan iki ayrı export bildirimi sanıyor (TS2309).
// `Object.assign` aynı referansı (db) mutasyona uğratıp döndürdüğü için
// çalışma zamanı davranışı birebir aynı kalır; tip çıkarımı ise
// `Database & { tx, txImmediate, dbPath, dataDir }` kesişimini doğru verir.
/**
 * Paylaşılan better-sqlite3 bağlantısı, bu projenin transaction
 * yardımcıları ve çözümlenmiş yollarla genişletilmiş hali. Veritabanına
 * dokunan her modül bu tek örneği import eder — üzerine kurulan
 * fonksiyonlar için `server/lib/core.js` ve `server/services/*.js`'e bakın.
 */
const appDb = Object.assign(db, { tx, txImmediate, dbPath, dataDir });

module.exports = appDb;
