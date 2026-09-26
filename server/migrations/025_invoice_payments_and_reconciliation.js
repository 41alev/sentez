// @ts-nocheck
/**
 * T06 + K-05: supplier invoice reconciliation/approval gate and partial
 * payment ledgers for both customer and supplier invoices.
 *
 * - Legacy supplier invoices (allocation_state='legacy') keep vat_amount NULL;
 *   the value becomes known only after a person reconciles them. Nothing is
 *   guessed for them here.
 * - Invoices already recorded with receipt-line snapshots get vat_amount from
 *   the same snapshot-weighted rate the journal export already used, so their
 *   accounting output does not change meaning.
 * - Existing 'paid' invoices get no fabricated payment rows; they are marked
 *   `paid_legacy = 1` and treated as fully settled by the application.
 */
module.exports = {
  name: 'invoice_payments_and_reconciliation',
  up(db) {
    db.exec(`
      ALTER TABLE customer_invoices ADD COLUMN paid_legacy INTEGER NOT NULL DEFAULT 0;
      UPDATE customer_invoices SET paid_legacy = 1 WHERE status = 'paid';
      ALTER TABLE supplier_invoices ADD COLUMN paid_legacy INTEGER NOT NULL DEFAULT 0;
      UPDATE supplier_invoices SET paid_legacy = 1 WHERE match_status = 'paid';

      ALTER TABLE supplier_invoices ADD COLUMN vat_amount REAL
        CHECK(vat_amount IS NULL OR vat_amount >= 0);
      ALTER TABLE supplier_invoices ADD COLUMN reconciled_at INTEGER;
      ALTER TABLE supplier_invoices ADD COLUMN reconciled_by INTEGER REFERENCES users(id);
      ALTER TABLE supplier_invoices ADD COLUMN reconcile_note TEXT;
      ALTER TABLE supplier_invoices ADD COLUMN approved_at INTEGER;
      ALTER TABLE supplier_invoices ADD COLUMN approved_by INTEGER REFERENCES users(id);
      ALTER TABLE supplier_invoices ADD COLUMN approval_note TEXT;

      UPDATE supplier_invoices SET vat_amount = ROUND(amount * (
          SELECT SUM(a.qty * a.unit_price * a.fx_rate * a.vat_rate) / SUM(a.qty * a.unit_price * a.fx_rate)
          FROM supplier_invoice_allocations a WHERE a.invoice_id = supplier_invoices.id
        ) / 100.0, 2)
      WHERE allocation_state = 'recorded'
        AND (SELECT SUM(a.qty * a.unit_price * a.fx_rate) FROM supplier_invoice_allocations a
             WHERE a.invoice_id = supplier_invoices.id) > 0;

      CREATE TABLE customer_invoice_payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES customer_invoices(id),
        amount REAL NOT NULL CHECK(amount > 0),
        paid_on TEXT NOT NULL,
        method TEXT,
        reference TEXT,
        note TEXT,
        request_key TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_customer_invoice_payments_invoice ON customer_invoice_payments(invoice_id);
      CREATE UNIQUE INDEX idx_customer_invoice_payments_request
        ON customer_invoice_payments(invoice_id, request_key) WHERE request_key IS NOT NULL;

      CREATE TABLE supplier_invoice_payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id),
        amount REAL NOT NULL CHECK(amount > 0),
        paid_on TEXT NOT NULL,
        method TEXT,
        reference TEXT,
        note TEXT,
        request_key TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_supplier_invoice_payments_invoice ON supplier_invoice_payments(invoice_id);
      CREATE UNIQUE INDEX idx_supplier_invoice_payments_request
        ON supplier_invoice_payments(invoice_id, request_key) WHERE request_key IS NOT NULL;

      -- Payments can never exceed what is still owed, whatever the client sends.
      CREATE TRIGGER customer_invoice_payment_limit
      BEFORE INSERT ON customer_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT invoice_type FROM customer_invoices WHERE id=NEW.invoice_id) = 'iade'
          THEN RAISE(ABORT, 'Credit note cannot be paid') END;
        SELECT CASE WHEN (SELECT status FROM customer_invoices WHERE id=NEW.invoice_id) != 'issued'
          THEN RAISE(ABORT, 'Invoice is not open') END;
        SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM customer_invoice_payments
            WHERE invoice_id=NEW.invoice_id),0) + COALESCE((SELECT SUM(amount) FROM customer_invoices
            WHERE original_invoice_id=NEW.invoice_id AND invoice_type='iade' AND status!='cancelled'),0)
          > (SELECT amount FROM customer_invoices WHERE id=NEW.invoice_id) + 0.005
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;
      CREATE TRIGGER customer_invoice_payment_immutable
      BEFORE UPDATE ON customer_invoice_payments BEGIN
        SELECT RAISE(ABORT, 'Payments are immutable');
      END;

      CREATE TRIGGER supplier_invoice_payment_limit
      BEFORE INSERT ON supplier_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT match_status FROM supplier_invoices WHERE id=NEW.invoice_id) != 'approved'
          THEN RAISE(ABORT, 'Invoice is not approved for payment') END;
        SELECT CASE WHEN (SELECT vat_amount FROM supplier_invoices WHERE id=NEW.invoice_id) IS NULL
          THEN RAISE(ABORT, 'Invoice VAT is not reconciled') END;
        SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM supplier_invoice_payments
            WHERE invoice_id=NEW.invoice_id),0)
          > (SELECT amount + vat_amount FROM supplier_invoices WHERE id=NEW.invoice_id) + 0.005
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;
      CREATE TRIGGER supplier_invoice_payment_immutable
      BEFORE UPDATE ON supplier_invoice_payments BEGIN
        SELECT RAISE(ABORT, 'Payments are immutable');
      END;

      -- Legacy invoices stay unapprovable until a person reconciles them.
      CREATE TRIGGER supplier_invoice_approval_gate
      BEFORE UPDATE OF match_status ON supplier_invoices
      WHEN NEW.match_status IN ('approved','paid') AND OLD.match_status NOT IN ('approved','paid') BEGIN
        SELECT CASE WHEN NEW.allocation_state = 'legacy'
          THEN RAISE(ABORT, 'Legacy invoice requires reconciliation') END;
        SELECT CASE WHEN NEW.vat_amount IS NULL
          THEN RAISE(ABORT, 'Invoice VAT is not reconciled') END;
      END;
    `);
  }
};
