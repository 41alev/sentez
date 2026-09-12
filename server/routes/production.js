// @ts-nocheck
const express = require('express');
const db = require('../db');
const { AppError, uuid, nextNumber, logAudit } = require('../lib/core');
const { today } = require('../lib/dates');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate, validateQuery, z, pageQuery } = require('../middleware/validate');
const stock = require('../services/stock');
const costing = require('../services/costing');

const router = express.Router();
router.use(requireAuth);

function serialize(r) {
  const wh = r.warehouse_id ? db.prepare('SELECT name FROM warehouses WHERE id = ?').get(r.warehouse_id) : null;
  return {
    id: r.id, orderNo: r.order_no, itemId: r.item_id, itemName: r.item_name,
    warehouseId: r.warehouse_id, warehouse: wh ? wh.name : null,
    qty: r.qty, producedQty: r.produced_qty, scrapQty: r.scrap_qty, reworkQty: r.rework_qty,
    status: r.status, date: r.date, lotNo: r.lot_no, outputLotId: r.output_lot_id,
    laborCost: r.labor_cost, overheadCost: r.overhead_cost, materialCost: r.material_cost,
    totalCost: r.total_cost, unitCost: r.unit_cost, note: r.note, completedAt: r.completed_at,
    components: db.prepare(`SELECT component_item_id AS componentItemId, component_name AS componentName, qty_used AS qtyUsed
      FROM production_order_components WHERE production_order_id = ?`).all(r.id),
    consumption: db.prepare(`SELECT component_name AS componentName, lot_no AS lotNo, qty, unit_cost AS unitCost
      FROM production_consumption WHERE production_order_id = ?`).all(r.id),
    yieldPct: r.produced_qty > 0 ? Math.round((r.produced_qty / (r.produced_qty + r.scrap_qty)) * 10000) / 100 : null
  };
}

router.get('/', validateQuery(pageQuery.extend({ status: z.string().max(1000).optional() })), (req, res) => {
  const q = req.validatedQuery;
  const where = ['1=1']; const params = [];
  if (q.status) { where.push('status = ?'); params.push(q.status); }
  if (q.q) { where.push('(order_no LIKE ? OR item_name LIKE ?)'); const l = `%${q.q}%`; params.push(l, l); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM production_orders WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM production_orders WHERE ${whereSql} ORDER BY date DESC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  res.json({ data: rows.map(serialize), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
});

router.get('/:id', (req, res, next) => {
  try {
    const r = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id);
    if (!r) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);
    res.json(serialize(r));
  } catch (e) { next(e); }
});

/** Requirements preview: what the BOM needs vs what's actually available right now. */
router.get('/:id/requirements', (req, res, next) => {
  try {
    const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id);
    if (!po) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);
    const comps = db.prepare('SELECT * FROM production_order_components WHERE production_order_id = ?').all(po.id);
    res.json(comps.map(c => {
      const item = db.prepare('SELECT name, unit FROM items WHERE id = ?').get(c.component_item_id);
      const available = stock.availableQty(c.component_item_id, po.warehouse_id);
      return {
        componentItemId: c.component_item_id, componentName: c.component_name,
        unit: item ? item.unit : '', needed: c.qty_used, available,
        sufficient: available >= c.qty_used - 1e-9, shortfall: Math.max(0, c.qty_used - available)
      };
    }));
  } catch (e) { next(e); }
});

const createSchema = z.object({
  itemId: z.string(),
  qty: z.coerce.number().positive(),
  warehouseId: z.coerce.number().nullable().optional(),
  date: z.string().nullable().optional(),
  lotNo: z.string().max(1000).optional(),
  note: z.string().max(5000).optional(),
  laborCost: z.coerce.number().min(0).default(0),
  overheadCost: z.coerce.number().min(0).default(0),
  components: z.array(z.object({
    componentItemId: z.string(), qty: z.coerce.number().min(0)
  })).optional()
});

/** Explode BOM into required quantities, applying each component's scrap allowance. */
function resolveComponents(itemId, qty, override) {
  if (override && override.length) {
    return override.filter(c => c.componentItemId).map(c => ({ componentItemId: c.componentItemId, qtyUsed: Number(c.qty) || 0 }));
  }
  const bom = db.prepare('SELECT component_item_id, qty_per_unit, scrap_pct FROM item_bom WHERE item_id = ?').all(itemId);
  return bom.map(b => ({
    componentItemId: b.component_item_id,
    qtyUsed: b.qty_per_unit * qty * (1 + (b.scrap_pct || 0) / 100)
  }));
}

router.post('/', requirePermission('production.write'), validate(createSchema), (req, res, next) => {
  try {
    const b = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(b.itemId);
    if (!item) throw new AppError('Mamul bulunamadı / Finished item not found', 404);

    const components = resolveComponents(item.id, b.qty, b.components);
    if (components.length === 0) {
      throw new AppError('Bu ürün için reçete tanımlı değil / No recipe (BOM) defined for this item', 400);
    }

    const id = db.txImmediate(() => {
      const poId = uuid();
      const no = nextNumber('production_order', 'URT');
      db.prepare(`INSERT INTO production_orders (id,order_no,item_id,item_name,warehouse_id,qty,status,date,lot_no,
        labor_cost,overhead_cost,note,created_by) VALUES (?,?,?,?,?,?, 'Planlandı',?,?,?,?,?,?)`).run(
        poId, no, item.id, item.name, b.warehouseId || item.default_warehouse_id, b.qty,
        b.date || today(), b.lotNo || '', b.laborCost, b.overheadCost,
        b.note || '', req.user.id);

      const ins = db.prepare('INSERT INTO production_order_components (production_order_id,component_item_id,component_name,qty_used) VALUES (?,?,?,?)');
      components.forEach(c => {
        const comp = db.prepare('SELECT name FROM items WHERE id = ?').get(c.componentItemId);
        ins.run(poId, c.componentItemId, comp ? comp.name : '—', c.qtyUsed);
      });

      logAudit(req, 'auditProductionAdd', { entityType: 'production_order', entityId: poId,
        newValue: { orderNo: no, item: item.name, qty: b.qty }, detail: `${no} · ${item.name} × ${b.qty}` });
      return poId;
    });

    res.status(201).json(serialize(db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id)));
  } catch (e) { next(e); }
});

const completeSchema = z.object({
  producedQty: z.coerce.number().min(0).optional(),
  scrapQty: z.coerce.number().min(0).default(0),
  reworkQty: z.coerce.number().min(0).default(0),
  laborCost: z.coerce.number().min(0).optional(),
  overheadCost: z.coerce.number().min(0).optional(),
  lotNo: z.string().max(1000).optional(),
  expiryDate: z.string().nullable().optional()
});

/**
 * Completing production: consume real lots (FEFO), record genealogy, produce an output
 * lot, and compute the true unit cost from what was actually consumed plus labour and
 * overhead. Runs in one IMMEDIATE transaction so two operators cannot double-consume.
 */
router.post('/:id/complete', requirePermission('production.write'), validate(completeSchema), (req, res, next) => {
  try {
    const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id);
    if (!po) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);
    if (po.status === 'Tamamlandı') throw new AppError('Bu emir zaten tamamlanmış / Already completed');
    if (po.status === 'İptal Edildi') throw new AppError('İptal edilmiş emir tamamlanamaz / Cancelled order');

    const b = req.body;
    const producedQty = b.producedQty != null ? b.producedQty : po.qty;
    const scrapQty = b.scrapQty || 0;

    const result = db.txImmediate(() => {
      const comps = db.prepare('SELECT * FROM production_order_components WHERE production_order_id = ?').all(po.id);

      // Scale component consumption to what was really made (good + scrapped both consumed material)
      const totalAttempted = producedQty + scrapQty;
      const scale = po.qty > 0 ? totalAttempted / po.qty : 1;

      // Check every component BEFORE consuming anything, so we never half-consume
      const shortfalls = [];
      for (const c of comps) {
        const needed = c.qty_used * scale;
        const available = stock.availableQty(c.component_item_id, po.warehouse_id);
        if (available < needed - 1e-9) {
          const item = db.prepare('SELECT name, unit FROM items WHERE id = ?').get(c.component_item_id);
          shortfalls.push({ name: item ? item.name : c.component_name, needed, available, unit: item ? item.unit : '' });
        }
      }
      if (shortfalls.length > 0) {
        throw new AppError('Yetersiz hammadde stoğu / Insufficient raw material stock', 400, { shortfalls });
      }

      // Consume and record genealogy
      const insCons = db.prepare(`INSERT INTO production_consumption
        (production_order_id,component_item_id,component_name,lot_id,lot_no,qty,unit_cost) VALUES (?,?,?,?,?,?,?)`);
      db.prepare('DELETE FROM production_consumption WHERE production_order_id = ?').run(po.id);

      for (const c of comps) {
        const needed = c.qty_used * scale;
        if (needed <= 0) continue;
        const consumed = stock.issueStock({
          itemId: c.component_item_id, qty: needed, warehouseId: po.warehouse_id,
          refType: 'production', refId: po.id, note: `Üretim ${po.order_no}`, userId: req.user.id
        });
        consumed.forEach(x => insCons.run(po.id, c.component_item_id, c.component_name, x.lotId, x.lotNo, x.qty, x.unitCost));
      }

      db.prepare(`UPDATE production_orders SET produced_qty=?, scrap_qty=?, rework_qty=?,
        labor_cost=COALESCE(?, labor_cost), overhead_cost=COALESCE(?, overhead_cost) WHERE id=?`)
        .run(producedQty, scrapQty, b.reworkQty || 0, b.laborCost ?? null, b.overheadCost ?? null, po.id);

      const cost = costing.computeProductionCost(po.id);

      // Output lot carries the real computed cost, not a guess
      let outputLotId = null;
      if (producedQty > 0) {
        outputLotId = stock.receiveLot({
          itemId: po.item_id, warehouseId: po.warehouse_id, qty: producedQty,
          lotNo: b.lotNo || po.lot_no || nextNumber('lot', 'URL'),
          expiryDate: b.expiryDate || null, unitCostBase: cost.unitCost,
          sourceType: 'production', sourceId: po.id,
          note: `Üretim ${po.order_no}`, userId: req.user.id
        });
      }

      db.prepare(`UPDATE production_orders SET status='Tamamlandı', completed_at=?, output_lot_id=? WHERE id=?`)
        .run(Date.now(), outputLotId, po.id);

      logAudit(req, 'auditProductionComplete', { entityType: 'production_order', entityId: po.id,
        oldValue: { status: po.status }, newValue: { status: 'Tamamlandı', producedQty, scrapQty, unitCost: cost.unitCost },
        detail: `${po.order_no} · ${producedQty} üretildi, ${scrapQty} fire` });

      return { outputLotId, cost, producedQty, scrapQty };
    });

    res.json({ ok: true, ...result, order: serialize(db.prepare('SELECT * FROM production_orders WHERE id = ?').get(po.id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePermission('stock.delete'), (req, res, next) => {
  try {
    const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id);
    if (!po) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);
    if (po.status === 'Tamamlandı') throw new AppError('Tamamlanmış üretim emri silinemez / Cannot delete a completed order');
    db.prepare('DELETE FROM production_orders WHERE id = ?').run(po.id);
    logAudit(req, 'auditProductionDelete', { entityType: 'production_order', entityId: po.id, detail: po.order_no });
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
