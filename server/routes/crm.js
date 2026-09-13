// @ts-nocheck
/**
 * CRM / satış hunisi — sipariş oluşmadan ÖNCEKİ süreç. Bir fırsat (opportunity)
 * doğar, aşamalardan geçer (yeni → iletişimde → teklif verildi → kazanıldı/
 * kaybedildi); kazanılırsa gerçek bir satış siparişine dönüştürülür
 * (server/services/sales-orders.js — server/routes/sales.js ile AYNI kod yolu,
 * kopya mantık yok).
 *
 * Aşama/alan değişiklikleri ayrı bir "aktivite geçmişi" tablosunda değil,
 * mevcut audit_log'da tutulur (eski/yeni değerle) — bkz. server/lib/core.js
 * logAudit. Bu, projenin geri kalanıyla aynı desen; CRM için özel bir
 * izlenebilirlik mekanizması icat edilmedi.
 */
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, uuid, nextNumber, logAudit, diff, paginate } = require('../lib/core');
const { companyIdOf } = require('../lib/tenant');
const { dispatchEvent } = require('../lib/webhooks');
const { createSalesOrder } = require('../services/sales-orders');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');

const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const CLOSED_STAGES = ['won', 'lost'];

function serialize(row) {
  const lines = db.prepare('SELECT * FROM opportunity_lines WHERE opportunity_id = ?').all(row.id);
  return {
    id: row.id, oppNo: row.opp_no, customerId: row.customer_id, customerName: row.customer_name,
    contactPerson: row.contact_person, phone: row.phone, email: row.email, source: row.source,
    stage: row.stage, estimatedValue: row.estimated_value, estimatedCloseDate: row.estimated_close_date,
    probability: row.probability, lostReason: row.lost_reason, assignedTo: row.assigned_to,
    notes: row.notes, convertedSoId: row.converted_so_id, createdAt: row.created_at, closedAt: row.closed_at,
    lines: lines.map(l => ({ id: l.id, itemId: l.item_id, itemName: l.item_name, qty: l.qty, unitPrice: l.unit_price }))
  };
}

/* ============================ LİSTE / HUNİ ============================ */

router.get('/opportunities', (req, res) => {
  const { stage = '', assignedTo = '', q = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM opportunities WHERE 1=1';
  const params = [];
  if (stage) { sql += ' AND stage = ?'; params.push(stage); }
  if (assignedTo) { sql += ' AND assigned_to = ?'; params.push(assignedTo); }
  if (q) { sql += ' AND customer_name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serialize);
  res.json(result);
});

/** Huni görünümü: her aşama için gruplanmış fırsatlar + toplam tahmini değer. */
router.get('/opportunities/pipeline', (req, res) => {
  const rows = db.prepare("SELECT * FROM opportunities WHERE stage != 'lost' ORDER BY created_at DESC").all();
  const byStage = {};
  STAGES.filter(s => s !== 'lost').forEach(s => { byStage[s] = { stage: s, totalValue: 0, opportunities: [] }; });
  rows.forEach(r => {
    const o = serialize(r);
    byStage[r.stage].opportunities.push(o);
    byStage[r.stage].totalValue += r.estimated_value;
  });
  res.json({ stages: Object.values(byStage) });
});

router.get('/opportunities/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
  const so = row.converted_so_id ? db.prepare('SELECT id, so_no, status FROM sales_orders WHERE id = ?').get(row.converted_so_id) : null;
  res.json({ ...serialize(row), convertedSalesOrder: so });
});

/* ============================ OLUŞTURMA / GÜNCELLEME ============================ */

const oppSchema = z.object({
  customerId: z.coerce.number().int().optional(),
  customerName: z.string().min(1).max(200),
  contactPerson: z.string().max(200).optional(), phone: z.string().max(100).optional(), email: z.string().max(200).optional(),
  source: z.enum(['referans', 'web', 'fuar', 'soguk_arama', 'diger']).default('diger'),
  estimatedValue: z.coerce.number().min(0).default(0),
  estimatedCloseDate: z.string().max(20).optional(),
  probability: z.coerce.number().int().min(0).max(100).default(20),
  assignedTo: z.coerce.number().int().optional(),
  notes: z.string().max(5000).optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1).max(200), itemName: z.string().min(1).max(200),
    qty: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0).default(0)
  })).default([])
});

router.post('/opportunities', WRITE, validate(oppSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    if (b.customerId) {
      const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(b.customerId);
      if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
    }
    const id = uuid();
    const oppNo = nextNumber('opportunity', 'FRS');
    db.prepare(`INSERT INTO opportunities
      (id,opp_no,company_id,customer_id,customer_name,contact_person,phone,email,source,stage,
       estimated_value,estimated_close_date,probability,assigned_to,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?)`)
      .run(id, oppNo, companyIdOf(req), b.customerId || null, b.customerName, b.contactPerson || null,
           b.phone || null, b.email || null, b.source, b.estimatedValue, b.estimatedCloseDate || null,
           b.probability, b.assignedTo || null, b.notes || null, req.user.id, Date.now());

    const ins = db.prepare('INSERT INTO opportunity_lines (opportunity_id,item_id,item_name,qty,unit_price) VALUES (?,?,?,?,?)');
    b.lines.forEach(l => ins.run(id, l.itemId, l.itemName, l.qty, l.unitPrice));

    logAudit(req, 'auditOpportunityAdd', { entityType: 'opportunity', entityId: id, newValue: { oppNo, customerName: b.customerName, estimatedValue: b.estimatedValue }, detail: oppNo });
    return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  });
  res.status(201).json(serialize(result));
});

const oppUpdateSchema = oppSchema.omit({ lines: true }).partial();

router.put('/opportunities/:id', WRITE, validate(oppUpdateSchema), (req, res) => {
  const before = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
  if (CLOSED_STAGES.includes(before.stage)) throw new AppError('Kapanmış fırsat düzenlenemez / A closed opportunity cannot be edited', 409);
  const b = req.valid;
  db.prepare(`UPDATE opportunities SET customer_id=COALESCE(?,customer_id), customer_name=COALESCE(?,customer_name),
    contact_person=COALESCE(?,contact_person), phone=COALESCE(?,phone), email=COALESCE(?,email), source=COALESCE(?,source),
    estimated_value=COALESCE(?,estimated_value), estimated_close_date=COALESCE(?,estimated_close_date),
    probability=COALESCE(?,probability), assigned_to=COALESCE(?,assigned_to), notes=COALESCE(?,notes) WHERE id=?`)
    .run(b.customerId, b.customerName, b.contactPerson, b.phone, b.email, b.source, b.estimatedValue,
         b.estimatedCloseDate, b.probability, b.assignedTo, b.notes, req.params.id);
  const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  const d = diff(before, after, ['customer_name', 'estimated_value', 'estimated_close_date', 'probability', 'assigned_to']);
  logAudit(req, 'auditOpportunityEdit', { entityType: 'opportunity', entityId: req.params.id, ...(d || {}), detail: after.opp_no });
  res.json(serialize(after));
});

/* ============================ AŞAMA GEÇİŞİ ============================ */

const stageSchema = z.object({
  stage: z.enum(STAGES),
  lostReason: z.string().min(1).max(1000).optional()
});

router.post('/opportunities/:id/stage', WRITE, validate(stageSchema), (req, res) => {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opp) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
  if (CLOSED_STAGES.includes(opp.stage)) throw new AppError('Kapanmış fırsat yeniden açılamaz / A closed opportunity cannot be reopened', 409);
  const b = req.valid;
  if (b.stage === 'lost' && !b.lostReason) throw new AppError('Kaybedilme sebebi zorunlu / Lost reason is required', 422);

  const closedAt = CLOSED_STAGES.includes(b.stage) ? Date.now() : null;
  db.prepare('UPDATE opportunities SET stage = ?, lost_reason = ?, closed_at = ? WHERE id = ?')
    .run(b.stage, b.stage === 'lost' ? b.lostReason : null, closedAt, opp.id);

  const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opp.id);
  logAudit(req, 'auditOpportunityStage', { entityType: 'opportunity', entityId: opp.id,
    oldValue: { stage: opp.stage }, newValue: { stage: b.stage }, detail: opp.opp_no });

  if (b.stage === 'won') dispatchEvent('opportunity.won', serialize(after), companyIdOf(req));
  res.json(serialize(after));
});

/* ============================ SATIŞ SİPARİŞİNE DÖNÜŞTÜRME ============================ */

const convertSchema = z.object({ customerId: z.coerce.number().int().optional() });

router.post('/opportunities/:id/convert', WRITE, validate(convertSchema), (req, res) => {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opp) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
  if (opp.stage !== 'won') throw new AppError('Yalnızca kazanılmış fırsatlar dönüştürülebilir / Only a won opportunity can be converted', 409);
  if (opp.converted_so_id) throw new AppError('Bu fırsat zaten dönüştürülmüş / This opportunity is already converted', 409);

  const customerId = opp.customer_id || req.valid.customerId;
  if (!customerId) throw new AppError('Dönüştürmek için bir müşteri gerekli / A customer is required to convert', 422, { hint: 'customerId' });
  const customer = db.prepare('SELECT id, currency FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new AppError('Müşteri bulunamadı / Customer not found', 404);

  const lines = db.prepare('SELECT * FROM opportunity_lines WHERE opportunity_id = ?').all(opp.id);
  if (!lines.length) throw new AppError('Dönüştürmek için en az bir kalem gerekli / At least one line is required to convert', 422);

  const so = createSalesOrder(req, {
    customerId, currency: customer.currency, notes: opp.notes || undefined, opportunityId: opp.id,
    lines: lines.map(l => ({ itemId: l.item_id, qty: l.qty, price: l.unit_price }))
  });
  db.prepare('UPDATE opportunities SET converted_so_id = ? WHERE id = ?').run(so.id, opp.id);
  logAudit(req, 'auditOpportunityConvert', { entityType: 'opportunity', entityId: opp.id, newValue: { soId: so.id, soNo: so.so_no }, detail: opp.opp_no });
  res.status(201).json({ opportunity: serialize(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opp.id)), salesOrder: { id: so.id, soNo: so.so_no } });
});

module.exports = router;
