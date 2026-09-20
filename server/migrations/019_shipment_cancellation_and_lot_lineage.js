module.exports = {
  name: 'shipment_cancellation_and_lot_lineage',
  up(db) {
    db.exec(`
      ALTER TABLE stock_lots ADD COLUMN parent_lot_id TEXT REFERENCES stock_lots(id);
      ALTER TABLE stock_lots ADD COLUMN parent_qty REAL CHECK(parent_qty IS NULL OR parent_qty > 0);
      CREATE INDEX idx_lots_parent ON stock_lots(parent_lot_id);
      ALTER TABLE shipment_items ADD COLUMN sales_order_line_id INTEGER REFERENCES sales_order_lines(id);
      ALTER TABLE shipments ADD COLUMN cancelled_at INTEGER;
      ALTER TABLE shipments ADD COLUMN cancelled_by INTEGER REFERENCES users(id);
      UPDATE shipment_items SET sales_order_line_id=(
        SELECT MIN(sol.id) FROM sales_order_lines sol JOIN shipments sh ON sh.so_id=sol.so_id
        WHERE sh.id=shipment_items.shipment_id AND sol.item_id=shipment_items.item_id
        HAVING COUNT(*)=1
      );
    `);
    // Legacy lot splits cannot be inferred reliably from matching lot numbers.
    // Their parent fields intentionally stay NULL; no historical links invented.
  }
};
