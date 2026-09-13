// @ts-nocheck
/**
 * İade faturası ↔ orijinal fatura ilişkisi.
 *
 * GİB'in resmi UBL-TR örnek paketindeki IadeFaturasiOrnegi.xml, bir iade
 * faturasının (InvoiceTypeCode=IADE) `cac:BillingReference` bloğuyla
 * MUTLAKA orijinal faturaya (belge no + tarih) referans verdiğini gösteriyor
 * (bkz. server/lib/ubl.js signatureBlock yorumu ve buildInvoice). Bu alan
 * eskiden yoktu; `invoice_type='iade'` seçilebiliyordu ama hangi faturanın
 * iade edildiği hiçbir yerde tutulmuyordu — üretilen e-Belge GİB'in
 * beklediği izlenebilirliği taşımıyordu.
 */
module.exports = {
  name: 'invoice_return_reference',
  up(db) {
    db.exec(`
      ALTER TABLE customer_invoices ADD COLUMN original_invoice_id TEXT REFERENCES customer_invoices(id);
    `);
  }
};
