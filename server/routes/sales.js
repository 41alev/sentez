// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, validatePartial, z } = require('../middleware/validate');
const { AppError, uuid, nextNumber, logAudit, diff, toBase, paginate } = require('../lib/core');
const { companyIdOf } = require('../lib/tenant');
const stock = require('../services/stock');
const { dispatchEvent } = require('../lib/webhooks');
const { createSalesOrder } = require('../services/sales-orders');
const { prepareInvoiceAllocation, saveInvoiceAllocation } = require('../services/invoice-allocation');
const kvkk = require('../lib/kvkk');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');
const ADMIN = requireRole('admin', 'manager');

/* ============================ CUSTOMERS ============================ */

const customerSchema = z.object({
  code: z.string().max(1000).optional(), name: z.string().min(1).max(200),
  contactPerson: z.string().max(1000).optional(), phone: z.string().max(1000).optional(), email: z.string().max(1000).optional(),
  address: z.string().max(5000).optional(), country: z.string().max(1000).optional(), taxNo: z.string().max(1000).optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).default('TRY'),
  paymentTermsDays: z.coerce.number().int().min(0).default(30),
  creditLimit: z.coerce.number().min(0).default(0),
  incoterm: z.string().max(1000).optional(), notes: z.string().max(5000).optional()
});

router.get('/customers', (req, res) => {
  const { q = '', page = 1, pageSize = 50 } = req.query;
  const like = `%${q}%`;
  res.json(paginate(
    `SELECT * FROM customers WHERE is_active = 1 AND (name LIKE ? OR COALESCE(code,'') LIKE ?) ORDER BY name COLLATE NOCASE`,
    [like, like], page, pageSize
  ));
});

router.get('/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  const orders = db.prepare('SELECT * FROM sales_orders WHERE customer_id = ? ORDER BY date DESC LIMIT 20').all(c.id);
  const openBalance = require('../services/customer-balance').outstandingBalance(c.id);
  res.json({ ...c, recentOrders: orders, openBalanceBase: openBalance });
});

router.post('/customers', ADMIN, validate(customerSchema), (req, res) => {
  const b = req.valid;
  const info = db.prepare(`INSERT INTO customers (code,name,contact_person,phone,email,address,country,tax_no,currency,payment_terms_days,credit_limit,incoterm,notes,created_at,company_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.code || null, b.name, b.contactPerson || null, b.phone || null,
    b.email || null, b.address || null, b.country || null, b.taxNo || null, b.currency,
    b.paymentTermsDays, b.creditLimit, b.incoterm || null, b.notes || null, Date.now(), companyIdOf(req));
  logAudit(req, 'auditCustomerAdd', { entityType: 'customer', entityId: info.lastInsertRowid, newValue: b, detail: b.name });
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/customers/:id', ADMIN, validatePartial(customerSchema), (req, res) => {
  const before = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!before) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  const b = req.valid;
  db.prepare(`UPDATE customers SET code=COALESCE(?,code), name=COALESCE(?,name), contact_person=COALESCE(?,contact_person),
    phone=COALESCE(?,phone), email=COALESCE(?,email), address=COALESCE(?,address), country=COALESCE(?,country),
    tax_no=COALESCE(?,tax_no), currency=COALESCE(?,currency), payment_terms_days=COALESCE(?,payment_terms_days),
    credit_limit=COALESCE(?,credit_limit), incoterm=COALESCE(?,incoterm), notes=COALESCE(?,notes) WHERE id=?`)
    .run(b.code, b.name, b.contactPerson, b.phone, b.email, b.address, b.country, b.taxNo, b.currency,
         b.paymentTermsDays, b.creditLimit, b.incoterm, b.notes, req.params.id);
  const after = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  const d = diff(before, after, ['name', 'currency', 'payment_terms_days', 'credit_limit', 'incoterm', 'country']);
  logAudit(req, 'auditCustomerEdit', { entityType: 'customer', entityId: req.params.id, ...(d || {}), detail: after.name });
  res.json(after);
});

router.delete('/customers/:id', requireRole('admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  db.prepare('UPDATE customers SET is_active = 0, deactivated_at = COALESCE(deactivated_at, ?) WHERE id = ?').run(Date.now(), c.id);
  logAudit(req, 'auditCustomerDelete', { entityType: 'customer', entityId: c.id, detail: c.name });
  res.status(204).end();
});

/** KVKK m.7 — geri döndürülemez anonimleştirme (bkz. server/lib/kvkk.js). */
router.post('/customers/:id/anonymize', requireRole('admin'), (req, res) => {
  res.json(kvkk.anonymizeCustomer(req, req.params.id));
});

/** KVKK m.11/b — "hangi veriyi tutuyoruz" dışa aktarım raporu. */
router.get('/customers/:id/data-export', requireRole('admin'), (req, res) => {
  res.json(kvkk.exportCustomerData(req.params.id));
});

/* ============================ SALES ORDERS ============================ */

function serializeSO(row) {
  const lines = db.prepare('SELECT * FROM sales_order_lines WHERE so_id = ?').all(row.id);
  return {
    id: row.id, soNo: row.so_no, customerId: row.customer_id, customerName: row.customer_name,
    date: row.date, promisedDate: row.promised_date, currency: row.currency, fxRate: row.fx_rate,
    incoterm: row.incoterm, status: row.status, totalBase: row.total_base, notes: row.notes,
    lines: lines.map(l => ({
      id: l.id, itemId: l.item_id, itemName: l.item_name, qty: l.qty, shippedQty: l.shipped_qty,
      remainingQty: l.qty - l.shipped_qty, price: l.price, currency: l.currency, cogsBase: l.cogs_base
    }))
  };
}

router.get('/orders', (req, res) => {
  const { status = '', customerId = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM sales_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (customerId) { sql += ' AND customer_id = ?'; params.push(customerId); }
  sql += ' ORDER BY date DESC, so_no DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serializeSO);
  res.json(result);
});

router.get('/orders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError('Sipariş bulunamadı / Order not found', 404);
  const shipments = db.prepare('SELECT * FROM shipments WHERE so_id = ?').all(row.id);
  res.json({ ...serializeSO(row), shipments });
});

const soSchema = z.object({
  customerId: z.coerce.number().int(),
  date: z.string().max(1000).optional(), promisedDate: z.string().max(1000).optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).default('TRY'),
  incoterm: z.string().max(1000).optional(), notes: z.string().max(5000).optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1).max(200), qty: z.coerce.number().positive(), price: z.coerce.number().min(0).default(0)
  })).min(1)
});

router.post('/orders', WRITE, validate(soSchema), (req, res) => {
  const b = req.valid;
  const result = createSalesOrder(req, b);
  const serialized = serializeSO(result);
  dispatchEvent('sales_order.created', serialized, companyIdOf(req));
  res.status(201).json(serialized);
});

router.post('/orders/:id/cancel', ADMIN, (req, res) => {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!so) throw new AppError('Sipariş bulunamadı / Order not found', 404);
  if (so.status === 'shipped' || so.status === 'invoiced') throw new AppError('Sevk edilmiş sipariş iptal edilemez / Cannot cancel a shipped order');
  db.prepare("UPDATE sales_orders SET status = 'cancelled' WHERE id = ?").run(so.id);
  logAudit(req, 'auditSalesOrderCancel', { entityType: 'sales_order', entityId: so.id, detail: so.so_no });
  res.json({ ok: true });
});

/* ============================ SHIPMENTS ============================ */

function serializeShipment(row) {
  const items = db.prepare('SELECT * FROM shipment_items WHERE shipment_id = ?').all(row.id);
  const crates = db.prepare('SELECT crate_no AS crateNo, w, h, d, weight FROM shipment_crates WHERE shipment_id = ?').all(row.id);
  return {
    id: row.id, shipmentNo: row.shipment_no, soId: row.so_id, customerId: row.customer_id,
    type: row.type, carrier: row.carrier, destination: row.destination, status: row.status,
    date: row.date, incoterm: row.incoterm, trackingNo: row.tracking_no,
    cancelledAt: row.cancelled_at, cancelledBy: row.cancelled_by,
    items: items.map(i => ({ itemId: i.item_id, salesOrderLineId: i.sales_order_line_id, itemName: i.item_name, lotId: i.lot_id, lotNo: i.lot_no, qty: i.qty, unitCost: i.unit_cost })),
    crates
  };
}

router.get('/shipments', (req, res) => {
  const { type = '', status = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM shipments WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY date DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serializeShipment);
  res.json(result);
});

router.get('/shipments/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError('Sevkiyat bulunamadı / Shipment not found', 404);
  res.json(serializeShipment(row));
});

const shipmentSchema = z.object({
  soId: z.string().max(1000).optional(),
  customerId: z.coerce.number().int().optional(),
  type: z.string().default('Yurt İçi'),
  carrier: z.string().max(1000).optional(), destination: z.string().min(1).max(200),
  date: z.string().max(1000).optional(), incoterm: z.string().max(1000).optional(), trackingNo: z.string().max(1000).optional(),
  warehouseId: z.coerce.number().int().optional(),
  items: z.array(z.object({
    itemId: z.string().min(1).max(200),
    qty: z.coerce.number().positive(),
    salesOrderLineId: z.coerce.number().int().positive().optional(),
    lotId: z.string().max(1000).optional()          // optional: if omitted, FEFO picks lots automatically
  })).min(1),
  crates: z.array(z.object({
    crateNo: z.string().max(1000).optional(), w: z.coerce.number().default(0), h: z.coerce.number().default(0),
    d: z.coerce.number().default(0), weight: z.coerce.number().default(0)
  })).default([])
});

router.post('/shipments', WRITE, validate(shipmentSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    const id = uuid();
    const shipmentNo = nextNumber('shipment', 'SVK');
    const so = b.soId ? db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(b.soId) : null;
    if (b.soId && !so) throw new AppError('Satış siparişi bulunamadı / Sales order not found', 404);
    if (so && !['open', 'partially_shipped'].includes(so.status)) throw new AppError('Sipariş sevke açık değil / Order is not open for shipping', 409);
    if (so && b.customerId != null && b.customerId !== so.customer_id) throw new AppError('Sipariş müşterisi eşleşmiyor / Order customer mismatch', 422);
    const customerId = b.customerId || (so ? so.customer_id : null);

    db.prepare(`INSERT INTO shipments (id,shipment_no,so_id,customer_id,type,carrier,destination,status,date,incoterm,tracking_no,created_by)
      VALUES (?,?,?,?,?,?,?,'Hazırlanıyor',?,?,?,?)`)
      .run(id, shipmentNo, b.soId || null, customerId, b.type, b.carrier || null, b.destination,
           b.date || new Date().toISOString().slice(0, 10), b.incoterm || null, b.trackingNo || null, req.user.id);

    const insItem = db.prepare('INSERT INTO shipment_items (shipment_id,item_id,item_name,lot_id,lot_no,qty,unit_cost,sales_order_line_id) VALUES (?,?,?,?,?,?,?,?)');

    for (const line of b.items) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(line.itemId);
      if (!item) throw new AppError('Ürün bulunamadı / Item not found', 404);
      let orderLine = null;
      if (so) {
        const candidates = db.prepare('SELECT * FROM sales_order_lines WHERE so_id=? AND item_id=?').all(so.id, item.id);
        orderLine = line.salesOrderLineId
          ? candidates.find(candidate => candidate.id === line.salesOrderLineId)
          : (candidates.length === 1 ? candidates[0] : null);
        if (!orderLine) throw new AppError('Geçerli sipariş satırı seçilmeli / Select an unambiguous sales order line', 422);
        if (orderLine.shipped_qty + line.qty > orderLine.qty + 1e-9) throw new AppError('Siparişin kalan miktarı aşılıyor / Shipment exceeds remaining order quantity', 409);
      } else if (line.salesOrderLineId) {
        throw new AppError('Sipariş satırı için sipariş gerekli / Sales order required', 422);
      }

      // Explicit lot, or FEFO allocation across available lots
      const picks = line.lotId
        ? [(() => {
            const lot = db.prepare("SELECT * FROM stock_lots WHERE id = ? AND status='available'").get(line.lotId);
            if (!lot) throw new AppError('Seçilen lot kullanılabilir değil / Selected lot is not available', 400);
            if (lot.qty < line.qty) throw new AppError('Lotta yeterli miktar yok / Not enough quantity in lot', 400,
              { shortfall: { name: item.name, needed: line.qty, available: lot.qty, unit: item.unit } });
            return { lotId: lot.id, lotNo: lot.lot_no, qty: line.qty, unitCost: lot.unit_cost };
          })()]
        : stock.allocate(line.itemId, line.qty, b.warehouseId || null, 'FEFO');

      stock.consume(picks, { itemId: item.id, itemName: item.name, warehouseId: b.warehouseId || null, note: `Sevkiyat ${shipmentNo}`, refType: 'shipment', refId: id, userId: req.user.id });
      picks.forEach(p => insItem.run(id, item.id, item.name, p.lotId, p.lotNo, p.qty, p.unitCost, orderLine ? orderLine.id : null));

      // Update the sales order line and accumulate cost of goods sold
      if (so) {
        const sol = orderLine;
        if (sol) {
          const cogs = picks.reduce((s, p) => s + p.qty * p.unitCost, 0);
          db.prepare('UPDATE sales_order_lines SET shipped_qty = shipped_qty + ?, cogs_base = cogs_base + ? WHERE id = ?')
            .run(line.qty, cogs, sol.id);
        }
      }
    }

    const insCrate = db.prepare('INSERT INTO shipment_crates (shipment_id,crate_no,w,h,d,weight) VALUES (?,?,?,?,?,?)');
    b.crates.forEach(c => insCrate.run(id, c.crateNo || null, c.w, c.h, c.d, c.weight));

    if (so) {
      const lines = db.prepare('SELECT qty, shipped_qty FROM sales_order_lines WHERE so_id = ?').all(so.id);
      const allShipped = lines.every(l => l.shipped_qty >= l.qty - 1e-9);
      const anyShipped = lines.some(l => l.shipped_qty > 0);
      db.prepare('UPDATE sales_orders SET status = ? WHERE id = ?')
        .run(allShipped ? 'shipped' : (anyShipped ? 'partially_shipped' : so.status), so.id);
    }

    logAudit(req, 'auditShipAdd', { entityType: 'shipment', entityId: id, newValue: { shipmentNo, destination: b.destination }, detail: shipmentNo });
    return db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  });
  const serialized = serializeShipment(result);
  dispatchEvent('shipment.created', serialized, companyIdOf(req));
  res.status(201).json(serialized);
});

router.patch('/shipments/:id/status', WRITE, (req, res) => {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!s) throw new AppError('Sevkiyat bulunamadı / Shipment not found', 404);
  const order = ['Hazırlanıyor', 'Yolda', 'Teslim Edildi'];
  if (!order.includes(s.status)) throw new AppError('Sevkiyat durumu ilerletilemez / Shipment status cannot advance', 409);
  const next = order[Math.min(order.indexOf(s.status) + 1, order.length - 1)];
  db.prepare('UPDATE shipments SET status = ? WHERE id = ?').run(next, s.id);
  logAudit(req, 'auditShipStatus', { entityType: 'shipment', entityId: s.id, oldValue: { status: s.status }, newValue: { status: next }, detail: s.shipment_no });
  const serialized = serializeShipment(db.prepare('SELECT * FROM shipments WHERE id = ?').get(s.id));
  dispatchEvent('shipment.status_changed', { ...serialized, previousStatus: s.status }, companyIdOf(req));
  res.json(serialized);
});

router.delete('/shipments/:id', requireRole('admin'), (req, res) => {
  db.txImmediate(() => {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!s) throw new AppError('Sevkiyat bulunamadı / Shipment not found', 404);
  if (s.cancelled_at) return;
  if (s.status !== 'Hazırlanıyor') throw new AppError('Yola çıkmış sevkiyat iptal edilemez; iade sürecini kullanın / Dispatched shipment requires a return', 409);
  const invoice = db.prepare("SELECT id FROM customer_invoices WHERE status!='cancelled' AND (shipment_id=? OR (so_id IS NOT NULL AND so_id=?)) LIMIT 1").get(s.id, s.so_id);
  if (invoice) throw new AppError('Faturaya bağlı sevkiyat iptal edilemez / Invoiced shipment cannot be cancelled', 409);
  const lines = db.prepare('SELECT * FROM shipment_items WHERE shipment_id=?').all(s.id);
  for (const line of lines) {
    const lot = db.prepare('SELECT * FROM stock_lots WHERE id=?').get(line.lot_id);
    if (!lot || lot.item_id !== line.item_id) throw new AppError('Eski sevkiyat lot eşleşmesi hatalı; mutabakat gerekli / Historical lot mismatch requires reconciliation', 409);
    if (s.so_id) {
      const sol = db.prepare('SELECT * FROM sales_order_lines WHERE id=? AND so_id=?').get(line.sales_order_line_id, s.so_id);
      if (!sol || sol.shipped_qty + 1e-9 < line.qty || sol.cogs_base + 1e-6 < line.qty * line.unit_cost) throw new AppError('Sipariş satırı mutabakatı gerekli / Order line reconciliation required', 409);
      db.prepare('UPDATE sales_order_lines SET shipped_qty=MAX(0,shipped_qty-?),cogs_base=MAX(0,cogs_base-?) WHERE id=?')
        .run(line.qty, line.qty * line.unit_cost, sol.id);
    }
    const movement = db.prepare("SELECT warehouse_id FROM movements WHERE ref_type='shipment' AND ref_id=? AND lot_id=? AND item_id=? LIMIT 1").get(s.id, lot.id, line.item_id);
    if (!movement) throw new AppError('Sevkiyat stok hareketi bulunamadı; mutabakat gerekli / Shipment movement requires reconciliation', 409);
    const restored = stock.receiveLot({ itemId: line.item_id, warehouseId: movement.warehouse_id, qty: line.qty,
      lotNo: lot.lot_no, serialNo: lot.serial_no, expiryDate: lot.expiry_date, unitCostBase: line.unit_cost,
      status: ['blocked', 'quarantine', 'rejected'].includes(lot.status) ? lot.status : 'available',
      sourceType: 'shipment_cancel', sourceId: s.id, supplierId: lot.supplier_id,
      note: `Sevkiyat iptali ${s.shipment_no}`, userId: req.user.id });
    db.prepare('UPDATE stock_lots SET parent_lot_id=?,parent_qty=? WHERE id=?').run(lot.id, line.qty, restored);
  }
  db.prepare("UPDATE shipments SET status='İptal Edildi',cancelled_at=?,cancelled_by=? WHERE id=?").run(Date.now(), req.user.id, s.id);
  if (s.so_id) {
    const remainingLines = db.prepare('SELECT qty,shipped_qty FROM sales_order_lines WHERE so_id=?').all(s.so_id);
    const status = remainingLines.some(line => line.shipped_qty > 1e-9) ? 'partially_shipped' : 'open';
    db.prepare("UPDATE sales_orders SET status=? WHERE id=? AND status!='cancelled'").run(status, s.so_id);
  }
  logAudit(req, 'auditShipCancel', { entityType: 'shipment', entityId: s.id, detail: s.shipment_no });
  });
  res.status(204).end();
});

/* ============================ CUSTOMER INVOICES ============================ */

router.get('/invoices', (req, res) => {
  const { page = 1, pageSize = 50 } = req.query;
  res.json(paginate(`SELECT ci.*, c.name AS customer_name FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id ORDER BY ci.invoice_date DESC`, [], page, pageSize));
});

const invoiceSchema = z.object({
  customerId: z.coerce.number().int(),
  soId: z.string().max(1000).optional(), shipmentId: z.string().max(1000).optional(),
  invoiceDate: z.string().max(1000).optional(),
  amount: z.coerce.number().min(0).optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).default('TRY'),
  invoiceType: z.enum(['satis', 'iade', 'tevkifat', 'istisna', 'ihrackayitli']).default('satis'),
  // İade faturasının hangi orijinal faturayı kredilendirdiğini izler —
  // 'iade' seçildiğinde zorunludur (bkz. aşağıdaki kontrol).
  originalInvoiceId: z.string().max(1000).optional(),
  // Kalem bazlı KDV/iskonto doğru raporlama için gerekir; verilmezse
  // siparişin sevk edilen satırlarından türetilir.
  lines: z.array(z.object({
    salesOrderLineId: z.coerce.number().int().positive().optional(),
    itemId: z.string().max(1000).optional(),
    itemName: z.string().min(1).max(200),
    itemCode: z.string().max(1000).optional(),
    qty: z.coerce.number().positive(),
    unit: z.string().default('adet'),
    unitPrice: z.coerce.number().min(0),
    discountRate: z.coerce.number().min(0).max(100).default(0),
    vatRate: z.coerce.number().min(0).max(100).optional()
  })).optional()
});

router.get('/orders/:id/invoice-preview', WRITE, (req, res) => {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(req.params.id);
  if (!so) throw new AppError('Sipariş bulunamadı / Order not found', 404);
  const defaultVat = Number(require('../lib/core').getSetting('defaultVatRate') || 20);
  const prepared = prepareInvoiceAllocation({ soId: so.id, customerId: so.customer_id, currency: so.currency }, defaultVat);
  const amount = prepared.lines.reduce((total, l) => {
    const net = Number((l.qty * l.unitPrice).toFixed(2));
    return total + net + Number((net * l.vatRate / 100).toFixed(2));
  }, 0);
  res.json({ currency: so.currency, amount: Number(amount.toFixed(2)), lines: prepared.lines });
});

router.post('/invoices', WRITE, validate(invoiceSchema), (req, res) => {
  const b = req.valid;
  const result = db.txImmediate(() => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customerId);
    if (!customer) throw new AppError('Müşteri bulunamadı / Customer not found', 404);

    // İade faturası hangi faturanın iade edildiğini bilmek zorunda —
    // bkz. server/migrations/015_invoice_return_reference.js.
    if (b.invoiceType === 'iade') {
      if (!b.originalInvoiceId) throw new AppError('İade faturası için orijinal fatura seçilmeli / An original invoice is required for a return invoice', 422, { hint: 'originalInvoiceId' });
      const original = db.prepare('SELECT * FROM customer_invoices WHERE id = ?').get(b.originalInvoiceId);
      if (!original) throw new AppError('Orijinal fatura bulunamadı / Original invoice not found', 404);
      if (original.customer_id !== b.customerId) throw new AppError('Orijinal fatura başka bir müşteriye ait / Original invoice belongs to a different customer', 422);
      if (!['issued', 'paid'].includes(original.status) || original.invoice_type === 'iade') throw new AppError('Bu fatura iade edilemez / Invoice is not eligible for return', 422);
      if (original.currency !== b.currency) throw new AppError('İade para birimi asıl faturayla aynı olmalı / Return currency must match original invoice', 422);
    }

    const date = b.invoiceDate || new Date().toISOString().slice(0, 10);
    const rate = require('../lib/core').fxRate(b.currency, date);
    const due = new Date(date); due.setDate(due.getDate() + (customer.payment_terms_days || 0));

    const defaultVat = Number(require('../lib/core').getSetting('defaultVatRate') || 20);

    // Kalemler: doğrudan verilebilir ya da siparişin sevk edilmiş satırlarından türetilir.
    // Kalem bazlı KDV/iskonto raporlaması için toplam tutar tek başına yeterli değildir.
    const prepared = prepareInvoiceAllocation(b, defaultVat);
    const lines = prepared.lines;

    let subtotal = 0, vatTotal = 0, discountTotal = 0;
    const computed = (lines || []).map((l, i) => {
      const gross = Number(l.qty) * Number(l.unitPrice);
      const discountAmount = Number((gross * (Number(l.discountRate || 0) / 100)).toFixed(2));
      const lineTotal = Number((gross - discountAmount).toFixed(2));
      const vatRate = l.vatRate ?? defaultVat;
      const vatAmount = Number((lineTotal * vatRate / 100).toFixed(2));
      subtotal += lineTotal; vatTotal += vatAmount; discountTotal += discountAmount;
      return { ...l, lineNo: i + 1, discountAmount, lineTotal, vatRate, vatAmount };
    });

    // Kalem yoksa geriye dönük uyumluluk için düz tutar kabul edilir.
    const amount = computed.length ? Number((subtotal + vatTotal).toFixed(2)) : Number(b.amount || 0);
    if (!computed.length && !b.amount) throw new AppError('Fatura tutarı veya kalemleri gerekli / Amount or lines required', 400);
    if (b.invoiceType === 'iade') {
      const original = db.prepare('SELECT amount FROM customer_invoices WHERE id=?').get(b.originalInvoiceId);
      const returned = db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM customer_invoices WHERE original_invoice_id=? AND invoice_type='iade' AND status!='cancelled'").get(b.originalInvoiceId).amount;
      if (returned + amount > original.amount + 1e-9) throw new AppError('İade tutarı kalan fatura tutarını aşıyor / Return exceeds remaining invoice amount', 409);
    }

    const id = uuid();
    const invoiceNo = nextNumber('customer_invoice', 'FAT');
    db.prepare(`INSERT INTO customer_invoices (id,invoice_no,customer_id,so_id,shipment_id,invoice_date,due_date,
        amount,currency,fx_rate,status,invoice_type,original_invoice_id,subtotal,vat_total,discount_total,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'issued',?,?,?,?,?,?)`)
      .run(id, invoiceNo, customer.id, prepared.soId, b.shipmentId || null, date, due.toISOString().slice(0, 10),
           amount, b.currency, rate, b.invoiceType || 'satis', b.originalInvoiceId || null,
           Number(subtotal.toFixed(2)), Number(vatTotal.toFixed(2)), Number(discountTotal.toFixed(2)), Date.now());

    const insLine = db.prepare(`INSERT INTO customer_invoice_lines
      (invoice_id,item_id,item_name,item_code,qty,unit,unit_price,discount_rate,discount_amount,vat_rate,vat_amount,line_total,line_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    computed.forEach(l => insLine.run(id, l.itemId || null, l.itemName, l.itemCode || null,
      l.qty, l.unit || 'adet', l.unitPrice, l.discountRate || 0, l.discountAmount,
      l.vatRate, l.vatAmount, l.lineTotal, l.lineNo));

    saveInvoiceAllocation(id, prepared);
    logAudit(req, 'auditCustomerInvoiceAdd', { entityType: 'customer_invoice', entityId: id,
      newValue: { invoiceNo, amount, currency: b.currency, lineCount: computed.length }, detail: invoiceNo });
    return db.prepare('SELECT * FROM customer_invoices WHERE id = ?').get(id);
  });
  res.status(201).json(result);
});

/** Faturanın kalemleri — yazdırma bunu kullanır. */
router.get('/invoices/:id', (req, res) => {
  const inv = db.prepare(`SELECT ci.*, c.name AS customer_name FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id WHERE ci.id = ?`).get(req.params.id);
  if (!inv) throw new AppError('Fatura bulunamadı / Invoice not found', 404);
  const lines = db.prepare('SELECT * FROM customer_invoice_lines WHERE invoice_id = ? ORDER BY line_no').all(inv.id);
  res.json({
    id: inv.id, invoiceNo: inv.invoice_no, customerId: inv.customer_id, customerName: inv.customer_name,
    invoiceDate: inv.invoice_date, dueDate: inv.due_date, amount: inv.amount, currency: inv.currency,
    fxRate: inv.fx_rate, status: inv.status, invoiceType: inv.invoice_type, originalInvoiceId: inv.original_invoice_id,
    subtotal: inv.subtotal, vatTotal: inv.vat_total, discountTotal: inv.discount_total,
    soId: inv.so_id, shipmentId: inv.shipment_id,
    lines: lines.map(l => ({
      id: l.id, itemId: l.item_id, itemName: l.item_name, itemCode: l.item_code,
      qty: l.qty, unit: l.unit, unitPrice: l.unit_price, discountRate: l.discount_rate,
      discountAmount: l.discount_amount, vatRate: l.vat_rate, vatAmount: l.vat_amount, lineTotal: l.line_total
    }))
  });
});

router.post('/invoices/:id/pay', WRITE, (req, res) => {
  const inv = db.prepare('SELECT * FROM customer_invoices WHERE id = ?').get(req.params.id);
  if (!inv) throw new AppError('Fatura bulunamadı / Invoice not found', 404);
  db.prepare("UPDATE customer_invoices SET status='paid' WHERE id = ?").run(inv.id);
  logAudit(req, 'auditCustomerInvoicePaid', { entityType: 'customer_invoice', entityId: inv.id, detail: inv.invoice_no });
  res.json({ ok: true });
});

/* ============================ PROFITABILITY ============================ */

/**
 * Margin analysis. Revenue is taken from shipped quantities at the order price
 * (converted at the order's locked FX rate); cost is the actual lot cost consumed,
 * so the margin reflects what really left the warehouse — not a standard cost guess.
 */
router.get('/profitability', (req, res) => {
  const { groupBy = 'item', from = '', to = '' } = req.query;
  let dateFilter = '';
  const params = [];
  if (from) { dateFilter += ' AND so.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND so.date <= ?'; params.push(to); }

  const base = `
    SELECT sol.item_id, sol.item_name, so.customer_id, c.name AS customer_name, so.so_no, so.id AS so_id,
           sol.shipped_qty AS qty,
           sol.shipped_qty * sol.price * so.fx_rate AS revenue_base,
           sol.cogs_base AS cost_base
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.so_id
    LEFT JOIN customers c ON c.id = so.customer_id
    WHERE sol.shipped_qty > 0 ${dateFilter}`;

  const rows = db.prepare(base).all(...params);
  const key = groupBy === 'customer' ? 'customer_name' : (groupBy === 'order' ? 'so_no' : 'item_name');
  const grouped = {};
  rows.forEach(r => {
    const k = r[key] || '—';
    if (!grouped[k]) grouped[k] = { key: k, qty: 0, revenueBase: 0, costBase: 0 };
    grouped[k].qty += r.qty;
    grouped[k].revenueBase += r.revenue_base;
    grouped[k].costBase += r.cost_base;
  });
  const data = Object.values(grouped).map(g => ({
    ...g,
    profitBase: g.revenueBase - g.costBase,
    marginPct: g.revenueBase > 0 ? ((g.revenueBase - g.costBase) / g.revenueBase) * 100 : 0
  })).sort((a, b) => b.profitBase - a.profitBase);

  const totals = data.reduce((acc, d) => ({
    revenueBase: acc.revenueBase + d.revenueBase, costBase: acc.costBase + d.costBase, profitBase: acc.profitBase + d.profitBase
  }), { revenueBase: 0, costBase: 0, profitBase: 0 });
  totals.marginPct = totals.revenueBase > 0 ? (totals.profitBase / totals.revenueBase) * 100 : 0;

  res.json({ groupBy, data, totals });
});

module.exports = router;
