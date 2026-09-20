const db = require('../db');

/** Issued returns are customer credits, not additional receivables. */
function outstandingBalance(customerId) {
  return db.prepare(`SELECT COALESCE(SUM(
    CASE WHEN invoice_type='iade' THEN -amount*fx_rate ELSE amount*fx_rate END
  ),0) AS balance FROM customer_invoices WHERE customer_id=? AND status='issued'`).get(customerId).balance;
}

module.exports = { outstandingBalance };
