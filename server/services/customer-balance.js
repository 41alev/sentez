const db = require('../db');

/**
 * Open receivable in base currency.
 *
 * For every non-cancelled sales invoice: amount − payments − linked credit
 * notes. An invoice marked paid before the payment ledger existed
 * (paid_legacy) counts as fully paid, so a credit note issued against it shows
 * up as a negative balance (money owed back to the customer), as before.
 * Credit notes without an original invoice (pre-015 data) reduce the balance
 * directly while they are issued.
 */
function outstandingBalance(customerId) {
  return db.prepare(`SELECT COALESCE(SUM(open_base),0) AS balance FROM (
      SELECT (ci.amount
        - CASE WHEN ci.paid_legacy = 1 THEN ci.amount
            ELSE COALESCE((SELECT SUM(p.amount) FROM customer_invoice_payments p WHERE p.invoice_id=ci.id),0) END
        - COALESCE((SELECT SUM(r.amount) FROM customer_invoices r WHERE r.original_invoice_id=ci.id
            AND r.invoice_type='iade' AND r.status!='cancelled'),0)) * ci.fx_rate AS open_base
      FROM customer_invoices ci
      WHERE ci.customer_id=? AND ci.invoice_type!='iade' AND ci.status IN ('issued','paid')
      UNION ALL
      SELECT -r.amount * r.fx_rate FROM customer_invoices r
      WHERE r.customer_id=? AND r.invoice_type='iade' AND r.status='issued' AND r.original_invoice_id IS NULL
    )`).get(customerId, customerId).balance;
}

module.exports = { outstandingBalance };
