// @ts-nocheck
/**
 * Genel arama (global search) — üst çubuktaki tek kutudan ürün, müşteri,
 * tedarikçi, satış siparişi, satın alma siparişi ve parti aranabilir.
 *
 * Kasıtlı olarak basit tutuldu: tam metin indeksleme (FTS5) yerine düz
 * `LIKE` sorguları — veri hacmi (binlerce, on binlerce kayıt) bu ölçekte
 * fark yaratmaz, ve FTS5 sanal tablosu her yazma yolunda ayrıca
 * güncellenmesi gereken bir bakım yükü ekler. Hacim gerçekten büyürse
 * (yüz binlerce kayıt) buradan FTS5'e geçilebilir — şema değişikliği
 * gerektirmez, yalnızca bu dosya değişir.
 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const LIMIT = 6;
const MIN_LEN = 2;

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < MIN_LEN) {
    return res.json({ items: [], customers: [], suppliers: [], salesOrders: [], purchaseOrders: [], lots: [] });
  }
  // User text is matched literally: % and _ are escaped, not wildcards (SE-01).
  const like = `%${q.slice(0, 100).replace(/[\\%_]/g, ch => '\\' + ch)}%`;
  const L = "LIKE ? ESCAPE '\\'";

  const items = db.prepare(`SELECT id, name, code, barcode FROM items
    WHERE deleted_at IS NULL AND is_active = 1 AND (name ${L} OR code ${L} OR barcode ${L})
    ORDER BY name LIMIT ?`).all(like, like, like, LIMIT);

  // Inactive and anonymized parties are not offered as search hits (SE-02).
  const customers = db.prepare(`SELECT id, name, code FROM customers
    WHERE is_active = 1 AND anonymized_at IS NULL AND (name ${L} OR code ${L}) ORDER BY name LIMIT ?`).all(like, like, LIMIT);

  const suppliers = db.prepare(`SELECT id, name, code FROM suppliers
    WHERE is_active = 1 AND anonymized_at IS NULL AND (name ${L} OR code ${L}) ORDER BY name LIMIT ?`).all(like, like, LIMIT);

  const salesOrders = db.prepare(`SELECT id, so_no, customer_name FROM sales_orders
    WHERE so_no ${L} ORDER BY date DESC LIMIT ?`).all(like, LIMIT);

  const purchaseOrders = db.prepare(`SELECT id, po_no, supplier_name FROM purchase_orders
    WHERE po_no ${L} ORDER BY date DESC LIMIT ?`).all(like, LIMIT);

  const lots = db.prepare(`SELECT sl.id, sl.lot_no, i.name AS item_name FROM stock_lots sl
    LEFT JOIN items i ON i.id = sl.item_id
    WHERE sl.lot_no ${L} ORDER BY sl.received_at DESC LIMIT ?`).all(like, LIMIT);

  res.json({
    items: items.map(i => ({ id: i.id, label: i.name, sub: i.code || i.barcode || '' })),
    customers: customers.map(c => ({ id: c.id, label: c.name, sub: c.code || '' })),
    suppliers: suppliers.map(s => ({ id: s.id, label: s.name, sub: s.code || '' })),
    salesOrders: salesOrders.map(s => ({ id: s.id, label: s.so_no, sub: s.customer_name || '' })),
    purchaseOrders: purchaseOrders.map(p => ({ id: p.id, label: p.po_no, sub: p.supplier_name || '' })),
    lots: lots.map(l => ({ id: l.id, label: l.lot_no, sub: l.item_name || '' }))
  });
});

module.exports = router;
