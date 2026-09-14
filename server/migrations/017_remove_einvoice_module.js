// @ts-nocheck
/**
 * e-Fatura/e-Arşiv/e-İrsaliye (e-Belge) modülünün KALICI olarak kaldırılması.
 *
 * Ürün, birden çok firmaya satılıp kurulacak bir ticari üründür — resmî belge
 * sorumluluğu (GİB entegrasyonu) ve buna bağlı sürekli mevzuat takibi kapsam
 * dışı bırakıldı (bkz. docs/YOL-HARITASI.md). `server/routes/edocs.js`,
 * `server/services/einvoice.js`, `server/lib/ubl.js`, `server/lib/
 * ubl-validate.js` ve `server/lib/ubl-schema/` (XSD şemaları) kaynak
 * kodundan TAMAMEN silindi; bu migration onların veritabanı izini temizler.
 *
 * `002_einvoice.js`'in KENDİSİ değiştirilmedi (geriye dönük migration
 * geçmişini bozmamak için — bkz. CLAUDE.md §22 migration güvenliği) çünkü o
 * migration yalnızca e-Belge'ye özel değildi: `items.vat_rate`,
 * `sales_order_lines.vat_rate`, `customer_invoices.subtotal/vat_total/
 * discount_total`, `customer_invoice_lines` tablosu ve `companies`/
 * `customers`'daki genel adres alanları (tax_office/district/city/
 * postal_code/mersis_no/trade_registry_no — bunlar hâlâ yazdırma
 * şablonlarında ve genel fatura kaydında kullanılıyor, bkz. server/routes/
 * templates.js) HÂLÂ kapsam İÇİNDE. Yalnızca GERÇEKTEN e-Belge'ye özel olan
 * tablolar/sütunlar burada kaldırılıyor.
 */
module.exports = {
  name: 'remove einvoice module',
  up(db) {
    db.exec(`
      -- Bağımlı tablo önce (e_document_log -> e_documents FK'sı var)
      DROP TABLE IF EXISTS e_document_log;
      DROP TABLE IF EXISTS e_document_series;
      DROP TABLE IF EXISTS e_documents;

      -- companies/customers'daki yalnızca e-Belge'ye özel sütunlar
      -- (tax_office/district/city/postal_code/mersis_no/trade_registry_no
      -- GENEL amaçlı kalır — silinmiyor).
      ALTER TABLE companies DROP COLUMN einvoice_sender_alias;
      ALTER TABLE companies DROP COLUMN edespatch_sender_alias;
      ALTER TABLE customers DROP COLUMN identity_no;
      ALTER TABLE customers DROP COLUMN is_einvoice_user;
      ALTER TABLE customers DROP COLUMN einvoice_alias;
      ALTER TABLE customers DROP COLUMN einvoice_checked_at;

      DELETE FROM settings WHERE key IN
        ('einvoiceEnabled', 'einvoiceProvider', 'einvoiceTestMode', 'einvoiceProviderConfig');
    `);
  }
};
