// @ts-nocheck
/**
 * Çok şirketlilik altyapı hazırlığı — HENÜZ DEVREYE ALINMIYOR.
 *
 * Bugün sistem tek bir firma varsayımıyla çalışıyor (`companies` tablosunda
 * tek satır, id=1). `company_id` şu ana kadar yalnızca 7 "ana veri" tablosunda
 * vardı (users, warehouses, suppliers, customers, items, work_centers,
 * document_templates) — hepsi nullable, indekssiz, ve HİÇBİR sorguda filtre
 * olarak kullanılmıyor. İşlemsel tabloların (stok, sipariş, üretim, kalite,
 * sevkiyat, e-belge, denetim kaydı) tamamında bu sütun hiç yoktu.
 *
 * Bu migration yalnızca KATKISAL (additive) değişiklikler yapar:
 *   - Eksik tablolara `company_id INTEGER NOT NULL DEFAULT 1` eklenir +
 *     indekslenir. Varsayılan değer sayesinde mevcut satırlar ve mevcut
 *     INSERT ifadeleri hiç değişmeden çalışmaya devam eder.
 *   - Zaten var olan 7 tablodaki NULL değerler 1'e doldurulur (veri
 *     tutarlılığı; sütunun kendisi NOT NULL'a ÇEVRİLMEZ — bu bir kısıt
 *     değişikliği olur, SQLite'ta tablo yeniden oluşturmayı gerektirir ve
 *     ayrı, daha dikkatli bir migration'ın konusu).
 *
 * Hiçbir sorgu `company_id`'ye göre filtrelemiyor, hiçbir arayüz şirket
 * seçtirmiyor — sütun orada durur, gelecekte gerçek izolasyon eklenmek
 * istendiğinde şema tarafında sıfırdan başlamak gerekmez. `settings` ve
 * `number_sequences` tabloları kasıtlı olarak KAPSAM DIŞI: bunlar bileşik
 * anahtar gerektirir (tablo yeniden oluşturma), ve gerçek aktivasyona çok
 * daha yakın bir adımdır.
 */
module.exports = {
  name: 'multitenancy prep - company_id on all remaining tables',
  up(db) {
    // Stok / lot / hareket
    const tables = [
      'sessions',
      'item_bom', 'raw_materials', 'stock_lots', 'movements',
      'stock_counts', 'stock_count_lines',
      // Satın alma
      'purchase_requests', 'purchase_request_lines',
      'rfqs', 'rfq_lines', 'rfq_quotes',
      'purchase_orders', 'po_items', 'po_revisions',
      'po_receipts', 'po_receipt_lines', 'landed_costs',
      'supplier_invoices', 'supplier_returns', 'supplier_price_history',
      // Satış
      'sales_orders', 'sales_order_lines',
      'shipments', 'shipment_items', 'shipment_crates',
      'customer_invoices', 'customer_invoice_lines',
      // Üretim / planlama
      'production_orders', 'production_order_components', 'production_consumption',
      'shifts', 'work_center_shifts', 'calendar_exceptions', 'routings',
      'production_operations', 'mrp_runs', 'mrp_suggestions', 'shift_logs',
      // Kalite
      'inspections', 'inspection_lines', 'inspection_plans',
      'ncrs', 'capas', 'documents', 'equipment', 'calibrations',
      // e-Belge
      'e_documents', 'e_document_log', 'e_document_series',
      // Excel aktarımı
      'import_batches', 'import_rows',
      // Sistem
      'audit_log', 'approval_rules', 'notification_rules', 'notifications',
      'exchange_rates'
    ];

    // Not: SQLite `ALTER TABLE ADD COLUMN`'da REFERENCES + NOT NULL DEFAULT
    // kombinasyonuna izin vermiyor ("Cannot add a REFERENCES column with
    // non-NULL default value"). Yabancı anahtar burada feda edilmiyor —
    // atıl bir sütun için şu an kritik değil; gerçek aktivasyonda (sorgu
    // filtrelemesi eklenirken) zaten yeniden ele alınacak bir tablo grubu.
    for (const t of tables) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1;`);
      db.exec(`CREATE INDEX idx_${t}_company_id ON ${t}(company_id);`);
    }

    // Zaten company_id'si olan 6 "ana veri" tablosu: NULL kalan satırlar
    // (canlı API rotaları bugüne kadar bu alanı hiç yazmıyordu) 1'e doldurulur.
    //
    // `document_templates` KASITLI OLARAK DIŞARIDA BIRAKILDI: o tabloda
    // NULL, "unutulmuş veri" değil — 005_templates.js'in kendi yorumunda
    // belirtildiği gibi "tüm firmalar için geçerli varsayılan şablon"
    // anlamına gelir. Bunu 1'e doldurmak, o şablonları company 1'e ÖZEL
    // hale getirip varsayılan-şablon davranışını bozardı. Ayrıca bu tablo
    // migration sırasında `companies` tablosu henüz boşken oluşturulduğu
    // için (seed her zaman migration'lardan SONRA çalışır) company_id=1'e
    // dolduracak bir UPDATE, taze bir kurulumda yabancı anahtar hatası
    // verirdi — semantik açıdan da, teknik açıdan da dokunulmaması doğru.
    const existing = ['users', 'warehouses', 'suppliers', 'customers', 'items', 'work_centers'];
    for (const t of existing) {
      db.exec(`UPDATE ${t} SET company_id = 1 WHERE company_id IS NULL;`);
    }
  }
};
