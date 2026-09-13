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

/**
 * Otomatik yeniden deneme — üstel geri çekilme + jitter (CLAUDE.md §35).
 * 5 deneme hakkı: ~1dk, ~2dk, ~4dk, ~8dk, ~16dk (üst sınır 30dk) sonra
 * dead-letter olur (next_retry_at NULL kalır, elle "yeniden dene" ile
 * hâlâ denenebilir — otomatik kuyruk sonsuza dek denemez).
 */
const MAX_AUTO_RETRIES = 5;
// Test paketi gerçek dakikalarca bekleyemez — yalnızca test ortamında
// WEBHOOK_RETRY_BASE_MS ile kısaltılabilir (bkz. test/run-all.js). Üretimde
// bu değişken hiç ayarlanmaz, varsayılan 60 saniye geçerli olur.
const RETRY_BASE_MS = Number(process.env.WEBHOOK_RETRY_BASE_MS) || 60000;
const RETRY_MAX_MS = 30 * 60000;

function nextRetryDelay(retryCount) {
  const exp = Math.min(RETRY_BASE_MS * 2 ** retryCount, RETRY_MAX_MS);
  return Math.round(exp * (0.85 + Math.random() * 0.3)); // ±15% jitter — art arda tekrar deneme fırtınasını önler
}

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

/**
 * Tek bir teslimatı gönderir ve sonucunu (başarı da olsa hata da olsa) kaydeder.
 * @param {number} [retryCount] Bu, kaçıncı deneme (0 = ilk deneme veya elle
 *   yeniden deneme — elle deneme kullanıcının "sorunu düzelttim" sinyalidir,
 *   otomatik kuyruk sayacını sıfırdan başlatması doğrudur). Otomatik kuyruk
 *   (bkz. processRetryQueue) bir önceki denemenin retry_count + 1'ini geçer.
 */
async function sendDelivery(webhook, event, data, retryCount = 0) {
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

  // Başarısızsa VE hâlâ otomatik deneme hakkı varsa bir sonraki deneme zamanı
  // hesaplanır; başarılıysa veya hak tükendiyse next_retry_at NULL kalır —
  // processRetryQueue bu kaydı bir daha hiç görmez (dead-letter, elle
  // "yeniden dene" ile hâlâ mümkün).
  const nextRetryAt = (!success && retryCount < MAX_AUTO_RETRIES) ? Date.now() + nextRetryDelay(retryCount) : null;

  db.prepare(`INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, success, error, duration_ms, attempted_at, retry_count, next_retry_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uuid(), webhook.id, event, body, statusCode, success ? 1 : 0, error, Date.now() - start, Date.now(), retryCount, nextRetryAt);

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

/**
 * Otomatik yeniden deneme kuyruğu — süresi gelmiş (next_retry_at <= now),
 * hâlâ deneme hakkı olan başarısız teslimatları bulup tekrar dener. Her
 * çağrıda önce next_retry_at NULL'a çekilir (bir sonraki tick aynı kaydı
 * TEKRAR işlemesin — yeni deneme kendi next_retry_at'ini kuracak).
 * Bilinçli kapsam sınırı: gerçek bir mesaj kuyruğu değil, basit bir
 * polling taraması — tek sunuculu bir ERP için yeterli (bkz. 012 migration).
 */
function processRetryQueue() {
  const due = db.prepare(`
    SELECT wd.id, wd.event, wd.payload, wd.retry_count, w.id AS webhook_id, w.url, w.secret, w.is_active, w.company_id
    FROM webhook_deliveries wd JOIN webhooks w ON w.id = wd.webhook_id
    WHERE wd.success = 0 AND wd.next_retry_at IS NOT NULL AND wd.next_retry_at <= ?
  `).all(Date.now());

  for (const d of due) {
    db.prepare('UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ?').run(d.id);
    if (!d.is_active) continue; // webhook o sırada devre dışı bırakılmışsa yeniden denenmez
    let payload;
    try { payload = JSON.parse(d.payload).data; } catch { continue; } // bozuk kayıt: sessizce atla, veri kaybı değil (orijinal kayıt zaten duruyor)
    sendDelivery({ id: d.webhook_id, url: d.url, secret: d.secret }, d.event, payload, d.retry_count + 1).catch(() => {});
  }
}

let retryTimer = null;
function startWebhookRetryScheduler() {
  if (retryTimer) return; // testler arka arkaya server başlatıp durdurabiliyor — çift zamanlayıcı kurulmasın
  const tick = () => {
    // Zamanlayıcı sunucuyu asla çökertmemeli (bkz. services/notifications.js
    // startScheduler — aynı desen): setInterval içindeki senkron bir hata
    // (ör. DB kilitliyken atılan bir istisna) yakalanmazsa süreç geneli
    // uncaughtException ile sonlanırdı.
    try { processRetryQueue(); } catch (e) { console.error('[webhook-retry] tarama başarısız / scan failed:', e.message); }
  };
  retryTimer = setInterval(tick, 60000);
  retryTimer.unref?.(); // açık bir zamanlayıcı process'in kapanmasını engellemesin (testlerde graceful shutdown)
}

module.exports = { EVENT_CATALOG, dispatchEvent, sendDelivery, processRetryQueue, startWebhookRetryScheduler };
