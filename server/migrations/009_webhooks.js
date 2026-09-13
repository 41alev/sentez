// @ts-nocheck
/**
 * Webhook altyapısı — rakip ERP'lerin çoğunda olmayan, "ERP'niz bizim
 * sistemimize haber verebilir mi?" sorusuna cevap. Bir dış sistem (e-ticaret,
 * B2B portal, başka bir ERP) belirli olaylarda (sipariş onaylandı, sevkiyat
 * oluştu, üretim tamamlandı vb.) HTTP POST bildirimi almak için kayıt olur.
 *
 * Bilinçli kapsam sınırı: bu bir "transactional outbox" veya kuyruk sistemi
 * DEĞİL. Gönderim, iş işlemi commit olduktan HEMEN SONRA tek seferlik
 * denenir (bkz. server/lib/webhooks.js) ve sonucu (başarı/hata) her zaman
 * webhook_deliveries'e kaydedilir — başarısız bir teslimat sessizce kaybolmaz,
 * Yönetim ekranından görülebilir ve elle yeniden denenebilir. Otomatik
 * yeniden deneme kuyruğu (v2 için not edildi, bkz. PROJECT_STATUS.md).
 */
module.exports = {
  name: 'webhooks',
  up(db) {
    db.exec(`
      CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL DEFAULT 1,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL,              -- JSON dizi, ör. ["purchase_order.approved"]
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_webhooks_company ON webhooks(company_id);

      CREATE TABLE webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id),
        event TEXT NOT NULL,
        payload TEXT NOT NULL,             -- gönderilen tam JSON gövde (yeniden deneme için saklanır)
        status_code INTEGER,               -- alınan HTTP durumu; istek hiç tamamlanmadıysa NULL
        success INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER,
        attempted_at INTEGER NOT NULL
      );
      CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, attempted_at DESC);
    `);
  }
};
