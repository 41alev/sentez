const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { toBase } = require('../lib/core');

const router = express.Router();
router.use(requireAuth);

const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
function daysAgoStr(n) { return new Date(Date.now() - n * DAY).toISOString().slice(0, 10); }

/* ---------- helper: stock value at lot cost (already in base currency) ---------- */
function stockValueBase(where = '', params = []) {
  return db.prepare(`SELECT COALESCE(SUM(sl.qty * sl.unit_cost),0) v FROM stock_lots sl
    WHERE sl.status = 'available' ${where}`).get(...params).v;
}

/* ============================ DASHBOARD SUMMARY ============================ */
router.get('/summary', (req, res) => {
  const totalValue = stockValueBase();
  const quarantineValue = db.prepare("SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status='quarantine'").get().v;
  const blockedValue = db.prepare("SELECT COALESCE(SUM(qty*unit_cost),0) v FROM stock_lots WHERE status IN ('blocked','rejected')").get().v;

  const items = db.prepare(`SELECT i.id, i.name, i.unit, i.min_stock, i.qty_cache, i.category, i.origin,
    w.name AS warehouse FROM items i LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
    WHERE i.is_active = 1 AND i.deleted_at IS NULL`).all();

  const lowStock = items.filter(i => i.qty_cache <= i.min_stock);
  const outOfStock = items.filter(i => i.qty_cache <= 0);

  const warnDays = Number(db.prepare("SELECT value FROM settings WHERE key='expiryWarningDays'").get()?.value || 30);
  const expiring = db.prepare(`SELECT sl.*, i.name AS item_name, i.unit FROM stock_lots sl JOIN items i ON i.id = sl.item_id
    WHERE sl.status IN ('available','quarantine') AND sl.qty > 0 AND sl.expiry_date IS NOT NULL AND sl.expiry_date <= ?
    ORDER BY sl.expiry_date`).all(new Date(Date.now() + warnDays * DAY).toISOString().slice(0, 10));

  const pendingPO = db.prepare(`SELECT COALESCE(SUM((pi.qty - pi.received_qty) * pi.price * po.fx_rate),0) v
    FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
    WHERE po.status IN ('approved','partially_received')`).get().v;

  const overduePO = db.prepare(`SELECT COUNT(*) c FROM purchase_orders
    WHERE status IN ('approved','partially_received') AND expected IS NOT NULL AND expected < ?`).get(todayStr()).c;

  const openNCRs = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE status IN ('open','in_progress')").get().c;
  const pendingInspections = db.prepare("SELECT COUNT(*) c FROM inspections WHERE result = 'pending'").get().c;
  const openProduction = db.prepare("SELECT COUNT(*) c FROM production_orders WHERE status IN ('Planlandı','Devam Ediyor')").get().c;
  const pendingApprovals = db.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE approval_status = 'pending'").get().c;
  const calibrationDue = db.prepare(`SELECT COUNT(*) c FROM equipment
    WHERE status='active' AND next_calibration_date IS NOT NULL AND next_calibration_date <= ?`).get(new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)).c;

  const categoryValue = db.prepare(`SELECT COALESCE(i.category,'Genel') category, SUM(sl.qty * sl.unit_cost) value
    FROM stock_lots sl JOIN items i ON i.id = sl.item_id WHERE sl.status='available'
    GROUP BY i.category ORDER BY value DESC`).all();

  const originBreakdown = {
    domestic: items.filter(i => i.origin !== 'Yurt Dışı').length,
    intl: items.filter(i => i.origin === 'Yurt Dışı').length
  };

  const statusBreakdown = db.prepare(`SELECT status, COALESCE(SUM(qty*unit_cost),0) value, COUNT(*) lots
    FROM stock_lots WHERE qty > 0 GROUP BY status`).all();

  res.json({
    totalValueTRY: Math.round(totalValue),
    quarantineValueTRY: Math.round(quarantineValue),
    blockedValueTRY: Math.round(blockedValue),
    itemCount: items.length,
    lowStockCount: lowStock.length,
    outOfStockCount: outOfStock.length,
    expiringCount: expiring.length,
    pendingPOTotalTRY: Math.round(pendingPO),
    overduePOCount: overduePO,
    openNCRCount: openNCRs,
    pendingInspectionCount: pendingInspections,
    openProductionCount: openProduction,
    pendingApprovalCount: pendingApprovals,
    calibrationDueCount: calibrationDue,
    intlProductCount: originBreakdown.intl,
    categoryValue: categoryValue.map(c => ({ category: c.category, value: Math.round(c.value) })),
    originBreakdown,
    statusBreakdown,
    lowStockList: lowStock.slice(0, 50).map(i => ({ id: i.id, name: i.name, warehouse: i.warehouse, qty: i.qty_cache, unit: i.unit, minStock: i.min_stock })),
    expiringList: expiring.slice(0, 50).map(l => ({
      lotId: l.id, itemName: l.item_name, lotNo: l.lot_no, qty: l.qty, unit: l.unit,
      expiryDate: l.expiry_date, daysLeft: Math.floor((new Date(l.expiry_date) - Date.now()) / DAY), status: l.status
    }))
  });
});

/* ============================ TRENDS ============================ */
/**
 * Monthly movement of stock value in/out, so the owner sees direction over time
 * rather than only a "right now" snapshot.
 */
router.get('/trends', (req, res) => {
  const months = Math.min(36, Number(req.query.months) || 12);
  const since = Date.now() - months * 30 * DAY;

  const rows = db.prepare(`SELECT
      strftime('%Y-%m', ts/1000, 'unixepoch') AS period,
      type,
      SUM(qty * COALESCE(unit_cost,0)) AS value,
      SUM(qty) AS qty
    FROM movements WHERE ts >= ? AND type IN ('in','out')
    GROUP BY period, type ORDER BY period`).all(since);

  const periods = [...new Set(rows.map(r => r.period))].sort();
  const inflow = periods.map(p => Math.round(rows.find(r => r.period === p && r.type === 'in')?.value || 0));
  const outflow = periods.map(p => Math.round(rows.find(r => r.period === p && r.type === 'out')?.value || 0));

  const production = db.prepare(`SELECT strftime('%Y-%m', completed_at/1000, 'unixepoch') AS period,
    SUM(produced_qty) qty, SUM(total_cost) cost, SUM(scrap_qty) scrap
    FROM production_orders WHERE status='Tamamlandı' AND completed_at >= ?
    GROUP BY period ORDER BY period`).all(since);

  const sales = db.prepare(`SELECT substr(so.date,1,7) AS period,
      SUM(sol.shipped_qty * sol.price * so.fx_rate) revenue, SUM(sol.cogs_base) cost
    FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.so_id
    WHERE sol.shipped_qty > 0 GROUP BY period ORDER BY period`).all();

  res.json({
    periods,
    stockInValue: inflow,
    stockOutValue: outflow,
    production: production.map(p => ({ period: p.period, qty: p.qty, cost: Math.round(p.cost || 0), scrap: p.scrap })),
    sales: sales.map(s => ({
      period: s.period, revenue: Math.round(s.revenue || 0), cost: Math.round(s.cost || 0),
      profit: Math.round((s.revenue || 0) - (s.cost || 0))
    }))
  });
});

/* ============================ DEAD STOCK / AGING ============================ */
router.get('/dead-stock', (req, res) => {
  const days = Number(req.query.days) || 180;
  const cutoff = Date.now() - days * DAY;

  const rows = db.prepare(`SELECT sl.id AS lot_id, sl.lot_no, sl.qty, sl.unit_cost, sl.received_at, sl.expiry_date,
      i.id AS item_id, i.name AS item_name, i.unit, i.category, w.name AS warehouse,
      (SELECT MAX(ts) FROM movements m WHERE m.item_id = i.id AND m.type = 'out') AS last_out
    FROM stock_lots sl JOIN items i ON i.id = sl.item_id
    LEFT JOIN warehouses w ON w.id = sl.warehouse_id
    WHERE sl.status = 'available' AND sl.qty > 0`).all();

  const dead = rows.filter(r => !r.last_out || r.last_out < cutoff).map(r => ({
    lotId: r.lot_id, itemId: r.item_id, itemName: r.item_name, lotNo: r.lot_no, category: r.category,
    warehouse: r.warehouse, qty: r.qty, unit: r.unit, valueBase: Math.round(r.qty * r.unit_cost),
    ageDays: r.received_at ? Math.floor((Date.now() - r.received_at) / DAY) : null,
    daysSinceLastOut: r.last_out ? Math.floor((Date.now() - r.last_out) / DAY) : null,
    expiryDate: r.expiry_date
  })).sort((a, b) => b.valueBase - a.valueBase);

  // Age buckets across all available stock, for a quick "how old is my money" view
  const buckets = { '0-30': 0, '31-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
  rows.forEach(r => {
    const age = r.received_at ? Math.floor((Date.now() - r.received_at) / DAY) : 0;
    const v = r.qty * r.unit_cost;
    if (age <= 30) buckets['0-30'] += v;
    else if (age <= 90) buckets['31-90'] += v;
    else if (age <= 180) buckets['91-180'] += v;
    else if (age <= 365) buckets['181-365'] += v;
    else buckets['365+'] += v;
  });

  res.json({
    thresholdDays: days,
    deadStockValueBase: Math.round(dead.reduce((s, d) => s + d.valueBase, 0)),
    items: dead.slice(0, 200),
    ageBuckets: Object.entries(buckets).map(([bucket, value]) => ({ bucket, value: Math.round(value) }))
  });
});

/* ============================ TURNOVER & DAYS ON HAND ============================ */
router.get('/turnover', (req, res) => {
  const days = Number(req.query.days) || 365;
  const since = Date.now() - days * DAY;

  const rows = db.prepare(`SELECT i.id, i.name, i.unit, i.category, i.qty_cache, i.avg_cost,
      COALESCE((SELECT SUM(m.qty) FROM movements m WHERE m.item_id = i.id AND m.type='out' AND m.ts >= ?),0) AS consumed
    FROM items i WHERE i.is_active = 1 AND i.deleted_at IS NULL`).all(since);

  const data = rows.map(r => {
    const avgInventory = r.qty_cache; // simple proxy: current on-hand
    const turnover = avgInventory > 0 ? r.consumed / avgInventory : 0;
    const dailyUse = r.consumed / days;
    const daysOnHand = dailyUse > 0 ? r.qty_cache / dailyUse : null;
    return {
      itemId: r.id, name: r.name, category: r.category, unit: r.unit,
      onHand: r.qty_cache, consumed: r.consumed,
      turnoverRatio: Number(turnover.toFixed(2)),
      daysOnHand: daysOnHand === null ? null : Math.round(daysOnHand),
      valueBase: Math.round(r.qty_cache * r.avg_cost)
    };
  }).sort((a, b) => (b.valueBase - a.valueBase));

  res.json({ periodDays: days, data });
});

/* ============================ ABC ANALYSIS ============================ */
router.get('/abc', (req, res) => {
  const days = Number(req.query.days) || 365;
  const since = Date.now() - days * DAY;
  const rows = db.prepare(`SELECT i.id, i.name, i.category, i.avg_cost,
      COALESCE((SELECT SUM(m.qty) FROM movements m WHERE m.item_id=i.id AND m.type='out' AND m.ts>=?),0) consumed
    FROM items i WHERE i.is_active=1 AND i.deleted_at IS NULL`).all(since);

  const scored = rows.map(r => ({ itemId: r.id, name: r.name, category: r.category, annualValue: r.consumed * r.avg_cost }))
    .filter(r => r.annualValue > 0).sort((a, b) => b.annualValue - a.annualValue);

  const total = scored.reduce((s, r) => s + r.annualValue, 0);
  let cum = 0;
  const data = scored.map(r => {
    cum += r.annualValue;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    return {
      ...r, annualValue: Math.round(r.annualValue),
      cumulativePct: Number(cumPct.toFixed(1)),
      abcClass: cumPct <= 80 ? 'A' : (cumPct <= 95 ? 'B' : 'C')
    };
  });
  res.json({ periodDays: days, totalValueBase: Math.round(total), data });
});

/* ============================ REORDER SUGGESTIONS ============================ */
/**
 * Reorder point = average daily usage × supplier lead time (+ safety = min_stock).
 * Already-ordered quantities are netted off so we do not double-order.
 */
router.get('/reorder-suggestions', (req, res) => {
  const lookbackDays = Number(req.query.days) || 90;
  const since = Date.now() - lookbackDays * DAY;

  const rows = db.prepare(`SELECT i.id, i.name, i.unit, i.qty_cache, i.min_stock, i.reorder_qty, i.avg_cost,
      i.default_supplier_id, s.name AS supplier_name, s.lead_time_days,
      COALESCE((SELECT SUM(m.qty) FROM movements m WHERE m.item_id=i.id AND m.type='out' AND m.ts>=?),0) consumed,
      COALESCE((SELECT SUM(pi.qty - pi.received_qty) FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id
                WHERE pi.item_id = i.id AND po.status IN ('approved','partially_received')),0) on_order
    FROM items i LEFT JOIN suppliers s ON s.id = i.default_supplier_id
    WHERE i.is_active=1 AND i.deleted_at IS NULL`).all(since);

  const suggestions = rows.map(r => {
    const dailyUse = r.consumed / lookbackDays;
    const leadTime = r.lead_time_days || 7;
    const reorderPoint = dailyUse * leadTime + r.min_stock;
    const projected = r.qty_cache + r.on_order;
    const shortfall = reorderPoint - projected;
    if (shortfall <= 0) return null;
    const suggestedQty = Math.max(r.reorder_qty || 0, Math.ceil(shortfall + dailyUse * leadTime));
    return {
      itemId: r.id, name: r.name, unit: r.unit, onHand: r.qty_cache, onOrder: r.on_order,
      dailyUse: Number(dailyUse.toFixed(3)), leadTimeDays: leadTime,
      reorderPoint: Math.ceil(reorderPoint), suggestedQty,
      estimatedCostBase: Math.round(suggestedQty * r.avg_cost),
      supplierId: r.default_supplier_id, supplierName: r.supplier_name,
      daysUntilStockout: dailyUse > 0 ? Math.floor(r.qty_cache / dailyUse) : null
    };
  }).filter(Boolean).sort((a, b) => (a.daysUntilStockout ?? 9999) - (b.daysUntilStockout ?? 9999));

  res.json({ lookbackDays, count: suggestions.length, suggestions });
});

/* ============================ SUPPLIER PERFORMANCE ============================ */
router.get('/supplier-performance', (req, res) => {
  const suppliers = db.prepare('SELECT id, name, lead_time_days FROM suppliers WHERE is_active = 1').all();

  const data = suppliers.map(s => {
    const orders = db.prepare(`SELECT po.id, po.expected, po.total_base,
        (SELECT MAX(received_at) FROM po_receipts r WHERE r.po_id = po.id) last_receipt
      FROM purchase_orders po WHERE po.supplier_id = ? AND po.status IN ('received','partially_received','closed')`).all(s.id);

    let onTime = 0, late = 0, totalDelayDays = 0;
    orders.forEach(o => {
      if (!o.expected || !o.last_receipt) return;
      const expected = new Date(o.expected).getTime();
      if (o.last_receipt <= expected + DAY) onTime++;
      else { late++; totalDelayDays += Math.round((o.last_receipt - expected) / DAY); }
    });

    const spend = db.prepare(`SELECT COALESCE(SUM(total_base),0) v FROM purchase_orders
      WHERE supplier_id = ? AND status IN ('approved','partially_received','received','closed')`).get(s.id).v;

    const qty = db.prepare(`SELECT COALESCE(SUM(rl.qty),0) q FROM po_receipt_lines rl
      JOIN po_receipts r ON r.id = rl.receipt_id JOIN purchase_orders po ON po.id = r.po_id
      WHERE po.supplier_id = ?`).get(s.id).q;

    const rejected = db.prepare(`SELECT COALESCE(SUM(rejected_qty),0) q FROM inspections WHERE supplier_id = ?`).get(s.id).q;
    const ncrCount = db.prepare('SELECT COUNT(*) c FROM ncrs WHERE supplier_id = ?').get(s.id).c;

    const deliveries = onTime + late;
    const onTimePct = deliveries > 0 ? (onTime / deliveries) * 100 : null;
    const rejectPct = qty > 0 ? (rejected / qty) * 100 : 0;

    // Composite score: delivery reliability and quality weighted equally
    const score = deliveries > 0 || qty > 0
      ? Math.round(((onTimePct ?? 100) * 0.5) + ((100 - rejectPct) * 0.5))
      : null;

    return {
      supplierId: s.id, name: s.name, deliveries, onTime, late,
      onTimePct: onTimePct === null ? null : Number(onTimePct.toFixed(1)),
      avgDelayDays: late > 0 ? Number((totalDelayDays / late).toFixed(1)) : 0,
      totalSpendBase: Math.round(spend), receivedQty: qty, rejectedQty: rejected,
      rejectPct: Number(rejectPct.toFixed(2)), ncrCount, score
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  res.json({ data });
});

/* ============================ PRICE HISTORY ============================ */
router.get('/price-history/:itemId', (req, res) => {
  const rows = db.prepare(`SELECT ph.*, s.name AS supplier_name FROM supplier_price_history ph
    LEFT JOIN suppliers s ON s.id = ph.supplier_id
    WHERE ph.item_id = ? ORDER BY ph.recorded_at DESC LIMIT 200`).all(req.params.itemId);
  res.json(rows.map(r => ({
    supplierId: r.supplier_id, supplierName: r.supplier_name, price: r.price, currency: r.currency,
    priceBase: toBase(r.price, r.currency, new Date(r.recorded_at).toISOString().slice(0, 10)),
    source: r.source, sourceId: r.source_id, recordedAt: r.recorded_at
  })));
});

/* ============================ QUALITY KPIs ============================ */
router.get('/quality-kpis', (req, res) => {
  const days = Number(req.query.days) || 365;
  const since = Date.now() - days * DAY;

  const insp = db.prepare(`SELECT result, COUNT(*) c, COALESCE(SUM(accepted_qty),0) acc, COALESCE(SUM(rejected_qty),0) rej
    FROM inspections WHERE created_at >= ? GROUP BY result`).all(since);
  const totalInspected = insp.reduce((s, r) => s + r.acc + r.rej, 0);
  const totalRejected = insp.reduce((s, r) => s + r.rej, 0);

  const ncrBySeverity = db.prepare('SELECT severity, COUNT(*) c FROM ncrs WHERE opened_at >= ? GROUP BY severity').all(since);
  const ncrBySource = db.prepare('SELECT source, COUNT(*) c FROM ncrs WHERE opened_at >= ? GROUP BY source').all(since);
  const openCapas = db.prepare("SELECT COUNT(*) c FROM capas WHERE status != 'closed'").get().c;
  const overdueCapas = db.prepare(`SELECT COUNT(*) c FROM capas WHERE status != 'closed' AND due_date IS NOT NULL AND due_date < ?`).get(todayStr()).c;

  const prod = db.prepare(`SELECT COALESCE(SUM(produced_qty),0) produced, COALESCE(SUM(scrap_qty),0) scrap,
    COALESCE(SUM(rework_qty),0) rework FROM production_orders WHERE status='Tamamlandı' AND completed_at >= ?`).get(since);
  const totalOut = prod.produced + prod.scrap;

  res.json({
    periodDays: days,
    inspectionsByResult: insp.map(r => ({ result: r.result, count: r.c })),
    incomingRejectPct: totalInspected > 0 ? Number(((totalRejected / totalInspected) * 100).toFixed(2)) : 0,
    ncrBySeverity, ncrBySource,
    openCapaCount: openCapas, overdueCapaCount: overdueCapas,
    production: {
      producedQty: prod.produced, scrapQty: prod.scrap, reworkQty: prod.rework,
      scrapPct: totalOut > 0 ? Number(((prod.scrap / totalOut) * 100).toFixed(2)) : 0,
      yieldPct: totalOut > 0 ? Number(((prod.produced / totalOut) * 100).toFixed(2)) : 100
    }
  });
});

/* ============================ PRODUCTION COST ANALYSIS ============================ */
router.get('/production-costs', (req, res) => {
  const rows = db.prepare(`SELECT po.*, i.unit FROM production_orders po LEFT JOIN items i ON i.id = po.item_id
    WHERE po.status = 'Tamamlandı' ORDER BY po.completed_at DESC LIMIT 200`).all();
  res.json(rows.map(r => ({
    id: r.id, orderNo: r.order_no, itemName: r.item_name, qty: r.produced_qty, scrapQty: r.scrap_qty,
    unit: r.unit, materialCost: Math.round(r.material_cost), laborCost: Math.round(r.labor_cost),
    overheadCost: Math.round(r.overhead_cost), totalCost: Math.round(r.total_cost),
    unitCost: Number(r.unit_cost.toFixed(2)), completedAt: r.completed_at,
    yieldPct: (r.produced_qty + r.scrap_qty) > 0 ? Number(((r.produced_qty / (r.produced_qty + r.scrap_qty)) * 100).toFixed(1)) : 100
  })));
});

/* ============================ STOCK VALUATION DETAIL ============================ */
router.get('/valuation', (req, res) => {
  const rows = db.prepare(`SELECT i.id, i.name, i.code, i.unit, i.category, i.costing_method, i.avg_cost,
      COALESCE(SUM(CASE WHEN sl.status='available' THEN sl.qty ELSE 0 END),0) available_qty,
      COALESCE(SUM(CASE WHEN sl.status='available' THEN sl.qty * sl.unit_cost ELSE 0 END),0) available_value,
      COALESCE(SUM(CASE WHEN sl.status='quarantine' THEN sl.qty ELSE 0 END),0) quarantine_qty,
      COALESCE(SUM(CASE WHEN sl.status IN ('blocked','rejected') THEN sl.qty ELSE 0 END),0) blocked_qty
    FROM items i LEFT JOIN stock_lots sl ON sl.item_id = i.id
    WHERE i.is_active = 1 AND i.deleted_at IS NULL
    GROUP BY i.id ORDER BY available_value DESC`).all();
  const total = rows.reduce((s, r) => s + r.available_value, 0);
  res.json({
    totalValueBase: Math.round(total),
    data: rows.map(r => ({
      itemId: r.id, name: r.name, code: r.code, unit: r.unit, category: r.category,
      costingMethod: r.costing_method, avgCost: Number(r.avg_cost.toFixed(4)),
      availableQty: r.available_qty, availableValueBase: Math.round(r.available_value),
      quarantineQty: r.quarantine_qty, blockedQty: r.blocked_qty
    }))
  });
});

module.exports = router;
