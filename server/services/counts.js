const db = require('../db');
const { AppError } = require('../lib/core');

/** Count line validation and atomic persistence. */
function saveCountLines(countId, lines) {
  return db.txImmediate(() => {
    const count = db.prepare('SELECT id,status FROM stock_counts WHERE id=?').get(countId);
    if (!count) throw new AppError('Sayım bulunamadı / Count not found', 404);
    if (!['open', 'counted'].includes(count.status)) throw new AppError('Sayım kapalı / Count is closed', 409);
    if (!Array.isArray(lines) || !lines.length) throw new AppError('Sayım satırı gerekli / Count lines required', 422);
    const ids = new Set();
    for (const line of lines) {
      if (!Number.isFinite(line.countedQty) || line.countedQty < 0 || !Number.isInteger(line.id)) {
        throw new AppError('Geçersiz sayım miktarı veya satırı / Invalid count quantity or line', 422);
      }
      if (ids.has(line.id)) throw new AppError('Tekrarlanan sayım satırı / Duplicate count line', 422);
      ids.add(line.id);
      if (!db.prepare('SELECT id FROM stock_count_lines WHERE id=? AND count_id=?').get(line.id, countId)) {
        throw new AppError('Satır bu sayıma ait değil / Line does not belong to count', 422);
      }
    }
    const update = db.prepare('UPDATE stock_count_lines SET counted_qty=?,difference=?-system_qty,reason=? WHERE id=? AND count_id=?');
    for (const line of lines) update.run(line.countedQty, line.countedQty, line.reason || null, line.id, countId);
    db.prepare("UPDATE stock_counts SET status='counted' WHERE id=?").run(countId);
  });
}

module.exports = { saveCountLines };
