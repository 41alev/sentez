// @ts-nocheck
/**
 * Webhook gönderim motoru.
 *
 * `dispatchEvent(name, data)` iş işlemi commit olduktan HEMEN SONRA, ilgili
 * route handler'dan çağrılır (asla bir DB transaction'ının İÇİNDEN — burada
 * yapılan `fetch` senkron SQLite transaction'ını bloke eder / bozar).
 * Gönderim "fire and forget"tir: route'un yanıtını bloke etmez, ama HER
 * denemenin sonucu (başarı/hata) `webhook_deliveries`e yazılır — sessizce
 * kaybolan bir teslimat olmaz.
 *
 * İmza: `X-Webhook-Signature: sha256=<hex>`, gövdenin HMAC-SHA256'sı,
 * webhook'a özel gizli anahtarla — GitHub/Stripe'ın kullandığı aynı desen,
 * entegratörler için tanıdık.
 */
const crypto = require('crypto');
const db = require('../db');
const { uuid } = require('./core');

const SEND_TIMEOUT_MS = 8000;

/** Bu sistemin ürettiği olay kataloğu — server/routes/webhooks.js'teki ADMIN CRUD arayüzü de bunu kullanır. */
const EVENT_CATALOG = [
  'purchase_order.created', 'purchase_order.approved', 'purchase_order.received',
  'sales_order.created', 'shipment.created', 'shipment.status_changed',
  'production_order.completed', 'ncr.opened', 'opportunity.won'
];

function activeSubscribersFor(event, companyId = 1) {
  const rows = db.prepare('SELECT * FROM webhooks WHERE is_active = 1 AND company_id = ?').all(companyId);
  return rows.filter(w => {
    try { return JSON.parse(w.events).includes(event); } catch { return false; }
  });
}

/** Tek bir teslimatı gönderir ve sonucunu (başarı da olsa hata da olsa) kaydeder. */
async function sendDelivery(webhook, event, data) {
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
  const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
  const start = Date.now();
  let statusCode = null, success = false, error = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Signature': `sha256=${signature}`
        },
        body,
        signal: controller.signal
      });
      statusCode = res.status;
      success = res.ok;
      if (!res.ok) error = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    error = e.name === 'AbortError' ? 'Zaman aşımı / Timed out' : e.message;
  }

  db.prepare(`INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, success, error, duration_ms, attempted_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(uuid(), webhook.id, event, body, statusCode, success ? 1 : 0, error, Date.now() - start, Date.now());

  return { success, statusCode, error };
}

/** İş işlemi tamamlandıktan sonra çağrılır — asla bir DB transaction'ı içinden. */
function dispatchEvent(event, data, companyId = 1) {
  if (!EVENT_CATALOG.includes(event)) throw new Error(`Bilinmeyen webhook olayı / Unknown webhook event: ${event}`);
  const subs = activeSubscribersFor(event, companyId);
  for (const wh of subs) {
    sendDelivery(wh, event, data).catch(() => {}); // sendDelivery kendi hatasını zaten kaydediyor
  }
}

module.exports = { EVENT_CATALOG, dispatchEvent, sendDelivery };
