const db = require('../db');
const { fromMinor, multiplyMinor } = require('../lib/money');

/**
 * Open receivable in base currency, calculated from authoritative integer
 * minor-unit ledgers. Reversed payments never reduce the balance.
 */
function outstandingBalance(customerId) {
  const invoices = db.prepare(`SELECT id,amount_minor,fx_rate,paid_legacy
    FROM customer_invoices
    WHERE customer_id=? AND invoice_type!='iade' AND status IN ('issued','paid')`).all(customerId);
  let baseMinor = 0;
  const paid = db.prepare(`SELECT COALESCE(SUM(p.amount_minor),0) value
    FROM customer_invoice_payments p
    WHERE p.invoice_id=? AND NOT EXISTS
      (SELECT 1 FROM customer_invoice_payment_reversals r WHERE r.payment_id=p.id)`);
  const credits = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) value FROM customer_invoices
    WHERE original_invoice_id=? AND invoice_type='iade' AND status!='cancelled'`);
  for (const invoice of invoices) {
    const paidMinor = invoice.paid_legacy ? invoice.amount_minor : paid.get(invoice.id).value;
    const openMinor = invoice.amount_minor - paidMinor - credits.get(invoice.id).value;
    baseMinor += multiplyMinor(openMinor, invoice.fx_rate || 1);
  }
  const standaloneCredits = db.prepare(`SELECT amount_minor,fx_rate FROM customer_invoices
    WHERE customer_id=? AND invoice_type='iade' AND status='issued' AND original_invoice_id IS NULL`).all(customerId);
  for (const credit of standaloneCredits) baseMinor -= multiplyMinor(credit.amount_minor, credit.fx_rate || 1);
  return fromMinor(baseMinor);
}

module.exports = { outstandingBalance };
