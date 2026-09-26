// T09 time-phased MRP + order BOM snapshot, T10 conflict-free finite scheduling.
// Run via: node test/run-all.js planning-integrity
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert(process.env.DATA_DIR && process.env.BASE && fs.existsSync(path.join(process.env.DATA_DIR, '.test-owner')),
  'Run node test/run-all.js planning-integrity');
const db = require('../server/db');
const { toLocalDateStr, addDays, isoWeekday } = require('../server/lib/dates');

let token;
async function api(method, route, body) {
  const r = await fetch(process.env.BASE + '/api' + route, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}
async function ok(method, route, body) {
  const r = await api(method, route, body);
  assert(r.status >= 200 && r.status < 300, `${method} ${route}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
let seq = 0;
const uniq = p => `${p}${Date.now().toString(36)}${++seq}`;
const today = toLocalDateStr();
// A Monday at least a week ahead keeps the schedule deterministic.
let monday = addDays(today, 7);
while (isoWeekday(monday) !== 1) monday = addDays(monday, 1);
const at = (dateStr, hh, mm = 0) => new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();

async function workCenter({ start, end, breakMinutes = 0, units = 1 }) {
  const shift = await ok('POST', '/planning/shifts', { code: uniq('S'), name: 'Test', startTime: start, endTime: end,
    breakMinutes, weekdays: [1, 2, 3, 4, 5, 6, 7] });
  const wc = await ok('POST', '/planning/work-centers', { code: uniq('W'), name: 'Test WC', capacityUnits: units, shiftIds: [shift.id] });
  return wc.id;
}
async function routedOrder(wcId, runMinutes, qty = 1) {
  const component = await ok('POST', '/items', { name: uniq('Comp'), itemType: 'raw' });
  const item = await ok('POST', '/items', { name: uniq('Fin'), itemType: 'finished', procurementType: 'make',
    bom: [{ componentItemId: component.id, qtyPerUnit: 1 }] });
  await ok('PUT', `/planning/routings/${item.id}`, { operations: [{ operationNo: 10, operationName: 'Op', workCenterId: wcId,
    runMinutesPerUnit: runMinutes }] });
  const order = await ok('POST', '/production', { itemId: item.id, qty });
  return order.id;
}
const overlaps = (a, b) => a.plannedStart < b.plannedEnd && b.plannedStart < a.plannedEnd;

async function scheduling() {
  // Night shift crossing midnight, single line: jobs never overlap and stay inside 22:00–06:00.
  const night = await workCenter({ start: '22:00', end: '06:00' });
  const first = (await ok('POST', `/planning/schedule/${await routedOrder(night, 300)}`, { startFrom: monday })).operations[0];
  const second = (await ok('POST', `/planning/schedule/${await routedOrder(night, 300)}`, { startFrom: monday })).operations[0];
  assert.equal(first.plannedStart, at(monday, 0), 'Sunday 22:00 shift is still running at Monday 00:00');
  assert.equal(first.plannedEnd, at(monday, 5));
  assert(!overlaps(first, second), 'same line cannot run two jobs at once');
  assert.equal(second.plannedStart, first.plannedEnd);
  assert.equal(second.plannedEnd, at(addDays(monday, 1), 2), '1h before 06:00, the remaining 4h on the next night');
  console.log('✓ T10 night shift over midnight, no overlap on a single line');

  // Break in the middle of a 08:00–12:00 shift: 180 work minutes span the full 4 clock hours.
  const withBreak = await workCenter({ start: '08:00', end: '12:00', breakMinutes: 60 });
  const op = (await ok('POST', `/planning/schedule/${await routedOrder(withBreak, 180)}`, { startFrom: monday })).operations[0];
  assert.equal(op.plannedStart, at(monday, 8));
  assert.equal(op.plannedEnd, at(monday, 12));

  // Holiday: the work centre does not run that day.
  const day = await workCenter({ start: '08:00', end: '16:00' });
  const exc = await ok('POST', '/planning/calendar-exceptions', { date: monday, workCenterId: day, reason: 'Bayram' });
  assert(exc.id);
  assert.equal((await api('POST', '/planning/calendar-exceptions', { date: monday, workCenterId: day })).status, 409);
  const hop = (await ok('POST', `/planning/schedule/${await routedOrder(day, 60)}`, { startFrom: monday })).operations[0];
  assert.equal(hop.plannedStart, at(addDays(monday, 1), 8));
  console.log('✓ T10 break placement and holiday exception respected');

  // Two parallel lines: two jobs may overlap, a third must wait for a free line.
  const twin = await workCenter({ start: '08:00', end: '16:00', units: 2 });
  const a = (await ok('POST', `/planning/schedule/${await routedOrder(twin, 240)}`, { startFrom: monday })).operations[0];
  const b = (await ok('POST', `/planning/schedule/${await routedOrder(twin, 240)}`, { startFrom: monday })).operations[0];
  const cOrder = await routedOrder(twin, 240);
  const c = (await ok('POST', `/planning/schedule/${cOrder}`, { startFrom: monday })).operations[0];
  assert.equal(a.plannedStart, b.plannedStart, 'second line runs in parallel');
  assert.equal(c.plannedStart, a.plannedEnd, 'third job waits for a line');
  const booked = db.prepare('SELECT planned_start s, planned_end e FROM production_operations WHERE work_center_id=?').all(twin);
  for (const probe of booked) {
    const concurrent = booked.filter(x => x.s <= probe.s && probe.s < x.e).length;
    assert(concurrent <= 2, 'never more jobs than lines');
  }
  // Rescheduling an order does not collide with its own previous booking.
  const again = (await ok('POST', `/planning/schedule/${cOrder}`, { startFrom: monday })).operations[0];
  assert.equal(again.plannedStart, c.plannedStart);
  const cap = await ok('GET', `/planning/capacity?from=${monday}&to=${monday}&workCenterId=${twin}`);
  assert.equal(cap.data[0].days[0].capacityMinutes, 960, '2 lines × 480 minutes');
  assert.equal(cap.data[0].days[0].loadMinutes, 720, '2×240 in parallel + 240 after');
  console.log('✓ T10 parallel lines, waiting job, idempotent reschedule');
}

async function capacityValidation() {
  assert.equal((await api('GET', '/planning/capacity?from=2026-01-01&to=2028-01-01')).status, 422);
  assert.equal((await api('GET', '/planning/capacity?from=2026-02-30&to=2026-03-01')).status, 422);
  assert.equal((await api('GET', '/planning/oee?from=2026-03-01&to=2026-02-01')).status, 422);
  assert.equal((await api('POST', '/planning/shifts', { code: uniq('X'), name: 'x', startTime: '24:00', endTime: '08:00', weekdays: [1] })).status, 422);
  assert.equal((await api('POST', '/planning/shifts', { code: uniq('X'), name: 'x', startTime: '08:00', endTime: '09:00', breakMinutes: 60, weekdays: [1] })).status, 422);
  console.log('✓ T10 range/shift validation');
}

async function mrp() {
  const supplier = await ok('POST', '/purchasing/suppliers', { name: uniq('Sup'), leadTimeDays: 5 });
  const customer = await ok('POST', '/sales/customers', { name: uniq('Cust') });
  const buy = await ok('POST', '/items', { name: uniq('Buy'), itemType: 'raw', procurementType: 'buy', defaultSupplierId: supplier.id });
  const needDate = addDays(today, 20);
  await ok('POST', '/sales/orders', { customerId: customer.id, promisedDate: needDate, lines: [{ itemId: buy.id, qty: 10, price: 1 }] });
  // Supply that arrives after the need date must not cover it.
  const late = await ok('POST', '/purchasing/orders', { supplierId: supplier.id, expected: addDays(today, 60),
    items: [{ itemId: buy.id, qty: 10, price: 1 }] });
  await ok('POST', '/planning/mrp/run', { horizonDays: 90 });
  let s = (await ok('GET', '/planning/mrp/suggestions')).data.filter(x => x.itemId === buy.id);
  assert.equal(s.length, 1, 'late supply leaves the earlier demand uncovered');
  assert.equal(s[0].suggestedQty, 10);
  assert.equal(s[0].needDate, needDate);
  // The same PO arriving on time covers the demand.
  db.prepare('UPDATE purchase_orders SET expected=? WHERE id=?').run(addDays(today, 10), late.id);
  await ok('POST', '/planning/mrp/run', { horizonDays: 90 });
  s = (await ok('GET', '/planning/mrp/suggestions')).data.filter(x => x.itemId === buy.id);
  assert.equal(s.length, 0, 'on-time supply covers demand');
  // Expired stock is not usable supply (K-01).
  const expiring = await ok('POST', '/items', { name: uniq('Exp'), itemType: 'raw', procurementType: 'buy', defaultSupplierId: supplier.id });
  await ok('POST', '/stock/move', { itemId: expiring.id, type: 'in', qty: 5, unitCost: 1, expiryDate: addDays(today, -1) });
  await ok('POST', '/sales/orders', { customerId: customer.id, promisedDate: needDate, lines: [{ itemId: expiring.id, qty: 5, price: 1 }] });
  await ok('POST', '/planning/mrp/run', { horizonDays: 90 });
  s = (await ok('GET', '/planning/mrp/suggestions')).data.filter(x => x.itemId === expiring.id);
  assert.equal(s.length, 1);
  assert.equal(s[0].onHand, 0);
  console.log('✓ T09 time-phased netting and expired stock');

  // Open production orders keep the BOM they were released with.
  const comp = await ok('POST', '/items', { name: uniq('C'), itemType: 'raw', procurementType: 'buy', defaultSupplierId: supplier.id });
  const made = await ok('POST', '/items', { name: uniq('M'), itemType: 'finished', procurementType: 'make',
    bom: [{ componentItemId: comp.id, qtyPerUnit: 2 }] });
  await ok('POST', '/production', { itemId: made.id, qty: 5, date: addDays(today, 3) });
  await ok('PUT', '/items/' + made.id, { bom: [{ componentItemId: comp.id, qtyPerUnit: 3 }] });
  await ok('POST', '/planning/mrp/run', { horizonDays: 90 });
  s = (await ok('GET', '/planning/mrp/suggestions')).data.filter(x => x.itemId === comp.id);
  assert.equal(s.length, 1);
  assert.equal(s[0].grossRequirement, 10, 'demand from order snapshot (5×2), not the edited BOM (5×3)');
  // Conversion: second attempt 409, unknown 404, dismissed cannot be converted.
  assert.equal((await ok('POST', `/planning/mrp/suggestions/${s[0].id}/convert`, {})).kind, 'purchase_order');
  assert.equal((await api('POST', `/planning/mrp/suggestions/${s[0].id}/convert`, {})).status, 409);
  assert.equal((await api('POST', '/planning/mrp/suggestions/99999999/convert', {})).status, 404);
  assert.equal((await api('POST', `/planning/mrp/suggestions/${s[0].id}/dismiss`, {})).status, 409);
  // BOM cycles are rejected at the source.
  assert.equal((await api('PUT', '/items/' + comp.id, { bom: [{ componentItemId: made.id, qtyPerUnit: 1 }] })).status, 422);
  console.log('✓ T09 production order BOM snapshot, conversion guards, cycle rejection');
}

(async () => {
  token = (await ok('POST', '/auth/login', { username: 'admin', password: 'Admin123!' })).token;
  await scheduling();
  await capacityValidation();
  await mrp();
  console.log('planning-integrity: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
