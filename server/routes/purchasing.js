// @ts-nocheck
const express = require('express');
const db = require('../db');
const { AppError, uuid, nextNumber, logAudit, diff, fxRate, paginate } = require('../lib/core');
const { toLocalDateStr, isValidLocalDate } = require('../lib/dates');
const { companyIdOf } = require('../lib/tenant');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const kvkk = require('../lib/kvkk');
const { validate, validatePartial, validateQuery, z, pageQuery, currency, optionalDate } = require('../middleware/validate');
const stock = require('../services/stock');
const costing = require('../services/costing');
const { dispatchEvent } = require('../lib/webhooks');
const payments = require('../services/invoice-payments');

const router = express.Router();
router.use(requireAuth);

// ============================ SUPPLIERS ============================
const supplierSchema = z.object({
  code: z.string().max(1000).optional(),
  name: z.string().trim().min(1).max(200),
  contactPerson: z.string().max(1000).optional(),
  phone: z.string().max(1000).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(5000).optional(),
  country: z.string().max(1000).optional(),
  taxNo: z.string().max(1000).optional(),
  currency: currency.default('TRY'),
  paymentTermsDays: z.coerce.number().int().min(0).default(30),
  leadTimeDays: z.coerce.number().int().min(0).default(7),
  incoterm: z.string().max(1000).optional(),
  bankInfo: z.string().max(1000).optional(),
  isApproved: z.coerce.boolean().default(true),
  notes: z.string().max(5000).optional()
});

router.get('/suppliers', validateQuery(pageQuery), (req, res) => {
  const q = req.validatedQuery;
  const where = ['is_active = 1']; const params = [];
  if (q.q) { where.push('(name LIKE ? OR code LIKE ? OR contact_person LIKE ?)'); const l = `%${q.q}%`; params.push(l, l, l); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM suppliers WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM suppliers WHERE ${whereSql} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  res.json({
    data: rows.map(serializeSupplier), page: q.page, pageSize: q.pageSize, total,
    totalPages: Math.ceil(total / q.pageSize)
  });
});

function serializeSupplier(r) {
  return {
    id: r.id, code: r.code, name: r.name, contactPerson: r.contact_person, phone: r.phone, email: r.email,
    address: r.address, country: r.country, taxNo: r.tax_no, currency: r.currency,
    paymentTermsDays: r.payment_terms_days, leadTimeDays: r.lead_time_days, incoterm: r.incoterm,
    bankInfo: r.bank_info, isApproved: !!r.is_approved, notes: r.notes, anonymizedAt: r.anonymized_at
  };
}

router.get('/suppliers/:id', (req, res, next) => {
  try {
    const r = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!r) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
    const out = serializeSupplier(r);
    out.priceHistory = db.prepare(`SELECT ph.*, i.name AS item_name FROM supplier_price_history ph
      LEFT JOIN items i ON i.id = ph.item_id WHERE ph.supplier_id = ? ORDER BY ph.recorded_at DESC LIMIT 100`).all(r.id)
      .map(p => ({ itemName: p.item_name, price: p.price, currency: p.currency, source: p.source, recordedAt: p.recorded_at }));
    out.performance = supplierPerformance(r.id);
    res.json(out);
  } catch (e) { next(e); }
});

/** On-time delivery, rejection rate and NCR count — the numbers that decide who keeps the business. */
function supplierPerformance(supplierId) {
  const receipts = db.prepare(`SELECT r.received_at, po.expected FROM po_receipts r
    JOIN purchase_orders po ON po.id = r.po_id WHERE po.supplier_id = ?`).all(supplierId);
  const withExpected = receipts.filter(r => r.expected);
  const onTime = withExpected.filter(r => toLocalDateStr(r.received_at) <= r.expected).length;

  const qty = db.prepare(`SELECT COALESCE(SUM(pi.received_qty),0) recv, COALESCE(SUM(pi.rejected_qty),0) rej
    FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE po.supplier_id = ?`).get(supplierId);
  const ncrCount = db.prepare(`SELECT COUNT(*) c FROM ncrs WHERE supplier_id = ?`).get(supplierId).c;
  const poCount = db.prepare(`SELECT COUNT(*) c FROM purchase_orders WHERE supplier_id = ?`).get(supplierId).c;
  const totalReceived = qty.recv + qty.rej;

  return {
    purchaseOrders: poCount,
    receipts: receipts.length,
    onTimeDeliveryPct: withExpected.length ? Math.round((onTime / withExpected.length) * 100) : null,
    rejectionRatePct: totalReceived > 0 ? Math.round((qty.rej / totalReceived) * 10000) / 100 : 0,
    ncrCount,
    qualityScore: totalReceived > 0
      ? Math.max(0, Math.round(100 - (qty.rej / totalReceived) * 100 - ncrCount * 2))
      : null
  };
}

router.post('/suppliers', requirePermission('purchase.write'), validate(supplierSchema), (req, res, next) => {
  try {
    const b = req.body;
    const info = db.prepare(`INSERT INTO suppliers (code,name,contact_person,phone,email,address,country,tax_no,
      currency,payment_terms_days,lead_time_days,incoterm,bank_info,is_approved,notes,created_at,company_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.code || null, b.name, b.contactPerson || null, b.phone || null, b.email || null, b.address || null,
      b.country || null, b.taxNo || null, b.currency, b.paymentTermsDays, b.leadTimeDays,
      b.incoterm || null, b.bankInfo || null, b.isApproved ? 1 : 0, b.notes || null, Date.now(), companyIdOf(req));
    logAudit(req, 'auditSupplierAdd', { entityType: 'supplier', entityId: info.lastInsertRowid, newValue: { name: b.name }, detail: b.name });
    res.status(201).json(serializeSupplier(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.put('/suppliers/:id', requirePermission('purchase.write'), validatePartial(supplierSchema), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
    if (existing.anonymized_at) throw new AppError('Anonimleştirilmiş tedarikçi düzenlenemez / Anonymized supplier cannot be edited', 409);
    const b = req.body;
    db.prepare(`UPDATE suppliers SET code=@code,name=@name,contact_person=@cp,phone=@phone,email=@email,address=@address,
      country=@country,tax_no=@tax,currency=@currency,payment_terms_days=@pt,lead_time_days=@lt,incoterm=@inc,
      bank_info=@bank,is_approved=@appr,notes=@notes WHERE id=@id`).run({
      id: existing.id, code: b.code ?? existing.code, name: b.name ?? existing.name,
      cp: b.contactPerson ?? existing.contact_person, phone: b.phone ?? existing.phone, email: b.email ?? existing.email,
      address: b.address ?? existing.address, country: b.country ?? existing.country, tax: b.taxNo ?? existing.tax_no,
      currency: b.currency ?? existing.currency, pt: b.paymentTermsDays ?? existing.payment_terms_days,
      lt: b.leadTimeDays ?? existing.lead_time_days, inc: b.incoterm ?? existing.incoterm,
      bank: b.bankInfo ?? existing.bank_info,
      appr: b.isApproved != null ? (b.isApproved ? 1 : 0) : existing.is_approved, notes: b.notes ?? existing.notes
    });
    const after = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(existing.id);
    const d = diff(existing, after, ['name','contact_person','phone','email','currency','payment_terms_days','lead_time_days','is_approved']);
    logAudit(req, 'auditSupplierEdit', { entityType: 'supplier', entityId: existing.id, ...(d || {}), detail: after.name });
    res.json(serializeSupplier(after));
  } catch (e) { next(e); }
});

router.delete('/suppliers/:id', requirePermission('stock.delete'), (req, res, next) => {
  try {
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!s) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
    if (s.anonymized_at) throw new AppError('Anonimleştirilmiş tedarikçi düzenlenemez / Anonymized supplier cannot be edited', 409);
    db.prepare('UPDATE suppliers SET is_active = 0, deactivated_at = COALESCE(deactivated_at, ?) WHERE id = ?').run(Date.now(), s.id);
    logAudit(req, 'auditSupplierDelete', { entityType: 'supplier', entityId: s.id, detail: s.name });
    res.status(204).end();
  } catch (e) { next(e); }
});

/** KVKK m.7 — geri döndürülemez anonimleştirme (bkz. server/lib/kvkk.js). */
router.post('/suppliers/:id/anonymize', requireRole('admin'), (req, res, next) => {
  try { res.json(kvkk.anonymizeSupplier(req, req.params.id)); } catch (e) { next(e); }
});

/** KVKK m.11/b — "hangi veriyi tutuyoruz" dışa aktarım raporu. */
router.get('/suppliers/:id/data-export', requireRole('admin'), (req, res, next) => {
  try { res.json(kvkk.exportSupplierData(req.params.id)); } catch (e) { next(e); }
});

// ============================ PURCHASE REQUESTS ============================
const prSchema = z.object({
  department: z.string().max(1000).optional(),
  neededBy: optionalDate,
  notes: z.string().max(5000).optional(),
  lines: z.array(z.object({
    itemId: z.string().nullable().optional(),
    itemName: z.string().trim().max(1000).optional(),
    qty: z.coerce.number().positive(),
    unit: z.string().max(1000).optional(),
    notes: z.string().max(5000).optional()
  })).min(1)
});

router.get('/requests', validateQuery(pageQuery), (req, res) => {
  const { page, pageSize } = req.validatedQuery;
  const result = paginate(`SELECT pr.*, u.username AS requester FROM purchase_requests pr
    LEFT JOIN users u ON u.id = pr.requested_by ORDER BY pr.created_at DESC, pr.id`, [], page, pageSize);
  res.json({ ...result, data: result.data.map(r => ({
    id: r.id, requestNo: r.request_no, requester: r.requester, department: r.department,
    neededBy: r.needed_by, status: r.status, notes: r.notes, createdAt: r.created_at,
    lines: db.prepare('SELECT item_id AS itemId, item_name AS itemName, qty, unit, notes FROM purchase_request_lines WHERE request_id = ?').all(r.id)
  })) });
});

router.post('/requests', requirePermission('purchase.write'), validate(prSchema), (req, res, next) => {
  try {
    const id = db.txImmediate(() => {
      const reqId = uuid();
      const no = nextNumber('purchase_request', 'TAL');
      db.prepare(`INSERT INTO purchase_requests (id,request_no,requested_by,department,needed_by,status,notes,created_at)
        VALUES (?,?,?,?,?,'submitted',?,?)`).run(reqId, no, req.user.id, req.body.department || null,
        req.body.neededBy || null, req.body.notes || '', Date.now());
      const ins = db.prepare('INSERT INTO purchase_request_lines (request_id,item_id,item_name,qty,unit,notes) VALUES (?,?,?,?,?,?)');
      req.body.lines.forEach(l => {
        const item = l.itemId ? db.prepare('SELECT name, unit FROM items WHERE id = ? AND deleted_at IS NULL').get(l.itemId) : null;
        if (l.itemId && !item) throw new AppError('Ürün bulunamadı / Item not found', 404);
        if (!l.itemId && !l.itemName) throw new AppError('Satırda ürün veya ürün adı gerekli / Item or item name required', 422);
        ins.run(reqId, l.itemId || null, item ? item.name : (l.itemName || '—'), l.qty, l.unit || (item ? item.unit : null), l.notes || null);
      });
      logAudit(req, 'auditRequestAdd', { entityType: 'purchase_request', entityId: reqId, detail: no });
      return reqId;
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

/** Estimated request value (item moving average × qty) for approval rules. */
function requestValueBase(requestId) {
  return db.prepare(`SELECT COALESCE(SUM(l.qty * COALESCE(i.avg_cost, 0)), 0) v FROM purchase_request_lines l
    LEFT JOIN items i ON i.id = l.item_id WHERE l.request_id = ?`).get(requestId).v;
}

router.post('/requests/:id/approve', requirePermission('purchase.approve'), (req, res, next) => {
  try {
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id);
    if (!pr) throw new AppError('Talep bulunamadı / Request not found', 404);
    if (pr.status === 'approved') return res.json({ ok: true, alreadyApproved: true });
    if (pr.status !== 'submitted') throw new AppError('Bu talep onaylanamaz / Request cannot be approved in its current state', 409);
    const rule = db.prepare(`SELECT * FROM approval_rules WHERE doc_type='purchase_request' AND is_active=1
      AND threshold_base <= ? ORDER BY threshold_base DESC LIMIT 1`).get(requestValueBase(pr.id));
    if (rule && req.user.role !== 'admin' && req.user.role !== rule.required_role) {
      throw new AppError('Bu talebi onaylama yetkiniz yok / Approval requires role: ' + rule.required_role, 403);
    }
    const changed = db.prepare(`UPDATE purchase_requests SET status='approved', approved_by=?, approved_at=? WHERE id=? AND status='submitted'`)
      .run(req.user.id, Date.now(), pr.id).changes;
    if (changed !== 1) throw new AppError('Talep eşzamanlı olarak değiştirildi / Request changed concurrently', 409);
    logAudit(req, 'auditRequestApprove', { entityType: 'purchase_request', entityId: pr.id,
      oldValue: { status: pr.status }, newValue: { status: 'approved' }, detail: pr.request_no });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/requests/:id/reject', requirePermission('purchase.approve'), (req, res, next) => {
  try {
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id);
    if (!pr) throw new AppError('Talep bulunamadı / Request not found', 404);
    if (pr.status === 'rejected') return res.json({ ok: true, alreadyRejected: true });
    if (pr.status !== 'submitted') throw new AppError('Bu talep reddedilemez / Request cannot be rejected in its current state', 409);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
    db.prepare(`UPDATE purchase_requests SET status='rejected', approved_by=?, approved_at=?, reject_reason=? WHERE id=? AND status='submitted'`)
      .run(req.user.id, Date.now(), reason, pr.id);
    logAudit(req, 'auditRequestReject', { entityType: 'purchase_request', entityId: pr.id, detail: pr.request_no });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================ RFQ ============================
const rfqSchema = z.object({
  requestId: z.string().nullable().optional(),
  dueDate: optionalDate,
  notes: z.string().max(5000).optional(),
  lines: z.array(z.object({ itemId: z.string(), qty: z.coerce.number().positive() })).min(1),
  supplierIds: z.array(z.coerce.number()).default([])
});

router.get('/rfqs', validateQuery(pageQuery), (req, res) => {
  const { page, pageSize } = req.validatedQuery;
  const result = paginate('SELECT * FROM rfqs ORDER BY created_at DESC, id', [], page, pageSize);
  res.json({ ...result, data: result.data.map(r => ({
    id: r.id, rfqNo: r.rfq_no, status: r.status, dueDate: r.due_date, notes: r.notes,
    awardedSupplierId: r.awarded_supplier_id, createdAt: r.created_at,
    lines: db.prepare('SELECT item_id AS itemId, item_name AS itemName, qty FROM rfq_lines WHERE rfq_id = ?').all(r.id),
    quotes: db.prepare(`SELECT q.*, s.name AS supplier_name, i.name AS item_name FROM rfq_quotes q
      LEFT JOIN suppliers s ON s.id = q.supplier_id LEFT JOIN items i ON i.id = q.item_id
      WHERE q.rfq_id = ?`).all(r.id).map(q => ({
        id: q.id, supplierId: q.supplier_id, supplier: q.supplier_name, itemId: q.item_id, itemName: q.item_name,
        unitPrice: q.unit_price, currency: q.currency, leadTimeDays: q.lead_time_days, validUntil: q.valid_until, notes: q.notes
      }))
  })) });
});

router.post('/rfqs', requirePermission('purchase.write'), validate(rfqSchema), (req, res, next) => {
  try {
    const id = db.txImmediate(() => {
      const rfqId = uuid();
      const no = nextNumber('rfq', 'TEK');
      db.prepare(`INSERT INTO rfqs (id,rfq_no,request_id,status,due_date,notes,created_by,created_at)
        VALUES (?,?,?,'open',?,?,?,?)`).run(rfqId, no, req.body.requestId || null, req.body.dueDate || null,
        req.body.notes || '', req.user.id, Date.now());
      const ins = db.prepare('INSERT INTO rfq_lines (rfq_id,item_id,item_name,qty) VALUES (?,?,?,?)');
      for (const supplierId of req.body.supplierIds) {
        if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
      }
      req.body.lines.forEach(l => {
        const item = db.prepare('SELECT name FROM items WHERE id = ? AND deleted_at IS NULL').get(l.itemId);
        if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);
        ins.run(rfqId, l.itemId, item ? item.name : '—', l.qty);
      });
      logAudit(req, 'auditRfqAdd', { entityType: 'rfq', entityId: rfqId, detail: no });
      return rfqId;
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

const quoteSchema = z.object({
  supplierId: z.coerce.number(),
  itemId: z.string(),
  unitPrice: z.coerce.number().min(0),
  currency: currency.default('TRY'),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  validUntil: optionalDate,
  notes: z.string().max(5000).optional()
});

router.post('/rfqs/:id/quotes', requirePermission('purchase.write'), validate(quoteSchema), (req, res, next) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) throw new AppError('Teklif talebi bulunamadı / RFQ not found', 404);
    const b = req.body;
    if (rfq.status !== 'open') throw new AppError('Teklif talebi kapalı / RFQ is closed', 409);
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(b.supplierId)) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
    if (!db.prepare('SELECT id FROM items WHERE id = ?').get(b.itemId)) throw new AppError('Ürün bulunamadı / Item not found', 404);
    if (!db.prepare('SELECT 1 FROM rfq_lines WHERE rfq_id = ? AND item_id = ?').get(rfq.id, b.itemId)) {
      throw new AppError('Ürün bu teklif talebinde yok / Item is not part of this RFQ', 422);
    }
    db.txImmediate(() => {
      db.prepare(`INSERT INTO rfq_quotes (rfq_id,supplier_id,item_id,unit_price,currency,lead_time_days,valid_until,notes)
        VALUES (?,?,?,?,?,?,?,?)`).run(rfq.id, b.supplierId, b.itemId, b.unitPrice, b.currency,
        b.leadTimeDays ?? null, b.validUntil || null, b.notes || null);
      db.prepare(`INSERT INTO supplier_price_history (supplier_id,item_id,price,currency,source,source_id,recorded_at)
        VALUES (?,?,?,?,'rfq',?,?)`).run(b.supplierId, b.itemId, b.unitPrice, b.currency, rfq.id, Date.now());
    });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

/** Side-by-side comparison, normalised to base currency so quotes in USD/EUR are comparable. */
router.get('/rfqs/:id/compare', (req, res, next) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) throw new AppError('Teklif talebi bulunamadı / RFQ not found', 404);
    const lines = db.prepare('SELECT * FROM rfq_lines WHERE rfq_id = ?').all(rfq.id);
    const out = lines.map(line => {
      const quotes = db.prepare(`SELECT q.*, s.name AS supplier_name, s.lead_time_days AS supplier_lead
        FROM rfq_quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.rfq_id = ? AND q.item_id = ?`).all(rfq.id, line.item_id)
        .map(q => {
          const rate = fxRate(q.currency);
          const unitBase = q.unit_price * rate;
          return {
            supplierId: q.supplier_id, supplier: q.supplier_name, unitPrice: q.unit_price, currency: q.currency,
            unitPriceBase: unitBase, totalBase: unitBase * line.qty,
            leadTimeDays: q.lead_time_days ?? q.supplier_lead, validUntil: q.valid_until
          };
        }).sort((a, b) => a.unitPriceBase - b.unitPriceBase);
      return { itemId: line.item_id, itemName: line.item_name, qty: line.qty, quotes, best: quotes[0] || null };
    });
    res.json({ rfqNo: rfq.rfq_no, lines: out });
  } catch (e) { next(e); }
});

// ============================ PURCHASE ORDERS ============================
function approvalRequired(totalBase) {
  const rule = db.prepare(`SELECT * FROM approval_rules WHERE doc_type='purchase_order' AND is_active=1
    AND threshold_base <= ? ORDER BY threshold_base DESC LIMIT 1`).get(totalBase);
  return rule || null;
}

function serializePO(r) {
  const items = db.prepare(`SELECT pi.*, i.unit FROM po_items pi LEFT JOIN items i ON i.id = pi.item_id WHERE pi.po_id = ?`)
    .all(r.id).map(x => ({
      id: x.id, itemId: x.item_id, itemName: x.item_name, unit: x.unit, qty: x.qty,
      receivedQty: x.received_qty, rejectedQty: x.rejected_qty, remainingQty: x.qty - x.received_qty,
      price: x.price, currency: x.currency, fxRate: x.fx_rate, tolerancePct: x.over_delivery_tolerance_pct
    }));
  const wh = r.warehouse_id ? db.prepare('SELECT name FROM warehouses WHERE id = ?').get(r.warehouse_id) : null;
  const receipts = db.prepare(`SELECT id, receipt_no, received_at, waybill_no FROM po_receipts WHERE po_id = ? ORDER BY received_at`).all(r.id);
  const landed = db.prepare('SELECT * FROM landed_costs WHERE po_id = ?').all(r.id);
  return {
    id: r.id, poNo: r.po_no, supplierId: r.supplier_id, supplier: r.supplier_name, date: r.date,
    expected: r.expected, warehouseId: r.warehouse_id, warehouse: wh ? wh.name : null,
    currency: r.currency, fxRate: r.fx_rate, incoterm: r.incoterm, status: r.status,
    approvalStatus: r.approval_status, approvedBy: r.approved_by, approvedAt: r.approved_at,
    revision: r.revision, totalBase: r.total_base, notes: r.notes, createdAt: r.created_at,
    items,
    receipts: receipts.map(x => ({ id: x.id, receiptNo: x.receipt_no, receivedAt: x.received_at, waybillNo: x.waybill_no })),
    landedCosts: landed.map(l => ({ id: l.id, costType: l.cost_type, amount: l.amount, currency: l.currency, method: l.allocation_method }))
  };
}

router.get('/orders', validateQuery(pageQuery.extend({ status: z.string().max(1000).optional(), supplierId: z.coerce.number().optional() })), (req, res) => {
  const q = req.validatedQuery;
  const where = ['1=1']; const params = [];
  if (q.status) { where.push('po.status = ?'); params.push(q.status); }
  if (q.supplierId) { where.push('po.supplier_id = ?'); params.push(q.supplierId); }
  if (q.q) { where.push('(po.po_no LIKE ? OR po.supplier_name LIKE ?)'); const l = `%${q.q}%`; params.push(l, l); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM purchase_orders po WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM purchase_orders po WHERE ${whereSql} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  res.json({ data: rows.map(serializePO), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
});

router.get('/orders/:id', (req, res, next) => {
  try {
    const r = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!r) throw new AppError('Sipariş bulunamadı / Order not found', 404);
    res.json(serializePO(r));
  } catch (e) { next(e); }
});

const poSchema = z.object({
  supplierId: z.coerce.number(),
  requestId: z.string().nullable().optional(),
  rfqId: z.string().nullable().optional(),
  date: z.string().refine(isValidLocalDate, 'Geçerli tarih gerekli / Valid date required').nullable().optional(),
  expected: z.string().refine(isValidLocalDate, 'Geçerli tarih gerekli / Valid date required').nullable().optional(),
  warehouseId: z.coerce.number().nullable().optional(),
  currency: currency.default('TRY'),
  incoterm: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
  items: z.array(z.object({
    itemId: z.string(),
    qty: z.coerce.number().positive(),
    price: z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number().min(0)),
    currency: currency.optional(),
    tolerancePct: z.coerce.number().min(0).max(100).default(0)
  })).min(1)
});

router.post('/orders', requirePermission('purchase.write'), validate(poSchema), (req, res, next) => {
  try {
    const b = req.body;
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(b.supplierId);
    if (!supplier) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
    if (!supplier.is_active || supplier.anonymized_at) throw new AppError('Pasif tedarikçiye sipariş açılamaz / Supplier is inactive', 409);
    if (!supplier.is_approved) throw new AppError('Onaylı olmayan tedarikçiye sipariş açılamaz / Supplier is not approved');

    const result = db.txImmediate(() => {
      if (b.warehouseId && !db.prepare('SELECT id FROM warehouses WHERE id=?').get(b.warehouseId)) {
        throw new AppError('Depo bulunamadı / Warehouse not found', 404);
      }
      if (b.requestId && !db.prepare('SELECT id FROM purchase_requests WHERE id=?').get(b.requestId)) {
        throw new AppError('Satın alma talebi bulunamadı / Purchase request not found', 404);
      }
      if (b.rfqId && !db.prepare('SELECT id FROM rfqs WHERE id=?').get(b.rfqId)) {
        throw new AppError('Teklif talebi bulunamadı / RFQ not found', 404);
      }
      const findItem = db.prepare('SELECT name,is_active,deleted_at FROM items WHERE id=?');
      const itemLines = b.items.map(line => {
        const item = findItem.get(line.itemId);
        if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);
        if (!item.is_active || item.deleted_at) throw new AppError('Pasif ürün siparişe eklenemez / Inactive item cannot be ordered', 409);
        return { ...line, itemName: item.name };
      });
      const poId = uuid();
      const no = nextNumber('purchase_order', 'SA');
      const date = b.date || new Date().toISOString().slice(0, 10);
      // Lock the FX rate at order date so later rate edits never revalue this order
      const rate = fxRate(b.currency, date);

      let totalBase = 0;
      b.items.forEach(l => { totalBase += l.qty * l.price * fxRate(l.currency || b.currency, date); });

      const rule = approvalRequired(totalBase);
      const needsApproval = !!rule;

      db.prepare(`INSERT INTO purchase_orders (id,po_no,supplier_id,supplier_name,request_id,rfq_id,date,expected,
        warehouse_id,currency,fx_rate,incoterm,status,approval_status,total_base,notes,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        poId, no, supplier.id, supplier.name, b.requestId || null, b.rfqId || null, date,
        b.expected || null, b.warehouseId || null, b.currency, rate, b.incoterm || supplier.incoterm || null,
        needsApproval ? 'pending_approval' : 'approved',
        needsApproval ? 'pending' : 'not_required',
        totalBase, b.notes || '', req.user.id, Date.now());

      const ins = db.prepare(`INSERT INTO po_items (po_id,item_id,item_name,qty,price,currency,over_delivery_tolerance_pct,fx_rate)
        VALUES (?,?,?,?,?,?,?,?)`);
      const insHist = db.prepare(`INSERT INTO supplier_price_history (supplier_id,item_id,price,currency,source,source_id,recorded_at)
        VALUES (?,?,?,?,'po',?,?)`);
      itemLines.forEach(l => {
        ins.run(poId, l.itemId, l.itemName, l.qty, l.price, l.currency || b.currency, l.tolerancePct,
          fxRate(l.currency || b.currency, date));
        insHist.run(supplier.id, l.itemId, l.price, l.currency || b.currency, poId, Date.now());
      });

      db.prepare(`INSERT INTO po_revisions (po_id,revision,changed_by,changed_at,change_summary,snapshot)
        VALUES (?,?,?,?,?,?)`).run(poId, 1, req.user.id, Date.now(), 'Oluşturuldu / Created', JSON.stringify(b));

      logAudit(req, 'auditPOAdd', { entityType: 'purchase_order', entityId: poId,
        newValue: { poNo: no, totalBase, supplier: supplier.name }, detail: no });
      const serialized = { ...serializePO(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId)), approvalRequired: needsApproval };
      dispatchEvent('purchase_order.created', serialized, companyIdOf(req));

      return { poId, needsApproval, rule, totalBase };
    });

    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result.poId);
    const serialized = { ...serializePO(row), approvalRequired: result.needsApproval };
    res.status(201).json(serialized);
  } catch (e) { next(e); }
});

router.post('/orders/:id/approve', requirePermission('purchase.approve'), (req, res, next) => {
  try {
    db.txImmediate(() => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) throw new AppError('Sipariş bulunamadı / Order not found', 404);
    if (po.approval_status !== 'pending') throw new AppError('Bu sipariş onay bekliyor durumunda değil / Order is not pending approval');

    // Approver must personally be authorised for this amount, not just hold the role
    const approver = db.prepare('SELECT approval_limit, role FROM users WHERE id = ?').get(req.user.id);
    const rule = approvalRequired(po.total_base);
    if (rule && approver.role !== 'admin' && approver.role !== rule.required_role) {
      throw new AppError('Onay kuralının gerektirdiği role sahip değilsiniz / Required approval role missing', 403);
    }
    if (approver.role !== 'admin' && approver.approval_limit > 0 && po.total_base > approver.approval_limit) {
      throw new AppError(`Onay limitiniz (${approver.approval_limit}) bu tutar için yetersiz / Approval limit exceeded`, 403);
    }

    db.prepare(`UPDATE purchase_orders SET status='approved', approval_status='approved', approved_by=?, approved_at=? WHERE id=?`)
      .run(req.user.id, Date.now(), po.id);
    logAudit(req, 'auditPOApprove', { entityType: 'purchase_order', entityId: po.id,
      oldValue: { status: po.status }, newValue: { status: 'approved' }, detail: po.po_no });
    dispatchEvent('purchase_order.approved', { id: po.id, poNo: po.po_no, totalBase: po.total_base }, companyIdOf(req));
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/orders/:id/reject', requirePermission('purchase.approve'), (req, res, next) => {
  try {
    db.txImmediate(() => {
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
      if (!po) throw new AppError('Sipariş bulunamadı / Order not found', 404);
      if (po.status !== 'pending_approval' || po.approval_status !== 'pending') {
        throw new AppError('Yalnız onay bekleyen sipariş reddedilebilir / Only pending orders can be rejected', 409);
      }
      db.prepare(`UPDATE purchase_orders SET status='rejected', approval_status='rejected', approved_by=?, approved_at=?, reject_reason=? WHERE id=?`)
        .run(req.user.id, Date.now(), req.body.reason || '', po.id);
      logAudit(req, 'auditPOReject', { entityType: 'purchase_order', entityId: po.id, detail: po.po_no });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- PARTIAL RECEIPTS ----------------
const receiptSchema = z.object({
  waybillNo: z.string().max(1000).optional(),
  customsDeclNo: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
  lines: z.array(z.object({
    poItemId: z.coerce.number(),
    qty: z.coerce.number().positive(),
    lotNo: z.string().max(1000).optional(),
    expiryDate: z.string().refine(isValidLocalDate, 'Geçerli son kullanma tarihi gerekli / Valid expiry date required').nullable().optional()
  })).min(1)
});

/**
 * Partial receiving: you order 100, 60 arrives now, 40 later. Each receipt creates its
 * own lots. Items flagged for incoming inspection land in quarantine, so nothing reaches
 * production before QA releases it.
 */
router.post('/orders/:id/receipts', requirePermission('purchase.write'), validate(receiptSchema), (req, res, next) => {
  try {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) throw new AppError('Sipariş bulunamadı / Order not found', 404);
    if (!['approved', 'partially_received'].includes(po.status)) {
      throw new AppError('Sipariş teslim alınabilir durumda değil (onaylı olmalı) / Order must be approved', 400);
    }
    if (!po.warehouse_id) throw new AppError('Teslim alma için siparişte depo seçilmeli / Receiving requires an order warehouse', 422);

    const result = db.txImmediate(() => {
      const receiptId = uuid();
      const receiptNo = nextNumber('po_receipt', 'IRS');
      db.prepare(`INSERT INTO po_receipts (id,receipt_no,po_id,warehouse_id,received_at,received_by,waybill_no,customs_decl_no,notes)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(receiptId, receiptNo, po.id, po.warehouse_id, Date.now(), req.user.id,
        req.body.waybillNo || null, req.body.customsDeclNo || null, req.body.notes || '');

      const created = [];
      for (const line of req.body.lines) {
        const poItem = db.prepare('SELECT * FROM po_items WHERE id = ? AND po_id = ?').get(line.poItemId, po.id);
        if (!poItem) throw new AppError(`Sipariş kalemi bulunamadı / PO line not found: ${line.poItemId}`, 404);

        const maxAllowed = poItem.qty * (1 + (poItem.over_delivery_tolerance_pct || 0) / 100);
        const afterQty = poItem.received_qty + line.qty;
        if (afterQty > maxAllowed + 1e-9) {
          throw new AppError(
            `${poItem.item_name}: fazla teslim toleransı aşıldı (sipariş ${poItem.qty}, teslim ${afterQty}, izin ${maxAllowed}) / Over-delivery tolerance exceeded`, 400);
        }

        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(poItem.item_id);
        const rate = poItem.fx_rate;
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new AppError('Eski sipariş satırında sabit kur yok; kur mutabakatı gerekli / Historical order line requires FX reconciliation', 409);
        }
        const unitCostBase = poItem.price * rate;
        const toQuarantine = item && item.requires_incoming_inspection ? 1 : 0;

        const lotId = stock.receiveLot({
          itemId: poItem.item_id, warehouseId: po.warehouse_id, qty: line.qty,
          lotNo: line.lotNo || nextNumber('lot', 'LOT'), expiryDate: line.expiryDate || null,
          unitCostBase, status: toQuarantine ? 'quarantine' : 'available',
          sourceType: 'purchase', sourceId: receiptId, supplierId: po.supplier_id,
          note: `${po.po_no} · ${receiptNo}`, userId: req.user.id
        });

        db.prepare(`INSERT INTO po_receipt_lines (receipt_id,po_item_id,item_id,item_name,qty,lot_no,expiry_date,lot_id,to_quarantine,base_unit_cost)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(receiptId, poItem.id, poItem.item_id, poItem.item_name, line.qty,
          line.lotNo || null, line.expiryDate || null, lotId, toQuarantine, unitCostBase);

        db.prepare('UPDATE po_items SET received_qty = received_qty + ? WHERE id = ?').run(line.qty, poItem.id);
        created.push({ itemName: poItem.item_name, qty: line.qty, lotId, quarantined: !!toQuarantine });
      }

      // Fully vs partially received
      const remaining = db.prepare('SELECT COALESCE(SUM(MAX(0, qty - received_qty)),0) r FROM po_items WHERE po_id = ?').get(po.id).r;
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?')
        .run(remaining <= 1e-9 ? 'received' : 'partially_received', po.id);

      logAudit(req, 'auditPOReceive', { entityType: 'purchase_order', entityId: po.id,
        detail: `${po.po_no} · ${receiptNo} · ${created.length} kalem` });

      const result = { receiptId, receiptNo, created, fullyReceived: remaining <= 1e-9 };
      dispatchEvent('purchase_order.received', { poId: po.id, poNo: po.po_no, ...result }, companyIdOf(req));
      return result;
    });

    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.get('/receipts/:id', (req, res, next) => {
  try {
    const r = db.prepare(`SELECT r.*, po.po_no, s.name AS supplier_name FROM po_receipts r
      LEFT JOIN purchase_orders po ON po.id = r.po_id LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE r.id = ?`).get(req.params.id);
    if (!r) throw new AppError('İrsaliye bulunamadı / Receipt not found', 404);
    const lines = db.prepare(`SELECT rl.*, sl.unit_cost, sl.status AS lot_status FROM po_receipt_lines rl
      LEFT JOIN stock_lots sl ON sl.id = rl.lot_id WHERE rl.receipt_id = ?`).all(r.id);
    res.json({
      id: r.id, receiptNo: r.receipt_no, poId: r.po_id, poNo: r.po_no, supplier: r.supplier_name,
      receivedAt: r.received_at, waybillNo: r.waybill_no, customsDeclNo: r.customs_decl_no, notes: r.notes,
      lines: lines.map(l => ({
        id: l.id, itemId: l.item_id, itemName: l.item_name, qty: l.qty, lotNo: l.lot_no, lotId: l.lot_id,
        expiryDate: l.expiry_date, unitCost: l.unit_cost, lotStatus: l.lot_status, quarantined: !!l.to_quarantine
      })),
      landedCosts: db.prepare('SELECT * FROM landed_costs WHERE receipt_id = ?').all(r.id)
        .map(l => ({ id: l.id, costType: l.cost_type, amount: l.amount, currency: l.currency, method: l.allocation_method }))
    });
  } catch (e) { next(e); }
});

// ---------------- LANDED COST ----------------
const landedSchema = z.object({
  costType: z.enum(['freight', 'customs', 'insurance', 'handling', 'other']),
  amount: z.coerce.number().positive().max(1e12),
  currency: currency.default('TRY'),
  allocationMethod: z.enum(['value', 'qty']).default('value'),
  notes: z.string().max(5000).optional()
});

router.post('/receipts/:id/landed-costs', requirePermission('purchase.write'), validate(landedSchema), (req, res, next) => {
  try {
    const receipt = db.prepare('SELECT * FROM po_receipts WHERE id = ?').get(req.params.id);
    if (!receipt) throw new AppError('İrsaliye bulunamadı / Receipt not found', 404);
    const b = req.body;
    const result = db.txImmediate(() => {
      db.prepare(`INSERT INTO landed_costs (receipt_id,po_id,cost_type,amount,currency,fx_rate,allocation_method,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(receipt.id, receipt.po_id, b.costType, b.amount, b.currency,
        fxRate(b.currency), b.allocationMethod, b.notes || null, Date.now());
      return costing.applyLandedCosts(receipt.id, req.user.id);
    });
    logAudit(req, 'auditLandedCost', { entityType: 'po_receipt', entityId: receipt.id,
      newValue: { costType: b.costType, amount: b.amount, currency: b.currency }, detail: receipt.receipt_no });
    res.status(201).json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ---------------- SUPPLIER INVOICE / 3-WAY MATCH ----------------
const invoiceSchema = z.object({
  invoiceNo: z.string().trim().min(1).max(200),
  poId: z.string(),
  receiptId: z.string().nullable().optional(),
  invoiceDate: z.string().refine(isValidLocalDate,
    'Geçerli takvim tarihi gerekli / Valid calendar date required').nullable().optional(),
  amount: z.coerce.number().min(0),
  currency: currency.default('TRY'),
  // KDV tutarı tedarikçi faturasındaki gerçek değerdir; verilmezse teslim
  // satırlarının fatura anındaki KDV oranı snapshot'ından hesaplanır.
  vatAmount: z.number().min(0).max(1e12).optional(),
  lines: z.array(z.object({
    receiptLineId: z.coerce.number().int().positive(),
    qty: z.coerce.number().positive(),
    vatRate: z.coerce.number().min(0).max(100).optional()
  })).min(1).optional()
});

router.get('/invoices/receivable-lines', requirePermission('purchase.write'),
  validateQuery(z.object({ poId: z.string().min(1) })), (req, res, next) => {
    try {
      const poId = req.validatedQuery.poId;
      if (!db.prepare('SELECT id FROM purchase_orders WHERE id=?').get(poId)) {
        throw new AppError('Sipariş bulunamadı / Order not found', 404);
      }
      const legacy = !!db.prepare(`SELECT id FROM supplier_invoices
        WHERE po_id=? AND allocation_state='legacy' LIMIT 1`).get(poId);
      const lines = db.prepare(`SELECT rl.id AS receipt_line_id, rl.receipt_id, pr.receipt_no,
          COALESCE(rl.item_name, i.name, '') AS item_name, rl.qty, pi.price, pi.currency,
          pi.fx_rate, i.vat_rate, COALESCE((SELECT SUM(a.qty) FROM supplier_invoice_allocations a
            WHERE a.receipt_line_id=rl.id),0) AS allocated_qty
        FROM po_receipt_lines rl
        JOIN po_receipts pr ON pr.id=rl.receipt_id
        JOIN po_items pi ON pi.id=rl.po_item_id AND pi.po_id=pr.po_id
        LEFT JOIN items i ON i.id=rl.item_id
        WHERE pr.po_id=? ORDER BY pr.received_at, rl.id`).all(poId);
      res.json({ legacy, lines: lines.map(line => ({
        receiptLineId: line.receipt_line_id, receiptId: line.receipt_id,
        receiptNo: line.receipt_no, itemName: line.item_name,
        receivedQty: line.qty, invoicedQty: line.allocated_qty,
        availableQty: Math.max(0, line.qty - line.allocated_qty),
        price: line.price, currency: line.currency, fxRate: line.fx_rate,
        vatRate: line.vat_rate
      })) });
    } catch (e) { next(e); }
  });

/**
 * Three-way match: purchase order vs goods actually received vs supplier invoice.
 * A mismatch beyond tolerance is flagged rather than silently paid.
 */
router.post('/invoices', requirePermission('purchase.write'), validate(invoiceSchema), (req, res, next) => {
  try {
    const b = req.body;
    const result = db.txImmediate(() => {
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(b.poId);
      if (!po) throw new AppError('Sipariş bulunamadı / Order not found', 404);
      if (db.prepare('SELECT id FROM supplier_invoices WHERE supplier_id=? AND invoice_no=?').get(po.supplier_id, b.invoiceNo)) {
        throw new AppError('Bu tedarikçinin fatura numarası zaten kayıtlı / Duplicate supplier invoice number', 409);
      }
      if (b.receiptId) {
        const receipt = db.prepare('SELECT po_id FROM po_receipts WHERE id=?').get(b.receiptId);
        if (!receipt || receipt.po_id !== po.id) throw new AppError('İrsaliye bu siparişe ait değil / Receipt does not belong to order', 422);
      }
      const lines = db.prepare(`SELECT rl.id, rl.qty, rl.receipt_id, pi.price, pi.currency,
          pi.fx_rate, i.vat_rate,
          COALESCE((SELECT SUM(a.qty) FROM supplier_invoice_allocations a
            WHERE a.receipt_line_id=rl.id),0) AS allocated_qty
        FROM po_receipt_lines rl
        JOIN po_receipts pr ON pr.id=rl.receipt_id
        JOIN po_items pi ON pi.id=rl.po_item_id AND pi.po_id=pr.po_id
        LEFT JOIN items i ON i.id=rl.item_id
        WHERE pr.po_id=? AND (? IS NULL OR pr.id=?)
        ORDER BY pr.received_at, rl.id`).all(po.id, b.receiptId || null, b.receiptId || null);
      if (lines.some(line => !(line.fx_rate > 0))) {
        throw new AppError('Teslim satırında kayıtlı kur yok / Receipt line has no historical FX rate', 409);
      }
      const legacy = db.prepare(`SELECT id FROM supplier_invoices WHERE po_id=? AND allocation_state='legacy' LIMIT 1`).get(po.id);
      if (legacy && lines.length) {
        throw new AppError('Eski faturaların teslim satırları eşleştirilmemiş; önce mutabakat gerekli / Legacy invoices require reconciliation', 409);
      }
      const chosen = [];
      if (b.lines) {
        const byId = new Map(lines.map(line => [line.id, line]));
        const seen = new Set();
        for (const requested of b.lines) {
          const line = byId.get(requested.receiptLineId);
          if (!line) throw new AppError('Teslim satırı bu sipariş/irsaliyeye ait değil / Receipt line does not belong to order', 422);
          if (seen.has(line.id)) throw new AppError('Teslim satırı tekrarlandı / Duplicate receipt line', 422);
          seen.add(line.id);
          if (requested.qty > line.qty - line.allocated_qty + 1e-9) {
            throw new AppError('Teslim miktarı daha önce faturalanmış / Receipt quantity already invoiced', 409);
          }
          chosen.push({ ...line, invoiceQty: requested.qty,
            invoiceVatRate: requested.vatRate ?? line.vat_rate });
        }
      } else {
        for (const line of lines) {
          const available = line.qty - line.allocated_qty;
          if (available > 1e-9) chosen.push({ ...line, invoiceQty: available,
            invoiceVatRate: line.vat_rate });
        }
      }
      if (lines.length && !chosen.length) {
        throw new AppError('Bu teslimatın faturalanmamış miktarı kalmadı / No uninvoiced receipt quantity remains', 409);
      }
      if (chosen.some(line => line.invoiceVatRate == null)) {
        throw new AppError('Ürünsüz teslim satırında fatura KDV oranı gerekli / Invoice VAT rate required for free-text receipt line', 422);
      }
      const receivedBase = chosen.reduce((sum, line) => sum + line.invoiceQty * line.price * line.fx_rate, 0);
      const rate = fxRate(b.currency, b.invoiceDate);
      const invoiceBase = b.amount * rate;
      const tolerance = Math.max(1, receivedBase * 0.02);
      const withinTolerance = chosen.length > 0 && Math.abs(invoiceBase - receivedBase) <= tolerance;
      const id = uuid();
      const supplier = db.prepare('SELECT payment_terms_days FROM suppliers WHERE id = ?').get(po.supplier_id);
      const invDate = b.invoiceDate || toLocalDateStr();
      const due = toLocalDateStr(new Date(`${invDate}T12:00:00`).getTime() + (supplier ? supplier.payment_terms_days : 30) * 86400000);
      db.prepare(`INSERT INTO supplier_invoices (id,invoice_no,supplier_id,po_id,receipt_id,invoice_date,due_date,
        amount,currency,fx_rate,match_status,discrepancy_note,created_at,allocation_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, b.invoiceNo, po.supplier_id, po.id, b.receiptId || null, invDate, due,
        b.amount, b.currency, rate, withinTolerance ? 'matched' : 'discrepancy',
        withinTolerance ? null : `Fatura ${invoiceBase.toFixed(2)} TL, teslim alınan ${receivedBase.toFixed(2)} TL`,
        Date.now(), chosen.length ? 'recorded' : 'none');
      const insertAllocation = db.prepare(`INSERT INTO supplier_invoice_allocations
        (invoice_id,receipt_line_id,qty,unit_price,currency,fx_rate,vat_rate)
        VALUES (?,?,?,?,?,?,?)`);
      for (const line of chosen) insertAllocation.run(id, line.id, line.invoiceQty, line.price,
        line.currency, line.fx_rate, line.invoiceVatRate);
      const vatAmount = b.vatAmount ?? payments.snapshotVatAmount(id, b.amount);
      if (vatAmount != null) db.prepare('UPDATE supplier_invoices SET vat_amount=? WHERE id=?').run(payments.round2(vatAmount), id);
      logAudit(req, 'auditInvoiceAdd', { entityType: 'supplier_invoice', entityId: id,
        newValue: { invoiceNo: b.invoiceNo, amount: b.amount, matched: withinTolerance }, detail: b.invoiceNo });
      return { id, matchStatus: withinTolerance ? 'matched' : 'discrepancy',
        invoiceBase, receivedBase, difference: invoiceBase - receivedBase, dueDate: due,
        allocations: chosen.map(line => ({ receiptLineId: line.id, qty: line.invoiceQty })) };
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

function supplierInvoiceDto(r) {
  return {
    id: r.id, invoiceNo: r.invoice_no, supplier: r.supplier_name, supplierId: r.supplier_id, poId: r.po_id,
    poNo: r.po_no, receiptId: r.receipt_id, invoiceDate: r.invoice_date, dueDate: r.due_date,
    amount: r.amount, vatAmount: r.vat_amount, currency: r.currency, fxRate: r.fx_rate,
    matchStatus: r.match_status, discrepancyNote: r.discrepancy_note, allocationState: r.allocation_state,
    reconciledAt: r.reconciled_at, reconcileNote: r.reconcile_note,
    approvedAt: r.approved_at, approvalNote: r.approval_note,
    ...payments.supplierSettlement(r)
  };
}

router.get('/invoices', validateQuery(pageQuery.extend({
  status: z.enum(['unmatched', 'matched', 'discrepancy', 'approved', 'paid']).optional(),
  allocationState: z.enum(['legacy', 'recorded', 'none']).optional(),
  q: z.string().trim().max(100).optional()
})), (req, res) => {
  const { page = 1, pageSize = 50, status, allocationState, q } = req.validatedQuery;
  const where = [], params = [];
  if (status) { where.push('si.match_status = ?'); params.push(status); }
  if (allocationState) { where.push('si.allocation_state = ?'); params.push(allocationState); }
  if (q) {
    where.push("(si.invoice_no LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR po.po_no LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, ch => '\\' + ch)}%`;
    params.push(like, like, like);
  }
  const result = paginate(`SELECT si.*, s.name AS supplier_name, po.po_no FROM supplier_invoices si
    LEFT JOIN suppliers s ON s.id = si.supplier_id LEFT JOIN purchase_orders po ON po.id = si.po_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY si.created_at DESC, si.id`, params, page, pageSize);
  result.data = result.data.map(supplierInvoiceDto);
  res.json(result);
});

function loadSupplierInvoice(id) {
  const r = db.prepare(`SELECT si.*, s.name AS supplier_name, po.po_no FROM supplier_invoices si
    LEFT JOIN suppliers s ON s.id = si.supplier_id LEFT JOIN purchase_orders po ON po.id = si.po_id
    WHERE si.id = ?`).get(id);
  if (!r) throw new AppError('Fatura bulunamadı / Invoice not found', 404);
  return r;
}

router.get('/invoices/:id', (req, res) => {
  const r = loadSupplierInvoice(req.params.id);
  const allocations = db.prepare(`SELECT a.receipt_line_id, a.qty, a.unit_price, a.currency, a.fx_rate, a.vat_rate,
      pr.receipt_no, COALESCE(rl.item_name, i.name, '') AS item_name
    FROM supplier_invoice_allocations a
    JOIN po_receipt_lines rl ON rl.id = a.receipt_line_id
    JOIN po_receipts pr ON pr.id = rl.receipt_id
    LEFT JOIN items i ON i.id = rl.item_id
    WHERE a.invoice_id = ? ORDER BY pr.received_at, rl.id`).all(r.id);
  res.json({ ...supplierInvoiceDto(r),
    allocations: allocations.map(a => ({ receiptLineId: a.receipt_line_id, receiptNo: a.receipt_no, itemName: a.item_name,
      qty: a.qty, unitPrice: a.unit_price, currency: a.currency, fxRate: a.fx_rate, vatRate: a.vat_rate })),
    payments: payments.listSupplierPayments(r.id) });
});

const reconcileSchema = z.object({
  lines: z.array(z.object({
    receiptLineId: z.number().int().positive(),
    qty: z.number().positive().max(1e12),
    vatRate: z.number().min(0).max(100).optional()
  }).strict()).max(500),
  vatAmount: z.number().min(0).max(1e12).optional(),
  note: z.string().trim().min(5, 'Mutabakat gerekçesi gerekli / Reconciliation note required').max(2000)
}).strict();

/**
 * T06: a person maps a legacy supplier invoice (created before receipt-line
 * allocation existed) to the receipt quantities it really billed. The
 * allocation rows snapshot the PO line price/FX and the VAT rate at this
 * moment; later item or PO edits never change them. An empty `lines` list
 * records that the invoice bills no received goods (e.g. a service charge).
 * Each invoice can be reconciled exactly once; a second attempt is 409.
 */
router.post('/invoices/:id/reconcile', requirePermission('purchase.approve'), validate(reconcileSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    const inv = loadSupplierInvoice(req.params.id);
    if (inv.allocation_state !== 'legacy') {
      throw new AppError('Bu fatura zaten eşleştirilmiş / Invoice is already reconciled', 409);
    }
    const lines = db.prepare(`SELECT rl.id, rl.qty, pi.price, pi.currency, pi.fx_rate, i.vat_rate,
        COALESCE((SELECT SUM(a.qty) FROM supplier_invoice_allocations a WHERE a.receipt_line_id=rl.id),0) AS allocated_qty
      FROM po_receipt_lines rl
      JOIN po_receipts pr ON pr.id=rl.receipt_id
      JOIN po_items pi ON pi.id=rl.po_item_id AND pi.po_id=pr.po_id
      LEFT JOIN items i ON i.id=rl.item_id
      WHERE pr.po_id=? AND (? IS NULL OR pr.id=?)`).all(inv.po_id, inv.receipt_id || null, inv.receipt_id || null);
    const byId = new Map(lines.map(line => [line.id, line]));
    const seen = new Set();
    const chosen = b.lines.map(requested => {
      const line = byId.get(requested.receiptLineId);
      if (!line) throw new AppError('Teslim satırı bu faturanın siparişine/irsaliyesine ait değil / Receipt line does not belong to this invoice', 422);
      if (seen.has(line.id)) throw new AppError('Teslim satırı tekrarlandı / Duplicate receipt line', 422);
      seen.add(line.id);
      if (!(line.fx_rate > 0)) throw new AppError('Teslim satırında kayıtlı kur yok / Receipt line has no historical FX rate', 409);
      if (requested.qty > line.qty - line.allocated_qty + 1e-9) {
        throw new AppError('Teslim miktarı daha önce faturalanmış / Receipt quantity already invoiced', 409);
      }
      const vatRate = requested.vatRate ?? line.vat_rate;
      if (vatRate == null) throw new AppError('Ürünsüz teslim satırında KDV oranı gerekli / VAT rate required for free-text receipt line', 422);
      return { ...line, invoiceQty: requested.qty, vatRate };
    });
    const insertAllocation = db.prepare(`INSERT INTO supplier_invoice_allocations
      (invoice_id,receipt_line_id,qty,unit_price,currency,fx_rate,vat_rate) VALUES (?,?,?,?,?,?,?)`);
    for (const line of chosen) insertAllocation.run(inv.id, line.id, line.invoiceQty, line.price, line.currency, line.fx_rate, line.vatRate);
    const receivedBase = chosen.reduce((sum, line) => sum + line.invoiceQty * line.price * line.fx_rate, 0);
    const invoiceBase = inv.amount * (inv.fx_rate || 1);
    const tolerance = Math.max(1, receivedBase * 0.02);
    const matched = chosen.length > 0 && Math.abs(invoiceBase - receivedBase) <= tolerance;
    const vatAmount = b.vatAmount ?? payments.snapshotVatAmount(inv.id, inv.amount);
    if (vatAmount == null) {
      throw new AppError('Teslim satırı olmayan fatura için KDV tutarı gerekli / VAT amount required when no receipt lines are allocated', 422);
    }
    const note = matched ? null : `Fatura ${invoiceBase.toFixed(2)} TL, eşleştirilen teslim ${receivedBase.toFixed(2)} TL`;
    const nextMatch = ['approved', 'paid'].includes(inv.match_status) ? inv.match_status : (matched ? 'matched' : 'discrepancy');
    const changed = db.prepare(`UPDATE supplier_invoices SET allocation_state=?, vat_amount=?, match_status=?,
        discrepancy_note=?, reconciled_at=?, reconciled_by=?, reconcile_note=?
      WHERE id=? AND allocation_state='legacy'`).run(chosen.length ? 'recorded' : 'none', payments.round2(vatAmount),
      nextMatch, note, Date.now(), req.user.id, b.note, inv.id).changes;
    if (changed !== 1) throw new AppError('Fatura eşzamanlı olarak değiştirildi / Invoice changed concurrently', 409);
    logAudit(req, 'auditSupplierInvoiceReconciled', { entityType: 'supplier_invoice', entityId: inv.id,
      oldValue: { allocationState: 'legacy', matchStatus: inv.match_status },
      newValue: { allocationState: chosen.length ? 'recorded' : 'none', matchStatus: nextMatch, vatAmount,
        allocations: chosen.map(line => ({ receiptLineId: line.id, qty: line.invoiceQty, vatRate: line.vatRate })) },
      detail: `${inv.invoice_no}: ${b.note}` });
    return supplierInvoiceDto(loadSupplierInvoice(inv.id));
  });
  res.json(result);
});

const approveSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  vatAmount: z.number().min(0).max(1e12).optional()
}).strict();

/**
 * Payment gate: only reconciled invoices with a known VAT amount can be
 * approved. A discrepancy (invoice ≠ received value beyond tolerance) needs
 * an explicit approval note so the override is traceable.
 */
router.post('/invoices/:id/approve', requirePermission('purchase.approve'), validate(approveSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    const inv = loadSupplierInvoice(req.params.id);
    if (inv.match_status === 'approved' || inv.match_status === 'paid') {
      return { ...supplierInvoiceDto(inv), alreadyApproved: true };
    }
    if (inv.allocation_state === 'legacy') {
      throw new AppError('Eski fatura önce mutabakat gerektirir / Legacy invoice requires reconciliation', 409);
    }
    if (inv.match_status === 'discrepancy' && !(b.note && b.note.length >= 5)) {
      throw new AppError('Uyuşmazlıklı fatura için onay gerekçesi gerekli / Approval note required for a discrepancy', 422);
    }
    let vatAmount = inv.vat_amount;
    if (vatAmount == null) {
      if (b.vatAmount == null) throw new AppError('Fatura KDV tutarı gerekli / Invoice VAT amount required', 422);
      vatAmount = payments.round2(b.vatAmount);
    }
    const changed = db.prepare(`UPDATE supplier_invoices SET match_status='approved', vat_amount=?,
        approved_at=?, approved_by=?, approval_note=?
      WHERE id=? AND match_status IN ('matched','discrepancy','unmatched')`)
      .run(vatAmount, Date.now(), req.user.id, b.note || null, inv.id).changes;
    if (changed !== 1) throw new AppError('Fatura eşzamanlı olarak değiştirildi / Invoice changed concurrently', 409);
    logAudit(req, 'auditSupplierInvoiceApproved', { entityType: 'supplier_invoice', entityId: inv.id,
      oldValue: { matchStatus: inv.match_status }, newValue: { matchStatus: 'approved', vatAmount, note: b.note || null },
      detail: inv.invoice_no });
    return supplierInvoiceDto(loadSupplierInvoice(inv.id));
  });
  res.json(result);
});

const supplierPaymentSchema = z.object({
  amount: z.number().positive().max(1e12).optional(),
  paidOn: z.string().refine(isValidLocalDate, 'Geçerli takvim tarihi gerekli / Valid calendar date required').optional(),
  method: z.enum(['cash', 'bank', 'card', 'check', 'other']).optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  requestKey: z.string().trim().min(8).max(100).optional()
}).strict();

router.post('/invoices/:id/payments', requirePermission('purchase.approve'), validate(supplierPaymentSchema), (req, res) => {
  const result = payments.recordSupplierPayment(req, req.params.id, req.valid);
  res.status(result.paymentId && !result.duplicate ? 201 : 200).json(result);
});

// ---------------- SUPPLIER RETURN ----------------
const returnSchema = z.object({
  supplierId: z.coerce.number(),
  lotId: z.string(),
  qty: z.coerce.number().positive(),
  reason: z.string().max(5000).optional(),
  ncrId: z.string().nullable().optional()
});

router.post('/returns', requirePermission('purchase.write'), validate(returnSchema), (req, res, next) => {
  try {
    const b = req.body;
    const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(b.lotId);
    if (!lot) throw new AppError('Parti bulunamadı / Lot not found', 404);
    if (lot.qty < b.qty) throw new AppError('İade miktarı parti miktarından fazla / Return qty exceeds lot qty');
    if (lot.supplier_id != null && lot.supplier_id !== b.supplierId) throw new AppError('Lot bu tedarikçiye ait değil / Lot supplier mismatch', 422);

    const id = db.txImmediate(() => {
      const retId = uuid();
      const no = nextNumber('supplier_return', 'IAD');
      db.prepare(`INSERT INTO supplier_returns (id,return_no,supplier_id,lot_id,item_id,qty,reason,ncr_id,status,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?, 'open',?,?)`).run(retId, no, b.supplierId, b.lotId, lot.item_id, b.qty,
        b.reason || '', b.ncrId || null, Date.now(), req.user.id);

      stock.consume([{ lotId: lot.id, qty: b.qty }], {
        itemId: lot.item_id, itemName: null, warehouseId: lot.warehouse_id,
        allowedStatuses: ['available', 'quarantine', 'blocked', 'rejected'],
        refType: 'supplier_return', refId: retId, note: `Tedarikçi iadesi ${no}`, userId: req.user.id
      });

      db.prepare('UPDATE po_items SET rejected_qty = rejected_qty + ? WHERE id IN (SELECT po_item_id FROM po_receipt_lines WHERE lot_id = ?)')
        .run(b.qty, lot.id);

      logAudit(req, 'auditSupplierReturn', { entityType: 'supplier_return', entityId: retId, detail: no });
      return retId;
    });

    res.status(201).json({ id });
  } catch (e) { next(e); }
});

module.exports = router;
