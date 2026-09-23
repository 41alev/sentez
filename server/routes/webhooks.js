// @ts-nocheck
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { AppError, uuid, logAudit, paginate } = require('../lib/core');
const { companyIdOf } = require('../lib/tenant');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { EVENT_CATALOG, sendDelivery, processRetryQueue, processOutbox } = require('../lib/webhooks');
const { resolveTarget } = require('../lib/webhook-target');

const router = express.Router();
router.use(requireAuth);

// Webhook'lar dışarıya iş verisi gönderir — bu yüzden yönetimi (sadece admin'e
// açık, purchase.write/manager gibi ara roller değil, ayarlarla aynı hassasiyette.
const ADMIN = requireRole('admin');

function serialize(w) {
  return {
    id: w.id, url: w.url, events: JSON.parse(w.events), description: w.description,
    isActive: !!w.is_active, createdAt: w.created_at
    // secret KASITLI OLARAK dışa aktarılmıyor — yalnızca oluşturma/yenileme anında bir kez gösterilir.
  };
}

router.get('/', ADMIN, (req, res) => {
  const rows = db.prepare('SELECT * FROM webhooks WHERE company_id = ? ORDER BY created_at DESC').all(companyIdOf(req));
  res.json(rows.map(serialize));
});

router.get('/events', ADMIN, (req, res) => res.json(EVENT_CATALOG));

/**
 * Otomatik kuyruk normalde 60 saniyede bir kendiliğinden çalışır (bkz.
 * server/lib/webhooks.js startWebhookRetryScheduler) — bu, bir yöneticinin
 * "beklemeden şimdi dene" diyebilmesi için VE test paketinin gerçek zamanlı
 * bekleme yapmadan retry mantığını doğrulayabilmesi için var.
 */
router.post('/process-retry-queue', ADMIN, (req, res) => {
  processRetryQueue();
  processOutbox().catch(e => console.error('[webhook-outbox] manual scan failed:', e.message));
  res.json({ ok: true });
});

const createSchema = z.object({
  url: z.string().trim().url('Geçerli bir URL olmalı / Must be a valid URL'),
  events: z.array(z.enum(EVENT_CATALOG)).min(1, 'En az bir olay seçilmeli / Pick at least one event'),
  description: z.string().max(1000).optional()
});

router.post('/', ADMIN, validate(createSchema), async (req, res, next) => {
  try {
  const b = req.valid;
  await resolveTarget(b.url);
  const id = uuid();
  const secret = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO webhooks (id, company_id, url, secret, events, description, is_active, created_by, created_at)
    VALUES (?,?,?,?,?,?,1,?,?)`)
    .run(id, companyIdOf(req), b.url, secret, JSON.stringify(b.events), b.description || null, req.user.id, Date.now());
  logAudit(req, 'auditWebhookAdd', { entityType: 'webhook', entityId: id, detail: b.url });
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  // secret sadece BURADA, oluşturma anında bir kez döner — tıpkı bir API anahtarı gibi.
  res.status(201).json({ ...serialize(row), secret });
  } catch (e) { next(e); }
});

router.put('/:id', ADMIN, async (req, res, next) => {
  try {
  const before = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!before) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  const { url, events, description, isActive } = req.body || {};
  if (url !== undefined) {
    const parsed = z.string().trim().url().safeParse(url);
    if (!parsed.success) throw new AppError('Geçerli bir URL olmalı / Must be a valid URL', 422);
    await resolveTarget(parsed.data);
  }
  if (events !== undefined) {
    const parsed = z.array(z.enum(EVENT_CATALOG)).min(1).safeParse(events);
    if (!parsed.success) throw new AppError('En az bir geçerli olay seçilmeli / Pick at least one valid event', 422);
  }
  db.prepare(`UPDATE webhooks SET url = COALESCE(?,url), events = COALESCE(?,events),
    description = COALESCE(?,description), is_active = COALESCE(?,is_active) WHERE id = ?`)
    .run(url ?? null, events ? JSON.stringify(events) : null, description ?? null,
      isActive === undefined ? null : (isActive ? 1 : 0), req.params.id);
  logAudit(req, 'auditWebhookEdit', { entityType: 'webhook', entityId: req.params.id, detail: url || before.url });
  res.json(serialize(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/:id/regenerate-secret', ADMIN, (req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  const secret = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run(secret, req.params.id);
  logAudit(req, 'auditWebhookSecretRotate', { entityType: 'webhook', entityId: req.params.id, detail: w.url });
  res.json({ ...serialize(w), secret });
});

router.delete('/:id', ADMIN, (req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  db.prepare('DELETE FROM webhook_outbox WHERE webhook_id = ?').run(req.params.id);
  db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(req.params.id);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  logAudit(req, 'auditWebhookDelete', { entityType: 'webhook', entityId: req.params.id, detail: w.url });
  res.status(204).end();
});

router.get('/:id/deliveries', ADMIN, (req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  const { page = 1, pageSize = 25 } = req.query;
  const result = paginate(
    `SELECT id, event, status_code AS statusCode, success, error, duration_ms AS durationMs, attempted_at AS attemptedAt,
            retry_count AS retryCount, next_retry_at AS nextRetryAt
     FROM webhook_deliveries WHERE webhook_id = ? ORDER BY attempted_at DESC`,
    [req.params.id], page, pageSize
  );
  // SQLite'ta boolean yok — 0/1 integer olarak gelir; API sözleşmesi gerçek boolean vermeli (bkz. admin.js'teki isActive deseni).
  result.data = result.data.map(d => ({ ...d, success: !!d.success }));
  res.json(result);
});

router.get('/:id/outbox', ADMIN, (req, res) => {
  const w = db.prepare('SELECT id FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  const { page = 1, pageSize = 25 } = req.query;
  res.json(paginate(`SELECT id, event, created_at AS createdAt, attempt_count AS attemptCount,
      next_attempt_at AS nextAttemptAt, delivered_at AS deliveredAt, last_error AS lastError
    FROM webhook_outbox WHERE webhook_id = ? ORDER BY created_at DESC`, [w.id], page, pageSize));
});

router.post('/:id/outbox/:eventId/retry', ADMIN, (req, res) => {
  const w = db.prepare('SELECT id FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
  if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
  const row = db.prepare('SELECT id, delivered_at, leased_until FROM webhook_outbox WHERE id = ? AND webhook_id = ?').get(req.params.eventId, w.id);
  if (!row) throw new AppError('Olay bulunamadı / Event not found', 404);
  if (row.delivered_at) throw new AppError('Olay zaten teslim edildi / Event already delivered', 409);
  if (row.leased_until && row.leased_until > Date.now()) throw new AppError('Olay hâlâ işleniyor / Event is being delivered', 409);
  db.prepare('UPDATE webhook_outbox SET attempt_count = 0, next_attempt_at = ?, leased_until = NULL, last_error = NULL WHERE id = ?')
    .run(Date.now(), row.id);
  logAudit(req, 'auditWebhookRetry', { entityType: 'webhook', entityId: w.id, detail: row.id });
  processOutbox().catch(e => console.error('[webhook-outbox] manual retry failed:', e.message));
  res.json({ ok: true });
});

router.post('/:id/deliveries/:deliveryId/retry', ADMIN, async (req, res, next) => {
  try {
    const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
    if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
    const d = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ? AND webhook_id = ?').get(req.params.deliveryId, req.params.id);
    if (!d) throw new AppError('Teslimat kaydı bulunamadı / Delivery not found', 404);
    const original = JSON.parse(d.payload);
    const result = await sendDelivery(w, d.event, original.data);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/:id/test', ADMIN, async (req, res, next) => {
  try {
    const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, companyIdOf(req));
    if (!w) throw new AppError('Webhook bulunamadı / Webhook not found', 404);
    const result = await sendDelivery(w, 'ping', { message: 'Bu bir test bildirimidir / This is a test notification', sentAt: new Date().toISOString() });
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
