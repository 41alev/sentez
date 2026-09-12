const crypto = require('crypto');
const db = require('../db');

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
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT rate FROM exchange_rates WHERE currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1')
    .get(currency, date);
  if (row) return row.rate;
  const latest = db.prepare('SELECT rate FROM exchange_rates WHERE currency = ? ORDER BY rate_date DESC LIMIT 1').get(currency);
  return latest ? latest.rate : 1;
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

module.exports = { AppError, uuid, nextNumber, logAudit, diff, getSetting, setSetting, fxRate, toBase, paginate };
