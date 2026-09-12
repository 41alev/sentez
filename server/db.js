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
 */
function tx(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}

/**
 * IMMEDIATE transaction: takes the write lock straight away. Use for operations
 * that read-then-write stock (production completion, receiving, shipping) so two
 * concurrent requests cannot both read the same "available" quantity.
 */
function txImmediate(fn) {
  const wrapped = db.transaction(fn);
  return wrapped.immediate();
}

module.exports = db;
module.exports.tx = tx;
module.exports.txImmediate = txImmediate;
module.exports.dbPath = dbPath;
module.exports.dataDir = dataDir;
