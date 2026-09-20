const db = require('../db');
const { AppError } = require('../lib/core');

// Called inside the invoice's IMMEDIATE transaction: allocation and document commit together.
function prepareInvoiceAllocation(b, defaultVat) {
  if (!b.soId && !b.shipmentId) return { lines: b.lines, allocations: [], soId: null };
  const shipment = b.shipmentId ? db.prepare('SELECT * FROM shipments WHERE id=?').get(b.shipmentId) : null;
  if (b.shipmentId && !shipment) throw new AppError('Sevkiyat bulunamadı / Shipment not found', 404);
  const soId = b.soId || shipment?.so_id || null;
  const so = soId ? db.prepare('SELECT * FROM sales_orders WHERE id=?').get(soId) : null;
  if (soId && !so) throw new AppError('Sipariş bulunamadı / Order not found', 404);
  if ((so && (so.customer_id !== b.customerId || so.currency !== b.currency)) ||
      (shipment && (shipment.customer_id !== b.customerId || (b.soId && shipment.so_id !== b.soId)))) {
    throw new AppError('Fatura müşteri, sipariş veya para birimi eşleşmiyor / Invoice source mismatch', 422);
  }
  if (so?.status === 'cancelled' || shipment?.status === 'İptal Edildi') {
    throw new AppError('İptal edilmiş belge faturalanamaz / Cancelled source cannot be invoiced', 409);
  }
  if (b.invoiceType === 'iade') return { lines: b.lines, allocations: [], soId };
  const legacy = db.prepare(`SELECT ci.id FROM customer_invoices ci
    LEFT JOIN shipments sh ON sh.id=ci.shipment_id
    WHERE ci.status!='cancelled' AND ci.invoice_type!='iade'
    AND ((? IS NOT NULL AND (ci.so_id=? OR sh.so_id=?)) OR ci.shipment_id=?)
    AND NOT EXISTS(SELECT 1 FROM invoice_shipment_allocations a WHERE a.invoice_id=ci.id) LIMIT 1`)
    .get(soId, soId, soId, b.shipmentId || null);
  if (legacy) throw new AppError('Eski faturanın sevk miktarı mutabakatı gerekli / Historical invoice allocation needs reconciliation', 409);
  const pool = db.prepare(`SELECT si.*, sol.price, i.unit, i.code, i.vat_rate,
    si.qty-COALESCE((SELECT SUM(a.qty) FROM invoice_shipment_allocations a
      JOIN customer_invoices ci ON ci.id=a.invoice_id
      WHERE a.shipment_item_id=si.id AND ci.status!='cancelled'),0) remaining
    FROM shipment_items si JOIN shipments sh ON sh.id=si.shipment_id
    LEFT JOIN sales_order_lines sol ON sol.id=si.sales_order_line_id
    LEFT JOIN items i ON i.id=si.item_id
    WHERE sh.status!='İptal Edildi' AND ((? IS NOT NULL AND sh.id=?) OR (? IS NULL AND sh.so_id=?))
    ORDER BY si.id`).all(b.shipmentId || null, b.shipmentId || null, b.shipmentId || null, soId);
  let lines = b.lines;
  if (!lines) {
    lines = pool.filter(p => p.remaining > 1e-9).map(p => {
      if (p.price == null) throw new AppError('Siparişsiz sevkiyat için fiyatlı fatura satırları gerekli / Priced lines required', 422);
      return { itemId: p.item_id, itemName: p.item_name, itemCode: p.code,
        salesOrderLineId: p.sales_order_line_id, qty: p.remaining, unit: p.unit || 'adet',
        unitPrice: p.price, discountRate: 0, vatRate: p.vat_rate ?? defaultVat };
    });
  }
  if (!lines.length) throw new AppError('Faturalanabilir sevk miktarı yok / No uninvoiced shipped quantity', 409);
  const allocations = [];
  lines.forEach((line, index) => {
    const candidates = pool.filter(p => p.item_id === line.itemId &&
      (line.salesOrderLineId == null || p.sales_order_line_id === line.salesOrderLineId));
    if (new Set(candidates.map(p => p.sales_order_line_id)).size > 1) {
      throw new AppError('Fatura için sipariş satırı seçilmeli / Select order line for invoice', 422);
    }
    let need = line.qty;
    for (const p of candidates) {
      const qty = Math.min(need, Math.max(0, p.remaining));
      if (qty > 0) { allocations.push({ lineNo: index + 1, shipmentItemId: p.id, qty }); p.remaining -= qty; need -= qty; }
    }
    if (need > 1e-9) throw new AppError('Miktar faturalanmamış sevki aşıyor / Quantity exceeds uninvoiced shipment', 409);
  });
  return { lines, allocations, soId };
}

function saveInvoiceAllocation(invoiceId, prepared) {
  const insert = db.prepare('INSERT INTO invoice_shipment_allocations(invoice_id,line_no,shipment_item_id,qty) VALUES(?,?,?,?)');
  prepared.allocations.forEach(a => insert.run(invoiceId, a.lineNo, a.shipmentItemId, a.qty));
  if (!prepared.soId || !prepared.allocations.length) return;
  const unshipped = db.prepare('SELECT COUNT(*) n FROM sales_order_lines WHERE so_id=? AND shipped_qty<qty-0.000000001').get(prepared.soId).n;
  const unbilled = db.prepare(`SELECT COUNT(*) n FROM shipment_items si JOIN shipments sh ON sh.id=si.shipment_id
    WHERE sh.so_id=? AND sh.status!='İptal Edildi' AND si.qty>0.000000001+COALESCE((
      SELECT SUM(a.qty) FROM invoice_shipment_allocations a JOIN customer_invoices ci ON ci.id=a.invoice_id
      WHERE a.shipment_item_id=si.id AND ci.status!='cancelled'),0)`).get(prepared.soId).n;
  if (!unshipped && !unbilled) db.prepare("UPDATE sales_orders SET status='invoiced' WHERE id=?").run(prepared.soId);
}
module.exports = { prepareInvoiceAllocation, saveInvoiceAllocation };
