// @ts-nocheck
/**
 * El terminali / mobil depo uçları.
 *
 * Masaüstü arayüzü "önce menüden işlem seç, sonra ürünü bul" mantığıyla çalışır.
 * Depoda bu tersine döner: elinde okuyucu olan kişi önce okutur, sonra ne yapacağını
 * söyler. Bu yüzden buradaki merkezi uç `resolve`: okutulan kodun ne olduğunu
 * sistem bulur, kullanıcı seçmek zorunda kalmaz.
 *
 * Yazma işlemleri mevcut uçları kullanır; burada tekrarlanmaz. Aynı iş kuralının
 * iki yerde yaşaması, er ya da geç ikisinin ayrışması demektir.
 */
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../lib/core');

const router = express.Router();
router.use(requireAuth);

/**
 * Okutulan kodu çözer.
 *
 * Arama sırası kasıtlıdır: en belirleyici olandan en genele doğru gider.
 * Parti numarası ürün kodundan daha spesifiktir; önce ona bakılır ki
 * "LOT-001" adlı bir ürün varsa bile parti eşleşmesi kaybolmasın.
 */
router.get('/resolve', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) throw new AppError('Kod boş / Empty code', 400);

  // 1) Parti numarası
  const lot = db.prepare(`SELECT sl.*, i.name AS item_name, i.code AS item_code, i.unit,
      i.location AS item_location, w.name AS warehouse_name FROM stock_lots sl
    JOIN items i ON i.id = sl.item_id
    LEFT JOIN warehouses w ON w.id = sl.warehouse_id
    WHERE sl.lot_no = ? AND sl.qty > 0 ORDER BY sl.received_at DESC LIMIT 1`).get(code);
  if (lot) {
    return res.json({
      type: 'lot',
      lot: {
        id: lot.id, lotNo: lot.lot_no, itemId: lot.item_id, itemName: lot.item_name,
        itemCode: lot.item_code, unit: lot.unit, qty: lot.qty, status: lot.status,
        warehouseId: lot.warehouse_id, warehouseName: lot.warehouse_name,
        location: lot.item_location, expiryDate: lot.expiry_date, unitCost: lot.unit_cost
      }
    });
  }

  // 2) Ürün: barkod veya kod
  const item = db.prepare(`SELECT * FROM items
    WHERE (barcode = ? OR code = ?) AND deleted_at IS NULL AND is_active = 1 LIMIT 1`).get(code, code);
  if (item) {
    const lots = db.prepare(`SELECT sl.*, w.name AS warehouse_name FROM stock_lots sl
      LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE sl.item_id = ? AND sl.qty > 0 ORDER BY
        CASE sl.status WHEN 'available' THEN 0 ELSE 1 END,
        COALESCE(sl.expiry_date, '9999-12-31') LIMIT 20`).all(item.id);
    return res.json({
      type: 'item',
      item: {
        id: item.id, name: item.name, code: item.code, barcode: item.barcode,
        unit: item.unit, category: item.category, qty: item.qty_cache,
        minStock: item.min_stock, location: item.location, avgCost: item.avg_cost,
        isLotTracked: !!item.is_lot_tracked
      },
      lots: lots.map(l => ({
        id: l.id, lotNo: l.lot_no, qty: l.qty, status: l.status,
        warehouseId: l.warehouse_id, warehouseName: l.warehouse_name,
        location: item.location, expiryDate: l.expiry_date
      }))
    });
  }

  // 3) Belge numarası: sipariş, sevkiyat, üretim emri, sayım
  const po = db.prepare(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.po_no = ?`).get(code);
  if (po) {
    return res.json({
      type: 'purchase_order',
      document: {
        id: po.id, no: po.po_no, status: po.status, approvalStatus: po.approval_status,
        partyName: po.supplier_name, date: po.date, expected: po.expected,
        warehouseId: po.warehouse_id,
        canReceive: po.approval_status === 'approved' && ['approved', 'partially_received'].includes(po.status)
      }
    });
  }

  const sh = db.prepare(`SELECT sh.*, c.name AS customer_name FROM shipments sh
    LEFT JOIN customers c ON c.id = sh.customer_id WHERE sh.shipment_no = ?`).get(code);
  if (sh) {
    return res.json({
      type: 'shipment',
      document: { id: sh.id, no: sh.shipment_no, status: sh.status,
        partyName: sh.customer_name, date: sh.date, destination: sh.destination }
    });
  }

  const prod = db.prepare('SELECT * FROM production_orders WHERE order_no = ?').get(code);
  if (prod) {
    return res.json({
      type: 'production_order',
      document: { id: prod.id, no: prod.order_no, status: prod.status,
        partyName: prod.item_name, qty: prod.qty, date: prod.date,
        warehouseId: prod.warehouse_id }
    });
  }

  const count = db.prepare(`SELECT c.*, w.name AS warehouse_name FROM stock_counts c
    LEFT JOIN warehouses w ON w.id = c.warehouse_id WHERE c.count_no = ?`).get(code);
  if (count) {
    return res.json({
      type: 'count',
      document: { id: count.id, no: count.count_no, status: count.status,
        partyName: count.warehouse_name, date: count.started_at, warehouseId: count.warehouse_id }
    });
  }

  // 4) Raf/konum. Raf bilgisi partide değil ürün kartında tutulur; bu yüzden
  // konum etiketi okutulduğunda o rafa atanmış ürünlerin partileri listelenir.
  const atLocation = db.prepare(
    `SELECT COUNT(*) c FROM items WHERE location = ? AND deleted_at IS NULL`).get(code);
  if (atLocation.c > 0) {
    const lots = db.prepare(`SELECT sl.*, i.name AS item_name, i.code AS item_code, i.unit,
        w.name AS warehouse_name
      FROM stock_lots sl JOIN items i ON i.id = sl.item_id
      LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE i.location = ? AND sl.qty > 0 ORDER BY i.name LIMIT 50`).all(code);
    return res.json({
      type: 'location',
      location: code,
      itemCount: atLocation.c,
      lots: lots.map(l => ({
        id: l.id, lotNo: l.lot_no, itemId: l.item_id, itemName: l.item_name,
        itemCode: l.item_code, unit: l.unit, qty: l.qty, status: l.status,
        warehouseName: l.warehouse_name
      }))
    });
  }

  // Bulunamadı: kullanıcıya ne aradığımızı söylemek, "çalışmıyor" demekten iyidir
  res.status(404).json({
    error: 'Kod bulunamadı / Code not found',
    code,
    searched: ['parti no', 'ürün barkodu/kodu', 'belge no', 'raf konumu']
  });
});

/**
 * Terminalin açılış ekranı: bu kişinin bekleyen işleri.
 * Depoda çalışan biri "ne yapmam gerekiyor" sorusuna tek bakışta cevap almalı.
 */
router.get('/tasks', (req, res) => {
  const pendingReceipts = db.prepare(`SELECT po.id, po.po_no, po.expected, s.name AS supplier_name,
      (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id = po.id AND pi.qty > pi.received_qty) AS open_lines
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.approval_status = 'approved' AND po.status IN ('approved','partially_received')
    ORDER BY po.expected LIMIT 30`).all();

  const pendingShipments = db.prepare(`SELECT so.id, so.so_no, so.promised_date, c.name AS customer_name,
      (SELECT COUNT(*) FROM sales_order_lines sol WHERE sol.so_id = so.id AND sol.qty > sol.shipped_qty) AS open_lines
    FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
    WHERE so.status IN ('open','partially_shipped')
    ORDER BY so.promised_date LIMIT 30`).all();

  const openCounts = db.prepare(`SELECT c.id, c.count_no, c.started_at, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id) AS line_count,
      (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL) AS counted
    FROM stock_counts c LEFT JOIN warehouses w ON w.id = c.warehouse_id
    WHERE c.status = 'open' ORDER BY c.started_at DESC LIMIT 20`).all();

  const openProduction = db.prepare(`SELECT id, order_no, item_name, qty, due_date, status
    FROM production_orders WHERE status IN ('Planlandı','Devam Ediyor')
    ORDER BY COALESCE(due_date, date) LIMIT 30`).all();

  res.json({
    receipts: pendingReceipts.map(r => ({
      id: r.id, no: r.po_no, party: r.supplier_name, date: r.expected, openLines: r.open_lines
    })),
    shipments: pendingShipments.map(s => ({
      id: s.id, no: s.so_no, party: s.customer_name, date: s.promised_date, openLines: s.open_lines
    })),
    counts: openCounts.map(c => ({
      id: c.id, no: c.count_no, party: c.warehouse_name, date: c.started_at,
      lineCount: c.line_count, counted: c.counted
    })),
    production: openProduction.map(p => ({
      id: p.id, no: p.order_no, party: p.item_name, qty: p.qty, date: p.due_date, status: p.status
    })),
    counts_summary: {
      receipts: pendingReceipts.length, shipments: pendingShipments.length,
      counts: openCounts.length, production: openProduction.length
    }
  });
});

/**
 * Bir sevkiyat siparişinin toplanacak kalemleri, FEFO sırasıyla önerilen partiler.
 * Toplayıcı hangi raftan hangi partiyi alacağını görmeli; aramak zaman kaybıdır.
 */
router.get('/pick-list/:soId', (req, res) => {
  const so = db.prepare(`SELECT so.*, c.name AS customer_name FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id WHERE so.id = ?`).get(req.params.soId);
  if (!so) throw new AppError('Sipariş bulunamadı / Order not found', 404);

  const lines = db.prepare(`SELECT sol.*, i.code AS item_code, i.unit, i.barcode
    FROM sales_order_lines sol LEFT JOIN items i ON i.id = sol.item_id
    WHERE sol.so_id = ? AND sol.qty > sol.shipped_qty`).all(so.id);

  const picks = lines.map(l => {
    // FEFO: son kullanma tarihi en yakın parti önce çıkar
    const lots = db.prepare(`SELECT sl.*, w.name AS warehouse_name, i.location AS item_location
      FROM stock_lots sl LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      JOIN items i ON i.id = sl.item_id
      WHERE sl.item_id = ? AND sl.status = 'available' AND sl.qty > 0
      ORDER BY COALESCE(sl.expiry_date,'9999-12-31'), sl.received_at`).all(l.item_id);

    let remaining = l.qty - l.shipped_qty;
    const suggested = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.qty, remaining);
      suggested.push({
        lotId: lot.id, lotNo: lot.lot_no, location: lot.item_location,
        warehouseName: lot.warehouse_name, available: lot.qty,
        takeQty: Number(take.toFixed(4)), expiryDate: lot.expiry_date
      });
      remaining -= take;
    }
    return {
      lineId: l.id, itemId: l.item_id, itemName: l.item_name, itemCode: l.item_code,
      barcode: l.barcode, unit: l.unit,
      orderedQty: l.qty, shippedQty: l.shipped_qty, toPick: l.qty - l.shipped_qty,
      // Yetersiz stok toplayıcının değil planlamanın sorunudur; yine de görünmeli
      shortage: remaining > 0 ? Number(remaining.toFixed(4)) : 0,
      suggestedLots: suggested
    };
  });

  res.json({
    soId: so.id, soNo: so.so_no, customerName: so.customer_name,
    promisedDate: so.promised_date,
    lines: picks,
    totalLines: picks.length,
    shortageLines: picks.filter(p => p.shortage > 0).length
  });
});

/** Üretim emrinin çekilecek malzemeleri, önerilen partilerle. */
router.get('/issue-list/:orderId', (req, res) => {
  const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.orderId);
  if (!po) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);

  const comps = db.prepare(`SELECT pc.*, i.code AS item_code, i.unit, i.barcode
    FROM production_order_components pc LEFT JOIN items i ON i.id = pc.component_item_id
    WHERE pc.production_order_id = ?`).all(po.id);

  const list = comps.map(c => {
    const lots = db.prepare(`SELECT sl.*, w.name AS warehouse_name, i.location AS item_location
      FROM stock_lots sl LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      JOIN items i ON i.id = sl.item_id
      WHERE sl.item_id = ? AND sl.status = 'available' AND sl.qty > 0
      ORDER BY COALESCE(sl.expiry_date,'9999-12-31'), sl.received_at`).all(c.component_item_id);
    const available = lots.reduce((s, l) => s + l.qty, 0);
    return {
      itemId: c.component_item_id, itemName: c.component_name, itemCode: c.item_code,
      barcode: c.barcode, unit: c.unit, needed: c.qty_used, available,
      shortage: available < c.qty_used ? Number((c.qty_used - available).toFixed(4)) : 0,
      lots: lots.slice(0, 10).map(l => ({
        lotId: l.id, lotNo: l.lot_no, qty: l.qty, location: l.item_location,
        warehouseName: l.warehouse_name, expiryDate: l.expiry_date
      }))
    };
  });

  res.json({
    orderId: po.id, orderNo: po.order_no, itemName: po.item_name, qty: po.qty,
    status: po.status, warehouseId: po.warehouse_id,
    components: list,
    shortageCount: list.filter(c => c.shortage > 0).length
  });
});

/**
 * Toplu okutma: terminal bağlantı kesintisinde işlemleri kuyruğa alır ve
 * bağlantı gelince toplu gönderir. Her işlem tek tek değerlendirilir; birinin
 * hatası diğerlerini düşürmez — aksi halde kullanıcı hangisinin geçtiğini bilemez.
 */
router.post('/sync', requireRole('admin', 'manager', 'operator', 'quality'), async (req, res) => {
  const ops = Array.isArray(req.body && req.body.operations) ? req.body.operations : [];
  if (!ops.length) throw new AppError('İşlem listesi boş / No operations', 400);
  if (ops.length > 200) throw new AppError('Tek seferde en fazla 200 işlem / Max 200 operations', 400);

  const stock = require('../services/stock');
  const results = [];

  for (const op of ops) {
    try {
      // Kalite rolü masaüstünde de yalnızca sayım kaydedebilir (count.write) —
      // stok girişi/transfer stock.write gerektirir, kalitede yok (bkz.
      // PERMISSIONS, server/middleware/auth.js). Aynı ayrım burada da
      // uygulanmazsa kalite kullanıcısı mobil terminalde HİÇBİR işlem
      // yapamaz hale gelirdi (route seviyesinde tamamen dışlanıyordu) —
      // rol taraması bulgusu.
      if (req.user.role === 'quality' && op.type !== 'count_line') {
        results.push({ clientId: op.clientId, ok: false, error: 'Bu işlem için yetkiniz yok / Not authorized for this operation' });
        continue;
      }

      if (op.type === 'move') {
        const r = db.txImmediate(() => stock.receiveLot({
          itemId: op.itemId, warehouseId: op.warehouseId, qty: op.qty,
          lotNo: op.lotNo || null, unitCostBase: op.unitCost || 0,
          expiryDate: op.expiryDate || null, status: op.status || 'available',
          sourceType: 'mobile', note: op.note || 'El terminali', userId: req.user.id
        }));
        results.push({ clientId: op.clientId, ok: true, id: typeof r === 'string' ? r : (r && r.id) || null });

      } else if (op.type === 'transfer') {
        db.txImmediate(() => stock.transferLot({
          lotId: op.lotId, targetWarehouseId: op.toWarehouseId, qty: op.qty,
          note: op.note || 'El terminali', userId: req.user.id
        }));
        results.push({ clientId: op.clientId, ok: true });

      } else if (op.type === 'count_line') {
        // stock_count_lines'ta counted_at diye bir sütun hiç yok (001_initial_schema.js) -
        // bu satır her zaman "no such column: counted_at" ile patlıyordu. Masaüstünün
        // PUT /counts/:id/lines'taki (server/routes/stock.js:248) ile aynı deseni kullan.
        db.prepare('UPDATE stock_count_lines SET counted_qty = ?, difference = ? - system_qty WHERE id = ?')
          .run(op.countedQty, op.countedQty, op.lineId);
        results.push({ clientId: op.clientId, ok: true });

      } else {
        results.push({ clientId: op.clientId, ok: false, error: `Bilinmeyen işlem tipi: ${op.type}` });
      }
    } catch (e) {
      // Hata mesajı kullanıcıya döner; kuyrukta kalan işlem elle düzeltilebilmeli
      results.push({ clientId: op.clientId, ok: false, error: e.message });
    }
  }

  res.json({
    total: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results
  });
});

module.exports = router;
