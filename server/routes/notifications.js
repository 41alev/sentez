// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { paginate, logAudit, AppError } = require('../lib/core');
const { validate, z } = require('../middleware/validate');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { unread = '', severity = '', page = 1, pageSize = 50 } = req.query;
  let sql = `SELECT n.*,CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END user_is_read
    FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=? WHERE 1=1`;
  const params = [req.user.id];
  if (unread === '1') sql += ' AND nr.notification_id IS NULL';
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  sql += ' ORDER BY n.created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.unreadCount = db.prepare(`SELECT COUNT(*) c FROM notifications n
    WHERE NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=?)`).get(req.user.id).c;
  result.data = result.data.map(n => ({
    id: n.id, ruleType: n.rule_type, severity: n.severity, title: n.title, body: n.body,
    refType: n.ref_type, refId: n.ref_id, isRead: !!n.user_is_read, createdAt: n.created_at
  }));
  res.json(result);
});

router.post('/:id/read', (req, res) => {
  if (!db.prepare('SELECT id FROM notifications WHERE id=?').get(req.params.id)) {
    throw new AppError('Bildirim bulunamadı / Notification not found', 404);
  }
  db.prepare('INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) VALUES (?,?,?)')
    .run(req.params.id, req.user.id, Date.now());
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  const result = db.prepare(`INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at)
    SELECT id,?,? FROM notifications`).run(req.user.id, Date.now());
  res.json({ ok: true, marked: result.changes });
});

/** Manually run the alert scan (low stock, expiry, overdue POs, open NCRs, calibration). */
router.post('/scan', requireRole('admin', 'manager'), (req, res) => {
  const created = notifications.runScan();
  logAudit(req, 'auditNotificationScan', { detail: `${created} uyarı / alerts` });
  res.json({ created });
});

/** SMTP durumu: uyarı e-postaları gerçekten gidiyor mu? */
router.get('/mail-status', requireRole('admin', 'manager'), (req, res) => {
  const st = notifications.mailStatus();
  res.json({
    configured: st.configured,
    host: process.env.SMTP_HOST || null,
    from: process.env.SMTP_FROM || null,
    lastSuccessAt: st.lastSuccessAt,
    lastError: st.lastError,
    lastErrorAt: st.lastErrorAt
  });
});

/** Deneme e-postası gönderir — ayarların doğru olduğunu kurulumda kanıtlar. */
router.post('/test-mail', requireRole('admin'), validate(z.object({
  to: z.string().trim().email().max(254).optional()
}).passthrough()), async (req, res, next) => {
  try {
    if (!notifications.mailStatus().configured) {
      throw new AppError('E-posta (SMTP) yapılandırılmamış / Email (SMTP) is not configured', 409);
    }
    const to = req.valid.to || process.env.SMTP_FROM;
    if (!to) throw new AppError('Alıcı adresi gerekli / Recipient required', 400);
    const r = await notifications.sendEmail(to, '[Dream Plus] Test e-postası',
      'Bu bir test mesajıdır. Bu e-postayı aldıysanız SMTP ayarlarınız çalışıyor demektir.');
    if (!r) {
      const st = notifications.mailStatus();
      throw new AppError(`E-posta gönderilemedi / Send failed: ${st.lastError || 'bilinmeyen hata'}`, 502);
    }
    logAudit(req, 'auditTestMail', { detail: to });
    res.json({ ok: true, to, ...r });
  } catch (e) { next(e); }
});

module.exports = router;
