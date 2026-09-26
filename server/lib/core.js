const crypto = require('crypto');
const db = require('../db');
const { today: todayLocal } = require('./dates');

/** Domain error with an HTTP status; routes translate these into responses. */
class AppError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function uuid() { return crypto.randomUUID(); }

/** Atomic document numbering: SVK-2026-001 etc. Must be called inside a transaction. */
function nextNumber(key, prefix) {
  const row = db.prepare('SELECT * FROM number_sequences WHERE key = ?').get(key);
  const year = new Date().getFullYear();
  if (!row) {
    db.prepare('INSERT INTO number_sequences (key, prefix, next_value) VALUES (?,?,?)').run(key, prefix, 2);
    return `${prefix}-${year}-001`;
  }
  db.prepare('UPDATE number_sequences SET next_value = next_value + 1 WHERE key = ?').run(key);
  return `${prefix}-${year}-${String(row.next_value).padStart(3, '0')}`;
}

/**
 * Audit entry. Pass oldValue/newValue objects to record what actually changed —
 * required for ISO / regulatory audits ("who changed the price from 10 to 50").
 */
function logAudit(req, actionKey, opts = {}) {
  const { entityType = null, entityId = null, oldValue = null, newValue = null, detail = '' } = opts;
  db.prepare(`INSERT INTO audit_log (id, ts, user_id, username, role, action_key, entity_type, entity_id, old_value, new_value, ip, detail)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuid(), Date.now(),
    req.user ? req.user.id : null,
    req.user ? req.user.username : 'system',
    req.user ? req.user.role : null,
    actionKey, entityType, entityId ? String(entityId) : null,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    req.ip || null, detail
  );
}

/** Shallow diff so audit rows only carry fields that really changed. */
function diff(before, after, fields) {
  const oldV = {}, newV = {};
  fields.forEach(f => {
    const a = before ? before[f] : undefined;
    const b = after ? after[f] : undefined;
    if (String(a ?? '') !== String(b ?? '')) { oldV[f] = a; newV[f] = b; }
  });
  return Object.keys(newV).length ? { oldValue: oldV, newValue: newV } : null;
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/**
 * Exchange rate as of a specific date. Historical rates are stored so that a
 * purchase made last year stays valued at last year's rate — changing today's
 * rate must never retroactively revalue old stock.
 */
function fxRate(currency, dateStr) {
  if (!currency || currency === 'TRY') return 1;
  const date = dateStr || todayLocal();
  const row = db.prepare('SELECT rate FROM exchange_rates WHERE currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1')
    .get(currency, date);
  if (row && Number.isFinite(row.rate) && row.rate > 0) return row.rate;
  throw new AppError(`${currency} için ${date} tarihinde geçerli kur bulunamadı / No valid exchange rate on or before document date`, 422);
}

function toBase(amount, currency, dateStr) {
  return Number(amount || 0) * fxRate(currency, dateStr);
}

/** Standard paged list helper: returns { data, page, pageSize, total }. */
function paginate(query, params, page = 1, pageSize = 50, countQuery = null) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(500, Math.max(1, Number(pageSize) || 50));
  const offset = (p - 1) * size;
  const rows = db.prepare(`${query} LIMIT ? OFFSET ?`).all(...params, size, offset);
  const cq = countQuery || `SELECT COUNT(*) c FROM (${query})`;
  const total = db.prepare(cq).get(...params).c;
  return { data: rows, page: p, pageSize: size, total, totalPages: Math.ceil(total / size) };
}


/**
 * Maps a better-sqlite3 constraint failure to a safe client response.
 * Returns null for anything that is not a constraint violation.
 * Trigger messages are fixed English strings written in our migrations; they
 * are mapped to bilingual messages here instead of being echoed verbatim.
 */
const TRIGGER_MESSAGES = {
  'Payment exceeds open amount': 'Ödeme açık tutarı aşıyor / Payment exceeds open amount',
  'Credit note cannot be paid': 'İade faturası tahsil edilemez / A credit note cannot be paid',
  'Invoice is not open': 'Fatura açık değil / Invoice is not open',
  'Invoice is not approved for payment': 'Fatura ödeme için onaylanmamış / Invoice is not approved for payment',
  'Invoice VAT is not reconciled': 'Fatura KDV tutarı mutabık değil / Invoice VAT is not reconciled',
  'Legacy invoice requires reconciliation': 'Eski fatura önce mutabakat gerektirir / Legacy invoice requires reconciliation',
  'Payments are immutable': 'Ödeme kaydı değiştirilemez / Payments are immutable',
  'Receipt quantity already invoiced': 'Teslim miktarı daha önce faturalanmış / Receipt quantity already invoiced',
  'Receipt line belongs to another order': 'Teslim satırı başka siparişe ait / Receipt line belongs to another order'
};
function sqliteConstraintResponse(err) {
  const code = err && typeof err.code === 'string' ? err.code : '';
  if (!code.startsWith('SQLITE_CONSTRAINT')) return null;
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { status: 422, error: 'İlişkili kayıt bulunamadı veya kullanımda / Related record not found or in use' };
  }
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return { status: 409, error: 'Bu kayıt zaten mevcut / Record already exists' };
  }
  if (code === 'SQLITE_CONSTRAINT_TRIGGER') {
    const known = Object.keys(TRIGGER_MESSAGES).find(key => String(err.message).includes(key));
    return { status: 409, error: known ? TRIGGER_MESSAGES[known] : 'İşlem veri kuralını ihlal ediyor / Operation violates a data rule' };
  }
  return { status: 422, error: 'Geçersiz veya eksik değer / Invalid or missing value' };
}

/** Assignee must be an existing, active user (CRM/support/visits). */
function ensureActiveUser(id) {
  if (id == null) return;
  const u = db.prepare('SELECT is_active FROM users WHERE id = ?').get(id);
  if (!u) throw new AppError('Atanan kullanıcı bulunamadı / Assigned user not found', 404);
  if (!u.is_active) throw new AppError('Atanan kullanıcı pasif / Assigned user is inactive', 422);
}

module.exports = { ensureActiveUser, sqliteConstraintResponse, AppError, uuid, nextNumber, logAudit, diff, getSetting, setSetting, fxRate, toBase, paginate };
