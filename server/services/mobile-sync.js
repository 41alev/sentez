const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const { AppError } = require('../lib/core');
const { hasPermission } = require('../middleware/auth');
const stock = require('./stock');
const { saveCountLines } = require('./counts');

const base = { clientId: z.string().min(1).max(200) };
const schema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('move'), itemId: z.string().min(1), warehouseId: z.number().int().positive(),
    qty: z.number().positive(), lotNo: z.string().max(200).optional(), unitCost: z.number().min(0).default(0),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z.enum(['available', 'quarantine', 'blocked', 'rejected']).default('available'), note: z.string().max(5000).optional() }),
  z.object({ ...base, type: z.literal('transfer'), lotId: z.string().min(1), toWarehouseId: z.number().int().positive(),
    qty: z.number().positive(), note: z.string().max(5000).optional() }),
  z.object({ ...base, type: z.literal('count_line'), lineId: z.number().int().positive(), countedQty: z.number().min(0),
    countId: z.string().min(1).optional() })
]);

function executeMobileOperation(input, user) {
  if (!input || !['move', 'transfer', 'count_line'].includes(input.type)) throw new AppError('Bilinmeyen işlem tipi / Unknown operation type', 422);
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError('Geçersiz mobil işlem / Invalid mobile operation: ' + parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '), 422);
  const op = parsed.data;
  if (!hasPermission(user.role, op.type === 'count_line' ? 'count.write' : 'stock.write')) throw new AppError('Bu işlem için yetkiniz yok / Not authorized for this operation', 403);
  // The schema supplies a stable field order and excludes local queue metadata.
  const hash = crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
  return db.txImmediate(() => {
    const previous = db.prepare('SELECT request_hash,result_json FROM mobile_sync_results WHERE user_id=? AND client_id=?').get(user.id, op.clientId);
    if (previous) {
      if (previous.request_hash !== hash) throw new AppError('İşlem kimliği farklı içerikle kullanıldı / Operation ID payload conflict', 409);
      return JSON.parse(previous.result_json);
    }
    const result = { clientId: op.clientId, ok: true };
    if (op.type === 'move') {
      Object.assign(result, { id: stock.receiveLot({ itemId: op.itemId, warehouseId: op.warehouseId, qty: op.qty,
        lotNo: op.lotNo || null, serialNo: null, supplierId: null, unitCostBase: op.unitCost, expiryDate: op.expiryDate || null, status: op.status,
        sourceType: 'mobile', sourceId: op.clientId, note: op.note || 'El terminali', userId: user.id }) });
    } else if (op.type === 'transfer') {
      stock.transferLot({ lotId: op.lotId, targetWarehouseId: op.toWarehouseId, qty: op.qty, note: op.note || 'El terminali', userId: user.id });
    } else {
      const line = db.prepare('SELECT count_id FROM stock_count_lines WHERE id=?').get(op.lineId);
      if (!line) throw new AppError('Sayım satırı bulunamadı / Count line not found', 404);
      if (op.countId && op.countId !== line.count_id) throw new AppError('Sayım eşleşmiyor / Count mismatch', 422);
      saveCountLines(line.count_id, [{ id: op.lineId, countedQty: op.countedQty }]);
    }
    db.prepare('INSERT INTO mobile_sync_results(user_id,client_id,request_hash,result_json,created_at) VALUES (?,?,?,?,?)')
      .run(user.id, op.clientId, hash, JSON.stringify(result), Date.now());
    return result;
  });
}

module.exports = { executeMobileOperation };
