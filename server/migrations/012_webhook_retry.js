// @ts-nocheck
/**
 * Webhook gönderim motoru şimdiye kadar "fire and forget"ti (bkz.
 * 009_webhooks.js'in kapsam notu): iş işlemi commit olduktan hemen sonra
 * TEK bir deneme yapılır, başarısızlık kaydedilir ama otomatik yeniden
 * denenmezdi — yalnızca elle (POST .../retry). Bu, gerçek bir üretim
 * webhook sisteminde (GitHub/Stripe deseni) beklenen "üstel geri çekilmeli
 * otomatik yeniden deneme" davranışını eksik bırakıyordu: alıcı sistem
 * birkaç dakikalığına ayakta değilse (deploy, geçici ağ kesintisi), olay
 * KALICI olarak kaybolurdu.
 *
 * Bu migration otomatik yeniden deneme kuyruğu için gereken iki alanı
 * ekliyor (bkz. server/lib/webhooks.js processRetryQueue): `retry_count`
 * (kaçıncı deneme olduğu) ve `next_retry_at` (bir sonraki deneme zamanı —
 * yalnızca başarısız VE hâlâ deneme hakkı kalan kayıtlarda dolu).
 *
 * Bilinçli kapsam sınırı: gerçek bir mesaj kuyruğu (SQS/RabbitMQ) veya
 * transactional outbox DEĞİL — SQLite üzerinde basit bir "next_retry_at
 * <= now() olanları tara" polling mekanizması. Tek sunuculu, tek tesis bir
 * ERP için bu, karmaşıklık/fayda dengesinde doğru nokta.
 */
module.exports = {
  name: 'webhook_retry',
  up(db) {
    db.exec(`
      ALTER TABLE webhook_deliveries ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE webhook_deliveries ADD COLUMN next_retry_at INTEGER;
      CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;
    `);
  }
};
