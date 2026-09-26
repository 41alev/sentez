const db = require('../db');
const { uuid, getSetting } = require('../lib/core');
const { today, addDays } = require('../lib/dates');

let mailer = null;
// Son gönderim sonucu: e-postalar sessizce düşerse kimsenin haberi olmaz,
// bu yüzden durum saklanır ve arayüzden görülebilir.
let lastMailStatus = { configured: false, lastSuccessAt: null, lastError: null, lastErrorAt: null };

function getMailer() {
  if (mailer !== null) return mailer;
  const host = process.env.SMTP_HOST;
  if (!host) { mailer = false; lastMailStatus.configured = false; return mailer; }
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      // 'true' ya da '1' kabul edilir; .env dosyalarında ikisi de yaygın
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS || 10000),
      greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS || 10000),
      // Kendi imzalı sertifikalı iç sunucular için kasıtlı kaçış kapısı
      tls: process.env.SMTP_ALLOW_SELF_SIGNED === '1' ? { rejectUnauthorized: false } : undefined
    });
    lastMailStatus.configured = true;
  } catch (e) {
    mailer = false;
    lastMailStatus = { configured: false, lastSuccessAt: null, lastError: e.message, lastErrorAt: Date.now() };
  }
  return mailer;
}

/** Test amaçlı: SMTP ayarları değiştiğinde bağlantıyı yeniden kurmak için. */
function resetMailer() { mailer = null; lastMailStatus = { configured: false, lastSuccessAt: null, lastError: null, lastErrorAt: null }; }
function mailStatus() { getMailer(); return { ...lastMailStatus }; }

function push({ ruleType, severity = 'info', title, body, refType, refId, dedupeKey }) {
  // Avoid re-raising the same open alert every scan
  if (dedupeKey) {
    const existing = db.prepare(
      `SELECT id FROM notifications WHERE ref_type = ? AND ref_id = ? AND rule_type = ?`
    ).get(refType || null, dedupeKey, ruleType);
    if (existing) return existing.id;
  }
  const id = uuid();
  db.prepare(`INSERT INTO notifications (id,rule_type,severity,title,body,ref_type,ref_id,is_read,created_at)
    VALUES (?,?,?,?,?,?,?,0,?)`).run(id, ruleType, severity, title, body || '', refType || null, refId || dedupeKey || null, Date.now());
  return id;
}

async function sendEmail(to, subject, text) {
  const transport = getMailer();
  if (!transport) {
    lastMailStatus.lastError = 'SMTP_HOST tanımlı değil / SMTP_HOST is not configured';
    lastMailStatus.lastErrorAt = Date.now();
    return false;
  }
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || 'depo-takip@localhost', to, subject, text
    });
    lastMailStatus.lastSuccessAt = Date.now();
    lastMailStatus.lastError = null;
    return { messageId: info.messageId, accepted: info.accepted || [], rejected: info.rejected || [] };
  } catch (e) {
    // Sessizce yutmuyoruz: neden gönderilemediği kayda geçer ve arayüzde görünür.
    lastMailStatus.lastError = e.message;
    lastMailStatus.lastErrorAt = Date.now();
    console.error('[mail] gönderilemedi / send failed:', e.message);
    return false;
  }
}

/** Scan the database and raise notifications. Called on a timer and on demand. */
function runScan() {
  const created = [];
  const rules = db.prepare('SELECT * FROM notification_rules WHERE is_active = 1').all();
  const ruleFor = (type) => rules.find(r => r.rule_type === type);

  // --- Low stock: compares available stock against min level, net of what's already on order
  if (ruleFor('low_stock')) {
    const rows = db.prepare(`
      SELECT i.id, i.name, i.unit, i.min_stock, i.qty_cache,
        (SELECT COALESCE(SUM(pi.qty - pi.received_qty),0) FROM po_items pi
          JOIN purchase_orders po ON po.id = pi.po_id
          WHERE pi.item_id = i.id AND po.status IN ('approved','partially_received')) AS on_order
      FROM items i WHERE i.is_active = 1 AND i.deleted_at IS NULL AND i.min_stock > 0
        AND i.qty_cache <= i.min_stock`).all();
    rows.forEach(r => {
      const id = push({
        ruleType: 'low_stock',
        severity: r.qty_cache <= 0 ? 'critical' : 'warning',
        title: `Düşük stok: ${r.name}`,
        body: `Mevcut ${r.qty_cache} ${r.unit}, kritik seviye ${r.min_stock} ${r.unit}. Yolda: ${r.on_order} ${r.unit}.`,
        refType: 'item', refId: r.id, dedupeKey: r.id
      });
      created.push(id);
    });
  }

  // --- Expiry (lot level, so different batches are handled independently)
  const expRule = ruleFor('expiry');
  if (expRule) {
    const days = expRule.threshold_days || 30;
    const limit = addDays(today(), days);
    const rows = db.prepare(`
      SELECT sl.id, sl.lot_no, sl.expiry_date, sl.qty, i.name, i.unit
      FROM stock_lots sl JOIN items i ON i.id = sl.item_id
      WHERE sl.status IN ('available','quarantine') AND sl.qty > 0
        AND sl.expiry_date IS NOT NULL AND sl.expiry_date <= ?`).all(limit);
    rows.forEach(r => {
      const expired = r.expiry_date < today();
      created.push(push({
        ruleType: 'expiry', severity: expired ? 'critical' : 'warning',
        title: `${expired ? 'SKT geçti' : 'SKT yaklaşıyor'}: ${r.name}`,
        body: `Parti ${r.lot_no || '—'} · ${r.qty} ${r.unit} · SKT ${r.expiry_date}`,
        refType: 'lot', refId: r.id, dedupeKey: r.id
      }));
    });
  }

  // --- Overdue purchase orders
  if (ruleFor('overdue_po')) {
    const rows = db.prepare(`
      SELECT id, po_no, supplier_name, expected FROM purchase_orders
      WHERE status IN ('approved','partially_received') AND expected IS NOT NULL AND expected < ?`).all(today());
    rows.forEach(r => {
      created.push(push({
        ruleType: 'overdue_po', severity: 'warning',
        title: `Geciken sipariş: ${r.po_no}`,
        body: `${r.supplier_name || ''} · beklenen teslim ${r.expected}`,
        refType: 'purchase_order', refId: r.id, dedupeKey: r.id
      }));
    });
  }

  // --- Calibration due
  const calRule = ruleFor('calibration_due');
  if (calRule) {
    const days = calRule.threshold_days || 30;
    const limit = addDays(today(), days);
    const rows = db.prepare(`SELECT id, name, next_calibration_date FROM equipment
      WHERE status = 'active' AND next_calibration_date IS NOT NULL AND next_calibration_date <= ?`).all(limit);
    rows.forEach(r => {
      created.push(push({
        ruleType: 'calibration_due', severity: 'warning',
        title: `Kalibrasyon zamanı: ${r.name}`,
        body: `Sonraki kalibrasyon: ${r.next_calibration_date}`,
        refType: 'equipment', refId: String(r.id), dedupeKey: String(r.id)
      }));
    });
  }

  // --- Open NCRs past a reasonable age
  if (ruleFor('ncr_open')) {
    const cutoff = Date.now() - 7 * 86400000;
    const rows = db.prepare(`SELECT id, ncr_no, item_name, severity FROM ncrs
      WHERE status IN ('open','in_progress') AND opened_at < ?`).all(cutoff);
    rows.forEach(r => {
      created.push(push({
        ruleType: 'ncr_open', severity: r.severity === 'critical' ? 'critical' : 'warning',
        title: `Açık uygunsuzluk: ${r.ncr_no}`,
        body: `${r.item_name || ''} · 7 günden uzun süredir açık`,
        refType: 'ncr', refId: r.id, dedupeKey: r.id
      }));
    });
  }

  return created.filter(Boolean).length;
}

/** Email out unsent critical/warning notifications to configured recipients. */
async function dispatchEmails() {
  const rules = db.prepare(`SELECT * FROM notification_rules WHERE is_active = 1 AND channel = 'email'`).all();
  if (rules.length === 0 || !getMailer()) return 0;
  const types = rules.map(r => r.rule_type);
  const placeholders = types.map(() => '?').join(',');
  const pending = db.prepare(
    `SELECT * FROM notifications WHERE emailed_at IS NULL AND rule_type IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`
  ).all(...types);
  let sent = 0;
  for (const n of pending) {
    const rule = rules.find(r => r.rule_type === n.rule_type);
    const recipients = (rule.recipients || '').split(',').map(s => s.trim()).filter(Boolean);
    if (recipients.length === 0) continue;
    const ok = await sendEmail(recipients.join(','), `[Dream Plus] ${n.title}`, n.body || n.title);
    if (ok) {
      db.prepare('UPDATE notifications SET emailed_at = ? WHERE id = ?').run(Date.now(), n.id);
      sent++;
    }
  }
  return sent;
}

function startScheduler() {
  const intervalMin = Number(process.env.NOTIFY_INTERVAL_MIN || 60);
  const tick = async () => {
    try { runScan(); await dispatchEmails(); } catch (e) { /* scheduler must never crash the server */ }
  };
  setTimeout(tick, 10000).unref?.();
  const timer = setInterval(tick, intervalMin * 60000);
  timer.unref?.();
  return timer;
}

module.exports = { push, runScan, dispatchEmails, startScheduler, sendEmail, mailStatus, resetMailer };
