// @ts-nocheck
/**
 * KVKK m.7/m.11 — kişisel veri sahibi haklarını (anonimleştirme, saklama
 * süresi sonunda otomatik anonimleştirme) teknik olarak karşılayacak alanlar.
 *
 * `anonymized_at` dolu bir kayıt bir daha asla düzenlenemez/anonimleştirilemez
 * (bkz. server/lib/kvkk.js) — geri döndürülemezliği veritabanı seviyesinde de
 * işaretler. `deactivated_at`, saklama süresi politikasının (bkz.
 * server/services/data-retention.js) "ilişki ne zaman sona erdi" sorusunu
 * yanıtlayabilmesi için gerekli — mevcut `is_active` bayrağının KENDİSİ bunu
 * hiç kaydetmiyordu, ne zaman pasifleştirildiği bilinmiyordu.
 */
module.exports = {
  name: 'kvkk_anonymization',
  up(db) {
    db.exec(`
      ALTER TABLE customers ADD COLUMN deactivated_at INTEGER;
      ALTER TABLE customers ADD COLUMN anonymized_at INTEGER;
      ALTER TABLE suppliers ADD COLUMN deactivated_at INTEGER;
      ALTER TABLE suppliers ADD COLUMN anonymized_at INTEGER;
      ALTER TABLE users ADD COLUMN anonymized_at INTEGER;
    `);
  }
};
