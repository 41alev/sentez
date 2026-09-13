// @ts-nocheck
/**
 * BI/raporlama derinliği — 9 sabit rapordan sonra kullanıcının KENDİ
 * kesişimini kurabilmesi (rakip ERP'lerin "esnek rapor" özelliğine karşılık).
 *
 * Bilinçli kapsam sınırı: serbest SQL veya sürükle-bırak rapor tasarımcısı
 * YOK — güvenlik açısından riskli (SQL injection, yetkisiz veri erişimi) ve
 * gerçek fayda/karmaşıklık oranı düşük. Bunun yerine `stock_lots`/`movements`
 * üzerinde ÖNCEDEN TANIMLANMIŞ, güvenli bir boyut+ölçü+filtre whitelist'i
 * (bkz. server/services/pivot.js) — kullanıcı yalnızca bu whitelist'ten
 * seçim yapar, hiçbir girdisi ham SQL'e karışmaz. Talep tahmini (forecasting)
 * kapsam dışı — ayrı bir veri bilimi çalışması gerektirir.
 */
module.exports = {
  name: 'saved_reports',
  up(db) {
    db.exec(`
      CREATE TABLE saved_reports (
        id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        dimension TEXT NOT NULL,
        metric TEXT NOT NULL,
        chart_type TEXT NOT NULL DEFAULT 'bar' CHECK(chart_type IN ('bar','line')),
        filters TEXT NOT NULL DEFAULT '{}',
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_saved_reports_company ON saved_reports(company_id);
    `);
  }
};
