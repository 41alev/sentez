// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { paginate, logAudit, AppError } = require('../lib/core');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { unread = '', severity = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM notifications WHERE 1=1';
  const params = [];
  if (unread === '1') sql += ' AND is_read = 0';
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  sql += ' ORDER BY created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE is_read = 0').get().c;
  result.data = result.data.map(n => ({
    id: n.id, ruleType: n.rule_type, severity: n.severity, title: n.title, body: n.body,
    refType: n.ref_type, refId: n.ref_id, isRead: !!n.is_read, createdAt: n.created_at
  }));
  res.json(result);
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
  res.json({ ok: true });
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
router.post('/test-mail', requireRole('admin'), async (req, res, next) => {
  try {
    const to = (req.body && req.body.to) || process.env.SMTP_FROM;
    if (!to) throw new AppError('Alıcı adresi gerekli / Recipient required', 400);
    const r = await notifications.sendEmail(to, '[Sentez] Test e-postası',
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
