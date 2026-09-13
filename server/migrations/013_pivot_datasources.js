// @ts-nocheck
/**
 * Aşama 8'in ilk sürümü özel raporu YALNIZCA `movements` (stok hareketleri)
 * tablosuyla sınırlıyordu — bu, "satış performansı × ürün kategorisi" gibi
 * soruları cevaplayamıyordu. `saved_reports`'a hangi veri kaynağının
 * kullanıldığını saklayan bir sütun ekleniyor (bkz. server/services/pivot.js
 * DATASOURCES: movements/sales/purchasing/quality).
 *
 * Geriye dönük uyumluluk: mevcut kayıtlarda data_source NULL kalır;
 * server/routes/reports.js bunu 'movements' olarak varsayar — Aşama 8'in
 * ilk sürümünde kaydedilmiş raporlar çalışmaya devam eder.
 */
module.exports = {
  name: 'pivot_datasources',
  up(db) {
    db.exec(`ALTER TABLE saved_reports ADD COLUMN data_source TEXT;`);
  }
};
