const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// This suite must only run under the isolated runner.
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js release-hardening');
const db = require('../server/db');
let token;
async function api(method, route, body, auth = token) {
  const response = await fetch(process.env.BASE + '/api' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function success(method, route, body) {
  const r = await api(method, route, body);
  assert(r.status >= 200 && r.status < 300, `${route}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function main() {
  token = (await success('POST', '/auth/login', { username: 'admin', password: 'Admin123!' })).token;
  const component = db.prepare('SELECT id FROM items LIMIT 1').get().id;
  const product = await success('POST', '/items', { name: 'Preserve card', itemType: 'finished', salePrice: 123,
    minStock: 12, isLotTracked: false, bom: [{ componentItemId: component, qtyPerUnit: 2 }] });
  const before = db.prepare('SELECT * FROM items WHERE id=?').get(product.id);
  const bom = db.prepare('SELECT * FROM item_bom WHERE item_id=?').all(product.id);
  await success('PUT', '/items/' + product.id, { name: 'Renamed card' });
  assert.deepEqual(db.prepare('SELECT * FROM items WHERE id=?').get(product.id), { ...before, name: 'Renamed card' });
  assert.deepEqual(db.prepare('SELECT * FROM item_bom WHERE item_id=?').all(product.id), bom);
  await success('PUT', '/items/' + product.id, { salePrice: 0, bom: [] });
  assert.equal(db.prepare('SELECT sale_price FROM items WHERE id=?').get(product.id).sale_price, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM item_bom WHERE item_id=?').get(product.id).c, 0);
  console.log('✓ F18: omitted product fields preserved; explicit zero/empty array applied');

  /** @type {Array<[string, string, Record<string, unknown>, Record<string, unknown>, string]>} */
  const cases = [
    ['/sales/customers', 'customers', { name: 'Customer', currency: 'USD', creditLimit: 321, paymentTermsDays: 90 }, { name: 'Renamed' }, 'name'],
    ['/purchasing/suppliers', 'suppliers', { name: 'Supplier', currency: 'EUR', leadTimeDays: 45, paymentTermsDays: 60, isApproved: false }, { name: 'Renamed' }, 'name'],
    ['/planning/work-centers', 'work_centers', { code: 'PRESERVE', name: 'Center', capacityUnits: 3, hourlyRate: 55, efficiencyPct: 85 }, { name: 'Renamed' }, 'name'],
    ['/crm/opportunities', 'opportunities', { customerName: 'Customer', estimatedValue: 900, probability: 80, source: 'web' }, { notes: 'Note only' }, 'notes'],
    ['/support', 'support_tickets', { customerName: 'Customer', subject: 'Keep priority', priority: 'high' }, { subject: 'Renamed' }, 'subject']
  ];
  for (const [route, table, body, update, column] of cases) {
    const created = await success('POST', route, body);
    // Tables and columns are compile-time test cases, not user input.
    const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(created.id);
    await success('PUT', route + '/' + created.id, update);
    const changed = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(created.id);
    assert.deepEqual(changed, { ...old, [column]: Object.values(update)[0] });
    console.log('✓ Partial update preserves omitted fields: ' + route);
  }

  const user = await success('POST', '/users', { username: 'release-user', password: 'Start123!', role: 'operator', mustChangePassword: false });
  const userBefore = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  const auditBefore = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
  for (const bad of [{ role: 'manager', password: '123' }, { role: 'manager', approvalLimit: -1 }, { role: 'manager', isActive: 'false' }, { role: 'manager', password: 'aaaaaaaa' }]) {
    assert((await api('PUT', '/users/' + user.id, bad)).status >= 400);
    assert.deepEqual(db.prepare('SELECT * FROM users WHERE id=?').get(user.id), userBefore);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_log').get().c, auditBefore);
  }
  console.log('✓ F14: failed user changes leave role, password, audit untouched');
  await success('PUT', '/users/' + user.id, { role: 'manager', approvalLimit: 500, password: 'Reset123!' });
  const first = (await api('POST', '/auth/login', { username: 'release-user', password: 'Reset123!' })).data.token;
  const second = (await api('POST', '/auth/login', { username: 'release-user', password: 'Reset123!' })).data.token;
  assert.equal((await api('GET', '/auth/me', undefined, first)).status, 200);
  const denied = await api('GET', '/items', undefined, first);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'Reset123!', newPassword: 'Final123!' }, first)).status, 200);
  assert.equal((await api('GET', '/items', undefined, first)).status, 200);
  assert.equal((await api('GET', '/items', undefined, second)).status, 401);
  console.log('✓ F11: reset session restricted until password change; other sessions revoked');

  db.prepare("UPDATE approval_rules SET is_active=0 WHERE doc_type='purchase_order'").run();
  db.prepare("INSERT INTO approval_rules(doc_type,threshold_base,required_role,is_active) VALUES ('purchase_order',1,'admin',1)").run();
  const supplier = db.prepare('SELECT id FROM suppliers LIMIT 1').get().id;
  const order = await success('POST', '/purchasing/orders', { supplierId: supplier, items: [{ itemId: component, qty: 1, price: 50 }] });
  assert.equal((await api('POST', `/purchasing/orders/${order.id}/approve`, {}, first)).status, 403);
  assert.equal(db.prepare('SELECT approval_status FROM purchase_orders WHERE id=?').get(order.id).approval_status, 'pending');
  await success('POST', `/purchasing/orders/${order.id}/approve`, {});
  console.log('✓ F13: required admin role enforced independently of personal amount limit');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.close());
