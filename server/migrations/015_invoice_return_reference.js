// @ts-nocheck
/**
 * İade faturası ↔ orijinal fatura ilişkisi.
 *
 * Bu alan eskiden yoktu; `invoice_type='iade'` seçilebiliyordu ama hangi
 * faturanın iade edildiği hiçbir yerde tutulmuyordu — bir iade kaydına
 * bakıldığında hangi orijinal satışı kredilendirdiği izlenemiyordu.
 */
module.exports = {
  name: 'invoice_return_reference',
  up(db) {
    db.exec(`
      ALTER TABLE customer_invoices ADD COLUMN original_invoice_id TEXT REFERENCES customer_invoices(id);
    `);
  }
};
