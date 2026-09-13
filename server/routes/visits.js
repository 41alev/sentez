// @ts-nocheck
/**
 * Saha ziyaret kaydı — CRM fırsatlarına (opportunity) isteğe bağlı olarak
 * bağlanabilen, GERÇEKLEŞMİŞ bir müşteri ziyaretinin kaydı.
 *
 * Bilinçli kapsam sınırı: gelecek tarihli randevu/planlama yok, yalnızca
 * geçmişe dönük kayıt. Konum (latitude/longitude) isteğe bağlıdır — tarayıcı
 * konum izni reddedilirse veya ofis içi bir görüşmeyse boş bırakılabilir;
 * hiçbir sunucu tarafı doğrulama konumun "gerçekten o an, o yerde" alındığını
 * kanıtlayamaz (istemci tarayıcı Geolocation API'sinden geldiği gibi kaydedilir).
 */
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, uuid, logAudit, paginate } = require('../lib/core');
const { companyIdOf } = require('../lib/tenant');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');
const MANAGER = requireRole('admin', 'manager');

function serialize(row) {
  return {
    id: row.id, customerId: row.customer_id, customerName: row.customer_name,
    opportunityId: row.opportunity_id, oppNo: row.opp_no,
    visitedBy: row.visited_by, visitedUsername: row.visited_username,
    visitDate: row.visit_date, purpose: row.purpose, notes: row.notes,
    latitude: row.latitude, longitude: row.longitude, followUpDate: row.follow_up_date,
    createdAt: row.created_at
  };
}

/* ============================ LİSTE ============================ */

router.get('/', (req, res) => {
  const { customerId = '', opportunityId = '', visitedBy = '', from = '', to = '', page = 1, pageSize = 50 } = req.query;
  let sql = `SELECT v.*, c.name AS customer_name, u.username AS visited_username, o.opp_no
             FROM customer_visits v
             LEFT JOIN customers c ON c.id = v.customer_id
             LEFT JOIN users u ON u.id = v.visited_by
             LEFT JOIN opportunities o ON o.id = v.opportunity_id
             WHERE 1=1`;
  const params = [];
  if (customerId) { sql += ' AND v.customer_id = ?'; params.push(customerId); }
  if (opportunityId) { sql += ' AND v.opportunity_id = ?'; params.push(opportunityId); }
  if (visitedBy) { sql += ' AND v.visited_by = ?'; params.push(visitedBy); }
  if (from) { sql += ' AND v.visit_date >= ?'; params.push(from); }
  if (to) { sql += ' AND v.visit_date <= ?'; params.push(to); }
  sql += ' ORDER BY v.visit_date DESC, v.created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serialize);
  res.json(result);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT v.*, c.name AS customer_name, u.username AS visited_username, o.opp_no
    FROM customer_visits v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN users u ON u.id = v.visited_by
    LEFT JOIN opportunities o ON o.id = v.opportunity_id
    WHERE v.id = ?`).get(req.params.id);
  if (!row) throw new AppError('Ziyaret kaydı bulunamadı / Visit not found', 404);
  res.json(serialize(row));
});

/* ============================ OLUŞTURMA / GÜNCELLEME ============================ */

const visitSchema = z.object({
  customerId: z.coerce.number().int(),
  opportunityId: z.string().max(200).optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purpose: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

router.post('/', WRITE, validate(visitSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(b.customerId);
    if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
    if (b.opportunityId) {
      const o = db.prepare('SELECT id FROM opportunities WHERE id = ?').get(b.opportunityId);
      if (!o) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
    }
    const id = uuid();
    db.prepare(`INSERT INTO customer_visits
      (id,company_id,customer_id,opportunity_id,visited_by,visit_date,purpose,notes,latitude,longitude,follow_up_date,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, companyIdOf(req), b.customerId, b.opportunityId || null, req.user.id, b.visitDate,
           b.purpose || null, b.notes || null, b.latitude ?? null, b.longitude ?? null, b.followUpDate || null, Date.now());
    logAudit(req, 'auditVisitAdd', { entityType: 'customer_visit', entityId: id, detail: `${b.visitDate} · müşteri #${b.customerId}` });
    return db.prepare('SELECT * FROM customer_visits WHERE id = ?').get(id);
  });
  res.status(201).json(serialize(result));
});

const visitUpdateSchema = visitSchema.omit({ customerId: true }).partial();

router.put('/:id', WRITE, validate(visitUpdateSchema), (req, res) => {
  const before = db.prepare('SELECT * FROM customer_visits WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('Ziyaret kaydı bulunamadı / Visit not found', 404);
  const b = req.valid;
  if (b.opportunityId) {
    const o = db.prepare('SELECT id FROM opportunities WHERE id = ?').get(b.opportunityId);
    if (!o) throw new AppError('Fırsat bulunamadı / Opportunity not found', 404);
  }
  db.prepare(`UPDATE customer_visits SET opportunity_id=COALESCE(?,opportunity_id), visit_date=COALESCE(?,visit_date),
    purpose=COALESCE(?,purpose), notes=COALESCE(?,notes), latitude=COALESCE(?,latitude),
    longitude=COALESCE(?,longitude), follow_up_date=COALESCE(?,follow_up_date) WHERE id=?`)
    .run(b.opportunityId, b.visitDate, b.purpose, b.notes, b.latitude, b.longitude, b.followUpDate, req.params.id);
  logAudit(req, 'auditVisitEdit', { entityType: 'customer_visit', entityId: req.params.id, detail: before.visit_date });
  res.json(serialize(db.prepare('SELECT * FROM customer_visits WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', MANAGER, (req, res) => {
  const row = db.prepare('SELECT * FROM customer_visits WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError('Ziyaret kaydı bulunamadı / Visit not found', 404);
  db.prepare('DELETE FROM customer_visits WHERE id = ?').run(row.id);
  logAudit(req, 'auditVisitDelete', { entityType: 'customer_visit', entityId: row.id, oldValue: { visitDate: row.visit_date, customerId: row.customer_id }, detail: row.visit_date });
  res.status(204).end();
});

module.exports = router;
