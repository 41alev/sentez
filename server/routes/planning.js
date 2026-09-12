// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit, diff, paginate } = require('../lib/core');
const dates = require('../lib/dates');
const { companyIdOf } = require('../lib/tenant');
const capacity = require('../services/capacity');
const mrp = require('../services/mrp');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');
const MANAGER = requireRole('admin', 'manager');

/* ============================ İŞ MERKEZLERİ ============================ */

router.get('/work-centers', (req, res) => {
  const rows = db.prepare(`SELECT wc.*, w.name AS warehouse_name,
      (SELECT GROUP_CONCAT(s.code) FROM work_center_shifts wcs JOIN shifts s ON s.id = wcs.shift_id
        WHERE wcs.work_center_id = wc.id) AS shift_codes,
      (SELECT COUNT(*) FROM routings r WHERE r.work_center_id = wc.id) AS routing_count
    FROM work_centers wc LEFT JOIN warehouses w ON w.id = wc.warehouse_id
    WHERE wc.is_active = 1 ORDER BY wc.code`).all();
  res.json(rows.map(r => ({
    id: r.id, code: r.code, name: r.name, description: r.description,
    warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
    capacityUnits: r.capacity_units, hourlyRate: r.hourly_rate,
    efficiencyPct: r.efficiency_pct, downtimePct: r.downtime_pct,
    shiftCodes: r.shift_codes ? r.shift_codes.split(',') : [],
    routingCount: r.routing_count, isActive: !!r.is_active
  })));
});

const wcSchema = z.object({
  code: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  warehouseId: z.coerce.number().int().optional(),
  capacityUnits: z.coerce.number().int().min(1).default(1),
  hourlyRate: z.coerce.number().min(0).default(0),
  efficiencyPct: z.coerce.number().min(1).max(200).default(100),
  downtimePct: z.coerce.number().min(0).max(90).default(0),
  shiftIds: z.array(z.coerce.number().int()).default([])
});

router.post('/work-centers', MANAGER, validate(wcSchema), (req, res) => {
  const b = req.valid;
  const result = db.tx(() => {
    if (db.prepare('SELECT id FROM work_centers WHERE code = ? AND company_id = ?').get(b.code, companyIdOf(req))) {
      throw new AppError('Bu kodda bir iş merkezi zaten var / Work centre code already exists', 409);
    }
    const info = db.prepare(`INSERT INTO work_centers (code,name,description,warehouse_id,capacity_units,
        hourly_rate,efficiency_pct,downtime_pct,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(b.code, b.name, b.description || null, b.warehouseId || null, b.capacityUnits,
           b.hourlyRate, b.efficiencyPct, b.downtimePct, Date.now());
    const id = info.lastInsertRowid;
    const insShift = db.prepare('INSERT INTO work_center_shifts (work_center_id,shift_id) VALUES (?,?)');
    b.shiftIds.forEach(s => insShift.run(id, s));
    return id;
  });
  logAudit(req, 'auditWorkCenterAdd', { entityType: 'work_center', entityId: result, newValue: b, detail: b.name });
  res.status(201).json({ id: result });
});

router.put('/work-centers/:id', MANAGER, validate(wcSchema.partial()), (req, res) => {
  const before = db.prepare('SELECT * FROM work_centers WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('İş merkezi bulunamadı / Work centre not found', 404);
  const b = req.valid;
  db.tx(() => {
    db.prepare(`UPDATE work_centers SET name=COALESCE(?,name), description=COALESCE(?,description),
      warehouse_id=COALESCE(?,warehouse_id), capacity_units=COALESCE(?,capacity_units),
      hourly_rate=COALESCE(?,hourly_rate), efficiency_pct=COALESCE(?,efficiency_pct),
      downtime_pct=COALESCE(?,downtime_pct) WHERE id = ?`)
      .run(b.name ?? null, b.description ?? null, b.warehouseId ?? null, b.capacityUnits ?? null,
           b.hourlyRate ?? null, b.efficiencyPct ?? null, b.downtimePct ?? null, req.params.id);
    if (b.shiftIds) {
      db.prepare('DELETE FROM work_center_shifts WHERE work_center_id = ?').run(req.params.id);
      const ins = db.prepare('INSERT INTO work_center_shifts (work_center_id,shift_id) VALUES (?,?)');
      b.shiftIds.forEach(s => ins.run(req.params.id, s));
    }
  });
  const after = db.prepare('SELECT * FROM work_centers WHERE id = ?').get(req.params.id);
  const d = diff(before, after, ['name', 'capacity_units', 'hourly_rate', 'efficiency_pct', 'downtime_pct']);
  logAudit(req, 'auditWorkCenterEdit', { entityType: 'work_center', entityId: after.id, ...(d || {}), detail: after.name });
  res.json({ ok: true });
});

router.delete('/work-centers/:id', MANAGER, (req, res) => {
  const wc = db.prepare('SELECT * FROM work_centers WHERE id = ?').get(req.params.id);
  if (!wc) throw new AppError('İş merkezi bulunamadı / Work centre not found', 404);
  // Rotalarda kullanılan bir merkez silinirse plan bozulur; pasifleştirmek yeterli.
  db.prepare('UPDATE work_centers SET is_active = 0 WHERE id = ?').run(wc.id);
  logAudit(req, 'auditWorkCenterDelete', { entityType: 'work_center', entityId: wc.id, detail: wc.name });
  res.status(204).end();
});

/* ============================ VARDİYALAR ============================ */

router.get('/shifts', (req, res) => {
  const rows = db.prepare('SELECT * FROM shifts WHERE is_active = 1 ORDER BY start_time').all();
  res.json(rows.map(s => ({
    id: s.id, code: s.code, name: s.name, startTime: s.start_time, endTime: s.end_time,
    breakMinutes: s.break_minutes, weekdays: String(s.weekdays).split(',').map(Number),
    netMinutes: capacity.shiftMinutes(s), isActive: !!s.is_active
  })));
});

router.post('/shifts', MANAGER, validate(z.object({
  code: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200),
  startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.coerce.number().min(0).default(0),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1)
})), (req, res) => {
  const b = req.valid;
  const info = db.prepare(`INSERT INTO shifts (code,name,start_time,end_time,break_minutes,weekdays)
    VALUES (?,?,?,?,?,?)`).run(b.code, b.name, b.startTime, b.endTime, b.breakMinutes, b.weekdays.join(','));
  logAudit(req, 'auditShiftAdd', { entityType: 'shift', entityId: info.lastInsertRowid, newValue: b, detail: b.name });
  res.status(201).json({ id: info.lastInsertRowid });
});

/* ============================ TATİL / İSTİSNA ============================ */

router.get('/calendar-exceptions', (req, res) => {
  res.json(db.prepare(`SELECT ce.*, wc.name AS work_center_name FROM calendar_exceptions ce
    LEFT JOIN work_centers wc ON wc.id = ce.work_center_id ORDER BY ce.date DESC LIMIT 200`).all());
});

router.post('/calendar-exceptions', MANAGER, validate(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workCenterId: z.coerce.number().int().optional(),
  reason: z.string().max(5000).optional(),
  exceptionType: z.enum(['holiday', 'partial']).default('holiday'),
  availableHours: z.coerce.number().min(0).optional()
})), (req, res) => {
  const b = req.valid;
  const info = db.prepare(`INSERT INTO calendar_exceptions (work_center_id,date,reason,exception_type,available_hours)
    VALUES (?,?,?,?,?)`).run(b.workCenterId || null, b.date, b.reason || null, b.exceptionType, b.availableHours ?? null);
  logAudit(req, 'auditCalendarException', { entityType: 'calendar_exception', entityId: info.lastInsertRowid, newValue: b, detail: b.date });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/calendar-exceptions/:id', MANAGER, (req, res) => {
  db.prepare('DELETE FROM calendar_exceptions WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/* ============================ ROTALAR ============================ */

router.get('/routings/:itemId', (req, res) => {
  const rows = db.prepare(`SELECT r.*, wc.name AS work_center_name, wc.code AS work_center_code
    FROM routings r JOIN work_centers wc ON wc.id = r.work_center_id
    WHERE r.item_id = ? ORDER BY r.operation_no`).all(req.params.itemId);
  res.json(rows.map(r => ({
    id: r.id, operationNo: r.operation_no, operationName: r.operation_name,
    workCenterId: r.work_center_id, workCenterName: r.work_center_name, workCenterCode: r.work_center_code,
    setupMinutes: r.setup_minutes, runMinutesPerUnit: r.run_minutes_per_unit,
    queueMinutes: r.queue_minutes, scrapPct: r.scrap_pct, notes: r.notes
  })));
});

/** Rotanın tamamı tek seferde yazılır: yarım rota planlamayı bozar. */
router.put('/routings/:itemId', MANAGER, validate(z.object({
  operations: z.array(z.object({
    operationNo: z.coerce.number().int().min(1),
    operationName: z.string().min(1).max(200),
    workCenterId: z.coerce.number().int(),
    setupMinutes: z.coerce.number().min(0).default(0),
    runMinutesPerUnit: z.coerce.number().min(0).default(0),
    queueMinutes: z.coerce.number().min(0).default(0),
    scrapPct: z.coerce.number().min(0).max(100).default(0),
    notes: z.string().max(5000).optional()
  }))
})), (req, res) => {
  const itemId = req.params.itemId;
  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);

  const nos = req.valid.operations.map(o => o.operationNo);
  if (new Set(nos).size !== nos.length) throw new AppError('Operasyon numaraları tekrarlanamaz / Duplicate operation numbers', 400);

  db.tx(() => {
    db.prepare('DELETE FROM routings WHERE item_id = ?').run(itemId);
    const ins = db.prepare(`INSERT INTO routings (item_id,operation_no,operation_name,work_center_id,
      setup_minutes,run_minutes_per_unit,queue_minutes,scrap_pct,notes) VALUES (?,?,?,?,?,?,?,?,?)`);
    req.valid.operations.forEach(o => ins.run(itemId, o.operationNo, o.operationName, o.workCenterId,
      o.setupMinutes, o.runMinutesPerUnit, o.queueMinutes, o.scrapPct, o.notes || null));
  });
  logAudit(req, 'auditRoutingUpdate', { entityType: 'routing', entityId: itemId,
    newValue: { operations: req.valid.operations.length }, detail: item.name });
  res.json({ ok: true, operations: req.valid.operations.length });
});

/* ============================ KAPASİTE ============================ */

router.get('/capacity', (req, res) => {
  const { from, to, workCenterId } = req.query;
  const start = from || dates.today();
  const end = to || dates.addDays(dates.today(), 30);
  res.json({ from: start, to: end, data: capacity.capacityLoad({ from: start, to: end, workCenterId: workCenterId || null }) });
});

/* ============================ ÇİZELGELEME ============================ */

router.post('/schedule/:orderId', WRITE, validate(z.object({ startFrom: z.string().max(1000).optional() })), (req, res) => {
  const result = db.txImmediate(() => capacity.scheduleOrder(req.params.orderId, { startFrom: req.valid.startFrom }));
  logAudit(req, 'auditSchedule', { entityType: 'production_order', entityId: req.params.orderId,
    newValue: { plannedStart: result.plannedStart, plannedEnd: result.plannedEnd, isLate: result.isLate } });
  res.json(result);
});

router.get('/operations', (req, res) => {
  const { workCenterId = '', status = '', from = '', to = '', page = 1, pageSize = 50 } = req.query;
  let sql = `SELECT po_op.*, po.order_no, po.item_name, po.qty AS order_qty
    FROM production_operations po_op
    JOIN production_orders po ON po.id = po_op.production_order_id WHERE 1=1`;
  const params = [];
  if (workCenterId) { sql += ' AND po_op.work_center_id = ?'; params.push(workCenterId); }
  if (status) { sql += ' AND po_op.status = ?'; params.push(status); }
  if (from) { sql += ' AND po_op.planned_start >= ?'; params.push(new Date(from + 'T00:00:00').getTime()); }
  if (to) { sql += ' AND po_op.planned_start <= ?'; params.push(new Date(to + 'T23:59:59').getTime()); }
  sql += ' ORDER BY po_op.planned_start';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(o => ({
    id: o.id, productionOrderId: o.production_order_id, orderNo: o.order_no, itemName: o.item_name,
    operationNo: o.operation_no, operationName: o.operation_name,
    workCenterId: o.work_center_id, workCenterName: o.work_center_name,
    plannedStart: o.planned_start, plannedEnd: o.planned_end,
    plannedMinutes: Math.round((o.planned_setup_minutes || 0) + (o.planned_run_minutes || 0)),
    actualStart: o.actual_start, actualEnd: o.actual_end, actualMinutes: o.actual_minutes,
    completedQty: o.completed_qty, scrapQty: o.scrap_qty, status: o.status
  }));
  res.json(result);
});

/** Operasyonu başlatır veya bitirir: gerçekleşen süre buradan toplanır. */
router.post('/operations/:id/:action', WRITE, (req, res) => {
  const { id, action } = req.params;
  const op = db.prepare('SELECT * FROM production_operations WHERE id = ?').get(id);
  if (!op) throw new AppError('Operasyon bulunamadı / Operation not found', 404);

  if (action === 'start') {
    if (op.status === 'in_progress') throw new AppError('Operasyon zaten başlatılmış / Already started', 409);
    if (op.status === 'completed') throw new AppError('Tamamlanmış operasyon başlatılamaz / Already completed', 409);
    db.prepare("UPDATE production_operations SET status='in_progress', actual_start=?, operator_id=? WHERE id=?")
      .run(Date.now(), req.user.id, id);
  } else if (action === 'complete') {
    if (op.status !== 'in_progress') throw new AppError('Önce operasyonu başlatın / Start the operation first', 409);
    const { completedQty = 0, scrapQty = 0, notes } = req.body || {};
    const end = Date.now();
    const minutes = op.actual_start ? (end - op.actual_start) / 60000 : null;
    db.prepare(`UPDATE production_operations SET status='completed', actual_end=?, actual_minutes=?,
      completed_qty=?, scrap_qty=?, notes=COALESCE(?,notes) WHERE id=?`)
      .run(end, minutes, Number(completedQty) || 0, Number(scrapQty) || 0, notes || null, id);
  } else {
    throw new AppError('Geçersiz işlem / Invalid action', 400);
  }
  logAudit(req, action === 'start' ? 'auditOpStart' : 'auditOpComplete',
    { entityType: 'production_operation', entityId: id, detail: op.operation_name });
  res.json(db.prepare('SELECT * FROM production_operations WHERE id = ?').get(id));
});

/* ============================ VARDİYA KAYITLARI ============================ */

router.get('/shift-logs', (req, res) => {
  const { from = '', to = '', workCenterId = '', page = 1, pageSize = 50 } = req.query;
  let sql = `SELECT sl.*, wc.name AS work_center_name, s.name AS shift_name, u.username
    FROM shift_logs sl JOIN work_centers wc ON wc.id = sl.work_center_id
    JOIN shifts s ON s.id = sl.shift_id LEFT JOIN users u ON u.id = sl.recorded_by WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND sl.date >= ?'; params.push(from); }
  if (to) { sql += ' AND sl.date <= ?'; params.push(to); }
  if (workCenterId) { sql += ' AND sl.work_center_id = ?'; params.push(workCenterId); }
  sql += ' ORDER BY sl.date DESC, sl.shift_id';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(l => ({
    id: l.id, date: l.date, shiftId: l.shift_id, shiftName: l.shift_name,
    workCenterId: l.work_center_id, workCenterName: l.work_center_name,
    plannedMinutes: l.planned_minutes, workedMinutes: l.worked_minutes,
    downtimeMinutes: l.downtime_minutes, downtimeReason: l.downtime_reason,
    producedQty: l.produced_qty, scrapQty: l.scrap_qty, operatorCount: l.operator_count,
    notes: l.notes, username: l.username
  }));
  res.json(result);
});

router.post('/shift-logs', WRITE, validate(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftId: z.coerce.number().int(),
  workCenterId: z.coerce.number().int(),
  workedMinutes: z.coerce.number().min(0),
  downtimeMinutes: z.coerce.number().min(0).default(0),
  downtimeReason: z.string().max(1000).optional(),
  producedQty: z.coerce.number().min(0).default(0),
  scrapQty: z.coerce.number().min(0).default(0),
  operatorCount: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(5000).optional()
})), (req, res) => {
  const b = req.valid;
  if (b.downtimeMinutes > b.workedMinutes) {
    throw new AppError('Duruş süresi çalışılan süreden fazla olamaz / Downtime cannot exceed worked time', 400);
  }
  // Planlanan süre vardiya tanımından gelir: elle girilirse OEE anlamsızlaşır.
  const planned = capacity.availableMinutes(b.workCenterId, b.date);
  const info = db.prepare(`INSERT INTO shift_logs (date,shift_id,work_center_id,planned_minutes,worked_minutes,
      downtime_minutes,downtime_reason,produced_qty,scrap_qty,operator_count,notes,recorded_by,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date,shift_id,work_center_id) DO UPDATE SET
      worked_minutes=excluded.worked_minutes, downtime_minutes=excluded.downtime_minutes,
      downtime_reason=excluded.downtime_reason, produced_qty=excluded.produced_qty,
      scrap_qty=excluded.scrap_qty, operator_count=excluded.operator_count, notes=excluded.notes`)
    .run(b.date, b.shiftId, b.workCenterId, Math.round(planned), b.workedMinutes, b.downtimeMinutes,
         b.downtimeReason || null, b.producedQty, b.scrapQty, b.operatorCount, b.notes || null,
         req.user.id, Date.now());
  logAudit(req, 'auditShiftLog', { entityType: 'shift_log', entityId: info.lastInsertRowid,
    newValue: { date: b.date, produced: b.producedQty }, detail: b.date });
  res.status(201).json({ id: info.lastInsertRowid, plannedMinutes: Math.round(planned) });
});

/* ============================ OEE ============================ */

router.get('/oee', (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  res.json(capacity.oee({ from, to, workCenterId: req.query.workCenterId || null }));
});

/* ============================ MRP ============================ */

router.get('/mrp/runs', (req, res) => {
  const rows = db.prepare(`SELECT r.*, u.username FROM mrp_runs r LEFT JOIN users u ON u.id = r.created_by
    ORDER BY r.created_at DESC LIMIT 50`).all();
  res.json(rows.map(r => ({
    id: r.id, runNo: r.run_no, horizonDays: r.horizon_days, status: r.status,
    itemCount: r.item_count, suggestionCount: r.suggestion_count, shortageCount: r.shortage_count,
    notes: r.notes, username: r.username, createdAt: r.created_at
  })));
});

router.post('/mrp/run', MANAGER, validate(z.object({
  horizonDays: z.coerce.number().int().min(1).max(730).optional(),
  notes: z.string().max(5000).optional()
})), (req, res) => {
  const result = db.txImmediate(() => mrp.runMrp({
    horizonDays: req.valid.horizonDays, notes: req.valid.notes, userId: req.user.id
  }));
  logAudit(req, 'auditMrpRun', { entityType: 'mrp_run', entityId: result.runId,
    newValue: { suggestions: result.suggestionCount, shortages: result.shortageCount }, detail: result.runNo });
  res.status(201).json(result);
});

router.get('/mrp/suggestions', (req, res) => {
  const { runId = '', status = 'open', type = '', lateOnly = '' } = req.query;
  let sql = `SELECT s.*, sup.name AS supplier_name FROM mrp_suggestions s
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id WHERE 1=1`;
  const params = [];
  if (runId) { sql += ' AND s.run_id = ?'; params.push(runId); }
  else {
    // Çalıştırma belirtilmezse en son çalıştırma gösterilir; eski öneriler yanıltıcıdır.
    const latest = db.prepare('SELECT id FROM mrp_runs ORDER BY created_at DESC LIMIT 1').get();
    if (latest) { sql += ' AND s.run_id = ?'; params.push(latest.id); }
  }
  if (status) { sql += ' AND s.status = ?'; params.push(status); }
  if (type) { sql += ' AND s.suggestion_type = ?'; params.push(type); }
  if (lateOnly === '1') sql += ' AND s.is_late = 1';
  sql += ' ORDER BY s.is_late DESC, s.bom_level, s.need_date';

  const rows = db.prepare(sql).all(...params);
  res.json({
    data: rows.map(s => ({
      id: s.id, runId: s.run_id, itemId: s.item_id, itemName: s.item_name, bomLevel: s.bom_level,
      type: s.suggestion_type, grossRequirement: s.gross_requirement, onHand: s.on_hand,
      onOrder: s.on_order, safetyStock: s.safety_stock, netRequirement: s.net_requirement,
      suggestedQty: s.suggested_qty, needDate: s.need_date, releaseDate: s.release_date,
      isLate: !!s.is_late, supplierId: s.supplier_id, supplierName: s.supplier_name,
      estimatedCost: s.estimated_cost, sourceDemand: s.source_demand,
      status: s.status, convertedTo: s.converted_to
    })),
    total: rows.length
  });
});

router.post('/mrp/suggestions/:id/convert', MANAGER, (req, res) => {
  const result = db.txImmediate(() => mrp.convertSuggestion(req.params.id, {
    userId: req.user.id, warehouseId: req.body && req.body.warehouseId
  }));
  logAudit(req, 'auditMrpConvert', { entityType: 'mrp_suggestion', entityId: req.params.id,
    newValue: result, detail: result.number });
  res.status(201).json(result);
});

router.post('/mrp/suggestions/:id/dismiss', MANAGER, (req, res) => {
  const s = db.prepare('SELECT * FROM mrp_suggestions WHERE id = ?').get(req.params.id);
  if (!s) throw new AppError('Öneri bulunamadı / Suggestion not found', 404);
  db.prepare("UPDATE mrp_suggestions SET status='dismissed' WHERE id=?").run(req.params.id);
  logAudit(req, 'auditMrpDismiss', { entityType: 'mrp_suggestion', entityId: s.id, detail: s.item_name });
  res.json({ ok: true });
});

module.exports = router;
