// T06 + K-05: legacy supplier invoice reconciliation, approval/payment gate
// and partial payment ledgers. Run via: node test/run-all.js invoice-settlement
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js invoice-settlement');
const db = require('../server/db');

async function call(token, method, route, body) {
  const r = await fetch(process.env.BASE + '/api' + route, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}
let token;
const api = (m, r, b) => call(token, m, r, b);
async function ok(method, route, body) {
  const r = await api(method, route, body);
  assert(r.status >= 200 && r.status < 300, `${method} ${route}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function login(username, password) {
  return (await call(null, 'POST', '/auth/login', { username, password })).data.token;
}

async function receivedOrder(qty = 10, price = 10) {
  const supplier = db.prepare('SELECT id FROM suppliers WHERE is_approved=1 LIMIT 1').get().id;
  const warehouse = db.prepare('SELECT id FROM warehouses LIMIT 1').get().id;
  const item = db.prepare("SELECT id FROM items WHERE is_active=1 AND vat_rate IS NOT NULL LIMIT 1").get().id;
  const order = await ok('POST', '/purchasing/orders', { supplierId: supplier, warehouseId: warehouse,
    items: [{ itemId: item, qty, price }] });
  const po = await ok('GET', '/purchasing/orders/' + order.id);
  const receipt = await ok('POST', `/purchasing/orders/${order.id}/receipts`,
    { lines: [{ poItemId: po.items[0].id, qty }] });
  const lineId = db.prepare('SELECT id FROM po_receipt_lines WHERE receipt_id=?').get(receipt.receiptId).id;
  return { order, receipt, lineId, item };
}

async function receiptReversalSide() {
  const clean = await receivedOrder(4, 7);
  const receiptId = clean.receipt.receiptId;
  const lotBefore = db.prepare('SELECT * FROM stock_lots WHERE source_id=?').get(receiptId);
  assert.equal(lotBefore.qty, 4);
  const operator = await login('operator', 'Operator123!');
  assert.equal((await call(operator, 'POST', `/purchasing/receipts/${receiptId}/reverse`, {
    reason: 'Yetkisiz ters kayıt denemesi', requestKey: 'receipt-denied-01'
  })).status, 403);
  const reversed = await ok('POST', `/purchasing/receipts/${receiptId}/reverse`, {
    reason: 'Yanlış teslimat siparişe işlendi', requestKey: 'receipt-rev-0001'
  });
  assert.equal(reversed.poStatus, 'approved');
  const replay = await ok('POST', `/purchasing/receipts/${receiptId}/reverse`, {
    reason: 'Yanlış teslimat siparişe işlendi', requestKey: 'receipt-rev-0001'
  });
  assert.equal(replay.alreadyReversed, true);
  assert.equal(db.prepare('SELECT qty,status FROM stock_lots WHERE id=?').get(lotBefore.id).qty, 0);
  assert.equal(db.prepare('SELECT received_qty FROM po_items WHERE po_id=?').get(clean.order.id).received_qty, 0);
  assert.equal(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(clean.order.id).status, 'approved');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action_key='auditPOReceiptReversed' AND entity_id=?").get(receiptId).c, 1);
  assert.equal((await api('POST', `/purchasing/receipts/${receiptId}/landed-costs`, { costType: 'freight', amount: 1 })).status, 409);
  assert.equal((await api('POST', '/purchasing/invoices', {
    invoiceNo: 'REVERSED-RCPT-1', poId: clean.order.id, receiptId, amount: 28
  })).status, 422);
  const available = await ok('GET', `/purchasing/invoices/receivable-lines?poId=${clean.order.id}`);
  assert.equal(available.lines.length, 0);

  const changed = await receivedOrder(2, 5);
  const changedLot = db.prepare('SELECT id FROM stock_lots WHERE source_id=?').get(changed.receipt.receiptId);
  db.prepare('UPDATE stock_lots SET qty=1 WHERE id=?').run(changedLot.id);
  assert.equal((await api('POST', `/purchasing/receipts/${changed.receipt.receiptId}/reverse`, {
    reason: 'Stok değişmiş teslimat', requestKey: 'receipt-rev-0002'
  })).status, 409);

  const invoiced = await receivedOrder(3, 6);
  await ok('POST', '/purchasing/invoices', { invoiceNo: 'RECEIPT-BLOCK-1', poId: invoiced.order.id, amount: 18 });
  assert.equal((await api('POST', `/purchasing/receipts/${invoiced.receipt.receiptId}/reverse`, {
    reason: 'Faturalanmış teslimat', requestKey: 'receipt-rev-0003'
  })).status, 409);
  console.log('✓ goods receipt reversal: authorization, idempotency, inventory rollback, dependent-record guards');
}

async function customerSide() {
  const customer = await ok('POST', '/sales/customers', { name: 'Settlement customer', creditLimit: 0 });
  const inv = await ok('POST', '/sales/invoices', { customerId: customer.id, amount: 100 });
  assert.equal((await api('POST', `/sales/invoices/${inv.id}/payments`, { amount: -5 })).status, 422);
  assert.equal((await api('POST', `/sales/invoices/${inv.id}/payments`, { amount: 5, paidOn: '2026-02-30' })).status, 422);
  assert.equal((await api('POST', `/sales/invoices/${inv.id}/payments`, { amount: '5' })).status, 422);
  assert.equal((await api('POST', `/sales/invoices/missing/payments`, { amount: 5 })).status, 404);

  const first = await ok('POST', `/sales/invoices/${inv.id}/payments`, { amount: 30, requestKey: 'pay-key-0001' });
  assert.equal(first.openAmount, 70);
  assert.equal(first.status, 'issued');
  const replay = await ok('POST', `/sales/invoices/${inv.id}/payments`, { amount: 30, requestKey: 'pay-key-0001' });
  assert.equal(replay.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM customer_invoice_payments WHERE invoice_id=?').get(inv.id).c, 1);
  assert.equal((await ok('GET', '/sales/customers/' + customer.id)).openBalanceBase, 70);

  const over = await api('POST', `/sales/invoices/${inv.id}/payments`, { amount: 70.01 });
  assert.equal(over.status, 409);
  assert.equal(over.data.outstanding, 70);

  // Concurrent collections can never exceed the open amount.
  const racers = await Promise.all([1, 2, 3, 4].map(() => api('POST', `/sales/invoices/${inv.id}/payments`, { amount: 30 })));
  assert.equal(racers.filter(r => r.status === 201).length, 2);
  assert(racers.filter(r => r.status !== 201).every(r => r.status === 409));
  assert.equal(db.prepare('SELECT SUM(amount) s FROM customer_invoice_payments WHERE invoice_id=?').get(inv.id).s, 90);

  const credit = await ok('POST', '/sales/invoices', { customerId: customer.id, amount: 10, invoiceType: 'iade', originalInvoiceId: inv.id });
  assert.equal(db.prepare('SELECT status FROM customer_invoices WHERE id=?').get(inv.id).status, 'paid');
  assert.equal((await ok('GET', '/sales/customers/' + customer.id)).openBalanceBase, 0);
  assert.equal((await api('POST', `/sales/invoices/${credit.id}/payments`, { amount: 1 })).status, 409);
  assert.equal((await ok('POST', `/sales/invoices/${inv.id}/pay`)).alreadyPaid, true);
  const detail = await ok('GET', '/sales/invoices/' + inv.id);
  assert.equal(detail.payments.length, 3);
  assert.equal(detail.openAmount, 0);
  assert.equal(detail.creditAmount, 10);

  // Database guard: even a direct insert cannot overpay.
  const other = await ok('POST', '/sales/invoices', { customerId: customer.id, amount: 50 });
  assert.throws(() => db.prepare(`INSERT INTO customer_invoice_payments (id,invoice_id,amount,paid_on,created_at)
    VALUES ('x-over',?,60,'2026-01-01',?)`).run(other.id, Date.now()), /Payment exceeds open amount/);
  // One-click full settlement still works and records a ledger row.
  const full = await ok('POST', `/sales/invoices/${other.id}/pay`);
  assert.equal(full.status, 'paid');
  assert.equal(full.paidAmount, 50);
  const fullPaymentId = db.prepare('SELECT id FROM customer_invoice_payments WHERE invoice_id=?').get(other.id).id;
  const operator = await login('operator', 'Operator123!');
  assert.equal((await call(operator, 'POST', `/sales/invoices/${other.id}/payments/${fullPaymentId}/reverse`,
    { reason: 'Yetkisiz ters kayıt', requestKey: 'cust-rev-denied' })).status, 403);
  const reversed = await ok('POST', `/sales/invoices/${other.id}/payments/${fullPaymentId}/reverse`,
    { reason: 'Banka hareketi yanlış faturaya işlendi', reversedOn: '2026-01-11', requestKey: 'cust-rev-0001' });
  assert.equal(reversed.status, 'issued'); assert.equal(reversed.openAmount, 50);
  const reversedReplay = await ok('POST', `/sales/invoices/${other.id}/payments/${fullPaymentId}/reverse`,
    { reason: 'Banka hareketi yanlış faturaya işlendi', reversedOn: '2026-01-11', requestKey: 'cust-rev-0001' });
  assert.equal(reversedReplay.duplicate, true);
  const paymentList = await ok('GET', `/sales/invoices/${other.id}/payments`);
  assert.equal(paymentList.payments[0].reversed, true);
  assert.throws(() => db.prepare('UPDATE customer_invoice_payment_reversals SET reason=? WHERE payment_id=?')
    .run('değiştir', fullPaymentId), /Payment reversals are immutable/);
  // A pre-ledger 'paid' invoice (no rows) stays fully paid; a later credit is owed back.
  const legacy = await ok('POST', '/sales/invoices', { customerId: customer.id, amount: 40 });
  db.prepare("UPDATE customer_invoices SET status='paid', paid_legacy=1 WHERE id=?").run(legacy.id);
  await ok('POST', '/sales/invoices', { customerId: customer.id, amount: 15, invoiceType: 'iade', originalInvoiceId: legacy.id });
  assert.equal((await ok('GET', '/sales/customers/' + customer.id)).openBalanceBase, -15);
  console.log('✓ K-05 customer: partial/duplicate/concurrent payments, credit settlement, DB overpay guard, legacy paid');
}

async function supplierSide() {
  const operator = await login('operator', 'Operator123!');

  // New invoice: VAT snapshot, approval gate, partial payment.
  const fresh = await receivedOrder(10, 10);
  const inv = await ok('POST', '/purchasing/invoices', { invoiceNo: 'SET-NEW-1', poId: fresh.order.id, amount: 100 });
  const vatRate = db.prepare('SELECT vat_rate FROM items WHERE id=?').get(fresh.item).vat_rate;
  assert.equal(db.prepare('SELECT vat_amount FROM supplier_invoices WHERE id=?').get(inv.id).vat_amount, 100 * vatRate / 100);
  assert.equal((await api('POST', `/purchasing/invoices/${inv.id}/payments`, { amount: 1 })).status, 409, 'unapproved invoice cannot be paid');
  assert.equal((await call(operator, 'POST', `/purchasing/invoices/${inv.id}/approve`, {})).status, 403);
  const approved = await ok('POST', `/purchasing/invoices/${inv.id}/approve`, {});
  assert.equal(approved.matchStatus, 'approved');
  assert.equal((await ok('POST', `/purchasing/invoices/${inv.id}/approve`, {})).alreadyApproved, true);
  const gross = approved.grossAmount;
  const part = await ok('POST', `/purchasing/invoices/${inv.id}/payments`, { amount: 50, paidOn: '2026-01-10', method: 'bank', requestKey: 'sup-key-0001' });
  assert.equal(part.status, 'approved');
  assert.equal((await ok('POST', `/purchasing/invoices/${inv.id}/payments`, { amount: 50, requestKey: 'sup-key-0001' })).duplicate, true);
  assert.equal((await api('POST', `/purchasing/invoices/${inv.id}/payments`, { amount: gross })).status, 409);
  const rest = await ok('POST', `/purchasing/invoices/${inv.id}/payments`, {});
  assert.equal(rest.status, 'paid');
  assert.equal(rest.openAmount, 0);
  assert.equal((await api('POST', `/purchasing/invoices/${inv.id}/payments`, { amount: 1 })).data.alreadyPaid, true);
  const reversed = await ok('POST', `/purchasing/invoices/${inv.id}/payments/${part.paymentId}/reverse`,
    { reason: 'Ödeme yanlış banka hesabına işlendi', reversedOn: '2026-01-11', requestKey: 'sup-rev-0001' });
  assert.equal(reversed.status, 'approved'); assert.equal(reversed.openAmount, 50);
  assert.equal((await ok('POST', `/purchasing/invoices/${inv.id}/payments/${part.paymentId}/reverse`,
    { reason: 'Ödeme yanlış banka hesabına işlendi', requestKey: 'sup-rev-0001' })).duplicate, true);
  const replacement = await ok('POST', `/purchasing/invoices/${inv.id}/payments`,
    { amount: 50, paidOn: '2026-01-12', method: 'bank', requestKey: 'sup-key-replace' });
  assert.equal(replacement.status, 'paid');
  // Discrepancy needs an explicit approval note.
  const diffOrder = await receivedOrder(5, 10);
  const diffInv = await ok('POST', '/purchasing/invoices', { invoiceNo: 'SET-DIFF-1', poId: diffOrder.order.id, amount: 80 });
  assert.equal(diffInv.matchStatus, 'discrepancy');
  assert.equal((await api('POST', `/purchasing/invoices/${diffInv.id}/approve`, {})).status, 422);
  assert.equal((await ok('POST', `/purchasing/invoices/${diffInv.id}/approve`, { note: 'Fiyat farkı tedarikçiyle onaylandı' })).matchStatus, 'approved');
  console.log('✓ T06 new invoices: VAT snapshot, approval gate, role check, partial/idempotent supplier payments');

  // Legacy invoice: simulate a pre-023 row (no allocations, VAT unknown).
  const old = await receivedOrder(10, 10);
  const legacy = await ok('POST', '/purchasing/invoices', { invoiceNo: 'SET-LEG-1', poId: old.order.id, amount: 60 });
  db.prepare('DELETE FROM supplier_invoice_allocations WHERE invoice_id=?').run(legacy.id);
  db.prepare("UPDATE supplier_invoices SET allocation_state='legacy', vat_amount=NULL, match_status='matched' WHERE id=?").run(legacy.id);
  assert.equal((await api('POST', `/purchasing/invoices/${legacy.id}/approve`, { vatAmount: 12 })).status, 409);
  assert.equal((await api('POST', `/purchasing/invoices/${legacy.id}/payments`, { amount: 1 })).status, 409);
  assert.throws(() => db.prepare("UPDATE supplier_invoices SET match_status='approved', vat_amount=1 WHERE id=?").run(legacy.id),
    /Legacy invoice requires reconciliation/);
  assert.equal((await api('POST', '/purchasing/invoices', { invoiceNo: 'SET-LEG-2', poId: old.order.id, amount: 1 })).status, 409,
    'new billing on the PO waits for reconciliation');

  const other = await receivedOrder(3, 10);
  const recon = `/purchasing/invoices/${legacy.id}/reconcile`;
  assert.equal((await call(operator, 'POST', recon, { lines: [], note: 'yetkisiz deneme' })).status, 403);
  assert.equal((await api('POST', recon, { lines: [{ receiptLineId: old.lineId, qty: 6 }] })).status, 422, 'note required');
  assert.equal((await api('POST', recon, { lines: [{ receiptLineId: old.lineId, qty: 11 }], note: 'fazla miktar' })).status, 409);
  assert.equal((await api('POST', recon, { lines: [{ receiptLineId: other.lineId, qty: 1 }], note: 'başka sipariş' })).status, 422);
  assert.equal((await api('POST', recon, { lines: [{ receiptLineId: old.lineId, qty: 1 }, { receiptLineId: old.lineId, qty: 1 }],
    note: 'tekrar satır' })).status, 422);
  assert.equal(db.prepare('SELECT allocation_state FROM supplier_invoices WHERE id=?').get(legacy.id).allocation_state, 'legacy',
    'rejected attempts leave no partial state');

  const body = { lines: [{ receiptLineId: old.lineId, qty: 6, vatRate: 10 }], note: 'Eski fatura 6 adet teslimi kapsıyor' };
  const racers = await Promise.all([api('POST', recon, body), api('POST', recon, body)]);
  assert.deepEqual(racers.map(r => r.status).sort(), [200, 409], 'exactly one concurrent reconciliation wins');
  const done = racers.find(r => r.status === 200).data;
  assert.equal(done.allocationState, 'recorded');
  assert.equal(done.matchStatus, 'matched');
  assert.equal(done.vatAmount, 6);
  const alloc = db.prepare('SELECT qty, unit_price, fx_rate, vat_rate FROM supplier_invoice_allocations WHERE invoice_id=?').all(legacy.id);
  assert.deepEqual(alloc, [{ qty: 6, unit_price: 10, fx_rate: 1, vat_rate: 10 }]);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action_key='auditSupplierInvoiceReconciled' AND entity_id=?").get(legacy.id).c, 1);

  // Later item/PO edits do not change the reconciled snapshot or the journal.
  db.prepare('UPDATE items SET vat_rate=1 WHERE id=?').run(old.item);
  db.prepare('UPDATE po_items SET price=999 WHERE po_id=?').run(old.order.id);
  const date = db.prepare('SELECT invoice_date FROM supplier_invoices WHERE id=?').get(legacy.id).invoice_date;
  const journal = await ok('GET', `/accounting/export?from=${date}&to=${date}`);
  const rows = journal.rows.filter(row => row.sourceId === legacy.id);
  assert.equal(rows.find(row => row.accountCode === '191').debit, 6);
  assert.equal(rows.find(row => row.accountCode === '320').credit, 66);
  assert.equal(db.prepare('SELECT unit_price FROM supplier_invoice_allocations WHERE invoice_id=?').get(legacy.id).unit_price, 10);

  // Remaining 4 units can now be billed; the reconciled invoice pays normally.
  const next = await ok('POST', '/purchasing/invoices', { invoiceNo: 'SET-LEG-3', poId: old.order.id, amount: 40 });
  assert.deepEqual(next.allocations.map(a => a.qty), [4]);
  await ok('POST', `/purchasing/invoices/${legacy.id}/approve`, {});
  assert.equal((await ok('POST', `/purchasing/invoices/${legacy.id}/payments`, {})).status, 'paid');

  // A legacy invoice for services (no receipts) needs an explicit VAT amount.
  const svc = await ok('POST', '/purchasing/invoices', { invoiceNo: 'SET-SVC-1', poId: other.order.id, amount: 30 });
  db.prepare('DELETE FROM supplier_invoice_allocations WHERE invoice_id=?').run(svc.id);
  db.prepare("UPDATE supplier_invoices SET allocation_state='legacy', vat_amount=NULL WHERE id=?").run(svc.id);
  assert.equal((await api('POST', `/purchasing/invoices/${svc.id}/reconcile`, { lines: [], note: 'Nakliye hizmeti' })).status, 422);
  const svcDone = await ok('POST', `/purchasing/invoices/${svc.id}/reconcile`, { lines: [], vatAmount: 6, note: 'Nakliye hizmeti' });
  assert.equal(svcDone.allocationState, 'none');
  assert.equal(svcDone.matchStatus, 'discrepancy');
  assert.equal((await api('POST', `/purchasing/invoices/${svc.id}/reconcile`, { lines: [], vatAmount: 6, note: 'ikinci kez' })).status, 409);

  const list = await ok('GET', '/purchasing/invoices?allocationState=legacy');
  assert.equal(list.total, 0);
  const page2 = await ok('GET', '/purchasing/invoices?page=2&pageSize=2');
  assert.equal(page2.page, 2);
  assert.equal(page2.data.length, 2);
  console.log('✓ T06 legacy: payment blocked, validated single reconciliation, snapshot/journal stability, billing unblocked');
}

(async () => {
  token = await login('admin', 'Admin123!');
  await receiptReversalSide();
  await customerSide();
  await supplierSide();
  console.log('invoice-settlement: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
