module.exports = {
  name: 'purchase_line_fx_snapshot',
  up(db) {
    db.exec(`
      ALTER TABLE po_items ADD COLUMN fx_rate REAL CHECK(fx_rate IS NULL OR fx_rate > 0);
      UPDATE po_items SET fx_rate=CASE WHEN currency='TRY' THEN 1 ELSE
        (SELECT p.fx_rate FROM purchase_orders p WHERE p.id=po_items.po_id AND p.currency=po_items.currency)
        END;
      CREATE TRIGGER po_line_fx_default AFTER INSERT ON po_items
      WHEN NEW.fx_rate IS NULL
      BEGIN
        UPDATE po_items SET fx_rate=CASE WHEN NEW.currency='TRY' THEN 1 ELSE
          (SELECT p.fx_rate FROM purchase_orders p WHERE p.id=NEW.po_id AND p.currency=NEW.currency)
          END WHERE id=NEW.id;
      END;
    `);
    // Historical mixed-currency lines have no trustworthy snapshot; leave NULL.
    // Receiving must reject those lines rather than silently invent a rate.
  }
};
