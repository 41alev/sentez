module.exports = {
  name: 'invoice_shipment_allocations',
  up(db) {
    db.exec(`CREATE TABLE invoice_shipment_allocations (
      invoice_id TEXT NOT NULL REFERENCES customer_invoices(id),
      line_no INTEGER NOT NULL,
      shipment_item_id INTEGER NOT NULL REFERENCES shipment_items(id),
      qty REAL NOT NULL CHECK(qty>0),
      PRIMARY KEY(invoice_id,line_no,shipment_item_id)
    );
    CREATE INDEX idx_invoice_allocation_shipment ON invoice_shipment_allocations(shipment_item_id);`);
  }
};
