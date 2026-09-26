// Pilot rehearsal (item 9): one realistic business chain with separate roles,
// numbers reconciled end to end, then a full backup restored into an EMPTY
// location and checked again. This is not the customer pilot itself — that
// needs the customer's own records and people — but it is the same script
// the pilot follows (docs/PILOT-KABUL-PLANI.md).
// Run via: node test/run-all.js pilot-flow
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js pilot-flow');
const db = require('../server/db');
const { toLocalDateStr } = require('../server/lib/dates');

async function call(token, method, route, body) {
  const r = await fetch(process.env.BASE + '/api' + route, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}
async function ok(token, method, route, body) {
  const r = await call(token, method, route, body);
  assert(r.status >= 200 && r.status < 300, `${method} ${route}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const login = async (u, p) => (await call(null, 'POST', '/auth/login', { username: u, password: p })).data.token;
const lotQty = (itemId, status) => db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id=? AND status=?`).get(itemId, status).q;

(async () => {
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const quality = await login('kalite', 'Kalite123!');
  const viewer = await login('viewer', 'Viewer123!');
  const today = toLocalDateStr();
  const warehouse = db.prepare('SELECT id FROM warehouses WHERE is_active=1 ORDER BY id LIMIT 1').get().id;

  // Master data (manager/admin)
  const supplier = await ok(manager, 'POST', '/purchasing/suppliers', { name: 'Pilot Hammadde A.Ş.', paymentTermsDays: 30 });
  const raw = await ok(operator, 'POST', '/items', { name: 'Pilot Granül', unit: 'kg', itemType: 'raw', warehouseId: warehouse,
    requiresIncomingInspection: true, defaultSupplierId: supplier.id });
  const fin = await ok(operator, 'POST', '/items', { name: 'Pilot Kasa', unit: 'adet', itemType: 'finished', procurementType: 'make',
    warehouseId: warehouse, salePrice: 100, bom: [{ componentItemId: raw.id, qtyPerUnit: 2 }] });
  const customer = await ok(admin, 'POST', '/sales/customers', { name: 'Pilot Müşteri Ltd.', creditLimit: 100000 });
  assert.equal((await call(viewer, 'POST', '/items', { name: 'Görüntüleyici denemesi' })).status, 403);

  // Purchase → receipt (quarantine) → incoming inspection (quality, signed) → return rejected part
  const po = await ok(operator, 'POST', '/purchasing/orders', { supplierId: supplier.id, warehouseId: warehouse,
    items: [{ itemId: raw.id, qty: 100, price: 10 }] });
  if (po.status !== 'approved') await ok(manager, 'POST', `/purchasing/orders/${po.id}/approve`);
  const poItem = (await ok(operator, 'GET', '/purchasing/orders/' + po.id)).items[0];
  const receipt = await ok(operator, 'POST', `/purchasing/orders/${po.id}/receipts`, { lines: [{ poItemId: poItem.id, qty: 100 }] });
  const lotId = db.prepare('SELECT lot_id FROM po_receipt_lines WHERE receipt_id=?').get(receipt.receiptId).lot_id;
  assert.equal(lotQty(raw.id, 'quarantine'), 100, 'inspection-required receipt waits in quarantine');
  const insp = await ok(quality, 'POST', '/quality/inspections', { type: 'incoming', lotId });
  assert.equal((await call(quality, 'POST', `/quality/inspections/${insp.id}/result`, { result: 'conditional',
    acceptedQty: 90, rejectedQty: 10, signaturePassword: 'yanlis' })).status, 403, 'wrong signature password refused');
  await ok(quality, 'POST', `/quality/inspections/${insp.id}/result`, { result: 'conditional', acceptedQty: 90, rejectedQty: 10,
    signaturePassword: 'Kalite123!' });
  assert.equal(lotQty(raw.id, 'available'), 90);
  const rejectedLot = db.prepare(`SELECT id, qty FROM stock_lots WHERE item_id=? AND status IN ('rejected','blocked') AND qty>0`).get(raw.id);
  assert.equal(rejectedLot.qty, 10);
  await ok(operator, 'POST', '/purchasing/returns', { supplierId: supplier.id, lotId: rejectedLot.id, qty: 10, reason: 'Pilot: nem oranı' });
  console.log('✓ satın alma → karantina → imzalı muayene (90 kabul/10 ret) → tedarikçi iadesi');

  // Supplier invoice: operator records, operator cannot approve, manager approves, two payments
  const sinv = await ok(operator, 'POST', '/purchasing/invoices', { invoiceNo: 'PILOT-ALIS-1', poId: po.id, amount: 1000, vatAmount: 200 });
  assert.equal(sinv.matchStatus, 'matched');
  assert.equal((await call(operator, 'POST', `/purchasing/invoices/${sinv.id}/approve`, {})).status, 403);
  await ok(manager, 'POST', `/purchasing/invoices/${sinv.id}/approve`, {});
  await ok(manager, 'POST', `/purchasing/invoices/${sinv.id}/payments`, { amount: 700, method: 'bank', requestKey: 'pilot-pay-0001' });
  const settled = await ok(manager, 'POST', `/purchasing/invoices/${sinv.id}/payments`, { method: 'bank', requestKey: 'pilot-pay-0002' });
  assert.equal(settled.status, 'paid');
  assert.equal(settled.paidAmount, 1200);
  console.log('✓ alış faturası: operatör kaydeder, müdür onaylar, iki taksitte ödenir (1.200 TL)');

  // Production: 40 units need 80 kg
  const prod = await ok(operator, 'POST', '/production', { itemId: fin.id, qty: 40, warehouseId: warehouse });
  const done = await ok(operator, 'POST', `/production/${prod.id}/complete`, {});
  assert.equal(done.producedQty, 40);
  assert.equal(lotQty(raw.id, 'available'), 10);
  assert.equal(lotQty(fin.id, 'available'), 40);
  const finUnitCost = db.prepare("SELECT unit_cost FROM stock_lots WHERE item_id=? AND status='available'").get(fin.id).unit_cost;
  assert.equal(finUnitCost, 20, '80 kg × 10 TL / 40 adet');
  console.log('✓ üretim: 80 kg tüketildi, 40 adet mamul 20 TL/adet maliyetle girdi');

  // Sales: order 30, ship 30, invoice, partial collection, one-unit credit note
  const so = await ok(operator, 'POST', '/sales/orders', { customerId: customer.id, lines: [{ itemId: fin.id, qty: 30, price: 100 }] });
  await ok(operator, 'POST', '/sales/shipments', { soId: so.id, destination: 'Pilot depo', items: [{ itemId: fin.id, qty: 30 }] });
  assert.equal(lotQty(fin.id, 'available'), 10);
  const cinv = await ok(operator, 'POST', '/sales/invoices', { customerId: customer.id, soId: so.id });
  assert.equal(cinv.amount, 3600, '30 × 100 + %20 KDV');
  await ok(operator, 'POST', `/sales/invoices/${cinv.id}/payments`, { amount: 2000, method: 'bank', requestKey: 'pilot-col-0001' });
  await ok(operator, 'POST', '/sales/invoices', { customerId: customer.id, invoiceType: 'iade', originalInvoiceId: cinv.id,
    lines: [{ itemName: 'Pilot Kasa iade', qty: 1, unitPrice: 100, vatRate: 20 }] });
  assert.equal((await ok(admin, 'GET', '/sales/customers/' + customer.id)).openBalanceBase, 1480, '3.600 − 2.000 − 120');
  const rest = await ok(operator, 'POST', `/sales/invoices/${cinv.id}/pay`);
  assert.equal(rest.status, 'paid');
  assert.equal((await ok(admin, 'GET', '/sales/customers/' + customer.id)).openBalanceBase, 0);
  console.log('✓ satış: 30 adet sevk, 3.600 TL fatura, kısmi tahsilat + 1 adet iade, bakiye sıfır');

  // Count: one unit missing, manager approves
  const count = await ok(operator, 'POST', '/stock/counts', { warehouseId: warehouse });
  const line = db.prepare('SELECT id, system_qty FROM stock_count_lines WHERE count_id=? AND item_id=?').get(count.id, fin.id);
  assert.equal(line.system_qty, 10);
  await ok(operator, 'PUT', `/stock/counts/${count.id}/lines`, { lines: [{ id: line.id, countedQty: 9, reason: 'Pilot: kırık kasa' }] });
  assert.equal((await call(operator, 'POST', `/stock/counts/${count.id}/approve`, {})).status, 403);
  await ok(manager, 'POST', `/stock/counts/${count.id}/approve`, {});
  assert.equal(lotQty(fin.id, 'available'), 9);
  console.log('✓ sayım: 1 adet eksik, operatör onaylayamaz, müdür onaylar');

  // Reports reconcile with what happened
  const valuation = await ok(manager, 'GET', '/reports/valuation');
  const row = id => valuation.data.find(r => r.itemId === id);
  assert.equal(row(raw.id).availableValueBase, 100, '10 kg × 10 TL');
  assert.equal(row(fin.id).availableValueBase, 180, '9 adet × 20 TL');
  const profit = await ok(manager, 'GET', '/sales/profitability?groupBy=item');
  const pRow = (profit.data || profit.rows || profit).find(r => (r.key || r.label || r.name) === 'Pilot Kasa');
  assert(pRow, 'profitability row for Pilot Kasa');
  assert.equal(Math.round(pRow.revenue ?? pRow.revenueBase), 3000);
  assert.equal(Math.round(pRow.cost ?? pRow.costBase), 600);
  const journal = await ok(admin, 'GET', `/accounting/export?from=${today}&to=${today}`);
  assert.equal(journal.totalDebit, journal.totalCredit, 'journal balances');
  const purchaseRows = journal.rows.filter(r => r.sourceId === sinv.id);
  assert.deepEqual(purchaseRows.map(r => [r.accountCode, r.debit, r.credit]).sort(), [['153', 1000, 0], ['191', 200, 0], ['320', 0, 1200]].sort());
  console.log('✓ raporlar: değerleme 100 + 180 TL, kârlılık 3.000/600, yevmiye dengede ve alış satırları doğru');

  // Full backup restored into an empty location reproduces the same figures
  const bundle = (await require('../server/scripts/full-backup').runFullBackup()).file;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-plus-pilot-restore-'));
  try {
    const target = path.join(empty, 'restored.sqlite');
    require('../server/scripts/full-backup').restoreFullBackup(bundle, { destinationDb: target, destinationUploads: path.join(empty, 'uploads') });
    const Database = require('better-sqlite3');
    const copy = new Database(target, { readonly: true });
    try {
      const q = (itemId, status) => copy.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id=? AND status=?').get(itemId, status).q;
      assert.equal(q(raw.id, 'available'), 10);
      assert.equal(q(fin.id, 'available'), 9);
      assert.equal(copy.prepare('SELECT SUM(amount) s FROM supplier_invoice_payments WHERE invoice_id=?').get(sinv.id).s, 1200);
      assert.equal(copy.prepare("SELECT status FROM customer_invoices WHERE id=?").get(cinv.id).status, 'paid');
      assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(copy.pragma('foreign_key_check'), []);
    } finally { copy.close(); }
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  console.log('✓ tam yedek boş bir konuma geri yüklendi; stok, ödeme ve fatura durumları aynı, bütünlük temiz');
  console.log('pilot-flow: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
