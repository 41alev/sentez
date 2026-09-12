// @ts-nocheck
const jwt = require('jsonwebtoken');
const db = require('../db');
const { AppError } = require('../lib/core');

const JWT_SECRET = process.env.JWT_SECRET || 'depo-takip-dev-secret-change-me';
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 12);

/**
 * Permission matrix. Roles are additive tiers plus a specialist 'quality' role
 * that can do quality work but not purchasing/finance.
 */
const PERMISSIONS = {
  admin: ['*'],
  manager: [
    'stock.write', 'stock.delete', 'purchase.write', 'purchase.approve', 'sales.write',
    'production.write', 'quality.write', 'count.write', 'count.approve', 'reports.view', 'settings.write'
  ],
  operator: ['stock.write', 'purchase.write', 'sales.write', 'production.write', 'count.write', 'reports.view'],
  quality: ['quality.write', 'stock.status', 'count.write', 'reports.view'],
  viewer: ['reports.view']
};

function hasPermission(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function signToken(user, jti) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: `${TOKEN_TTL_HOURS}h` }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Yetkilendirme gerekli / Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Server-side revocation: signing out or disabling a user kills the token immediately,
    // instead of leaving a stolen token valid until it expires.
    const session = db.prepare('SELECT * FROM sessions WHERE jti = ?').get(payload.jti);
    if (!session || session.revoked_at) {
      return res.status(401).json({ error: 'Oturum sonlandırılmış / Session revoked' });
    }
    const user = db.prepare('SELECT id, username, role, is_active, must_change_password FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Kullanıcı pasif / User inactive' });
    }
    req.user = { id: user.id, username: user.username, role: user.role, jti: payload.jti, mustChangePassword: !!user.must_change_password };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum / Invalid or expired session' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli / Authentication required' });
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: `Bu işlem için yetkiniz yok (${permission}) / Permission denied` });
    }
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok / Permission denied' });
    }
    next();
  };
}

const requireAdmin = requireRole('admin');

module.exports = {
  JWT_SECRET, TOKEN_TTL_HOURS, PERMISSIONS,
  hasPermission, signToken, requireAuth, requirePermission, requireRole, requireAdmin
};
