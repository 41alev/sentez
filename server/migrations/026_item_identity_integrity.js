// @ts-nocheck
/**
 * Product identifiers are operational identities, not display hints.
 *
 * The old schema only indexed code/barcode, so two active items could carry
 * the same value and barcode lookup returned an arbitrary row.  We deliberately
 * do not rewrite customer data here: an unsafe duplicate must be reconciled by
 * an administrator before the upgrade can continue.
 */
module.exports = {
  name: 'active item code and barcode identity',
  up(db) {
    for (const field of ['code', 'barcode']) {
      const duplicates = db.prepare(`
        SELECT company_id, lower(trim(${field})) value, COUNT(*) count
        FROM items
        WHERE deleted_at IS NULL AND trim(COALESCE(${field}, '')) <> ''
        GROUP BY company_id, lower(trim(${field}))
        HAVING COUNT(*) > 1
        ORDER BY company_id, value
        LIMIT 20
      `).all();
      if (duplicates.length) {
        const detail = duplicates.map(x => `${x.company_id}:${x.value} (${x.count})`).join(', ');
        throw new Error(`026_item_identity_integrity: duplicate active item ${field}: ${detail}`);
      }
    }

    db.exec(`
      CREATE UNIQUE INDEX ux_items_company_code_active
        ON items(company_id, lower(trim(code)))
        WHERE deleted_at IS NULL AND trim(COALESCE(code, '')) <> '';
      CREATE UNIQUE INDEX ux_items_company_barcode_active
        ON items(company_id, lower(trim(barcode)))
        WHERE deleted_at IS NULL AND trim(COALESCE(barcode, '')) <> '';
    `);
  }
};
