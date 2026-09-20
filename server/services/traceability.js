const db = require('../db');
const { AppError } = require('../lib/core');

/**
 * Backward trace ("where did this come from"): given a finished lot, walk down the
 * genealogy to every component lot that went into it, recursively.
 */
function traceBackward(lotId, depth = 0, seen = new Set()) {
  if (depth > 100) throw new AppError('İzlenebilirlik ağacı çok derin; kapsamlı inceleme gerekli / Trace depth limit reached', 409);
  if (seen.has(lotId)) return null;
  seen.add(lotId);

  const lot = db.prepare(`SELECT sl.*, i.name AS item_name, i.unit FROM stock_lots sl
    JOIN items i ON i.id = sl.item_id WHERE sl.id = ?`).get(lotId);
  if (!lot) return null;

  const node = {
    lotId: lot.id, itemName: lot.item_name, lotNo: lot.lot_no, qty: lot.qty, unit: lot.unit,
    status: lot.status, expiryDate: lot.expiry_date, sourceType: lot.source_type, sourceId: lot.source_id,
    receivedAt: lot.received_at, supplierId: lot.supplier_id, components: []
  };

  if (lot.source_type === 'purchase' && lot.source_id) {
    const receipt = db.prepare(`SELECT r.*, po.po_no, s.name AS supplier_name
      FROM po_receipts r LEFT JOIN purchase_orders po ON po.id = r.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE r.id = ?`).get(lot.source_id);
    if (receipt) node.purchase = { receiptNo: receipt.receipt_no, poNo: receipt.po_no, supplier: receipt.supplier_name, waybillNo: receipt.waybill_no };
  }

  if (lot.parent_lot_id) {
    const parent = traceBackward(lot.parent_lot_id, depth + 1, seen);
    node.components.push({ itemName: parent ? parent.itemName : lot.item_name, lotNo: parent ? parent.lotNo : null,
      qty: lot.parent_qty, unitCost: lot.unit_cost, relationship: 'lot_split_or_return', child: parent });
  }
  if (!lot.parent_lot_id && lot.source_type === 'production' && lot.source_id) {
    const po = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(lot.source_id);
    if (po) {
      node.production = { orderNo: po.order_no, qty: po.qty, producedQty: po.produced_qty, scrapQty: po.scrap_qty, date: po.date };
      const consumed = db.prepare('SELECT * FROM production_consumption WHERE production_order_id = ?').all(po.id);
      node.components = consumed.map(c => ({
        itemName: c.component_name, lotNo: c.lot_no, qty: c.qty, unitCost: c.unit_cost,
        child: c.lot_id ? traceBackward(c.lot_id, depth + 1, seen) : null
      }));
    }
  }

  return node;
}

/**
 * Forward trace ("where did this go") — the recall question. Given a component lot,
 * find every production order that consumed it, every resulting output lot, and every
 * shipment/customer that received those outputs.
 */
function traceForward(lotId, depth = 0, seen = new Set()) {
  if (depth > 100) throw new AppError('İzlenebilirlik ağacı çok derin; kapsamlı inceleme gerekli / Trace depth limit reached', 409);
  if (seen.has(lotId)) return null;
  seen.add(lotId);

  const lot = db.prepare(`SELECT sl.*, i.name AS item_name, i.unit FROM stock_lots sl
    JOIN items i ON i.id = sl.item_id WHERE sl.id = ?`).get(lotId);
  if (!lot) return null;

  const node = {
    lotId: lot.id, itemName: lot.item_name, lotNo: lot.lot_no, qty: lot.qty, unit: lot.unit,
    status: lot.status, usedIn: [], shippedTo: [], splits: []
  };
  const splits = db.prepare('SELECT id,parent_qty FROM stock_lots WHERE parent_lot_id=?').all(lotId);
  node.splits = splits.map(split => ({ qty: split.parent_qty, output: traceForward(split.id, depth + 1, seen) }));

  const consumptions = db.prepare(`SELECT pc.*, po.id AS po_id, po.order_no, po.item_name AS output_item,
      po.output_lot_id, po.date, po.status
    FROM production_consumption pc JOIN production_orders po ON po.id = pc.production_order_id
    WHERE pc.lot_id = ?`).all(lotId);

  for (const c of consumptions) {
    node.usedIn.push({
      productionOrderNo: c.order_no, outputItem: c.output_item, qtyUsed: c.qty, date: c.date, status: c.status,
      output: c.output_lot_id ? traceForward(c.output_lot_id, depth + 1, seen) : null
    });
  }

  const shipments = db.prepare(`SELECT si.qty, sh.shipment_no, sh.date, sh.destination, sh.status,
      c.name AS customer_name, c.id AS customer_id, so.so_no
    FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
    LEFT JOIN customers c ON c.id = sh.customer_id
    LEFT JOIN sales_orders so ON so.id = sh.so_id
    WHERE si.lot_id = ? AND sh.cancelled_at IS NULL`).all(lotId);

  node.shippedTo = shipments.map(s => ({
    shipmentNo: s.shipment_no, soNo: s.so_no, customerId: s.customer_id, customer: s.customer_name,
    qty: s.qty, date: s.date, destination: s.destination, status: s.status
  }));

  return node;
}

/** Flatten a forward trace into the customer list a recall notice needs. */
function recallReport(lotId) {
  const tree = traceForward(lotId);
  if (!tree) throw new AppError('Parti bulunamadı / Lot not found', 404);

  const customers = new Map();
  const shipments = [];
  (function walk(node) {
    if (!node) return;
    node.shippedTo.forEach(s => {
      shipments.push(s);
      const key = s.customerId || s.customer || s.destination;
      if (!customers.has(key)) customers.set(key, { customerId: s.customerId, customer: s.customer || s.destination, qty: 0, shipments: [] });
      const entry = customers.get(key);
      entry.qty += s.qty;
      entry.shipments.push(s.shipmentNo);
    });
    node.usedIn.forEach(u => walk(u.output));
    node.splits.forEach(split => walk(split.output));
  })(tree);

  const remaining = db.prepare(
    `WITH RECURSIVE family(id) AS (
      SELECT id FROM stock_lots WHERE id=?
      UNION SELECT child.id FROM stock_lots child JOIN family parent ON child.parent_lot_id=parent.id
    ) SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE id IN (SELECT id FROM family)
      AND status IN ('available','quarantine','blocked')`
  ).get(lotId).q;

  return {
    lot: { lotId: tree.lotId, itemName: tree.itemName, lotNo: tree.lotNo, status: tree.status },
    stillInStock: remaining,
    affectedCustomers: [...customers.values()],
    shipments,
    tree
  };
}

module.exports = { traceBackward, traceForward, recallReport };
