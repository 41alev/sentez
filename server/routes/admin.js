// @ts-nocheck
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole, PERMISSIONS } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit, diff, getSetting, setSetting, paginate } = require('../lib/core');
const { today } = require('../lib/dates');
const { companyIdOf } = require('../lib/tenant');

const router = express.Router();
router.use(requireAuth);

const ADMIN = requireRole('admin');
const MANAGER = requireRole('admin', 'manager');
const ROLES = ['admin', 'manager', 'operator', 'quality', 'viewer'];

/* ============================ USERS ============================ */

router.get('/users', ADMIN, (req, res) => {
  const rows = db.prepare(`SELECT id, username, full_name, email, role, approval_limit, is_active,
    must_change_password, last_login_at, locked_until, created_at FROM users ORDER BY id`).all();
  res.json(rows.map(u => ({
    id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role,
    approvalLimit: u.approval_limit, isActive: !!u.is_active, mustChangePassword: !!u.must_change_password,
    lastLoginAt: u.last_login_at, lockedUntil: u.locked_until, createdAt: u.created_at,
    permissions: PERMISSIONS[u.role] || []
  })));
});

const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(200),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı / Password must be at least 8 characters'),
  fullName: z.string().max(1000).optional(), email: z.string().email().optional().or(z.literal('')),
  role: z.enum(['admin', 'manager', 'operator', 'quality', 'viewer']),
  approvalLimit: z.coerce.number().min(0).default(0),
  mustChangePassword: z.coerce.boolean().default(true)
});

/** Reject trivially weak passwords regardless of length. */
function assertPasswordStrength(pw) {
  if (pw.length < 8) throw new AppError('Şifre en az 8 karakter olmalı / Password must be at least 8 characters');
  const weak = ['12345678', 'password', 'qwertyui', 'admin123', '11111111'];
  if (weak.includes(pw.toLowerCase())) throw new AppError('Şifre çok basit / Password is too weak');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (classes < 2) throw new AppError('Şifre harf ve rakam içermeli / Password must mix letters and numbers');
}

router.post('/users', ADMIN, validate(userCreateSchema), (req, res) => {
  const b = req.valid;
  assertPasswordStrength(b.password);
  if (db.prepare('SELECT id FROM users WHERE username = ? AND company_id = ?').get(b.username, companyIdOf(req))) {
    throw new AppError('Bu kullanıcı adı zaten kullanılıyor / Username already taken', 409);
  }
  const info = db.prepare(`INSERT INTO users (username, full_name, email, password_hash, role, approval_limit, must_change_password, is_active, created_at, company_id)
    VALUES (?,?,?,?,?,?,?,1,?,?)`).run(b.username, b.fullName || null, b.email || null,
    bcrypt.hashSync(b.password, 12), b.role, b.approvalLimit, b.mustChangePassword ? 1 : 0, Date.now(), companyIdOf(req));
  logAudit(req, 'auditUserAdd', { entityType: 'user', entityId: info.lastInsertRowid, newValue: { username: b.username, role: b.role }, detail: `${b.username} (${b.role})` });
  res.status(201).json({ id: info.lastInsertRowid, username: b.username, role: b.role });
});

router.put('/users/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError('Kullanıcı bulunamadı / User not found', 404);
  const { role, password, fullName, email, approvalLimit, isActive } = req.body || {};

  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new AppError('Geçersiz rol / Invalid role');
    if (user.role === 'admin' && role !== 'admin') {
      const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1").get().c;
      if (admins <= 1) throw new AppError('Son yönetici hesabının rolü değiştirilemez / Cannot demote the last admin');
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (password) {
    assertPasswordStrength(password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(bcrypt.hashSync(password, 12), id);
    // Force re-login everywhere after an admin password reset
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), id);
  }
  if (fullName !== undefined) db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, id);
  if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id);
  if (approvalLimit !== undefined) db.prepare('UPDATE users SET approval_limit = ? WHERE id = ?').run(Number(approvalLimit) || 0, id);
  if (isActive !== undefined) {
    if (!isActive && user.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1").get().c;
      if (admins <= 1) throw new AppError('Son yönetici hesabı pasifleştirilemez / Cannot deactivate the last admin');
    }
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    if (!isActive) db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), id);
  }
  const after = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const d = diff(user, after, ['role', 'full_name', 'email', 'approval_limit', 'is_active']);
  logAudit(req, 'auditUserEdit', { entityType: 'user', entityId: id, ...(d || {}), detail: user.username + (password ? ' (şifre sıfırlandı)' : '') });
  res.json({ id: after.id, username: after.username, role: after.role, isActive: !!after.is_active });
});

router.post('/users/:id/unlock', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
  logAudit(req, 'auditUserUnlock', { entityType: 'user', entityId: id });
  res.json({ ok: true });
});

router.delete('/users/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError('Kullanıcı bulunamadı / User not found', 404);
  if (id === req.user.id) throw new AppError('Kendi hesabınızı silemezsiniz / You cannot delete your own account');
  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1").get().c;
    if (admins <= 1) throw new AppError('Son yönetici hesabı silinemez / Cannot delete the last admin');
  }
  // Soft-deactivate rather than hard delete so audit/movement history keeps its author
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), id);
  logAudit(req, 'auditUserDelete', { entityType: 'user', entityId: id, detail: user.username });
  res.status(204).end();
});

/* ============================ WAREHOUSES ============================ */

router.get('/warehouses', (req, res) => {
  res.json(db.prepare('SELECT id, code, name, address, is_quarantine AS isQuarantine, is_active AS isActive FROM warehouses WHERE is_active = 1 ORDER BY id').all());
});

router.post('/warehouses', MANAGER, validate(z.object({
  name: z.string().trim().min(1).max(200), code: z.string().max(1000).optional(),
  address: z.string().max(5000).optional(), isQuarantine: z.coerce.boolean().default(false)
})), (req, res) => {
  const b = req.valid;
  try {
    const info = db.prepare('INSERT INTO warehouses (name, code, address, is_quarantine, company_id) VALUES (?,?,?,?,?)')
      .run(b.name, b.code || null, b.address || null, b.isQuarantine ? 1 : 0, companyIdOf(req));
    logAudit(req, 'auditWarehouseAdd', { entityType: 'warehouse', entityId: info.lastInsertRowid, newValue: b, detail: b.name });
    res.status(201).json(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    throw new AppError('Bu isimde bir depo zaten var / Warehouse already exists', 409);
  }
});

router.put('/warehouses/:id', MANAGER, (req, res) => {
  const before = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('Depo bulunamadı / Warehouse not found', 404);
  const { name, code, address, isQuarantine, isActive } = req.body || {};
  db.prepare(`UPDATE warehouses SET name = COALESCE(?,name), code = COALESCE(?,code), address = COALESCE(?,address),
    is_quarantine = COALESCE(?,is_quarantine), is_active = COALESCE(?,is_active) WHERE id = ?`)
    .run(name ?? null, code ?? null, address ?? null,
         isQuarantine === undefined ? null : (isQuarantine ? 1 : 0),
         isActive === undefined ? null : (isActive ? 1 : 0), req.params.id);
  const after = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  const d = diff(before, after, ['name', 'code', 'address', 'is_quarantine', 'is_active']);
  logAudit(req, 'auditWarehouseEdit', { entityType: 'warehouse', entityId: after.id, ...(d || {}), detail: after.name });
  res.json(after);
});

/* ============================ SETTINGS ============================ */

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => out[r.key] = r.value);
  res.json({
    companyName: out.companyName || 'Depo Takip',
    baseCurrency: out.baseCurrency || 'TRY',
    defaultLaborRate: Number(out.defaultLaborRate || 0),
    defaultOverheadPct: Number(out.defaultOverheadPct || 0),
    expiryWarningDays: Number(out.expiryWarningDays || 30),
    lowStockCheckEnabled: out.lowStockCheckEnabled !== '0',
    labelPrinterIp: out.labelPrinterIp || '',
    labelPrinterPort: Number(out.labelPrinterPort || 9100),
    raw: out
  });
});

router.put('/settings', MANAGER, (req, res) => {
  const before = {};
  const allowed = ['companyName', 'baseCurrency', 'defaultLaborRate', 'defaultOverheadPct', 'expiryWarningDays', 'lowStockCheckEnabled', 'labelPrinterIp', 'labelPrinterPort'];
  const changes = {};
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      before[k] = getSetting(k);
      setSetting(k, req.body[k]);
      changes[k] = req.body[k];
    }
  });
  logAudit(req, 'auditSettingsUpdate', { entityType: 'settings', oldValue: before, newValue: changes });
  res.json({ ok: true });
});

/* ============================ EXCHANGE RATES (historical) ============================ */

router.get('/exchange-rates', (req, res) => {
  const { currency = '', page = 1, pageSize = 100 } = req.query;
  let sql = 'SELECT * FROM exchange_rates WHERE 1=1';
  const params = [];
  if (currency) { sql += ' AND currency = ?'; params.push(currency); }
  sql += ' ORDER BY rate_date DESC, currency';
  res.json(paginate(sql, params, page, pageSize));
});

router.get('/exchange-rates/current', (req, res) => {
  const out = {};
  ['USD', 'EUR', 'GBP'].forEach(c => {
    const row = db.prepare('SELECT rate, rate_date FROM exchange_rates WHERE currency = ? ORDER BY rate_date DESC LIMIT 1').get(c);
    if (row) out[c] = { rate: row.rate, date: row.rate_date };
  });
  res.json(out);
});

router.post('/exchange-rates', MANAGER, validate(z.object({
  currency: z.enum(['USD', 'EUR', 'GBP']),
  rate: z.coerce.number().positive(),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().max(1000).optional()
})), (req, res) => {
  const b = req.valid;
  const date = b.rateDate || today();
  const existing = db.prepare('SELECT rate FROM exchange_rates WHERE currency = ? AND rate_date = ?').get(b.currency, date);
  db.prepare(`INSERT INTO exchange_rates (currency, rate, rate_date, source, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(currency, rate_date) DO UPDATE SET rate = excluded.rate, source = excluded.source`)
    .run(b.currency, b.rate, date, b.source || 'manual', Date.now());
  logAudit(req, 'auditFxRateSet', {
    entityType: 'exchange_rate', entityId: `${b.currency}:${date}`,
    oldValue: existing ? { rate: existing.rate } : null, newValue: { rate: b.rate },
    detail: `${b.currency} @ ${date} = ${b.rate}`
  });
  res.status(201).json({ currency: b.currency, rate: b.rate, rateDate: date });
});

/* ============================ APPROVAL RULES ============================ */

router.get('/approval-rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM approval_rules WHERE is_active = 1 ORDER BY doc_type, threshold_base').all());
});

router.post('/approval-rules', ADMIN, validate(z.object({
  docType: z.enum(['purchase_order', 'purchase_request']),
  thresholdBase: z.coerce.number().min(0),
  requiredRole: z.enum(['admin', 'manager'])
})), (req, res) => {
  const b = req.valid;
  const info = db.prepare('INSERT INTO approval_rules (doc_type, threshold_base, required_role) VALUES (?,?,?)')
    .run(b.docType, b.thresholdBase, b.requiredRole);
  logAudit(req, 'auditApprovalRuleAdd', { entityType: 'approval_rule', entityId: info.lastInsertRowid, newValue: b });
  res.status(201).json(db.prepare('SELECT * FROM approval_rules WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/approval-rules/:id', ADMIN, (req, res) => {
  db.prepare('UPDATE approval_rules SET is_active = 0 WHERE id = ?').run(req.params.id);
  logAudit(req, 'auditApprovalRuleDelete', { entityType: 'approval_rule', entityId: req.params.id });
  res.status(204).end();
});

/* ============================ NOTIFICATION RULES ============================ */

router.get('/notification-rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM notification_rules ORDER BY rule_type').all());
});

router.post('/notification-rules', MANAGER, validate(z.object({
  ruleType: z.enum(['low_stock', 'expiry', 'overdue_po', 'ncr_open', 'calibration_due']),
  channel: z.enum(['inapp', 'email']).default('inapp'),
  thresholdDays: z.coerce.number().int().optional(),
  recipients: z.string().max(1000).optional()
})), (req, res) => {
  const b = req.valid;
  const info = db.prepare('INSERT INTO notification_rules (rule_type, channel, threshold_days, recipients) VALUES (?,?,?,?)')
    .run(b.ruleType, b.channel, b.thresholdDays ?? null, b.recipients || null);
  logAudit(req, 'auditNotificationRuleAdd', { entityType: 'notification_rule', entityId: info.lastInsertRowid, newValue: b });
  res.status(201).json(db.prepare('SELECT * FROM notification_rules WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/notification-rules/:id', MANAGER, (req, res) => {
  db.prepare('DELETE FROM notification_rules WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/* ============================ AUDIT LOG ============================ */

router.get('/audit', (req, res) => {
  const { entityType = '', entityId = '', username = '', page = 1, pageSize = 100 } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType); }
  if (entityId) { sql += ' AND entity_id = ?'; params.push(String(entityId)); }
  if (username) { sql += ' AND username = ?'; params.push(username); }
  sql += ' ORDER BY ts DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(r => ({
    id: r.id, ts: r.ts, username: r.username, role: r.role, actionKey: r.action_key,
    entityType: r.entity_type, entityId: r.entity_id,
    oldValue: r.old_value ? JSON.parse(r.old_value) : null,
    newValue: r.new_value ? JSON.parse(r.new_value) : null,
    detail: r.detail, ip: r.ip
  }));
  res.json(result);
});

module.exports = router;
