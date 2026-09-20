const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js finance-integrity');
const db = require('../server/db');
let token;
async function api(method, route, body) {
  const r = await fetch(process.env.BASE + '/api' + route, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
async function success(method, route, body) {
  const r = await api(method, route, body);
  assert(r.status >= 200 && r.status < 300, `${route}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function main() {
  token = (await success('POST', '/auth/login', { username: 'admin', password: 'Admin123!' })).token;
  const customer = await success('POST', '/sales/customers', { name: 'Return test', creditLimit: 200 });
  assert.equal((await api('POST', '/sales/orders', { customerId: customer.id,
    lines: [{ itemId: 'missing-item', qty: 1, price: 1 }] })).status, 404);
  assert.equal((await api('POST', '/sales/orders', { customerId: customer.id, date: '2026-02-30',
    lines: [{ itemId: 'unused', qty: 1, price: 1 }] })).status, 422);
  assert.equal((await api('POST', '/sales/shipments', { destination: 'Date check', date: '2026-13-01', items: [] })).status, 422);
  assert.equal((await api('POST', '/sales/invoices', { customerId: customer.id, invoiceDate: 'abc', amount: 1 })).status, 422);
  const original = await success('POST', '/sales/invoices', { customerId: customer.id, amount: 100 });
  const credit = await success('POST', '/sales/invoices', { customerId: customer.id, amount: 40, invoiceType: 'iade', originalInvoiceId: original.id });
  assert.equal((await success('GET', '/sales/customers/' + customer.id)).openBalanceBase, 60);
  const item = db.prepare('SELECT id FROM items LIMIT 1').get().id;
  await success('POST', '/sales/orders', { customerId: customer.id, lines: [{ itemId: item, qty: 1, price: 140 }] });
  assert.equal((await api('POST', '/sales/orders', { customerId: customer.id, lines: [{ itemId: item, qty: 1, price: 141 }] })).status, 400);
  const overReturn = { customerId: customer.id, amount: 61, invoiceType: 'iade', originalInvoiceId: original.id };
  assert.equal((await api('POST', '/sales/invoices', overReturn)).status, 409);
  assert.equal((await api('POST', '/sales/invoices', { ...overReturn, amount: 1, originalInvoiceId: credit.id })).status, 422);
  assert.equal((await api('POST', '/sales/invoices', { ...overReturn, amount: 1, currency: 'USD' })).status, 422);
  const journal = await success('GET', `/accounting/export?from=${original.invoice_date}&to=${original.invoice_date}`);
  const rows = journal.rows.filter(row => row.sourceId === credit.id);
  assert.equal(rows.find(row => row.accountCode === '120').credit, 40);
  assert.equal(rows.find(row => row.accountCode === '600').debit, 40);
  assert.equal(rows.reduce((sum, row) => sum + row.debit - row.credit, 0), 0);
  console.log('✓ F12/F22: return reduces receivables and reverses balanced journal; over-return blocked');
  assert.equal((await api('POST', `/sales/invoices/${credit.id}/pay`)).status, 409);
  assert.equal((await success('GET', '/sales/customers/' + customer.id)).openBalanceBase, 60);
  assert.equal((await success('POST', `/sales/invoices/${original.id}/pay`)).ok, true);
  assert.equal((await success('POST', `/sales/invoices/${original.id}/pay`)).alreadyPaid, true);
  assert.equal(db.prepare('SELECT status FROM customer_invoices WHERE id=?').get(original.id).status, 'paid');
  assert.equal(db.prepare('SELECT status FROM customer_invoices WHERE id=?').get(credit.id).status, 'issued');
  const taxOriginal = await success('POST', '/sales/invoices', { customerId: customer.id,
    lines: [{ itemName: 'Tax test', qty: 1, unitPrice: 100, vatRate: 20 }] });
  const taxReturn = await success('POST', '/sales/invoices', { customerId: customer.id, invoiceType: 'iade', originalInvoiceId: taxOriginal.id,
    lines: [{ itemName: 'Tax test return', qty: 1, unitPrice: 50, vatRate: 20 }] });
  const taxJournal = await success('GET', `/accounting/export?from=${original.invoice_date}&to=${original.invoice_date}`);
  const taxRows = taxJournal.rows.filter(row => row.sourceId === taxReturn.id);
  assert.equal(taxRows.find(row => row.accountCode === '120').credit, 60);
  assert.equal(taxRows.find(row => row.accountCode === '391').debit, 10);
  assert.equal(taxRows.find(row => row.accountCode === '600').debit, 50);
  const { fxRate } = require('../server/lib/core');
  assert.throws(() => fxRate('USD', '1900-01-01'), /kur bulunamadı/);
  assert.throws(() => fxRate('UNKNOWN'), /kur bulunamadı/);
  assert.equal(fxRate('TRY', '1900-01-01'), 1);
  assert.equal((await api('POST', '/sales/invoices', { customerId: customer.id, amount: 10, currency: 'USD', invoiceDate: '1900-01-01' })).status, 422);
  console.log('✓ F15: missing historical or unknown FX never silently becomes latest rate or 1');
  const supplier = db.prepare('SELECT id FROM suppliers WHERE is_approved=1 LIMIT 1').get().id;
  const warehouse = db.prepare('SELECT id FROM warehouses LIMIT 1').get().id;
  const poBody = { supplierId: supplier, warehouseId: warehouse,
    items: [{ itemId: item, qty: 1, price: 1 }] };
  assert.equal((await api('POST', '/purchasing/orders', { ...poBody,
    items: [{ itemId: 'missing-item', qty: 1, price: 1 }] })).status, 404);
  assert.equal((await api('POST', '/purchasing/orders', { ...poBody, warehouseId: 999999 })).status, 404);
  assert.equal((await api('POST', '/purchasing/orders', { ...poBody,
    items: [{ itemId: item, qty: 1, price: '' }] })).status, 422);
  assert.equal((await api('POST', '/purchasing/orders', { ...poBody, date: '2026-02-30' })).status, 422);
  const datedRate = db.prepare('INSERT INTO exchange_rates(currency,rate,rate_date,created_at) VALUES (?,?,?,?)');
  datedRate.run('USD', 30, '2001-01-01', Date.now());
  datedRate.run('EUR', 40, '2001-01-01', Date.now());
  const order = await success('POST', '/purchasing/orders', { supplierId: supplier, warehouseId: warehouse,
    date: '2001-01-01', currency: 'USD', items: [
      { itemId: item, qty: 2, price: 1, currency: 'USD' },
      { itemId: item, qty: 2, price: 1, currency: 'EUR' }
    ] });
  const po = await success('GET', '/purchasing/orders/' + order.id);
  assert.deepEqual(po.items.map(l => l.fxRate), [30, 40]);
  assert.equal((await api('POST', `/purchasing/orders/${order.id}/receipts`,
    { lines: [{ poItemId: po.items[0].id, qty: 1, expiryDate: '2026-02-30' }] })).status, 422);
  db.prepare("UPDATE exchange_rates SET rate=99 WHERE rate_date='2001-01-01'").run();
  const first = await success('POST', `/purchasing/orders/${order.id}/receipts`,
    { lines: po.items.map(l => ({ poItemId: l.id, qty: 1 })) });
  assert.equal((await api('POST', `/purchasing/orders/${order.id}/reject`, { reason: 'late' })).status, 409);
  assert.equal(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(order.id).status, 'partially_received');
  const costs = receiptId => db.prepare(`SELECT sl.unit_cost FROM po_receipt_lines rl
    JOIN stock_lots sl ON sl.id=rl.lot_id WHERE rl.receipt_id=? ORDER BY rl.id`).all(receiptId).map(r => r.unit_cost);
  assert.deepEqual(costs(first.receiptId), [30, 40]);
  const matchedReceipt = await success('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-MIX-1', poId: order.id, receiptId: first.receiptId,
    invoiceDate: '2001-01-01', amount: 70, currency: 'TRY'
  });
  assert.equal(matchedReceipt.receivedBase, 70);
  assert.equal(matchedReceipt.matchStatus, 'matched');
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-MIX-1', poId: order.id, amount: 70, currency: 'TRY'
  })).status, 409);
  const otherPo = db.prepare('SELECT id FROM purchase_orders WHERE id<>? LIMIT 1').get(order.id).id;
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-WRONG-RECEIPT', poId: otherPo, receiptId: first.receiptId,
    amount: 70, currency: 'TRY'
  })).status, 422);
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-BAD-DATE', poId: order.id, invoiceDate: '2026-02-31', amount: 70
  })).status, 422);
  const second = await success('POST', `/purchasing/orders/${order.id}/receipts`,
    { lines: po.items.map(l => ({ poItemId: l.id, qty: 1 })) });
  assert.deepEqual(costs(second.receiptId), [30, 40]);
  assert.equal((await success('GET', '/purchasing/orders/' + order.id)).totalBase, 140);
  const secondLines = db.prepare('SELECT id FROM po_receipt_lines WHERE receipt_id=? ORDER BY id').all(second.receiptId);
  const partial = await success('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-PART-1', poId: order.id, receiptId: second.receiptId,
    invoiceDate: '2001-01-01', amount: 12, currency: 'TRY',
    lines: [{ receiptLineId: secondLines[0].id, qty: 0.4, vatRate: 18 }]
  });
  assert.equal(partial.matchStatus, 'matched');
  assert.equal(partial.receivedBase, 12);
  assert.equal(db.prepare('SELECT qty FROM supplier_invoice_allocations WHERE invoice_id=?').get(partial.id).qty, 0.4);
  const receivable = await success('GET', `/purchasing/invoices/receivable-lines?poId=${order.id}`);
  assert.equal(receivable.lines.find(line => line.receiptLineId === secondLines[0].id).availableQty, 0.6);
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-PART-OVER', poId: order.id, receiptId: second.receiptId, amount: 21,
    lines: [{ receiptLineId: secondLines[0].id, qty: 0.7 }]
  })).status, 409);
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-PART-WRONG', poId: otherPo, amount: 1,
    lines: [{ receiptLineId: secondLines[0].id, qty: 0.1 }]
  })).status, 422);
  const remainder = await success('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-PART-2', poId: order.id, receiptId: second.receiptId,
    invoiceDate: '2001-01-01', amount: 58, currency: 'TRY'
  });
  assert.equal(remainder.receivedBase, 58);
  assert.equal(remainder.matchStatus, 'matched');
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'FX-PART-REPEAT', poId: order.id, receiptId: second.receiptId, amount: 58
  })).status, 409);
  db.prepare('UPDATE items SET vat_rate=8 WHERE id=?').run(item);
  const purchaseJournal = await success('GET', '/accounting/export?from=2001-01-01&to=2001-01-01');
  assert.equal(purchaseJournal.rows.find(row => row.sourceId === partial.id && row.accountCode === '191').debit, 2.16);
  assert.throws(() => db.prepare(`INSERT INTO supplier_invoice_allocations
    (invoice_id,receipt_line_id,qty,unit_price,currency,fx_rate,vat_rate) VALUES (?,?,?,?,?,?,?)`)
    .run(remainder.id, secondLines[0].id, 0.7, 1, 'USD', 30, 20), /Receipt quantity already invoiced/);
  console.log('✓ F20: mixed-currency and partial receipts retain order-date FX after rate edits');
  const addCost = body => api('POST', `/purchasing/receipts/${first.receiptId}/landed-costs`, body);
  assert.equal((await addCost({ costType: 'freight', amount: 14, allocationMethod: 'qty' })).status, 201);
  assert.deepEqual(costs(first.receiptId), [37, 47]);
  assert.equal((await addCost({ costType: 'customs', amount: 14, allocationMethod: 'value' })).status, 201);
  assert.deepEqual(costs(first.receiptId), [43, 55]);
  assert.equal(require('../server/services/costing').applyLandedCosts(first.receiptId).allocated, 0);
  assert.deepEqual(costs(first.receiptId), [43, 55]);
  const parent = db.prepare('SELECT lot_id FROM po_receipt_lines WHERE receipt_id=? ORDER BY id LIMIT 1').get(first.receiptId).lot_id;
  const splitId = db.txImmediate(() => require('../server/services/stock').changeLotStatus({ lotId: parent, toStatus: 'blocked', qty: 0.4,
    userId: null, note: 'Cost allocation test', refId: null, refType: null }));
  assert.equal((await addCost({ costType: 'insurance', amount: 14, allocationMethod: 'qty' })).status, 201);
  assert.equal(db.prepare('SELECT unit_cost FROM stock_lots WHERE id=?').get(splitId).unit_cost, 50);
  assert.deepEqual(costs(first.receiptId), [50, 62]);
  const allocated = db.prepare(`SELECT SUM(a.amount_base) v FROM landed_cost_allocations a
    JOIN landed_costs c ON c.id=a.cost_id WHERE c.receipt_id=?`).get(first.receiptId).v;
  assert.equal(allocated, 42);
  db.prepare('UPDATE stock_lots SET qty=qty-0.1 WHERE id=?').run(splitId);
  const countBefore = db.prepare('SELECT COUNT(*) n FROM landed_costs').get().n;
  assert.equal((await addCost({ costType: 'other', amount: 14 })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM landed_costs').get().n, countBefore);
  console.log('✓ F07: costs apply once using original weights, follow splits, and reject consumed-stock mutation atomically');
  const buyer = await success('POST', '/sales/customers', { name: 'Partial billing buyer' });
  const goods = await success('POST', '/items', { name: 'Billing goods', openingQty: 10, openingUnitCost: 1 });
  const sale = await success('POST', '/sales/orders', { customerId: buyer.id,
    lines: [{ itemId: goods.id, qty: 10, price: 2 }] });
  const ship = qty => success('POST', '/sales/shipments', { soId: sale.id, destination: 'Test',
    items: [{ itemId: goods.id, qty }] });
  const firstShip = await ship(4);
  const bill = { customerId: buyer.id, soId: sale.id };
  const preview = await success('GET', `/sales/orders/${sale.id}/invoice-preview`);
  assert.equal(preview.lines.reduce((sum, l) => sum + l.qty, 0), 4);
  const one = await success('POST', '/sales/invoices', bill);
  assert.equal(one.amount, preview.amount);
  assert.equal(db.prepare('SELECT SUM(qty) q FROM customer_invoice_lines WHERE invoice_id=?').get(one.id).q, 4);
  assert.equal((await api('POST', '/sales/invoices', bill)).status, 409);
  assert.equal((await api('POST', '/sales/invoices', { customerId: buyer.id, shipmentId: firstShip.id,
    lines: [{ itemId: goods.id, itemName: 'Billing goods', qty: 1, unitPrice: 2 }] })).status, 409);
  assert.equal((await success('GET', '/sales/orders/' + sale.id)).status, 'partially_shipped');
  await ship(6);
  const concurrent = await Promise.all([api('POST', '/sales/invoices', bill), api('POST', '/sales/invoices', bill)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  assert.equal(db.prepare(`SELECT SUM(a.qty) q FROM invoice_shipment_allocations a
    JOIN customer_invoices ci ON ci.id=a.invoice_id WHERE ci.so_id=?`).get(sale.id).q, 10);
  assert.equal((await success('GET', '/sales/orders/' + sale.id)).status, 'invoiced');
  assert.equal((await api('POST', '/sales/invoices', { ...bill, customerId: customer.id })).status, 422);
  const manualGoods = await success('POST', '/items', { name: 'Manual allocation', openingQty: 5 });
  const manualOrder = await success('POST', '/sales/orders', { customerId: buyer.id,
    lines: [{ itemId: manualGoods.id, qty: 5, price: 3 }] });
  const manualShipment = await success('POST', '/sales/shipments', { soId: manualOrder.id, destination: 'Test',
    items: [{ itemId: manualGoods.id, qty: 5 }] });
  const manual = { customerId: buyer.id, shipmentId: manualShipment.id,
    lines: [{ itemId: manualGoods.id, itemName: 'Manual allocation', qty: 2, unitPrice: 3 }] };
  await success('POST', '/sales/invoices', manual);
  assert.equal((await api('POST', '/sales/invoices', { ...manual,
    lines: [{ ...manual.lines[0], qty: 4 }] })).status, 409);
  const rest = await success('POST', '/sales/invoices', { customerId: buyer.id, soId: manualOrder.id });
  assert.equal(db.prepare('SELECT SUM(qty) q FROM customer_invoice_lines WHERE invoice_id=?').get(rest.id).q, 3);
  console.log('✓ F24: partial billing preserves shipping; cross-source and concurrent duplicate invoices blocked');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.close());
