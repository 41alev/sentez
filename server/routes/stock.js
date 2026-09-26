// @ts-nocheck
const express = require('express');
const db = require('../db');
const { AppError, uuid, nextNumber, logAudit, paginate } = require('../lib/core');
const { today, addDays, isValidLocalDate } = require('../lib/dates');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate, validateQuery, z, pageQuery } = require('../middleware/validate');
const stock = require('../services/stock');

const router = express.Router();
router.use(requireAuth);

// ---------------- LOTS ----------------
const lotQuery = pageQuery.extend({
  itemId: z.string().max(1000).optional(),
  warehouseId: z.coerce.number().optional(),
  status: z.string().max(1000).optional(),
  expiringDays: z.coerce.number().optional()
});

router.get('/lots', validateQuery(lotQuery), (req, res) => {
  const q = req.validatedQuery;
  const where = ['sl.qty > 0'];
  const params = [];
  if (q.itemId) { where.push('sl.item_id = ?'); params.push(q.itemId); }
  if (q.warehouseId) { where.push('sl.warehouse_id = ?'); params.push(q.warehouseId); }
  if (q.status) { where.push('sl.status = ?'); params.push(q.status); }
  if (q.expiringDays != null) {
    const limit = addDays(today(), q.expiringDays);
    where.push('sl.expiry_date IS NOT NULL AND sl.expiry_date <= ?'); params.push(limit);
  }
  if (q.q) { where.push('(i.name LIKE ? OR sl.lot_no LIKE ? OR sl.serial_no LIKE ?)'); const l = `%${q.q}%`; params.push(l, l, l); }
  const whereSql = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM stock_lots sl JOIN items i ON i.id = sl.item_id WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT sl.*, i.name AS item_name, i.unit, w.name AS warehouse_name
    FROM stock_lots sl JOIN items i ON i.id = sl.item_id LEFT JOIN warehouses w ON w.id = sl.warehouse_id
    WHERE ${whereSql} ORDER BY (sl.expiry_date IS NULL), sl.expiry_date, sl.received_at DESC
    LIMIT ? OFFSET ?`).all(...params, q.pageSize, (q.page - 1) * q.pageSize);

  res.json({
    data: rows.map(r => ({
      id: r.id, itemId: r.item_id, itemName: r.item_name, unit: r.unit, lotNo: r.lot_no, serialNo: r.serial_no,
      qty: r.qty, status: r.status, expiryDate: r.expiry_date, unitCost: r.unit_cost,
      warehouseId: r.warehouse_id, warehouse: r.warehouse_name, receivedAt: r.received_at,
      sourceType: r.source_type, sourceId: r.source_id, supplierId: r.supplier_id, notes: r.notes
    })),
    page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize)
  });
});

// ---------------- MOVEMENTS ----------------
const movQuery = pageQuery.extend({
  itemId: z.string().max(1000).optional(), lotId: z.string().max(1000).optional(), type: z.string().max(1000).optional()
});

router.get('/movements', validateQuery(movQuery), (req, res) => {
  const q = req.validatedQuery;
  const where = ['1=1']; const params = [];
  if (q.itemId) { where.push('m.item_id = ?'); params.push(q.itemId); }
  if (q.lotId) { where.push('m.lot_id = ?'); params.push(q.lotId); }
  if (q.type) { where.push('m.type = ?'); params.push(q.type); }
  const whereSql = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM movements m WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT m.*, u.username, w.name AS warehouse_name FROM movements m
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN warehouses w ON w.id = m.warehouse_id
    WHERE ${whereSql} ORDER BY m.ts DESC LIMIT ? OFFSET ?`).all(...params, q.pageSize, (q.page - 1) * q.pageSize);

  res.json({
    data: rows.map(r => ({
      id: r.id, itemId: r.item_id, itemName: r.item_name, lotId: r.lot_id, lotNo: r.lot_no,
      warehouse: r.warehouse_name, type: r.type, qty: r.qty, unitCost: r.unit_cost,
      fromStatus: r.from_status, toStatus: r.to_status, note: r.note,
      refType: r.ref_type, refId: r.ref_id, ts: r.ts, username: r.username
    })),
    page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize)
  });
});

// ---------------- MANUAL IN / OUT ----------------
const moveSchema = z.object({
  itemId: z.string(),
  type: z.enum(['in', 'out']),
  qty: z.coerce.number().positive(),
  warehouseId: z.coerce.number().optional(),
  lotNo: z.string().max(1000).optional(),
  expiryDate: z.string().refine(isValidLocalDate, 'Geçerli takvim tarihi gerekli / Valid calendar date required').nullable().optional(),
  unitCost: z.coerce.number().min(0).optional(),
  note: z.string().max(5000).optional()
});

function ensureWarehouse(id) {
  if (id != null && !db.prepare('SELECT id FROM warehouses WHERE id = ? AND is_active = 1').get(id)) {
    throw new AppError('Depo bulunamadı / Warehouse not found', 404);
  }
}

router.post('/move', requirePermission('stock.write'), validate(moveSchema), (req, res, next) => {
  try {
    const b = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(b.itemId);
    if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);
    const warehouseId = b.warehouseId || item.default_warehouse_id;
    ensureWarehouse(b.warehouseId);

    const result = db.txImmediate(() => {
      if (b.type === 'in') {
        const lotId = stock.receiveLot({
          itemId: item.id, warehouseId, qty: b.qty,
          lotNo: b.lotNo || nextNumber('lot', 'LOT'), expiryDate: b.expiryDate || null,
          unitCostBase: b.unitCost != null ? b.unitCost : item.avg_cost,
          sourceType: 'manual', note: b.note, userId: req.user.id
        });
        logAudit(req, 'auditStockIn', { entityType: 'item', entityId: item.id, detail: `${item.name} +${b.qty}` });
        return { lotId };
      }
      const consumed = stock.issueStock({
        itemId: item.id, qty: b.qty, warehouseId,
        refType: 'manual', note: b.note, userId: req.user.id
      });
      logAudit(req, 'auditStockOut', { entityType: 'item', entityId: item.id, detail: `${item.name} -${b.qty}` });
      return { consumed };
    });

    res.json({ ok: true, ...result, qty: stock.availableQty(item.id) });
  } catch (e) { next(e); }
});

// ---------------- STATUS CHANGE (quality hold / release) ----------------
const statusSchema = z.object({
  lotId: z.string(),
  toStatus: z.enum(['available', 'quarantine', 'blocked', 'rejected']),
  qty: z.coerce.number().positive().optional(),
  note: z.string().max(5000).optional()
});

router.post('/lot-status', requirePermission('stock.status'), validate(statusSchema), (req, res, next) => {
  try {
    const b = req.body;
    const before = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(b.lotId);
    if (!before) throw new AppError('Parti bulunamadı / Lot not found', 404);
    const newLotId = db.txImmediate(() => stock.changeLotStatus({
      lotId: b.lotId, toStatus: b.toStatus, qty: b.qty, note: b.note,
      userId: req.user.id, refType: 'quality'
    }));
    logAudit(req, 'auditLotStatus', {
      entityType: 'lot', entityId: b.lotId,
      oldValue: { status: before.status }, newValue: { status: b.toStatus },
      detail: `${before.lot_no || ''} → ${b.toStatus}`
    });
    res.json({ ok: true, lotId: newLotId });
  } catch (e) { next(e); }
});

// ---------------- TRANSFER ----------------
const transferSchema = z.object({
  lotId: z.string(), targetWarehouseId: z.coerce.number(),
  qty: z.coerce.number().positive().optional(), note: z.string().max(5000).optional()
});

router.post('/transfer', requirePermission('stock.write'), validate(transferSchema), (req, res, next) => {
  try {
    const b = req.body;
    ensureWarehouse(b.targetWarehouseId);
    const newLotId = db.txImmediate(() => stock.transferLot({
      lotId: b.lotId, targetWarehouseId: b.targetWarehouseId, qty: b.qty, note: b.note, userId: req.user.id
    }));
    logAudit(req, 'auditTransfer', { entityType: 'lot', entityId: b.lotId, detail: `→ depo ${b.targetWarehouseId}` });
    res.json({ ok: true, lotId: newLotId });
  } catch (e) { next(e); }
});

// ---------------- PHYSICAL COUNT ----------------
const countCreateSchema = z.object({
  warehouseId: z.coerce.number().nullable().optional(),
  notes: z.string().max(5000).optional()
});

router.get('/counts', (req, res) => {
  const { page = 1, pageSize = 25 } = req.query;
  const result = paginate(`SELECT sc.*, w.name AS warehouse_name, u.username AS created_by_name,
      (SELECT COUNT(*) FROM stock_count_lines cl WHERE cl.count_id = sc.id) AS line_count
    FROM stock_counts sc LEFT JOIN warehouses w ON w.id = sc.warehouse_id
    LEFT JOIN users u ON u.id = sc.created_by ORDER BY sc.started_at DESC`, [], page, pageSize);
  result.data = result.data.map(r => ({
    id: r.id, countNo: r.count_no, warehouse: r.warehouse_name, status: r.status,
    startedAt: r.started_at, approvedAt: r.approved_at, createdBy: r.created_by_name,
    lineCount: r.line_count, notes: r.notes
  }));
  res.json(result);
});

router.get('/counts/:id', (req, res, next) => {
  try {
    const c = db.prepare(`SELECT sc.*, w.name AS warehouse_name FROM stock_counts sc
      LEFT JOIN warehouses w ON w.id = sc.warehouse_id WHERE sc.id = ?`).get(req.params.id);
    if (!c) throw new AppError('Sayım bulunamadı / Count not found', 404);
    const lines = db.prepare(`SELECT cl.*, i.unit, w.name AS warehouse_name, sl.unit_cost FROM stock_count_lines cl
      LEFT JOIN items i ON i.id = cl.item_id
      LEFT JOIN stock_lots sl ON sl.id = cl.lot_id
      LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE cl.count_id = ? ORDER BY cl.item_name`).all(req.params.id);
    res.json({
      id: c.id, countNo: c.count_no, warehouse: c.warehouse_name, warehouseId: c.warehouse_id,
      status: c.status, startedAt: c.started_at, approvedAt: c.approved_at, notes: c.notes,
      lines: lines.map(l => ({
        id: l.id, lotId: l.lot_id, itemId: l.item_id, itemName: l.item_name, lotNo: l.lot_no,
        unit: l.unit, warehouse: l.warehouse_name, systemQty: l.system_qty,
        unitCost: l.unit_cost || 0,
        countedQty: l.counted_qty, difference: l.difference, reason: l.reason
      }))
    });
  } catch (e) { next(e); }
});

/** Opening a count freezes the system quantities as a snapshot to count against. */
router.post('/counts', requirePermission('count.write'), validate(countCreateSchema), (req, res, next) => {
  try {
    ensureWarehouse(req.body.warehouseId || null);
    const id = db.txImmediate(() => {
      const countId = uuid();
      const countNo = nextNumber('stock_count', 'SAY');
      db.prepare(`INSERT INTO stock_counts (id,count_no,warehouse_id,status,started_at,created_by,notes)
        VALUES (?,?,?,'open',?,?,?)`).run(countId, countNo, req.body.warehouseId || null, Date.now(), req.user.id, req.body.notes || '');

      const params = [];
      let where = `sl.qty > 0 AND sl.status IN ('available','quarantine','blocked')`;
      if (req.body.warehouseId) { where += ' AND sl.warehouse_id = ?'; params.push(req.body.warehouseId); }
      const lots = db.prepare(`SELECT sl.*, i.name AS item_name FROM stock_lots sl
        JOIN items i ON i.id = sl.item_id WHERE ${where}`).all(...params);

      const ins = db.prepare(`INSERT INTO stock_count_lines (count_id,lot_id,item_id,item_name,lot_no,system_qty)
        VALUES (?,?,?,?,?,?)`);
      lots.forEach(l => ins.run(countId, l.id, l.item_id, l.item_name, l.lot_no, l.qty));

      logAudit(req, 'auditCountOpen', { entityType: 'stock_count', entityId: countId, detail: countNo });
      return countId;
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

const countLinesSchema = z.object({
  lines: z.array(z.object({
    id: z.coerce.number(), countedQty: z.coerce.number().min(0), reason: z.string().max(5000).optional()
  }))
});

router.put('/counts/:id/lines', requirePermission('count.write'), validate(countLinesSchema), (req, res, next) => {
  try {
    const c = db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(req.params.id);
    if (!c) throw new AppError('Sayım bulunamadı / Count not found', 404);
    require('../services/counts').saveCountLines(c.id, req.body.lines);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Approving a count posts the differences as adjustment movements. */
router.post('/counts/:id/approve', requirePermission('count.approve'), (req, res, next) => {
  try {
    const c = db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(req.params.id);
    if (!c) throw new AppError('Sayım bulunamadı / Count not found', 404);
    if (!['open', 'counted'].includes(c.status)) throw new AppError('Sayım kapalı / Count is closed', 409);

    const summary = db.txImmediate(() => {
      const lines = db.prepare('SELECT * FROM stock_count_lines WHERE count_id = ? AND counted_qty IS NOT NULL').all(c.id);
      if (!lines.length) throw new AppError('Önce sayım miktarlarını girin / Enter count quantities first', 422);
      for (const line of lines) {
        const lot = db.prepare('SELECT qty FROM stock_lots WHERE id=?').get(line.lot_id);
        const movement = db.prepare('SELECT id FROM movements WHERE lot_id=? AND ts>=? LIMIT 1').get(line.lot_id, c.started_at);
        if (!lot || Math.abs(lot.qty - line.system_qty) > 1e-9 || movement) {
          throw new AppError('Sayım açıldıktan sonra stok hareketi var. Güncel stokla yeni sayım başlatın / Stock changed since count opened; recount required', 409);
        }
      }
      let adjusted = 0, totalDiff = 0;
      lines.forEach(l => {
        if (l.counted_qty == null || !l.lot_id) return;
        const delta = stock.adjustLot({
          lotId: l.lot_id, newQty: l.counted_qty,
          reason: `Sayım ${c.count_no}${l.reason ? ' · ' + l.reason : ''}`,
          userId: req.user.id, refType: 'count', refId: c.id
        });
        if (delta !== 0) { adjusted++; totalDiff += delta; }
      });
      db.prepare(`UPDATE stock_counts SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?`)
        .run(Date.now(), req.user.id, c.id);
      logAudit(req, 'auditCountApprove', { entityType: 'stock_count', entityId: c.id, detail: `${c.count_no} · ${adjusted} satır düzeltildi` });
      return { adjusted, totalDiff };
    });

    res.json({ ok: true, ...summary });
  } catch (e) { next(e); }
});

module.exports = router;
