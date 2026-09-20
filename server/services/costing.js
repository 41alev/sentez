const db = require('../db');
const { AppError } = require('../lib/core');

/**
 * Landed cost: freight, customs, insurance and handling are NOT overheads — they are
 * part of what the goods actually cost you. This spreads them across the lots created
 * by a receipt so an imported item's cost reflects reality, not just the invoice price.
 */
function applyLandedCosts(receiptId, userId) {
  return db.txImmediate(() => allocateLandedCosts(receiptId, userId));
}

function allocateLandedCosts(receiptId, _userId) {
  const receipt = db.prepare('SELECT * FROM po_receipts WHERE id = ?').get(receiptId);
  if (!receipt) throw new AppError('İrsaliye bulunamadı / Receipt not found', 404);

  if (db.prepare('SELECT id FROM landed_costs WHERE receipt_id=? AND requires_reconciliation=1 LIMIT 1').get(receiptId)) {
    throw new AppError('Önceki ek maliyetlerin mutabakatı gerekli / Historical landed costs require reconciliation', 409);
  }
  const costs = db.prepare('SELECT * FROM landed_costs WHERE receipt_id = ? AND applied_at IS NULL ORDER BY id').all(receiptId);
  if (costs.length === 0) return { allocated: 0, lines: 0 };

  const lines = db.prepare(`SELECT rl.*
    FROM po_receipt_lines rl
    WHERE rl.receipt_id = ? AND rl.lot_id IS NOT NULL`).all(receiptId);
  if (lines.length === 0) throw new AppError('Dağıtılabilir teslimat satırı yok / No receipt lines to allocate', 422);
  const families = new Map();
  for (const line of lines) {
    const lots = db.prepare(`WITH RECURSIVE family(id) AS (
      SELECT id FROM stock_lots WHERE id=? UNION
      SELECT sl.id FROM stock_lots sl JOIN family f ON sl.parent_lot_id=f.id
    ) SELECT sl.id,sl.qty FROM stock_lots sl JOIN family f ON sl.id=f.id WHERE sl.qty>0`).all(line.lot_id);
    if (line.base_unit_cost == null || Math.abs(lots.reduce((sum, l) => sum + l.qty, 0) - line.qty) > 1e-9) {
      throw new AppError('Tüketilmiş veya geçmiş maliyeti belirsiz teslimat için maliyet mutabakatı gerekli / Consumed or historical receipt requires cost reconciliation', 409);
    }
    families.set(line.id, lots);
  }

  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const totalValue = lines.reduce((s, l) => s + (l.qty || 0) * l.base_unit_cost, 0);

  let totalAllocated = 0;
  for (const cost of costs) {
    const amountBase = Number(cost.amount || 0) * Number(cost.fx_rate || 1);
    if (!Number.isFinite(amountBase) || amountBase < 0) throw new AppError('Geçersiz maliyet / Invalid cost', 422);
    for (const line of lines) {
      let share;
      if (cost.allocation_method === 'qty') {
        share = totalQty > 0 ? (line.qty / totalQty) * amountBase : 0;
      } else {
        const lineValue = (line.qty || 0) * line.base_unit_cost;
        share = totalValue > 0 ? (lineValue / totalValue) * amountBase : (amountBase / lines.length);
      }
      if (share <= 0 || !line.qty) continue;
      const perUnit = share / line.qty;
      for (const lot of families.get(line.id)) {
        db.prepare('UPDATE stock_lots SET unit_cost = unit_cost + ? WHERE id = ?').run(perUnit, lot.id);
        db.prepare('INSERT INTO landed_cost_allocations(cost_id,receipt_line_id,lot_id,qty,amount_base) VALUES(?,?,?,?,?)')
          .run(cost.id, line.id, lot.id, lot.qty, perUnit * lot.qty);
      }
      totalAllocated += share;
    }
    db.prepare('UPDATE landed_costs SET applied_at=? WHERE id=?').run(Date.now(), cost.id);
  }

  // Refresh moving-average cost for every affected item after allocation
  const itemIds = [...new Set(lines.map(l => l.item_id))];
  itemIds.forEach(recalcAverageFromLots);

  return { allocated: totalAllocated, lines: lines.length };
}

/** Recompute avg_cost as the true weighted average of on-hand lots. */
function recalcAverageFromLots(itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(qty*unit_cost),0) v
     FROM stock_lots WHERE item_id = ? AND status = 'available'`
  ).get(itemId);
  const avg = row.q > 0 ? row.v / row.q : 0;
  if (row.q > 0) db.prepare('UPDATE items SET avg_cost = ? WHERE id = ?').run(avg, itemId);
  return avg;
}

/**
 * Production cost = actual consumed material cost (from the real lots consumed)
 * + labour + overhead, divided by good output. Scrap is deliberately NOT divided
 * out: scrapped units still consumed material, so their cost is absorbed by the
 * good units — which is what makes scrap show up as a real cost.
 */
function computeProductionCost(productionOrderId) {
  const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(productionOrderId);
  if (!po) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);

  const materialCost = db.prepare(
    'SELECT COALESCE(SUM(qty * unit_cost),0) v FROM production_consumption WHERE production_order_id = ?'
  ).get(productionOrderId).v;

  const labor = Number(po.labor_cost || 0);
  const overhead = Number(po.overhead_cost || 0);
  const total = materialCost + labor + overhead;
  const goodQty = Number(po.produced_qty || po.qty || 0);
  const unitCost = goodQty > 0 ? total / goodQty : 0;

  db.prepare('UPDATE production_orders SET material_cost = ?, total_cost = ?, unit_cost = ? WHERE id = ?')
    .run(materialCost, total, unitCost, productionOrderId);

  return { materialCost, labor, overhead, total, unitCost, goodQty };
}

/** Cost of goods sold for a shipment line, taken from the actual lots shipped. */
function recordCOGS(shipmentId) {
  const rows = db.prepare('SELECT * FROM shipment_items WHERE shipment_id = ?').all(shipmentId);
  return rows.reduce((sum, r) => sum + (r.qty || 0) * (r.unit_cost || 0), 0);
}

/** Inventory ageing buckets — surfaces dead stock and tied-up capital. */
function inventoryAgeing() {
  const now = Date.now();
  const lots = db.prepare(
    `SELECT sl.*, i.name AS item_name, i.unit FROM stock_lots sl
     JOIN items i ON i.id = sl.item_id
     WHERE sl.status IN ('available','quarantine','blocked') AND sl.qty > 0`
  ).all();

  const buckets = { '0-30': 0, '31-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
  const detail = [];
  for (const lot of lots) {
    const days = Math.floor((now - (lot.received_at || now)) / 86400000);
    const value = lot.qty * lot.unit_cost;
    const bucket = days <= 30 ? '0-30' : days <= 90 ? '31-90' : days <= 180 ? '91-180' : days <= 365 ? '181-365' : '365+';
    buckets[bucket] += value;
    if (days > 180) {
      detail.push({ itemName: lot.item_name, lotNo: lot.lot_no, qty: lot.qty, unit: lot.unit, days, value });
    }
  }
  detail.sort((a, b) => b.value - a.value);
  return { buckets, deadStock: detail.slice(0, 50) };
}

/**
 * Stock turnover: cost of goods issued over the period divided by average inventory
 * value. Also returns days-of-inventory, which is the number owners actually ask for.
 */
function stockTurnover(days = 365) {
  const since = Date.now() - days * 86400000;
  const cogs = db.prepare(
    `SELECT COALESCE(SUM(ABS(qty) * COALESCE(unit_cost,0)),0) v FROM movements
     WHERE type = 'out' AND ts >= ?`
  ).get(since).v;
  const currentValue = db.prepare(
    `SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status IN ('available','quarantine','blocked')`
  ).get().v;
  const turnover = currentValue > 0 ? cogs / currentValue : 0;
  const daysOfInventory = turnover > 0 ? days / turnover : null;
  return { periodDays: days, cogsBase: cogs, inventoryValueBase: currentValue, turnover, daysOfInventory };
}

module.exports = {
  applyLandedCosts, recalcAverageFromLots, computeProductionCost,
  recordCOGS, inventoryAgeing, stockTurnover
};
