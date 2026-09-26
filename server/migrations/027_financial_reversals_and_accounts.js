// @ts-nocheck
/**
 * Immutable correction ledgers and complete accounting bridge mappings.
 * Original payment rows remain untouched; a reversal is a separate, auditable
 * record linked one-to-one to the original payment.
 */
module.exports = {
  name: 'financial reversals and accounting mappings',
  up(db) {
    db.exec(`
      CREATE TABLE customer_invoice_payment_reversals (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL UNIQUE REFERENCES customer_invoice_payments(id),
        reversed_on TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_key TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id)
      );
      CREATE UNIQUE INDEX ux_customer_payment_reversal_request
        ON customer_invoice_payment_reversals(request_key) WHERE request_key IS NOT NULL;

      CREATE TABLE supplier_invoice_payment_reversals (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL UNIQUE REFERENCES supplier_invoice_payments(id),
        reversed_on TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_key TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id)
      );
      CREATE UNIQUE INDEX ux_supplier_payment_reversal_request
        ON supplier_invoice_payment_reversals(request_key) WHERE request_key IS NOT NULL;

      CREATE TRIGGER customer_payment_reversal_immutable
      BEFORE UPDATE ON customer_invoice_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;
      CREATE TRIGGER customer_payment_reversal_no_delete
      BEFORE DELETE ON customer_invoice_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;
      CREATE TRIGGER supplier_payment_reversal_immutable
      BEFORE UPDATE ON supplier_invoice_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;
      CREATE TRIGGER supplier_payment_reversal_no_delete
      BEFORE DELETE ON supplier_invoice_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;

      DROP TRIGGER customer_invoice_payment_limit;
      CREATE TRIGGER customer_invoice_payment_limit
      BEFORE INSERT ON customer_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT invoice_type FROM customer_invoices WHERE id=NEW.invoice_id) = 'iade'
          THEN RAISE(ABORT, 'Credit note cannot be paid') END;
        SELECT CASE WHEN (SELECT status FROM customer_invoices WHERE id=NEW.invoice_id) != 'issued'
          THEN RAISE(ABORT, 'Invoice is not open') END;
        SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(p.amount) FROM customer_invoice_payments p
            WHERE p.invoice_id=NEW.invoice_id AND NOT EXISTS
              (SELECT 1 FROM customer_invoice_payment_reversals r WHERE r.payment_id=p.id)),0)
            + COALESCE((SELECT SUM(amount) FROM customer_invoices
              WHERE original_invoice_id=NEW.invoice_id AND invoice_type='iade' AND status!='cancelled'),0)
          > (SELECT amount FROM customer_invoices WHERE id=NEW.invoice_id) + 0.005
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;

      DROP TRIGGER supplier_invoice_payment_limit;
      CREATE TRIGGER supplier_invoice_payment_limit
      BEFORE INSERT ON supplier_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT match_status FROM supplier_invoices WHERE id=NEW.invoice_id) != 'approved'
          THEN RAISE(ABORT, 'Invoice is not approved for payment') END;
        SELECT CASE WHEN (SELECT vat_amount FROM supplier_invoices WHERE id=NEW.invoice_id) IS NULL
          THEN RAISE(ABORT, 'Invoice VAT is not reconciled') END;
        SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(p.amount) FROM supplier_invoice_payments p
            WHERE p.invoice_id=NEW.invoice_id AND NOT EXISTS
              (SELECT 1 FROM supplier_invoice_payment_reversals r WHERE r.payment_id=p.id)),0)
          > (SELECT amount + vat_amount FROM supplier_invoices WHERE id=NEW.invoice_id) + 0.005
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;

      ALTER TABLE po_receipts ADD COLUMN reversed_at INTEGER;
      ALTER TABLE po_receipts ADD COLUMN reversed_by INTEGER REFERENCES users(id);
      ALTER TABLE po_receipts ADD COLUMN reversal_reason TEXT;
      ALTER TABLE po_receipts ADD COLUMN reversal_request_key TEXT;
      CREATE UNIQUE INDEX ux_po_receipt_reversal_request
        ON po_receipts(reversal_request_key) WHERE reversal_request_key IS NOT NULL;
    `);

    const mappings = [
      ['cost_of_goods_sold', '621', 'Satılan Ticari Mallar Maliyeti'],
      ['cash', '100', 'Kasa'],
      ['bank', '102', 'Bankalar'],
      ['card', '108', 'Diğer Hazır Değerler'],
      ['check', '101', 'Alınan Çekler'],
      ['payment_clearing', '108', 'Diğer Hazır Değerler']
    ];
    const insert = db.prepare(`INSERT OR IGNORE INTO account_code_mappings
      (company_id,mapping_key,account_code,account_name) VALUES (1,?,?,?)`);
    mappings.forEach(row => insert.run(...row));
  }
};
