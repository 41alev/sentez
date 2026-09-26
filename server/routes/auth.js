// @ts-nocheck
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { uuid, logAudit } = require('../lib/core');
const { signToken, requireAuth, TOKEN_TTL_HOURS } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { passwordProblem } = require('../lib/password-policy');

const router = express.Router();

const MAX_FAILED = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCK_MINUTES = Number(process.env.LOCKOUT_MINUTES || 15);

const loginSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200)
});

router.post('/login', validate(loginSchema), (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  const genericFail = () => res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı / Invalid username or password' });

  // A wrong password must not reveal whether the account exists or is disabled.
  if (!user) return genericFail();
  if (!user.is_active) {
    bcrypt.compareSync(password, user.password_hash); // same cost as an active account
    return genericFail();
  }

  if (user.locked_until && user.locked_until > Date.now()) {
    const mins = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(429).json({ error: `Hesap geçici olarak kilitli, ${mins} dk sonra tekrar deneyin / Account locked, retry in ${mins} min` });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    // After a lock has expired the counter restarts, so one typo does not re-lock (AU-02).
    const expired = user.locked_until && user.locked_until <= Date.now();
    const attempts = (expired ? 0 : user.failed_attempts) + 1;
    const lockUntil = attempts >= MAX_FAILED ? Date.now() + LOCK_MINUTES * 60000 : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockUntil, user.id);
    logAudit({ user: null, ip: req.ip }, 'auditLoginFailed', { entityType: 'user', entityId: user.id, detail: username });
    return genericFail();
  }

  const jti = uuid();
  const expiresAt = Date.now() + TOKEN_TTL_HOURS * 3600000;
  db.prepare('INSERT INTO sessions (jti,user_id,issued_at,expires_at,user_agent) VALUES (?,?,?,?,?)')
    .run(jti, user.id, Date.now(), expiresAt, (req.headers['user-agent'] || '').slice(0, 200));
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(Date.now(), user.id);

  const token = signToken(user, jti);
  logAudit({ user, ip: req.ip }, 'auditLogin', { entityType: 'user', entityId: user.id });

  res.json({
    token,
    user: {
      id: user.id, username: user.username, fullName: user.full_name, role: user.role,
      approvalLimit: user.approval_limit, mustChangePassword: !!user.must_change_password
    }
  });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE jti = ?').run(Date.now(), req.user.jti);
  logAudit(req, 'auditLogout', { entityType: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, full_name, email, role, approval_limit, must_change_password FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({
    user: {
      id: user.id, username: user.username, fullName: user.full_name, email: user.email,
      role: user.role, approvalLimit: user.approval_limit, mustChangePassword: !!user.must_change_password
    }
  });
});

const changePwSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().max(200)
});

router.post('/change-password', requireAuth, validate(changePwSchema), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Mevcut şifre hatalı / Current password is incorrect' });
  }
  const problem = passwordProblem(req.body.newPassword);
  if (problem) return res.status(422).json({ error: problem });
  if (bcrypt.compareSync(req.body.newPassword, user.password_hash)) {
    return res.status(422).json({ error: 'Yeni şifre eskisiyle aynı olamaz / New password must differ from the current one' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(req.body.newPassword, 12), user.id);
  // Force re-login everywhere else after a password change
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND jti != ? AND revoked_at IS NULL')
    .run(Date.now(), user.id, req.user.jti);
  logAudit(req, 'auditPasswordChanged', { entityType: 'user', entityId: user.id });
  res.json({ ok: true });
});

router.get('/sessions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT jti, issued_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id = ? ORDER BY issued_at DESC LIMIT 20')
    .all(req.user.id);
  res.json(rows.map(r => ({
    jti: r.jti, issuedAt: r.issued_at, expiresAt: r.expires_at, revokedAt: r.revoked_at,
    userAgent: r.user_agent, current: r.jti === req.user.jti
  })));
});

module.exports = router;
