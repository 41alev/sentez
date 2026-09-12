// @ts-nocheck
/**
 * Contract test: asserts that each endpoint actually returns the field names the
 * frontend views read. The e2e suite proves the backend *works*; this proves the
 * frontend is reading the right keys — the class of bug that produces a silently
 * blank column instead of an error.
 *
 * Run with the server up:  node test/contract.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/** Assert an object exposes every key the UI binds to. */
function hasFields(name, obj, fields) {
  if (!obj) return check(name, false, 'nesne yok / no object');
  const missing = fields.filter(f => obj[f] === undefined);
  check(name, missing.length === 0, missing.length ? 'eksik / missing: ' + missing.join(',') : '');
}

/** Assert a list endpoint returns the {data,page,pageSize,total,totalPages} envelope the pager needs. */
function isEnvelope(name, res) {
  const ok = res && Array.isArray(res.data) && res.total !== undefined && res.totalPages !== undefined;
  check(name, ok, ok ? '' : 'zarf değil / not an envelope: ' + JSON.stringify(Object.keys(res || {})));
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  const tok = (await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'Admin123!' } })).data.token;
  const get = (p) => api("GET", p, { token: tok }).then(r => r.data);

  console.log('\n=== LİSTE ZARFLARI / LIST ENVELOPES ===');
  // Every paginated list the UI renders with UI.pager() must share one shape.
  for (const [name, path] of [
    ['items', '/api/items?pageSize=2'],
    ['lots', '/api/stock/lots?pageSize=2'],
    ['movements', '/api/stock/movements?pageSize=2'],
    ['counts', '/api/stock/counts?pageSize=2'],
    ['production', '/api/production?pageSize=2'],
    ['purchase orders', '/api/purchasing/orders?pageSize=2'],
    ['suppliers', '/api/purchasing/suppliers?pageSize=2'],
    ['sales orders', '/api/sales/orders?pageSize=2'],
    ['shipments', '/api/sales/shipments?pageSize=2'],
    ['customers', '/api/sales/customers?pageSize=2'],
    ['inspections', '/api/quality/inspections?pageSize=2'],
    ['ncrs', '/api/quality/ncrs?pageSize=2'],
    ['audit', '/api/audit?pageSize=2'],
    ['notifications', '/api/notifications?pageSize=2'],
  ]) isEnvelope(name, await get(path));

  console.log('\n=== ÜRÜN / ITEMS ===');
  const items = await get('/api/items?pageSize=100');
  const row = items.data[0];
  hasFields('items list row has the columns the table renders', row,
    ['id', 'name', 'code', 'barcode', 'category', 'itemType', 'origin', 'unit', 'qty', 'minStock', 'avgCost', 'quarantineQty']);
  const setItem = items.data.find(i => i.code === 'SET-001');
  const detail = await get('/api/items/' + setItem.id);
  hasFields('item card fields', detail, ['stockByStatus', 'bom', 'lots', 'warehouse', 'salePrice', 'description']);
  hasFields('stockByStatus buckets', detail.stockByStatus, ['available', 'quarantine', 'blocked', 'rejected']);
  hasFields('BOM line fields', detail.bom[0], ['componentItemId', 'componentName', 'qtyPerUnit', 'scrapPct']);

  console.log('\n=== LOT ===');
  const lots = await get('/api/stock/lots?pageSize=5');
  hasFields('lot row fields', lots.data[0],
    ['id', 'itemName', 'lotNo', 'qty', 'unit', 'status', 'unitCost', 'warehouse', 'warehouseId', 'receivedAt']);

  console.log('\n=== SAYIM / COUNT ===');
  const created = await api('POST', '/api/stock/counts', { token: tok, body: { warehouseId: 1 } });
  const cnt = await get('/api/stock/counts/' + created.data.id);
  hasFields('count header fields', cnt, ['countNo', 'warehouse', 'status', 'lines']);
  // unitCost is what lets the UI show the monetary value of the variance
  hasFields('count line fields (incl. unitCost for variance value)', cnt.lines[0],
    ['id', 'itemName', 'lotNo', 'systemQty', 'unitCost']);
  const countList = await get('/api/stock/counts?pageSize=5');
  hasFields('count list row has lineCount', countList.data[0], ['countNo', 'warehouse', 'status', 'lineCount']);

  console.log('\n=== ÜRETİM / PRODUCTION ===');
  const prod = await get('/api/production?pageSize=5');
  hasFields('production row fields', prod.data[0],
    ['id', 'orderNo', 'itemName', 'qty', 'producedQty', 'scrapQty', 'status', 'date', 'components']);
  const done = prod.data.find(p => p.status === 'Tamamlandı');
  hasFields('completed production carries real costs', done,
    ['materialCost', 'laborCost', 'overheadCost', 'totalCost', 'unitCost', 'outputLotId', 'consumption']);

  console.log('\n=== SATIN ALMA / PURCHASING ===');
  const pos = await get('/api/purchasing/orders?pageSize=5');
  // The list shows the supplier name; the API calls it `supplier`, not `supplierName`
  hasFields('PO row fields', pos.data[0],
    ['id', 'poNo', 'supplier', 'date', 'expected', 'currency', 'fxRate', 'status', 'approvalStatus', 'totalBase', 'items']);
  hasFields('PO line fields', pos.data[0].items[0],
    ['id', 'itemName', 'qty', 'receivedQty', 'remainingQty', 'price', 'currency']);
  const sup = await get('/api/purchasing/suppliers/1');
  hasFields('supplier detail fields', sup,
    ['name', 'contactPerson', 'phone', 'email', 'taxNo', 'paymentTermsDays', 'leadTimeDays', 'priceHistory', 'performance']);

  console.log('\n=== SATIŞ / SALES ===');
  const sos = await get('/api/sales/orders?pageSize=5');
  hasFields('sales order row fields', sos.data[0],
    ['id', 'soNo', 'customerName', 'date', 'currency', 'fxRate', 'status', 'totalBase', 'lines']);
  hasFields('sales order line fields', sos.data[0].lines[0],
    ['itemName', 'qty', 'shippedQty', 'remainingQty', 'price', 'cogsBase']);
  const ships = await get('/api/sales/shipments?pageSize=5');
  hasFields('shipment row fields', ships.data[0],
    ['id', 'shipmentNo', 'destination', 'status', 'date', 'items', 'crates']);
  hasFields('shipment item carries lot reference', ships.data[0].items[0], ['itemName', 'lotId', 'lotNo', 'qty', 'unitCost']);
  const profit = await get('/api/sales/profitability?groupBy=item');
  hasFields('profitability totals', profit.totals, ['revenueBase', 'costBase', 'profitBase', 'marginPct']);
  hasFields('profitability row', profit.data[0], ['key', 'qty', 'revenueBase', 'costBase', 'profitBase', 'marginPct']);
  // customers are intentionally raw rows — the UI reads snake_case here
  const cus = await get('/api/sales/customers?pageSize=2');
  hasFields('customer row fields (snake_case as the UI expects)', cus.data[0],
    ['id', 'name', 'contact_person', 'currency', 'payment_terms_days', 'credit_limit']);

  console.log('\n=== KALİTE / QUALITY ===');
  const insp = await get('/api/quality/inspections?pageSize=5');
  hasFields('inspection row fields', insp.data[0],
    ['id', 'inspectionNo', 'type', 'itemName', 'lotNo', 'inspectedQty', 'acceptedQty', 'rejectedQty', 'result', 'lines']);
  // The UI renders pass/fail from `result`, not a boolean
  hasFields('inspection line fields', insp.data[0].lines[0],
    ['id', 'characteristic', 'specMin', 'specMax', 'specText', 'measuredValue', 'result']);
  const ncrs = await get('/api/quality/ncrs?pageSize=5');
  hasFields('NCR row fields', ncrs.data[0],
    ['id', 'ncrNo', 'source', 'severity', 'qtyAffected', 'disposition', 'status', 'openedAt']);
  const eq = await get('/api/quality/equipment');
  hasFields('equipment row fields', (eq.data || eq)[0],
    ['id', 'code', 'name', 'serialNo', 'lastCalibrationDate', 'nextCalibrationDate']);
  const capas = await get('/api/quality/capas');
  hasFields('CAPA row fields', (capas.data || capas)[0],
    ['id', 'capaNo', 'type', 'rootCause', 'actionPlan', 'status']);

  console.log('\n=== RAPORLAR / REPORTS ===');
  hasFields('dashboard summary fields', await get('/api/reports/summary'),
    ['totalValueTRY', 'quarantineValueTRY', 'lowStockCount', 'expiringCount', 'pendingApprovalCount',
     'openNCRCount', 'pendingInspectionCount', 'categoryValue', 'statusBreakdown', 'lowStockList', 'expiringList']);
  hasFields('trends fields', await get('/api/reports/trends?months=12'),
    ['periods', 'stockInValue', 'stockOutValue', 'production', 'sales']);
  hasFields('dead stock fields', await get('/api/reports/dead-stock?days=180'),
    ['deadStockValueBase', 'items', 'ageBuckets']);
  hasFields('turnover row', (await get('/api/reports/turnover')).data[0],
    ['itemId', 'name', 'onHand', 'consumed', 'turnoverRatio', 'daysOnHand', 'valueBase']);
  hasFields('reorder suggestion row', (await get('/api/reports/reorder-suggestions')).suggestions[0],
    ['name', 'onHand', 'onOrder', 'dailyUse', 'leadTimeDays', 'reorderPoint', 'suggestedQty', 'estimatedCostBase']);
  hasFields('supplier performance row', (await get('/api/reports/supplier-performance')).data[0],
    ['supplierId', 'name', 'deliveries', 'onTimePct', 'rejectPct', 'totalSpendBase', 'score']);
  hasFields('quality KPI fields', await get('/api/reports/quality-kpis'),
    ['incomingRejectPct', 'ncrBySeverity', 'ncrBySource', 'openCapaCount', 'overdueCapaCount', 'production']);
  hasFields('production cost row', (await get('/api/reports/production-costs'))[0],
    ['orderNo', 'itemName', 'qty', 'materialCost', 'laborCost', 'overheadCost', 'totalCost', 'unitCost', 'yieldPct']);
  hasFields('valuation row', (await get('/api/reports/valuation')).data[0],
    ['itemId', 'name', 'availableQty', 'availableValueBase', 'quarantineQty', 'costingMethod']);

  console.log('\n=== YÖNETİM / ADMIN ===');
  hasFields('user row fields', (await get('/api/users'))[0],
    ['id', 'username', 'fullName', 'role', 'approvalLimit', 'isActive', 'lastLoginAt']);
  hasFields('warehouse row fields', (await get('/api/warehouses'))[0],
    ['id', 'code', 'name', 'isQuarantine', 'isActive']);
  hasFields('settings fields', await get('/api/settings'),
    ['companyName', 'baseCurrency', 'defaultLaborRate', 'defaultOverheadPct', 'expiryWarningDays']);
  hasFields('FX row fields (snake_case as the UI expects)', (await get('/api/exchange-rates?pageSize=2')).data[0],
    ['currency', 'rate', 'rate_date', 'source']);
  hasFields('approval rule fields', (await get('/api/approval-rules'))[0],
    ['doc_type', 'threshold_base', 'required_role']);
  hasFields('notification rule fields', (await get('/api/notification-rules'))[0],
    ['rule_type', 'channel', 'threshold_days']);
  await api('POST', '/api/notifications/scan', { token: tok });
  const notifs = await get('/api/notifications?pageSize=5');
  hasFields('notification row fields', notifs.data[0],
    ['id', 'ruleType', 'severity', 'title', 'body', 'isRead', 'createdAt']);
  check('notifications carry unreadCount for the badge', notifs.unreadCount !== undefined);

  console.log('\n=== DENETİM KAYDI / AUDIT ===');
  await api('PUT', '/api/items/' + setItem.id, { token: tok, body: { salePrice: 555 } });
  const audit = await get('/api/audit?entityType=item&pageSize=10');
  const entry = audit.data.find(a => a.oldValue && a.newValue);
  hasFields('audit row fields', audit.data[0], ['ts', 'username', 'role', 'actionKey', 'entityType', 'detail']);
  check('audit records both old and new values', !!entry, entry ? '' : 'eski/yeni değer yok');

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
