module.exports = {
  name: 'landed_cost_allocations',
  up(db) {
    db.exec(`
      ALTER TABLE landed_costs ADD COLUMN applied_at INTEGER;
      ALTER TABLE landed_costs ADD COLUMN requires_reconciliation INTEGER NOT NULL DEFAULT 0;
      UPDATE landed_costs SET requires_reconciliation=1;
      ALTER TABLE po_receipt_lines ADD COLUMN base_unit_cost REAL;
      UPDATE po_receipt_lines SET base_unit_cost=(SELECT unit_cost FROM stock_lots WHERE id=po_receipt_lines.lot_id)
        WHERE NOT EXISTS(SELECT 1 FROM landed_costs c WHERE c.receipt_id=po_receipt_lines.receipt_id);
      CREATE TABLE landed_cost_allocations (
        cost_id INTEGER NOT NULL REFERENCES landed_costs(id),
        receipt_line_id INTEGER NOT NULL REFERENCES po_receipt_lines(id),
        lot_id TEXT NOT NULL REFERENCES stock_lots(id),
        qty REAL NOT NULL CHECK(qty>0),
        amount_base REAL NOT NULL CHECK(amount_base>=0),
        PRIMARY KEY(cost_id,receipt_line_id,lot_id)
      );
    `);
  }
};
