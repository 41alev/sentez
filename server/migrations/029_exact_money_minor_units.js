// @ts-nocheck
/**
 * Exact posted money representation.
 *
 * Legacy REAL columns remain as a compatibility projection for API/report code.
 * Integer *_minor columns are the authoritative values. Consistency triggers
 * reject direct SQL writes that do not supply the same rounded monetary value.
 */
module.exports = {
  name: 'exact posted money minor units',
  up(db) {
    db.exec(`
      ALTER TABLE customer_invoices ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(amount_minor >= 0);
      ALTER TABLE customer_invoices ADD COLUMN subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_minor >= 0);
      ALTER TABLE customer_invoices ADD COLUMN vat_total_minor INTEGER NOT NULL DEFAULT 0 CHECK(vat_total_minor >= 0);
      ALTER TABLE customer_invoices ADD COLUMN discount_total_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_total_minor >= 0);
      UPDATE customer_invoices SET
        amount_minor=CAST(ROUND(amount*100) AS INTEGER),
        subtotal_minor=CAST(ROUND(subtotal*100) AS INTEGER),
        vat_total_minor=CAST(ROUND(vat_total*100) AS INTEGER),
        discount_total_minor=CAST(ROUND(discount_total*100) AS INTEGER);

      ALTER TABLE supplier_invoices ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(amount_minor >= 0);
      ALTER TABLE supplier_invoices ADD COLUMN vat_amount_minor INTEGER CHECK(vat_amount_minor IS NULL OR vat_amount_minor >= 0);
      UPDATE supplier_invoices SET amount_minor=CAST(ROUND(amount*100) AS INTEGER),
        vat_amount_minor=CASE WHEN vat_amount IS NULL THEN NULL ELSE CAST(ROUND(vat_amount*100) AS INTEGER) END;

      ALTER TABLE customer_invoice_payments ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 1 CHECK(amount_minor > 0);
      UPDATE customer_invoice_payments SET amount_minor=CAST(ROUND(amount*100) AS INTEGER);
      ALTER TABLE supplier_invoice_payments ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 1 CHECK(amount_minor > 0);
      UPDATE supplier_invoice_payments SET amount_minor=CAST(ROUND(amount*100) AS INTEGER);

      CREATE TRIGGER customer_invoice_money_insert
      BEFORE INSERT ON customer_invoices BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          OR NEW.subtotal_minor != CAST(ROUND(NEW.subtotal*100) AS INTEGER)
          OR NEW.vat_total_minor != CAST(ROUND(NEW.vat_total*100) AS INTEGER)
          OR NEW.discount_total_minor != CAST(ROUND(NEW.discount_total*100) AS INTEGER)
          THEN RAISE(ABORT, 'Invoice money/minor mismatch') END;
      END;
      CREATE TRIGGER customer_invoice_money_update
      BEFORE UPDATE OF amount,amount_minor,subtotal,subtotal_minor,vat_total,vat_total_minor,discount_total,discount_total_minor ON customer_invoices BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          OR NEW.subtotal_minor != CAST(ROUND(NEW.subtotal*100) AS INTEGER)
          OR NEW.vat_total_minor != CAST(ROUND(NEW.vat_total*100) AS INTEGER)
          OR NEW.discount_total_minor != CAST(ROUND(NEW.discount_total*100) AS INTEGER)
          THEN RAISE(ABORT, 'Invoice money/minor mismatch') END;
      END;

      CREATE TRIGGER supplier_invoice_money_insert
      BEFORE INSERT ON supplier_invoices BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          OR (NEW.vat_amount IS NULL) != (NEW.vat_amount_minor IS NULL)
          OR (NEW.vat_amount IS NOT NULL AND NEW.vat_amount_minor != CAST(ROUND(NEW.vat_amount*100) AS INTEGER))
          THEN RAISE(ABORT, 'Supplier invoice money/minor mismatch') END;
      END;
      CREATE TRIGGER supplier_invoice_money_update
      BEFORE UPDATE OF amount,amount_minor,vat_amount,vat_amount_minor ON supplier_invoices BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          OR (NEW.vat_amount IS NULL) != (NEW.vat_amount_minor IS NULL)
          OR (NEW.vat_amount IS NOT NULL AND NEW.vat_amount_minor != CAST(ROUND(NEW.vat_amount*100) AS INTEGER))
          THEN RAISE(ABORT, 'Supplier invoice money/minor mismatch') END;
      END;

      CREATE TRIGGER customer_payment_money_insert
      BEFORE INSERT ON customer_invoice_payments BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          THEN RAISE(ABORT, 'Payment money/minor mismatch') END;
      END;
      CREATE TRIGGER supplier_payment_money_insert
      BEFORE INSERT ON supplier_invoice_payments BEGIN
        SELECT CASE WHEN NEW.amount_minor != CAST(ROUND(NEW.amount*100) AS INTEGER)
          THEN RAISE(ABORT, 'Payment money/minor mismatch') END;
      END;

      DROP TRIGGER customer_invoice_payment_limit;
      CREATE TRIGGER customer_invoice_payment_limit
      BEFORE INSERT ON customer_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT invoice_type FROM customer_invoices WHERE id=NEW.invoice_id) = 'iade'
          THEN RAISE(ABORT, 'Credit note cannot be paid') END;
        SELECT CASE WHEN (SELECT status FROM customer_invoices WHERE id=NEW.invoice_id) != 'issued'
          THEN RAISE(ABORT, 'Invoice is not open') END;
        SELECT CASE WHEN NEW.amount_minor + COALESCE((SELECT SUM(p.amount_minor) FROM customer_invoice_payments p
            WHERE p.invoice_id=NEW.invoice_id AND NOT EXISTS
              (SELECT 1 FROM customer_invoice_payment_reversals r WHERE r.payment_id=p.id)),0)
            + COALESCE((SELECT SUM(amount_minor) FROM customer_invoices
              WHERE original_invoice_id=NEW.invoice_id AND invoice_type='iade' AND status!='cancelled'),0)
          > (SELECT amount_minor FROM customer_invoices WHERE id=NEW.invoice_id)
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;

      DROP TRIGGER supplier_invoice_payment_limit;
      CREATE TRIGGER supplier_invoice_payment_limit
      BEFORE INSERT ON supplier_invoice_payments BEGIN
        SELECT CASE WHEN (SELECT match_status FROM supplier_invoices WHERE id=NEW.invoice_id) != 'approved'
          THEN RAISE(ABORT, 'Invoice is not approved for payment') END;
        SELECT CASE WHEN (SELECT vat_amount_minor FROM supplier_invoices WHERE id=NEW.invoice_id) IS NULL
          THEN RAISE(ABORT, 'Invoice VAT is not reconciled') END;
        SELECT CASE WHEN NEW.amount_minor + COALESCE((SELECT SUM(p.amount_minor) FROM supplier_invoice_payments p
            WHERE p.invoice_id=NEW.invoice_id AND NOT EXISTS
              (SELECT 1 FROM supplier_invoice_payment_reversals r WHERE r.payment_id=p.id)),0)
          > (SELECT amount_minor + vat_amount_minor FROM supplier_invoices WHERE id=NEW.invoice_id)
          THEN RAISE(ABORT, 'Payment exceeds open amount') END;
      END;

      DROP TRIGGER supplier_invoice_approval_gate;
      CREATE TRIGGER supplier_invoice_approval_gate
      BEFORE UPDATE OF match_status ON supplier_invoices
      WHEN NEW.match_status IN ('approved','paid') AND OLD.match_status NOT IN ('approved','paid') BEGIN
        SELECT CASE WHEN NEW.allocation_state = 'legacy'
          THEN RAISE(ABORT, 'Legacy invoice requires reconciliation') END;
        SELECT CASE WHEN NEW.vat_amount_minor IS NULL
          THEN RAISE(ABORT, 'Invoice VAT is not reconciled') END;
      END;
    `);
  }
};

