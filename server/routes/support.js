// @ts-nocheck
/**
 * Müşteri destek/talep (ticket) takibi.
 *
 * Kalite modülündeki uygunsuzluk (NCR) akışından KASITLI olarak ayrı: NCR bir
 * ÜRÜN kusurunun kök nedenini ve düzeltici faaliyetini takip eder, ticket ise
 * müşteriyle iletişimi ve çözüm süresini takip eder — ikisi farklı sorular
 * cevaplar. Gerçek bir ürün kusuru şikayeti geldiğinde `POST /:id/to-ncr` ile
 * tek adımda bir NCR'ye dönüştürülebilir, veri tekrar girilmez.
 *
 * Aşama/alan değişiklikleri ayrı bir "aktivite geçmişi" tablosunda değil,
 * mevcut audit_log'da tutulur (CRM/kalite ile aynı desen) — yalnızca serbest
 * metin müşteri/ekip yorumları için ayrı support_ticket_comments tablosu var,
 * çünkü bir ticket'ta genelde birden çok görüşme birikir.
 */
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, validatePartial, z } = require('../middleware/validate');
const { AppError, uuid, nextNumber, logAudit, diff, paginate } = require('../lib/core');
const { companyIdOf } = require('../lib/tenant');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');

const CATEGORIES = ['complaint', 'question', 'return', 'warranty', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

function serialize(row) {
  return {
    id: row.id, ticketNo: row.ticket_no, customerId: row.customer_id, customerName: row.customer_name,
    subject: row.subject, description: row.description, category: row.category, priority: row.priority,
    status: row.status, assignedTo: row.assigned_to, assignedUsername: row.assigned_username || undefined,
    relatedOrderId: row.related_order_id, relatedShipmentId: row.related_shipment_id, relatedLotId: row.related_lot_id,
    resolution: row.resolution, resultingNcrId: row.resulting_ncr_id,
    createdAt: row.created_at, resolvedAt: row.resolved_at, closedAt: row.closed_at
  };
}

/* ============================ LİSTE ============================ */

router.get('/', (req, res) => {
  const { status = '', priority = '', assignedTo = '', customerId = '', q = '', page = 1, pageSize = 50 } = req.query;
  let sql = `SELECT t.*, u.username AS assigned_username FROM support_tickets t
             LEFT JOIN users u ON u.id = t.assigned_to WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (assignedTo) { sql += ' AND t.assigned_to = ?'; params.push(assignedTo); }
  if (customerId) { sql += ' AND t.customer_id = ?'; params.push(customerId); }
  if (q) { sql += ' AND (t.subject LIKE ? OR t.customer_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ` ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC`;
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serialize);
  res.json(result);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT t.*, u.username AS assigned_username FROM support_tickets t
    LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?`).get(req.params.id);
  if (!row) throw new AppError('Talep bulunamadı / Ticket not found', 404);
  const comments = db.prepare(`SELECT c.*, u.username FROM support_ticket_comments c
    LEFT JOIN users u ON u.id = c.user_id WHERE c.ticket_id = ? ORDER BY c.ts ASC`).all(row.id);
  res.json({
    ...serialize(row),
    comments: comments.map(c => ({ id: c.id, userId: c.user_id, username: c.username, ts: c.ts, comment: c.comment }))
  });
});

/* ============================ OLUŞTURMA / GÜNCELLEME ============================ */

const ticketSchema = z.object({
  customerId: z.coerce.number().int().optional(),
  customerName: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  category: z.enum(CATEGORIES).default('question'),
  priority: z.enum(PRIORITIES).default('normal'),
  assignedTo: z.coerce.number().int().optional(),
  relatedOrderId: z.string().max(200).optional(),
  relatedShipmentId: z.string().max(200).optional(),
  relatedLotId: z.string().max(200).optional()
});

router.post('/', WRITE, validate(ticketSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    if (b.customerId) {
      const c = db.prepare('SELECT id, is_active, anonymized_at FROM customers WHERE id = ?').get(b.customerId);
      if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
      if (!c.is_active || c.anonymized_at) throw new AppError('Pasif müşteriye talep açılamaz / Customer is inactive', 409);
    }
    const id = uuid();
    const ticketNo = nextNumber('ticket', 'DST');
    db.prepare(`INSERT INTO support_tickets
      (id,ticket_no,company_id,customer_id,customer_name,subject,description,category,priority,status,
       assigned_to,related_order_id,related_shipment_id,related_lot_id,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?)`)
      .run(id, ticketNo, companyIdOf(req), b.customerId || null, b.customerName, b.subject, b.description || null,
           b.category, b.priority, b.assignedTo || null, b.relatedOrderId || null, b.relatedShipmentId || null,
           b.relatedLotId || null, req.user.id, Date.now());
    logAudit(req, 'auditTicketAdd', { entityType: 'support_ticket', entityId: id,
      newValue: { ticketNo, customerName: b.customerName, subject: b.subject }, detail: ticketNo });
    return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  });
  res.status(201).json(serialize(result));
});

const ticketUpdateSchema = ticketSchema.omit({ customerId: true });

router.put('/:id', WRITE, validatePartial(ticketUpdateSchema), (req, res) => {
  const before = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('Talep bulunamadı / Ticket not found', 404);
  if (before.customer_id && db.prepare('SELECT anonymized_at FROM customers WHERE id = ?').get(before.customer_id)?.anonymized_at) throw new AppError('Anonim müşteri talebi düzenlenemez / Anonymized customer ticket cannot be edited', 409);
  if (before.status === 'closed') throw new AppError('Kapanmış talep düzenlenemez / A closed ticket cannot be edited', 409);
  const b = req.valid;
  db.prepare(`UPDATE support_tickets SET customer_name=COALESCE(?,customer_name), subject=COALESCE(?,subject),
    description=COALESCE(?,description), category=COALESCE(?,category), priority=COALESCE(?,priority),
    assigned_to=COALESCE(?,assigned_to), related_order_id=COALESCE(?,related_order_id),
    related_shipment_id=COALESCE(?,related_shipment_id), related_lot_id=COALESCE(?,related_lot_id) WHERE id=?`)
    .run(b.customerName, b.subject, b.description, b.category, b.priority, b.assignedTo,
         b.relatedOrderId, b.relatedShipmentId, b.relatedLotId, req.params.id);
  const after = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  const d = diff(before, after, ['subject', 'priority', 'assigned_to', 'category']);
  logAudit(req, 'auditTicketEdit', { entityType: 'support_ticket', entityId: req.params.id, ...(d || {}), detail: after.ticket_no });
  res.json(serialize(after));
});

/* ============================ DURUM GEÇİŞİ ============================ */

const statusSchema = z.object({
  status: z.enum(STATUSES),
  resolution: z.string().max(5000).optional()
});

router.post('/:id/status', WRITE, validate(statusSchema), (req, res) => {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!t) throw new AppError('Talep bulunamadı / Ticket not found', 404);
  if (t.customer_id && db.prepare('SELECT anonymized_at FROM customers WHERE id = ?').get(t.customer_id)?.anonymized_at) throw new AppError('Anonim müşteri talebi güncellenemez / Anonymized customer ticket cannot be updated', 409);
  if (t.status === 'closed') throw new AppError('Kapanmış talep yeniden açılamaz / A closed ticket cannot be reopened', 409);
  const b = req.valid;
  if (b.status === 'resolved' && !b.resolution && !t.resolution) {
    throw new AppError('Çözüm açıklaması zorunlu / A resolution note is required', 422, { hint: 'resolution' });
  }
  const now = Date.now();
  const resolvedAt = b.status === 'resolved' ? now : t.resolved_at;
  const closedAt = b.status === 'closed' ? now : null;
  db.prepare('UPDATE support_tickets SET status = ?, resolution = COALESCE(?,resolution), resolved_at = ?, closed_at = ? WHERE id = ?')
    .run(b.status, b.resolution || null, resolvedAt, closedAt, t.id);
  const after = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(t.id);
  logAudit(req, 'auditTicketStatus', { entityType: 'support_ticket', entityId: t.id,
    oldValue: { status: t.status }, newValue: { status: b.status }, detail: t.ticket_no });
  res.json(serialize(after));
});

/* ============================ YORUM ============================ */

router.post('/:id/comments', WRITE, validate(z.object({ comment: z.string().min(1).max(5000) })), (req, res) => {
  const t = db.prepare('SELECT id, ticket_no, customer_id FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!t) throw new AppError('Talep bulunamadı / Ticket not found', 404);
  if (t.customer_id && db.prepare('SELECT anonymized_at FROM customers WHERE id = ?').get(t.customer_id)?.anonymized_at) throw new AppError('Anonim müşteri talebine yorum eklenemez / Anonymized customer ticket cannot receive comments', 409);
  const info = db.prepare('INSERT INTO support_ticket_comments (ticket_id,user_id,ts,comment) VALUES (?,?,?,?)')
    .run(t.id, req.user.id, Date.now(), req.valid.comment);
  logAudit(req, 'auditTicketComment', { entityType: 'support_ticket', entityId: t.id, detail: t.ticket_no });
  res.status(201).json({ id: info.lastInsertRowid, userId: req.user.id, username: req.user.username, ts: Date.now(), comment: req.valid.comment });
});

/* ============================ NCR'YE DÖNÜŞTÜRME ============================ */

const toNcrSchema = z.object({
  itemId: z.string().min(1).max(200).optional(),
  lotId: z.string().min(1).max(200).optional(),
  severity: z.enum(['minor', 'major', 'critical']).default('minor'),
  qtyAffected: z.coerce.number().min(0).optional()
});

router.post('/:id/to-ncr', WRITE, validate(toNcrSchema), (req, res) => {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!t) throw new AppError('Talep bulunamadı / Ticket not found', 404);
  if (t.customer_id && db.prepare('SELECT anonymized_at FROM customers WHERE id = ?').get(t.customer_id)?.anonymized_at) throw new AppError('Anonim müşteri talebi dönüştürülemez / Anonymized customer ticket cannot be converted', 409);
  if (t.category !== 'complaint') throw new AppError('Yalnızca şikayet kategorisindeki talepler uygunsuzluğa dönüştürülebilir / Only complaint tickets can convert to an NCR', 409);
  if (t.resulting_ncr_id) throw new AppError('Bu talep zaten bir uygunsuzluğa dönüştürülmüş / Already converted', 409);
  if (!t.customer_id) throw new AppError('Uygunsuzluğa dönüştürmek için talepte kayıtlı bir müşteri olmalı / A registered customer is required', 422);

  const b = req.valid;
  const result = db.txImmediate(() => {
    const item = b.itemId ? db.prepare('SELECT id, name FROM items WHERE id = ?').get(b.itemId) : null;
    const lot = b.lotId ? db.prepare('SELECT id, lot_no FROM stock_lots WHERE id = ?').get(b.lotId) : null;
    const ncrId = uuid();
    const ncrNo = nextNumber('ncr', 'UYG');
    db.prepare(`INSERT INTO ncrs (id,ncr_no,source,item_id,item_name,lot_id,lot_no,customer_id,qty_affected,
        severity,description,status,opened_by,opened_at)
      VALUES (?,?,'customer',?,?,?,?,?,?,?,?,'open',?,?)`)
      .run(ncrId, ncrNo, item?.id || null, item?.name || null, lot?.id || null, lot?.lot_no || null,
           t.customer_id, b.qtyAffected || null, b.severity,
           `[${t.ticket_no}] ${t.subject}\n\n${t.description || ''}`, req.user.id, Date.now());
    db.prepare('UPDATE support_tickets SET resulting_ncr_id = ? WHERE id = ?').run(ncrId, t.id);
    logAudit(req, 'auditTicketToNcr', { entityType: 'support_ticket', entityId: t.id, newValue: { ncrId, ncrNo }, detail: `${t.ticket_no} → ${ncrNo}` });
    return { ncrId, ncrNo };
  });
  res.status(201).json(result);
});

module.exports = router;
