const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js stock-integrity');
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
  const a = await success('POST', '/items', { name: 'Integrity A', openingQty: 100, openingUnitCost: 10 });
  const b = await success('POST', '/items', { name: 'Integrity B', openingQty: 100, openingUnitCost: 10 });
  const lotA = db.prepare('SELECT * FROM stock_lots WHERE item_id=?').get(a.id);
  const lotB = db.prepare('SELECT * FROM stock_lots WHERE item_id=?').get(b.id);
  const customer = db.prepare('SELECT id FROM customers LIMIT 1').get().id;
  const shipment = lines => ({ customerId: customer, destination: 'Test', items: lines });
  const snapshot = () => ({
    lots: db.prepare('SELECT id,qty,status FROM stock_lots ORDER BY id').all(),
    cache: db.prepare('SELECT id,qty_cache FROM items ORDER BY id').all(),
    movements: db.prepare('SELECT COUNT(*) c FROM movements').get().c,
    shipments: db.prepare('SELECT COUNT(*) c FROM shipments').get().c
  });
  for (const body of [
    shipment([{ itemId: a.id, lotId: lotB.id, qty: 2 }]),
    { ...shipment([{ itemId: a.id, lotId: lotA.id, qty: 2 }]), warehouseId: lotA.warehouse_id + 10000 },
    shipment([{ itemId: a.id, lotId: lotA.id, qty: 1 }, { itemId: b.id, lotId: lotA.id, qty: 1 }])
  ]) {
    const before = snapshot();
    assert.equal((await api('POST', '/sales/shipments', body)).status, 422);
    assert.deepEqual(snapshot(), before);
  }
  console.log('✓ F01: wrong product/depot and second-line failure roll back all stock effects');
  const operation = { clientId: 'repeat-safe', type: 'move', itemId: b.id, warehouseId: lotB.warehouse_id, qty: 7 };
  const firstSync = await success('POST', '/mobile/sync', { operations: [operation] });
  const syncSnapshot = snapshot();
  const repeats = await Promise.all(Array.from({ length: 5 }, () => success('POST', '/mobile/sync', { operations: [operation] })));
  for (const repeat of repeats) assert.deepEqual(repeat.results, firstSync.results);
  assert.deepEqual(snapshot(), syncSnapshot);
  const changedPayload = await success('POST', '/mobile/sync', { operations: [{ ...operation, qty: 8 }] });
  assert.equal(changedPayload.results[0].status, 409);
  assert.deepEqual(snapshot(), syncSnapshot);
  const { execFileSync } = require('node:child_process');
  const fromNewProcess = execFileSync(process.execPath, ['-e',
    "const db=require('./server/db');const user=db.prepare('SELECT id,role FROM users WHERE username=?').get('admin');const r=require('./server/services/mobile-sync').executeMobileOperation(JSON.parse(process.argv[1]),user);console.log(JSON.stringify(r));db.close()",
    JSON.stringify(operation)], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(fromNewProcess), firstSync.results[0]);
  assert.deepEqual(snapshot(), syncSnapshot);
  console.log('✓ F04: concurrent retries, payload conflict and a new process preserve one stock effect');
  const order = await success('POST', '/sales/orders', { customerId: customer, lines: [{ itemId: a.id, qty: 2, price: 50 }] });
  for (const body of [
    { ...shipment([{ itemId: a.id, lotId: lotA.id, qty: 3 }]), soId: order.id },
    { ...shipment([{ itemId: a.id, lotId: lotA.id, qty: 1.5 }, { itemId: a.id, lotId: lotA.id, qty: 1 }]), soId: order.id }
  ]) {
    const before = snapshot();
    assert.equal((await api('POST', '/sales/shipments', body)).status, 409);
    assert.deepEqual(snapshot(), before);
  }
  db.prepare("UPDATE sales_orders SET status='cancelled' WHERE id=?").run(order.id);
  assert.equal((await api('POST', '/sales/shipments', { ...shipment([{ itemId: a.id, qty: 1 }]), soId: order.id })).status, 409);
  console.log('✓ F03: cancelled orders and cumulative over-shipment rejected');

  const count = await success('POST', '/stock/counts', {});
  const line = db.prepare('SELECT * FROM stock_count_lines WHERE count_id=? AND lot_id=?').get(count.id, lotA.id);
  await success('PUT', `/stock/counts/${count.id}/lines`, { lines: [{ id: line.id, countedQty: 99 }] });
  await success('PUT', `/stock/counts/${count.id}/lines`, { lines: [{ id: line.id, countedQty: 98 }] });
  assert.equal(db.prepare('SELECT counted_qty FROM stock_count_lines WHERE id=?').get(line.id).counted_qty, 98);
  console.log('✓ F17: saved count can be corrected before approval');
  const badMobile = await success('POST', '/mobile/sync', { operations: [{ clientId: 'negative-count', type: 'count_line', lineId: line.id, countedQty: -9 }] });
  assert.equal(badMobile.failed, 1);
  assert.equal(db.prepare('SELECT counted_qty FROM stock_count_lines WHERE id=?').get(line.id).counted_qty, 98);
  await success('POST', '/sales/shipments', shipment([{ itemId: a.id, lotId: lotA.id, qty: 5 }]));
  const beforeCount = snapshot();
  assert.equal((await api('POST', `/stock/counts/${count.id}/approve`, {})).status, 409);
  assert.deepEqual(snapshot(), beforeCount);
  console.log('✓ F06: count cannot overwrite an intervening shipment');
  db.prepare("UPDATE stock_counts SET status='approved' WHERE id=?").run(count.id);
  const closed = await success('POST', '/mobile/sync', { operations: [{ clientId: 'closed-count', type: 'count_line', lineId: line.id, countedQty: 1 }] });
  assert.equal(closed.failed, 1);
  assert.equal(db.prepare('SELECT counted_qty FROM stock_count_lines WHERE id=?').get(line.id).counted_qty, 98);
  console.log('✓ F05: closed count and negative mobile quantity leave count unchanged');

  db.prepare("UPDATE stock_lots SET status='rejected' WHERE id=?").run(lotB.id);
  const supplier = db.prepare('SELECT id FROM suppliers LIMIT 1').get().id;
  await success('POST', '/purchasing/returns', { supplierId: supplier, lotId: lotB.id, qty: 3 });
  assert.equal(db.prepare('SELECT qty FROM stock_lots WHERE id=?').get(lotB.id).qty, 97);
  assert.equal(db.prepare('SELECT qty FROM stock_lots WHERE id=?').get(lotA.id).qty, 95);
  const returned = db.prepare("SELECT * FROM movements WHERE ref_type='supplier_return' ORDER BY ts DESC LIMIT 1").get();
  assert.equal(returned.lot_id, lotB.id);
  assert.equal(returned.from_status, 'rejected');
  console.log('✓ F08: supplier return removes only the selected rejected lot');

  const po = await success('POST', '/purchasing/orders', { supplierId: supplier, warehouseId: lotA.warehouse_id,
    items: [{ itemId: a.id, qty: 10, price: 1, tolerancePct: 100 }, { itemId: b.id, qty: 10, price: 1 }] });
  const first = db.prepare('SELECT id FROM po_items WHERE po_id=? AND item_id=?').get(po.id, a.id);
  db.prepare('UPDATE po_items SET over_delivery_tolerance_pct=100 WHERE id=?').run(first.id);
  await success('POST', `/purchasing/orders/${po.id}/receipts`, { lines: [{ poItemId: first.id, qty: 20 }] });
  assert.equal(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(po.id).status, 'partially_received');
  console.log('✓ F23: over-delivery on one line cannot close an undelivered line');
  const c = await success('POST', '/items', { name: 'Cancellation and lineage', openingQty: 12, openingUnitCost: 10 });
  const parent = db.prepare('SELECT * FROM stock_lots WHERE item_id=?').get(c.id);
  const otherWarehouse = db.prepare('SELECT id FROM warehouses WHERE id!=? LIMIT 1').get(parent.warehouse_id).id;
  const child = await success('POST', '/stock/transfer', { lotId: parent.id, targetWarehouseId: otherWarehouse, qty: 5 });
  const so = await success('POST', '/sales/orders', { customerId: customer, lines: [{ itemId: c.id, qty: 2, price: 30 }] });
  const sent = await success('POST', '/sales/shipments', { ...shipment([{ itemId: c.id, lotId: child.lotId, qty: 2 }]), soId: so.id });
  const recalled = await success('GET', '/quality/recall/' + parent.id);
  assert.equal(recalled.shipments.length, 1);
  assert.equal(recalled.shipments[0].qty, 2);
  assert.equal(recalled.stillInStock, 10);
  const backward = await success('GET', '/quality/trace/backward/' + child.lotId);
  assert.equal(backward.components[0].child.lotId, parent.id);
  console.log('✓ F16: split lot remains connected to parent, customer and remaining inventory');
  await success('DELETE', '/sales/shipments/' + sent.id);
  const cancelled = await success('GET', '/sales/shipments/' + sent.id);
  assert.equal(cancelled.status, 'İptal Edildi');
  assert.equal(cancelled.items.length, 1);
  assert.equal(db.prepare('SELECT qty_cache FROM items WHERE id=?').get(c.id).qty_cache, 12);
  const afterCancel = await success('GET', '/sales/orders/' + so.id);
  assert.equal(afterCancel.status, 'open');
  assert.equal(afterCancel.lines[0].shippedQty, 0);
  assert.equal(afterCancel.lines[0].cogsBase, 0);
  assert.equal((await success('GET', '/quality/recall/' + parent.id)).shipments.length, 0);
  const cancelledSnapshot = snapshot();
  await success('DELETE', '/sales/shipments/' + sent.id);
  assert.deepEqual(snapshot(), cancelledSnapshot);
  assert.equal((await api('PATCH', '/sales/shipments/' + sent.id + '/status', {})).status, 409);
  console.log('✓ F02: cancellation restores stock and COGS, preserves document, cannot run twice');
  const q = await success('POST', '/items', { name: 'Quality disposition', openingQty: 10, openingUnitCost: 10 });
  const qlot = db.prepare('SELECT * FROM stock_lots WHERE item_id=?').get(q.id);
  db.prepare("UPDATE stock_lots SET status='quarantine' WHERE id=?").run(qlot.id);
  const inspection = await success('POST', '/quality/inspections', { type: 'incoming', lotId: qlot.id });
  const qualitySnapshot = snapshot();
  for (const body of [
    { result: 'accepted', acceptedQty: 1, rejectedQty: 9 },
    { result: 'conditional', acceptedQty: 1, rejectedQty: 2 },
    { result: 'rejected', acceptedQty: 1, rejectedQty: 9 },
    { result: 'accepted', lines: [{ id: 99999999, result: 'pass' }] }
  ]) {
    assert.equal((await api('POST', `/quality/inspections/${inspection.id}/result`, body)).status, 422);
    assert.deepEqual(snapshot(), qualitySnapshot);
    assert.equal(db.prepare('SELECT result FROM inspections WHERE id=?').get(inspection.id).result, 'pending');
  }
  const decision = await success('POST', `/quality/inspections/${inspection.id}/result`,
    { result: 'conditional', acceptedQty: 1, rejectedQty: 9 });
  assert.equal(db.prepare('SELECT qty FROM stock_lots WHERE id=?').get(qlot.id).qty, 1);
  assert.equal(db.prepare('SELECT status FROM stock_lots WHERE id=?').get(qlot.id).status, 'available');
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id=?').get(decision.ncrId);
  assert.notEqual(ncr.lot_id, qlot.id);
  const rejected = db.prepare('SELECT * FROM stock_lots WHERE id=?').get(ncr.lot_id);
  assert.equal(rejected.qty, 9);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.parent_lot_id, qlot.id);
  console.log('✓ F10: contradictory decisions roll back; partial acceptance links NCR to rejected stock');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.close());
