const db = require('../db');
const { AppError, uuid } = require('../lib/core');
const { today, addDays } = require('../lib/dates');

/**
 * All stock lives in `stock_lots`. Nothing outside this service should write to
 * stock_lots / movements / items.qty_cache directly, so that every quantity change
 * is guaranteed to leave a movement trail and keep the cache consistent.
 *
 * Every exported mutating function assumes it is already inside a transaction
 * (see db.txImmediate) — callers own the transaction boundary so that multi-step
 * operations like "consume 5 components + produce 1 output" are atomic.
 */

const ACTIVE_STATUSES = ['available', 'quarantine', 'blocked'];

function recalcItemQty(itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id = ? AND status = 'available'`
  ).get(itemId);
  db.prepare('UPDATE items SET qty_cache = ? WHERE id = ?').run(row.q, itemId);
  return row.q;
}

/**
 * @param {{
 *   itemId: number|string, itemName?: string, lotId?: string, lotNo?: string,
 *   warehouseId?: number|string, type: string, qty: number, unitCost?: number,
 *   fromStatus?: string, toStatus?: string, note?: string, refType?: string,
 *   refId?: number|string, userId?: number|string
 * }} movement
 */
function recordMovement({ itemId, itemName, lotId, lotNo, warehouseId, type, qty, unitCost, fromStatus, toStatus, note, refType, refId, userId }) {
  const id = uuid();
  db.prepare(`INSERT INTO movements
    (id,item_id,item_name,lot_id,lot_no,warehouse_id,type,qty,unit_cost,from_status,to_status,note,ref_type,ref_id,ts,user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, itemId, itemName || null, lotId || null, lotNo || null, warehouseId || null,
    type, qty, unitCost ?? null, fromStatus || null, toStatus || null,
    note || '', refType || null, refId || null, Date.now(), userId || null
  );
  return id;
}

/**
 * Moving-average cost update. Called on every inbound movement so `items.avg_cost`
 * always reflects what stock on hand actually cost, rather than a hand-typed number.
 */
function updateAverageCost(itemId, inboundQty, inboundUnitCostBase) {
  const item = db.prepare('SELECT avg_cost, qty_cache, costing_method FROM items WHERE id = ?').get(itemId);
  if (!item) return;
  if (item.costing_method === 'fifo') return; // FIFO valuation is derived from lot costs directly
  const currentQty = db.prepare(
    `SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id = ? AND status = 'available'`
  ).get(itemId).q;
  const priorQty = Math.max(0, currentQty - inboundQty);
  const totalValue = priorQty * (item.avg_cost || 0) + inboundQty * (inboundUnitCostBase || 0);
  const newQty = priorQty + inboundQty;
  const newAvg = newQty > 0 ? totalValue / newQty : (inboundUnitCostBase || 0);
  db.prepare('UPDATE items SET avg_cost = ? WHERE id = ?').run(newAvg, itemId);
}

/** Create (or top up) a lot and record the inbound movement. */
function receiveLot({ itemId, warehouseId, qty, lotNo, serialNo, expiryDate, unitCostBase, status = 'available',
                      sourceType, sourceId, supplierId, note, userId }) {
  if (!(qty > 0)) throw new AppError('Miktar sıfırdan büyük olmalı / Quantity must be positive');
  const item = db.prepare('SELECT id, name, unit, is_lot_tracked, shelf_life_days FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);

  let expiry = expiryDate || null;
  if (!expiry && item.shelf_life_days) {
    expiry = addDays(today(), item.shelf_life_days);
  }

  const lotId = uuid();
  db.prepare(`INSERT INTO stock_lots
    (id,item_id,warehouse_id,lot_no,serial_no,qty,status,expiry_date,unit_cost,received_at,source_type,source_id,supplier_id,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    lotId, itemId, warehouseId, lotNo || null, serialNo || null, qty, status, expiry,
    unitCostBase || 0, Date.now(), sourceType || null, sourceId || null, supplierId || null, note || null
  );

  recordMovement({
    itemId, itemName: item.name, lotId, lotNo, warehouseId, type: 'in', qty,
    unitCost: unitCostBase || 0, toStatus: status, note, refType: sourceType, refId: sourceId, userId
  });

  if (status === 'available') updateAverageCost(itemId, qty, unitCostBase || 0);
  recalcItemQty(itemId);
  return lotId;
}

/**
 * Pick lots to satisfy a quantity, FEFO (First Expired First Out), falling back to
 * FIFO by receipt date for lots with no expiry. Only 'available' lots are eligible —
 * quarantined or blocked stock can never be silently consumed.
 */
function pickLotsFEFO(itemId, qty, warehouseId = null) {
  const params = [itemId];
  let where = `item_id = ? AND status = 'available' AND qty > 0`;
  if (warehouseId) { where += ' AND warehouse_id = ?'; params.push(warehouseId); }
  const lots = db.prepare(
    `SELECT * FROM stock_lots WHERE ${where}
     ORDER BY (expiry_date IS NULL), expiry_date ASC, received_at ASC`
  ).all(...params);

  const picks = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.qty, remaining);
    picks.push({ lot, qty: take });
    remaining -= take;
  }
  return { picks, shortfall: remaining > 1e-9 ? remaining : 0 };
}

function availableQty(itemId, warehouseId = null) {
  const params = [itemId];
  let where = `item_id = ? AND status = 'available'`;
  if (warehouseId) { where += ' AND warehouse_id = ?'; params.push(warehouseId); }
  return db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE ${where}`).get(...params).q;
}

/** Consume stock using FEFO. Returns the lots actually consumed (for genealogy). */
function issueStock({ itemId, qty, warehouseId, refType, refId, note, userId, allowPartial = false }) {
  if (!Number.isFinite(qty) || qty <= 0) throw new AppError('Geçersiz miktar / Invalid quantity', 422);
  const item = db.prepare('SELECT id, name, unit FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);

  const { picks, shortfall } = pickLotsFEFO(itemId, qty, warehouseId);
  if (shortfall > 0 && !allowPartial) {
    throw new AppError('Yetersiz stok / Insufficient stock', 400, {
      shortfalls: [{ itemId, name: item.name, needed: qty, available: qty - shortfall, unit: item.unit }]
    });
  }

  const consumed = [];
  for (const p of picks) {
    const newQty = p.lot.qty - p.qty;
    db.prepare('UPDATE stock_lots SET qty = ?, status = CASE WHEN ? <= 0 THEN ? ELSE status END WHERE id = ?')
      .run(newQty, newQty, 'consumed', p.lot.id);
    recordMovement({
      itemId, itemName: item.name, lotId: p.lot.id, lotNo: p.lot.lot_no, warehouseId: p.lot.warehouse_id,
      type: 'out', qty: p.qty, unitCost: p.lot.unit_cost, fromStatus: 'available',
      note, refType, refId, userId
    });
    consumed.push({ lotId: p.lot.id, lotNo: p.lot.lot_no, qty: p.qty, unitCost: p.lot.unit_cost });
  }
  recalcItemQty(itemId);
  return consumed;
}

/** Move a lot (or part of it) between quality statuses: available <-> quarantine/blocked/rejected. */
function changeLotStatus({ lotId, toStatus, qty, note, userId, refType, refId }) {
  const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(lotId);
  if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
  if (!['available', 'quarantine', 'blocked', 'rejected'].includes(toStatus)) {
    throw new AppError('Geçersiz durum / Invalid status');
  }
  const moveQty = qty != null ? Number(qty) : lot.qty;
  if (moveQty <= 0 || moveQty > lot.qty + 1e-9) throw new AppError('Geçersiz miktar / Invalid quantity');

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(lot.item_id);

  let targetLotId = lotId;
  if (moveQty < lot.qty - 1e-9) {
    // Partial status change: split the lot so each part keeps its own status and history
    db.prepare('UPDATE stock_lots SET qty = qty - ? WHERE id = ?').run(moveQty, lot.id);
    targetLotId = uuid();
    db.prepare(`INSERT INTO stock_lots
      (id,item_id,warehouse_id,lot_no,serial_no,qty,status,expiry_date,unit_cost,received_at,source_type,source_id,supplier_id,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      targetLotId, lot.item_id, lot.warehouse_id, lot.lot_no, lot.serial_no, moveQty, toStatus,
      lot.expiry_date, lot.unit_cost, lot.received_at, lot.source_type, lot.source_id, lot.supplier_id, lot.notes
    );
    db.prepare('UPDATE stock_lots SET parent_lot_id=?,parent_qty=? WHERE id=?').run(lot.id, moveQty, targetLotId);
  } else {
    db.prepare('UPDATE stock_lots SET status = ? WHERE id = ?').run(toStatus, lot.id);
  }

  recordMovement({
    itemId: lot.item_id, itemName: item ? item.name : null, lotId: targetLotId, lotNo: lot.lot_no,
    warehouseId: lot.warehouse_id, type: 'status_change', qty: moveQty,
    unitCost: lot.unit_cost, fromStatus: lot.status, toStatus, note, refType, refId, userId
  });

  recalcItemQty(lot.item_id);
  return targetLotId;
}

/** Move quantity of a lot to another warehouse (keeps lot identity and cost). */
function transferLot({ lotId, targetWarehouseId, qty, note, userId }) {
  const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(lotId);
  if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
  if (Number(targetWarehouseId) === lot.warehouse_id) {
    throw new AppError('Hedef depo mevcut depo ile aynı olamaz / Target warehouse must differ');
  }
  const moveQty = qty != null ? Number(qty) : lot.qty;
  if (moveQty <= 0 || moveQty > lot.qty + 1e-9) throw new AppError('Geçersiz miktar / Invalid quantity');

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(lot.item_id);
  const fromWh = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(lot.warehouse_id);
  const toWh = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(targetWarehouseId);
  if (!toWh) throw new AppError('Hedef depo bulunamadı / Target warehouse not found', 404);

  let targetLotId;
  if (moveQty < lot.qty - 1e-9) {
    db.prepare('UPDATE stock_lots SET qty = qty - ? WHERE id = ?').run(moveQty, lot.id);
    targetLotId = uuid();
    db.prepare(`INSERT INTO stock_lots
      (id,item_id,warehouse_id,lot_no,serial_no,qty,status,expiry_date,unit_cost,received_at,source_type,source_id,supplier_id,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      targetLotId, lot.item_id, targetWarehouseId, lot.lot_no, lot.serial_no, moveQty, lot.status,
      lot.expiry_date, lot.unit_cost, lot.received_at, lot.source_type, lot.source_id, lot.supplier_id, lot.notes
    );
    db.prepare('UPDATE stock_lots SET parent_lot_id=?,parent_qty=? WHERE id=?').run(lot.id, moveQty, targetLotId);
  } else {
    db.prepare('UPDATE stock_lots SET warehouse_id = ? WHERE id = ?').run(targetWarehouseId, lot.id);
    targetLotId = lot.id;
  }

  recordMovement({
    itemId: lot.item_id, itemName: item ? item.name : null, lotId: targetLotId, lotNo: lot.lot_no,
    warehouseId: targetWarehouseId, type: 'transfer', qty: moveQty, unitCost: lot.unit_cost,
    note: note || `${fromWh ? fromWh.name : '—'} → ${toWh.name}`, refType: 'transfer', userId
  });

  recalcItemQty(lot.item_id);
  return targetLotId;
}

/** Manual adjustment (used by physical counts and corrections). */
function adjustLot({ lotId, newQty, reason, userId, refType, refId }) {
  const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(lotId);
  if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
  const delta = Number(newQty) - lot.qty;
  if (Math.abs(delta) < 1e-9) return 0;
  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(lot.item_id);

  db.prepare('UPDATE stock_lots SET qty = ?, status = CASE WHEN ? <= 0 THEN ? ELSE status END WHERE id = ?')
    .run(Number(newQty), Number(newQty), 'consumed', lot.id);

  recordMovement({
    itemId: lot.item_id, itemName: item ? item.name : null, lotId: lot.id, lotNo: lot.lot_no,
    warehouseId: lot.warehouse_id, type: 'adjust', qty: delta, unitCost: lot.unit_cost,
    note: reason, refType: refType || 'adjustment', refId, userId
  });

  recalcItemQty(lot.item_id);
  return delta;
}

/**
 * Pick lots for a quantity WITHOUT consuming them yet, so a caller can combine the
 * result with an explicitly chosen lot before committing everything through
 * consume() in one pass (see sales.js shipment creation: per line, either an
 * explicit lot or an allocate() pick, always finished off by the same consume()).
 * Only FEFO is implemented (see pickLotsFEFO) — the strategy argument is accepted
 * for call-site clarity but not otherwise used.
 */
function allocate(itemId, qty, warehouseId = null, strategy = 'FEFO') {
  const item = db.prepare('SELECT id, name, unit FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);
  const { picks, shortfall } = pickLotsFEFO(itemId, qty, warehouseId);
  if (shortfall > 0) {
    throw new AppError('Yetersiz stok / Insufficient stock', 400, {
      shortfall: { name: item.name, needed: qty, available: qty - shortfall, unit: item.unit }
    });
  }
  return picks.map(p => ({ lotId: p.lot.id, lotNo: p.lot.lot_no, qty: p.qty, unitCost: p.lot.unit_cost }));
}

/** Consume lots already picked by allocate() or chosen explicitly by the caller. */
function consume(picks, { itemId, itemName, note, refType, refId, userId, warehouseId = null, allowedStatuses = ['available'] }) {
  return db.txImmediate(() => {
  for (const p of picks) {
    const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(p.lotId);
    if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
    if (lot.item_id !== itemId) throw new AppError('Ürün ile lot eşleşmiyor / Lot does not belong to item', 422);
    if (warehouseId != null && Number(warehouseId) !== lot.warehouse_id) throw new AppError('Lot seçilen depoda değil / Lot warehouse mismatch', 422);
    if (!allowedStatuses.includes(lot.status)) throw new AppError('Lot bu işlem için uygun değil / Lot status is not eligible', 409);
    if (!Number.isFinite(p.qty) || p.qty <= 0 || p.qty > lot.qty + 1e-9) throw new AppError('Geçersiz veya yetersiz miktar / Invalid or insufficient quantity', 422);
    const newQty = lot.qty - p.qty;
    db.prepare('UPDATE stock_lots SET qty = ?, status = CASE WHEN ? <= 0 THEN ? ELSE status END WHERE id = ?')
      .run(newQty, newQty, 'consumed', lot.id);
    recordMovement({
      itemId, itemName, lotId: lot.id, lotNo: lot.lot_no, warehouseId: lot.warehouse_id,
      type: 'out', qty: p.qty, unitCost: lot.unit_cost,
      fromStatus: lot.status, note, refType, refId, userId
    });
  }
  recalcItemQty(itemId);
  });
}

/** Total stock value at lot cost — the number you can actually give to accounting. */
function stockValueBase(warehouseId = null) {
  const params = [];
  let where = `status IN ('available','quarantine','blocked')`;
  if (warehouseId) { where += ' AND warehouse_id = ?'; params.push(warehouseId); }
  return db.prepare(`SELECT COALESCE(SUM(qty * unit_cost),0) v FROM stock_lots WHERE ${where}`).get(...params).v;
}

module.exports = {
  ACTIVE_STATUSES, recalcItemQty, recordMovement, updateAverageCost,
  receiveLot, pickLotsFEFO, availableQty, issueStock, allocate, consume,
  changeLotStatus, transferLot, adjustLot, stockValueBase
};
