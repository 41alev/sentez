// @ts-nocheck
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { AppError, uuid, nextNumber, logAudit } = require('../lib/core');
const { today } = require('../lib/dates');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate, validateQuery, z, pageQuery } = require('../middleware/validate');
const stock = require('../services/stock');
const trace = require('../services/traceability');
const { companyIdOf } = require('../lib/tenant');
const { dispatchEvent } = require('../lib/webhooks');

const router = express.Router();
router.use(requireAuth);

// ============================ INSPECTION PLANS ============================
const planSchema = z.object({
  itemId: z.string(),
  type: z.enum(['incoming', 'in_process', 'final']),
  characteristic: z.string().trim().min(1).max(200),
  specMin: z.coerce.number().nullable().optional(),
  specMax: z.coerce.number().nullable().optional(),
  specText: z.string().max(5000).optional(),
  aql: z.string().max(1000).optional()
});

router.get('/plans', (req, res) => {
  const rows = db.prepare(`SELECT p.*, i.name AS item_name FROM inspection_plans p
    LEFT JOIN items i ON i.id = p.item_id WHERE p.is_active = 1 ORDER BY i.name, p.type`).all();
  res.json(rows.map(r => ({
    id: r.id, itemId: r.item_id, itemName: r.item_name, type: r.type, characteristic: r.characteristic,
    specMin: r.spec_min, specMax: r.spec_max, specText: r.spec_text, aql: r.aql
  })));
});

router.post('/plans', requirePermission('quality.write'), validate(planSchema), (req, res, next) => {
  try {
    const b = req.body;
    const info = db.prepare(`INSERT INTO inspection_plans (item_id,type,characteristic,spec_min,spec_max,spec_text,aql)
      VALUES (?,?,?,?,?,?,?)`).run(b.itemId, b.type, b.characteristic, b.specMin ?? null, b.specMax ?? null,
      b.specText || null, b.aql || null);
    logAudit(req, 'auditPlanAdd', { entityType: 'inspection_plan', entityId: info.lastInsertRowid, detail: b.characteristic });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) { next(e); }
});

router.delete('/plans/:id', requirePermission('quality.write'), (req, res) => {
  db.prepare('UPDATE inspection_plans SET is_active = 0 WHERE id = ?').run(req.params.id);
  logAudit(req, 'auditPlanDelete', { entityType: 'inspection_plan', entityId: req.params.id });
  res.status(204).end();
});

// ============================ INSPECTIONS ============================
function serializeInspection(r) {
  return {
    id: r.id, inspectionNo: r.inspection_no, type: r.type, itemId: r.item_id, itemName: r.item_name,
    lotId: r.lot_id, lotNo: r.lot_no, receiptId: r.receipt_id, productionOrderId: r.production_order_id,
    supplierId: r.supplier_id, sampleSize: r.sample_size, inspectedQty: r.inspected_qty,
    acceptedQty: r.accepted_qty, rejectedQty: r.rejected_qty, aql: r.aql, result: r.result,
    inspectedBy: r.inspected_by, inspectedAt: r.inspected_at, signedBy: r.signed_by, signedAt: r.signed_at,
    signatureHash: r.signature_hash, notes: r.notes,
    lines: db.prepare('SELECT * FROM inspection_lines WHERE inspection_id = ?').all(r.id).map(l => ({
      id: l.id, characteristic: l.characteristic, specMin: l.spec_min, specMax: l.spec_max, specText: l.spec_text,
      measuredValue: l.measured_value, measuredText: l.measured_text, result: l.result, notes: l.notes
    })),
    documents: db.prepare(`SELECT id, doc_no, title, doc_type, file_path, original_name FROM documents
      WHERE ref_type='inspection' AND ref_id = ?`).all(r.id)
  };
}

router.get('/inspections', validateQuery(pageQuery.extend({ result: z.string().max(1000).optional(), type: z.string().max(1000).optional() })), (req, res) => {
  const q = req.validatedQuery;
  const where = ['1=1']; const params = [];
  if (q.result) { where.push('result = ?'); params.push(q.result); }
  if (q.type) { where.push('type = ?'); params.push(q.type); }
  if (q.q) { where.push('(inspection_no LIKE ? OR item_name LIKE ? OR lot_no LIKE ?)'); const l = `%${q.q}%`; params.push(l, l, l); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM inspections WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM inspections WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  res.json({ data: rows.map(serializeInspection), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
});

router.get('/inspections/:id', (req, res, next) => {
  try {
    const r = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id);
    if (!r) throw new AppError('Muayene bulunamadı / Inspection not found', 404);
    res.json(serializeInspection(r));
  } catch (e) { next(e); }
});

const inspectionSchema = z.object({
  type: z.enum(['incoming', 'in_process', 'final']),
  lotId: z.string().nullable().optional(),
  receiptId: z.string().nullable().optional(),
  productionOrderId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  sampleSize: z.coerce.number().min(0).optional(),
  aql: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional()
});

/** Creating an inspection pulls the characteristics from the item's inspection plan. */
router.post('/inspections', requirePermission('quality.write'), validate(inspectionSchema), (req, res, next) => {
  try {
    const b = req.body;
    let lot = null, item = null;
    if (b.lotId) {
      lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(b.lotId);
      if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
      item = db.prepare('SELECT * FROM items WHERE id = ?').get(lot.item_id);
    } else if (b.itemId) {
      item = db.prepare('SELECT * FROM items WHERE id = ?').get(b.itemId);
    }
    if (!item) throw new AppError('Ürün belirtilmeli / Item is required', 400);

    const id = db.txImmediate(() => {
      const inspId = uuid();
      const no = nextNumber('inspection', 'MUA');
      db.prepare(`INSERT INTO inspections (id,inspection_no,type,item_id,item_name,lot_id,lot_no,receipt_id,
        production_order_id,supplier_id,sample_size,inspected_qty,aql,result,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?,?)`).run(
        inspId, no, b.type, item.id, item.name, b.lotId || null, lot ? lot.lot_no : null,
        b.receiptId || null, b.productionOrderId || null, lot ? lot.supplier_id : null,
        b.sampleSize ?? null, lot ? lot.qty : null, b.aql || null, b.notes || '', Date.now());

      const plans = db.prepare('SELECT * FROM inspection_plans WHERE item_id = ? AND type = ? AND is_active = 1').all(item.id, b.type);
      const ins = db.prepare(`INSERT INTO inspection_lines (inspection_id,characteristic,spec_min,spec_max,spec_text)
        VALUES (?,?,?,?,?)`);
      plans.forEach(p => ins.run(inspId, p.characteristic, p.spec_min, p.spec_max, p.spec_text));

      logAudit(req, 'auditInspectionAdd', { entityType: 'inspection', entityId: inspId, detail: `${no} · ${item.name}` });
      return inspId;
    });

    res.status(201).json(serializeInspection(db.prepare('SELECT * FROM inspections WHERE id = ?').get(id)));
  } catch (e) { next(e); }
});

const resultSchema = z.object({
  lines: z.array(z.object({
    id: z.coerce.number(),
    measuredValue: z.coerce.number().nullable().optional(),
    measuredText: z.string().max(1000).optional(),
    result: z.enum(['pass', 'fail', 'na']).optional(),
    notes: z.string().max(5000).optional()
  })).default([]),
  result: z.enum(['accepted', 'rejected', 'conditional']),
  acceptedQty: z.coerce.number().min(0).optional(),
  rejectedQty: z.coerce.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  signaturePassword: z.string().max(1000).optional()
});

/**
 * Recording an inspection result also moves the stock: accepted quantity is released
 * from quarantine to available, rejected quantity is blocked and an NCR is opened
 * automatically. Quality decisions and stock status can therefore never diverge.
 */
router.post('/inspections/:id/result', requirePermission('quality.write'), validate(resultSchema), (req, res, next) => {
  try {
    const insp = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id);
    if (!insp) throw new AppError('Muayene bulunamadı / Inspection not found', 404);
    if (insp.result !== 'pending') throw new AppError('Bu muayene zaten sonuçlandırılmış / Inspection already completed');

    const b = req.body;
    const out = db.txImmediate(() => {
      const upd = db.prepare('UPDATE inspection_lines SET measured_value=?, measured_text=?, result=?, notes=? WHERE id=? AND inspection_id=?');
      b.lines.forEach(l => upd.run(l.measuredValue ?? null, l.measuredText || null, l.result || null, l.notes || null, l.id, insp.id));

      const lot = insp.lot_id ? db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(insp.lot_id) : null;
      const totalQty = lot ? lot.qty : (insp.inspected_qty || 0);
      if (lot && (lot.qty <= 0 || Math.abs(lot.qty - insp.inspected_qty) > 1e-9)) {
        throw new AppError('Parti miktarı değişti; yeni muayene oluşturun / Lot quantity changed; create a new inspection', 409);
      }
      const rejectedQty = b.rejectedQty ?? (b.result === 'rejected' ? totalQty : 0);
      const acceptedQty = b.acceptedQty != null ? b.acceptedQty : Math.max(0, totalQty - rejectedQty);
      if (Math.abs(acceptedQty + rejectedQty - totalQty) > 1e-9 ||
          (b.result === 'accepted' && rejectedQty > 0) ||
          (b.result === 'rejected' && acceptedQty > 0)) {
        throw new AppError('Kabul ve ret miktarları karar ve toplam miktarla uyuşmalı / Disposition quantities must match the decision and total', 422);
      }
      if (new Set(b.lines.map(l => l.id)).size !== b.lines.length || b.lines.some(l =>
        !db.prepare('SELECT id FROM inspection_lines WHERE id=? AND inspection_id=?').get(l.id, insp.id))) {
        throw new AppError('Muayene satırları geçersiz / Invalid inspection lines', 422);
      }

      // Simple electronic signature: a tamper-evident hash of who signed what and when
      const signature = crypto.createHash('sha256')
        .update(`${insp.id}|${req.user.id}|${b.result}|${Date.now()}`).digest('hex').slice(0, 32);

      db.prepare(`UPDATE inspections SET result=?, accepted_qty=?, rejected_qty=?, inspected_by=?, inspected_at=?,
        signed_by=?, signed_at=?, signature_hash=?, notes=COALESCE(?, notes) WHERE id=?`).run(
        b.result, acceptedQty, rejectedQty, req.user.id, Date.now(), req.user.id, Date.now(), signature,
        b.notes || null, insp.id);

      let ncrId = null;
      let rejectedLotId = insp.lot_id;
      if (lot) {
        if (rejectedQty > 0) {
          rejectedLotId = stock.changeLotStatus({ lotId: lot.id, toStatus: 'rejected', qty: rejectedQty,
            note: `Muayene ${insp.inspection_no} · kısmi red`, userId: req.user.id, refType: 'inspection', refId: insp.id });
        }
        if (acceptedQty > 0 && lot.status === 'quarantine') {
          stock.changeLotStatus({ lotId: lot.id, toStatus: 'available', qty: acceptedQty,
            note: `Muayene ${insp.inspection_no} · kabul`, userId: req.user.id, refType: 'inspection', refId: insp.id });
        }
      }

      if (b.result !== 'accepted') {
        ncrId = uuid();
        const ncrNo = nextNumber('ncr', 'UYG');
        db.prepare(`INSERT INTO ncrs (id,ncr_no,source,item_id,item_name,lot_id,lot_no,supplier_id,inspection_id,
          qty_affected,severity,description,disposition,status,opened_by,opened_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending','open',?,?)`).run(
          ncrId, ncrNo, insp.type, insp.item_id, insp.item_name, rejectedLotId, insp.lot_no, insp.supplier_id,
          insp.id, rejectedQty || insp.inspected_qty, b.result === 'rejected' ? 'major' : 'minor',
          `Muayene ${insp.inspection_no} sonucu: ${b.result}. ${b.notes || ''}`, req.user.id, Date.now());
      }

      logAudit(req, 'auditInspectionResult', { entityType: 'inspection', entityId: insp.id,
        oldValue: { result: 'pending' }, newValue: { result: b.result, acceptedQty, rejectedQty },
        detail: `${insp.inspection_no} → ${b.result}` });

      return { acceptedQty, rejectedQty, ncrId, signature };
    });

    res.json({ ok: true, ...out });
  } catch (e) { next(e); }
});

// ============================ NCR ============================
function serializeNcr(r) {
  return {
    id: r.id, ncrNo: r.ncr_no, source: r.source, itemId: r.item_id, itemName: r.item_name,
    lotId: r.lot_id, lotNo: r.lot_no, supplierId: r.supplier_id, customerId: r.customer_id,
    inspectionId: r.inspection_id, qtyAffected: r.qty_affected, severity: r.severity,
    description: r.description, disposition: r.disposition, status: r.status,
    openedAt: r.opened_at, closedAt: r.closed_at,
    capas: db.prepare('SELECT * FROM capas WHERE ncr_id = ?').all(r.id).map(c => ({
      id: c.id, capaNo: c.capa_no, type: c.type, rootCause: c.root_cause, actionPlan: c.action_plan,
      responsibleUserId: c.responsible_user_id, dueDate: c.due_date, status: c.status,
      effectivenessCheck: c.effectiveness_check
    }))
  };
}

router.get('/ncrs', validateQuery(pageQuery.extend({ status: z.string().max(1000).optional(), supplierId: z.coerce.number().optional() })), (req, res) => {
  const q = req.validatedQuery;
  const where = ['1=1']; const params = [];
  if (q.status) { where.push('status = ?'); params.push(q.status); }
  if (q.supplierId) { where.push('supplier_id = ?'); params.push(q.supplierId); }
  if (q.q) { where.push('(ncr_no LIKE ? OR item_name LIKE ?)'); const l = `%${q.q}%`; params.push(l, l); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM ncrs WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM ncrs WHERE ${whereSql} ORDER BY opened_at DESC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  res.json({ data: rows.map(serializeNcr), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
});

const ncrSchema = z.object({
  source: z.enum(['incoming', 'in_process', 'final', 'customer', 'internal']),
  itemId: z.string().nullable().optional(),
  lotId: z.string().nullable().optional(),
  supplierId: z.coerce.number().nullable().optional(),
  customerId: z.coerce.number().nullable().optional(),
  qtyAffected: z.coerce.number().min(0).optional(),
  severity: z.enum(['minor', 'major', 'critical']).default('minor'),
  description: z.string().trim().min(1).max(200)
});

router.post('/ncrs', requirePermission('quality.write'), validate(ncrSchema), (req, res, next) => {
  try {
    const b = req.body;
    const id = db.txImmediate(() => {
      const ncrId = uuid();
      const no = nextNumber('ncr', 'UYG');
      const item = b.itemId ? db.prepare('SELECT name FROM items WHERE id = ?').get(b.itemId) : null;
      const lot = b.lotId ? db.prepare('SELECT lot_no FROM stock_lots WHERE id = ?').get(b.lotId) : null;
      db.prepare(`INSERT INTO ncrs (id,ncr_no,source,item_id,item_name,lot_id,lot_no,supplier_id,customer_id,
        qty_affected,severity,description,disposition,status,opened_by,opened_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending','open',?,?)`).run(
        ncrId, no, b.source, b.itemId || null, item ? item.name : null, b.lotId || null, lot ? lot.lot_no : null,
        b.supplierId ?? null, b.customerId ?? null, b.qtyAffected ?? null, b.severity, b.description,
        req.user.id, Date.now());
      logAudit(req, 'auditNcrAdd', { entityType: 'ncr', entityId: ncrId, newValue: { ncrNo: no, severity: b.severity }, detail: no });
      return ncrId;
    });
    const serialized = serializeNcr(db.prepare('SELECT * FROM ncrs WHERE id = ?').get(id));
    dispatchEvent('ncr.opened', serialized, companyIdOf(req));
    res.status(201).json(serialized);
  } catch (e) { next(e); }
});

const dispositionSchema = z.object({
  disposition: z.enum(['use_as_is', 'rework', 'return_to_supplier', 'scrap']),
  note: z.string().max(5000).optional()
});

/** Disposition drives the stock: scrap removes it, use-as-is releases it, etc. */
router.post('/ncrs/:id/disposition', requirePermission('quality.write'), validate(dispositionSchema), (req, res, next) => {
  try {
    const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
    if (!ncr) throw new AppError('Uygunsuzluk bulunamadı / NCR not found', 404);
    const b = req.body;

    db.txImmediate(() => {
      const lot = ncr.lot_id ? db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(ncr.lot_id) : null;
      if (lot) {
        if (b.disposition === 'use_as_is') {
          stock.changeLotStatus({ lotId: lot.id, toStatus: 'available', note: `${ncr.ncr_no} · şartlı kabul`,
            userId: req.user.id, refType: 'ncr', refId: ncr.id });
        } else if (b.disposition === 'scrap') {
          stock.issueStock({ itemId: lot.item_id, qty: Math.min(lot.qty, ncr.qty_affected || lot.qty),
            warehouseId: lot.warehouse_id, refType: 'ncr', refId: ncr.id,
            note: `${ncr.ncr_no} · hurdaya ayrıldı`, userId: req.user.id, allowPartial: true });
        } else if (b.disposition === 'rework' || b.disposition === 'return_to_supplier') {
          stock.changeLotStatus({ lotId: lot.id, toStatus: 'blocked', note: `${ncr.ncr_no} · ${b.disposition}`,
            userId: req.user.id, refType: 'ncr', refId: ncr.id });
        }
      }
      db.prepare(`UPDATE ncrs SET disposition=?, status='in_progress' WHERE id=?`).run(b.disposition, ncr.id);
      logAudit(req, 'auditNcrDisposition', { entityType: 'ncr', entityId: ncr.id,
        oldValue: { disposition: ncr.disposition }, newValue: { disposition: b.disposition }, detail: ncr.ncr_no });
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/ncrs/:id/close', requirePermission('quality.write'), (req, res, next) => {
  try {
    const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
    if (!ncr) throw new AppError('Uygunsuzluk bulunamadı / NCR not found', 404);
    db.prepare(`UPDATE ncrs SET status='closed', closed_by=?, closed_at=? WHERE id=?`).run(req.user.id, Date.now(), ncr.id);
    logAudit(req, 'auditNcrClose', { entityType: 'ncr', entityId: ncr.id, detail: ncr.ncr_no });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================ CAPA ============================
const capaSchema = z.object({
  ncrId: z.string().nullable().optional(),
  type: z.enum(['corrective', 'preventive']).default('corrective'),
  rootCause: z.string().max(5000).optional(),
  actionPlan: z.string().trim().min(1).max(200),
  responsibleUserId: z.coerce.number().nullable().optional(),
  dueDate: z.string().nullable().optional()
});

router.get('/capas', (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.username AS responsible, n.ncr_no FROM capas c
    LEFT JOIN users u ON u.id = c.responsible_user_id LEFT JOIN ncrs n ON n.id = c.ncr_id
    ORDER BY c.opened_at DESC LIMIT 200`).all();
  res.json(rows.map(r => ({
    id: r.id, capaNo: r.capa_no, ncrId: r.ncr_id, ncrNo: r.ncr_no, type: r.type, rootCause: r.root_cause,
    actionPlan: r.action_plan, responsible: r.responsible, dueDate: r.due_date, status: r.status,
    effectivenessCheck: r.effectiveness_check, openedAt: r.opened_at, closedAt: r.closed_at
  })));
});

router.post('/capas', requirePermission('quality.write'), validate(capaSchema), (req, res, next) => {
  try {
    const b = req.body;
    const id = db.txImmediate(() => {
      const capaId = uuid();
      const no = nextNumber('capa', 'DOF');
      db.prepare(`INSERT INTO capas (id,capa_no,ncr_id,type,root_cause,action_plan,responsible_user_id,due_date,status,opened_at)
        VALUES (?,?,?,?,?,?,?,?, 'open',?)`).run(capaId, no, b.ncrId || null, b.type, b.rootCause || '',
        b.actionPlan, b.responsibleUserId ?? null, b.dueDate || null, Date.now());
      logAudit(req, 'auditCapaAdd', { entityType: 'capa', entityId: capaId, detail: no });
      return capaId;
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

router.post('/capas/:id/close', requirePermission('quality.write'), (req, res, next) => {
  try {
    const capa = db.prepare('SELECT * FROM capas WHERE id = ?').get(req.params.id);
    if (!capa) throw new AppError('DÖF bulunamadı / CAPA not found', 404);
    db.prepare(`UPDATE capas SET status='closed', closed_at=?, effectiveness_check=? WHERE id=?`)
      .run(Date.now(), req.body.effectivenessCheck || '', capa.id);
    logAudit(req, 'auditCapaClose', { entityType: 'capa', entityId: capa.id, detail: capa.capa_no });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================ EQUIPMENT / CALIBRATION ============================
const equipSchema = z.object({
  code: z.string().max(1000).optional(),
  name: z.string().trim().min(1).max(200),
  serialNo: z.string().max(1000).optional(),
  location: z.string().max(1000).optional(),
  calibrationIntervalDays: z.coerce.number().int().min(1).default(365),
  lastCalibrationDate: z.string().nullable().optional(),
  notes: z.string().max(5000).optional()
});

router.get('/equipment', (req, res) => {
  const rows = db.prepare('SELECT * FROM equipment ORDER BY next_calibration_date').all();
  res.json(rows.map(r => ({
    id: r.id, code: r.code, name: r.name, serialNo: r.serial_no, location: r.location,
    calibrationIntervalDays: r.calibration_interval_days, lastCalibrationDate: r.last_calibration_date,
    nextCalibrationDate: r.next_calibration_date, status: r.status, notes: r.notes,
    overdue: r.next_calibration_date ? r.next_calibration_date < today() : false,
    history: db.prepare('SELECT * FROM calibrations WHERE equipment_id = ? ORDER BY calibration_date DESC LIMIT 20').all(r.id)
      .map(c => ({ id: c.id, date: c.calibration_date, nextDue: c.next_due_date, performedBy: c.performed_by,
        certificateNo: c.certificate_no, result: c.result, notes: c.notes }))
  })));
});

router.post('/equipment', requirePermission('quality.write'), validate(equipSchema), (req, res, next) => {
  try {
    const b = req.body;
    let next = null;
    if (b.lastCalibrationDate) {
      const d = new Date(b.lastCalibrationDate); d.setDate(d.getDate() + b.calibrationIntervalDays);
      next = d.toISOString().slice(0, 10);
    }
    const info = db.prepare(`INSERT INTO equipment (code,name,serial_no,location,calibration_interval_days,
      last_calibration_date,next_calibration_date,notes) VALUES (?,?,?,?,?,?,?,?)`).run(
      b.code || null, b.name, b.serialNo || null, b.location || null, b.calibrationIntervalDays,
      b.lastCalibrationDate || null, next, b.notes || null);
    logAudit(req, 'auditEquipmentAdd', { entityType: 'equipment', entityId: info.lastInsertRowid, detail: b.name });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) { next(e); }
});

const calSchema = z.object({
  calibrationDate: z.string(),
  performedBy: z.string().max(1000).optional(),
  certificateNo: z.string().max(1000).optional(),
  result: z.enum(['pass', 'fail', 'adjusted']).default('pass'),
  notes: z.string().max(5000).optional()
});

router.post('/equipment/:id/calibrations', requirePermission('quality.write'), validate(calSchema), (req, res, next) => {
  try {
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
    if (!eq) throw new AppError('Cihaz bulunamadı / Equipment not found', 404);
    const b = req.body;
    const nextDue = new Date(b.calibrationDate);
    nextDue.setDate(nextDue.getDate() + eq.calibration_interval_days);
    const nextStr = nextDue.toISOString().slice(0, 10);

    db.txImmediate(() => {
      db.prepare(`INSERT INTO calibrations (equipment_id,calibration_date,next_due_date,performed_by,certificate_no,result,notes,recorded_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(eq.id, b.calibrationDate, nextStr, b.performedBy || null,
        b.certificateNo || null, b.result, b.notes || null, Date.now());
      db.prepare(`UPDATE equipment SET last_calibration_date=?, next_calibration_date=?,
        status = CASE WHEN ? = 'fail' THEN 'out_of_service' ELSE status END WHERE id=?`)
        .run(b.calibrationDate, nextStr, b.result, eq.id);
      logAudit(req, 'auditCalibration', { entityType: 'equipment', entityId: eq.id,
        newValue: { date: b.calibrationDate, result: b.result }, detail: eq.name });
    });

    res.status(201).json({ ok: true, nextDueDate: nextStr });
  } catch (e) { next(e); }
});

// ============================ TRACEABILITY / RECALL ============================
router.get('/trace/backward/:lotId', (req, res, next) => {
  try {
    const tree = trace.traceBackward(req.params.lotId);
    if (!tree) throw new AppError('Parti bulunamadı / Lot not found', 404);
    res.json(tree);
  } catch (e) { next(e); }
});

router.get('/trace/forward/:lotId', (req, res, next) => {
  try {
    const tree = trace.traceForward(req.params.lotId);
    if (!tree) throw new AppError('Parti bulunamadı / Lot not found', 404);
    res.json(tree);
  } catch (e) { next(e); }
});

router.get('/recall/:lotId', (req, res, next) => {
  try { res.json(trace.recallReport(req.params.lotId)); } catch (e) { next(e); }
});

module.exports = router;
