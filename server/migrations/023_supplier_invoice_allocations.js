module.exports = {
  name: 'supplier_invoice_receipt_allocations',
  up(db) {
    db.exec(`
      -- Existing invoices have no reliable line mapping. Do not guess one during migration.
      ALTER TABLE supplier_invoices ADD COLUMN allocation_state TEXT NOT NULL DEFAULT 'legacy'
        CHECK(allocation_state IN ('legacy','recorded','none'));

      CREATE TABLE supplier_invoice_allocations (
        invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
        receipt_line_id INTEGER NOT NULL REFERENCES po_receipt_lines(id),
        qty REAL NOT NULL CHECK(qty > 0),
        unit_price REAL NOT NULL CHECK(unit_price >= 0),
        currency TEXT NOT NULL,
        fx_rate REAL NOT NULL CHECK(fx_rate > 0),
        vat_rate REAL NOT NULL CHECK(vat_rate >= 0 AND vat_rate <= 100),
        PRIMARY KEY(invoice_id, receipt_line_id)
      );
      CREATE INDEX idx_supplier_invoice_allocations_receipt
        ON supplier_invoice_allocations(receipt_line_id);
      CREATE TRIGGER supplier_invoice_allocation_qty_insert
      BEFORE INSERT ON supplier_invoice_allocations BEGIN
        SELECT CASE WHEN (SELECT po_id FROM supplier_invoices WHERE id=NEW.invoice_id) !=
          (SELECT pr.po_id FROM po_receipt_lines rl JOIN po_receipts pr ON pr.id=rl.receipt_id
            WHERE rl.id=NEW.receipt_line_id)
          THEN RAISE(ABORT, 'Receipt line belongs to another order') END;
        SELECT CASE WHEN NEW.qty + COALESCE((SELECT SUM(qty) FROM supplier_invoice_allocations
          WHERE receipt_line_id=NEW.receipt_line_id),0) >
          (SELECT qty FROM po_receipt_lines WHERE id=NEW.receipt_line_id) + 0.000000001
          THEN RAISE(ABORT, 'Receipt quantity already invoiced') END;
      END;
      CREATE TRIGGER supplier_invoice_allocation_qty_update
      BEFORE UPDATE ON supplier_invoice_allocations BEGIN
        SELECT CASE WHEN (SELECT po_id FROM supplier_invoices WHERE id=NEW.invoice_id) !=
          (SELECT pr.po_id FROM po_receipt_lines rl JOIN po_receipts pr ON pr.id=rl.receipt_id
            WHERE rl.id=NEW.receipt_line_id)
          THEN RAISE(ABORT, 'Receipt line belongs to another order') END;
        SELECT CASE WHEN NEW.qty + COALESCE((SELECT SUM(qty) FROM supplier_invoice_allocations
          WHERE receipt_line_id=NEW.receipt_line_id AND NOT
            (invoice_id=OLD.invoice_id AND receipt_line_id=OLD.receipt_line_id)),0) >
          (SELECT qty FROM po_receipt_lines WHERE id=NEW.receipt_line_id) + 0.000000001
          THEN RAISE(ABORT, 'Receipt quantity already invoiced') END;
      END;
    `);
  }
};
