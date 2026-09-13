// @ts-nocheck
/**
 * End-to-end smoke test. Boots nothing itself — expects the server on BASE.
 * Run:  node test/e2e.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function login(username, password) {
  const r = await api('POST', '/api/auth/login', { body: { username, password } });
  return r.data && r.data.token;
}

(async () => {
  console.log('\n=== HEALTH ===');
  const health = await api('GET', '/health');
  ok('health endpoint responds', health.status === 200 && health.data.status === 'ok', JSON.stringify(health.data));
  ok('no pending migrations', health.data?.pendingMigrations === 0);

  console.log('\n=== AUTH ===');
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const quality = await login('kalite', 'Kalite123!');
  const viewer = await login('viewer', 'Viewer123!');
  ok('admin login', !!admin);
  ok('manager login', !!manager);
  ok('operator login', !!operator);
  ok('quality login', !!quality);
  ok('viewer login', !!viewer);

  const badLogin = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  ok('wrong password rejected', badLogin.status === 401);
  const noAuth = await api('GET', '/api/items');
  ok('unauthenticated request rejected', noAuth.status === 401);

  console.log('\n=== ITEMS & PAGINATION ===');
  const items = await api('GET', '/api/items?pageSize=5', { token: admin });
  ok('items paginated', items.status === 200 && Array.isArray(items.data.data) && items.data.pageSize === 5,
    JSON.stringify(items.data).slice(0, 120));
  ok('pagination metadata present', items.data?.total > 0 && items.data?.totalPages >= 1);

  const all = await api('GET', '/api/items?pageSize=100', { token: admin });
  const setItem = all.data.data.find(i => i.code === 'SET-001');
  const panelItem = all.data.data.find(i => i.code === 'MP-500');
  const sacItem = all.data.data.find(i => i.code === 'SC-200');
  const somunItem = all.data.data.find(i => i.code === 'SM-108');
  ok('finished good has BOM', setItem && setItem.bom && setItem.bom.length === 3, JSON.stringify(setItem?.bom));
  ok('multi-level BOM exists on panel', panelItem && panelItem.bom.length === 3);

  const byBarcode = await api('GET', '/api/items/barcode/8690123456781', { token: admin });
  ok('barcode lookup works', byBarcode.status === 200 && byBarcode.data.code === 'SM-108');

  console.log('\n=== LOT-LEVEL STOCK ===');
  const lots = await api('GET', '/api/stock/lots?pageSize=100', { token: admin });
  ok('lots listed', lots.status === 200 && lots.data.data.length > 0);
  const quarantined = lots.data.data.filter(l => l.status === 'quarantine');
  ok('quarantine status exists', quarantined.length > 0, `found ${quarantined.length}`);
  const avail = lots.data.data.filter(l => l.status === 'available');
  ok('available lots exist', avail.length > 0);

  console.log('\n=== ROLE MATRIX ===');
  const newItemBody = { name: 'Test Ürün', code: 'TST-1', category: 'Test', unit: 'adet', minStock: 1 };
  const viewerCreate = await api('POST', '/api/items', { token: viewer, body: newItemBody });
  ok('viewer cannot create item (403)', viewerCreate.status === 403, `got ${viewerCreate.status}`);
  const opCreate = await api('POST', '/api/items', { token: operator, body: newItemBody });
  ok('operator can create item (201)', opCreate.status === 201, `got ${opCreate.status} ${JSON.stringify(opCreate.data).slice(0,100)}`);
  const createdItemId = opCreate.data?.id;
  const opDelete = await api('DELETE', `/api/items/${createdItemId}`, { token: operator });
  ok('operator cannot delete item (403)', opDelete.status === 403, `got ${opDelete.status}`);
  const adminDelete = await api('DELETE', `/api/items/${createdItemId}`, { token: admin });
  ok('admin can delete item', adminDelete.status === 204, `got ${adminDelete.status}`);
  const opUsers = await api('GET', '/api/users', { token: operator });
  ok('operator cannot list users (403)', opUsers.status === 403);
  const adminUsers = await api('GET', '/api/users', { token: admin });
  ok('admin can list users', adminUsers.status === 200 && adminUsers.data.length === 5);

  console.log('\n=== VALIDATION ===');
  const badItem = await api('POST', '/api/items', { token: admin, body: { name: '' } });
  ok('empty name rejected (422)', badItem.status === 422, `got ${badItem.status}`);
  const weakPw = await api('POST', '/api/users', { token: admin, body: { username: 'zayif', password: '123', role: 'viewer' } });
  ok('weak password rejected', weakPw.status === 422 || weakPw.status === 400, `got ${weakPw.status}`);

  console.log('\n=== PRODUCTION (BOM → stock consumption) ===');
  // Bu route /:id ile ayni segment sayisina sahip oldugu icin production.js'de
  // /:id'DEN ONCE tanimli olmali - aksi halde Express "requirements-preview"
  // dizesini bir emir kimligi sanip yanlislikla 404 doner (bkz. gercek tarayicida
  // bulunan hata: "Yeni Uretim Emri" dialogu hep bu hatayi gosteriyordu).
  const reqs = await api('GET', `/api/production/requirements-preview?itemId=${setItem.id}&qty=5`, { token: admin });
  ok('requirements-preview gerçek reçete bileşenlerini döndürüyor (404 değil)',
    reqs.status === 200 && Array.isArray(reqs.data) && reqs.data.length > 0, JSON.stringify(reqs.data).slice(0, 200));
  ok('requirements-preview miktarı ölçekliyor (qty=5)',
    reqs.status === 200 && reqs.data[0].needed > 0, JSON.stringify(reqs.data[0]));
  const prodOrders = await api('GET', '/api/production', { token: admin });
  ok('production orders listed', prodOrders.status === 200);
  const completed = (prodOrders.data.data || prodOrders.data).find?.(p => p.status === 'Tamamlandı');
  ok('completed production has real cost', completed && completed.totalCost > 0, JSON.stringify(completed).slice(0, 140));

  const somunBefore = (await api('GET', `/api/items/${somunItem.id}`, { token: admin })).data.qty;
  const newProd = await api('POST', '/api/production', {
    token: operator,
    body: { itemId: setItem.id, qty: 3, lotNo: 'TEST-PARTI-1', laborCost: 500 }
  });
  ok('operator can create production order', newProd.status === 201, `got ${newProd.status} ${JSON.stringify(newProd.data).slice(0,140)}`);
  if (newProd.status === 201) {
    const done = await api('POST', `/api/production/${newProd.data.id}/complete`, { token: operator, body: { producedQty: 3, scrapQty: 0 } });
    ok('production completes and consumes lots', done.status === 200, `got ${done.status} ${JSON.stringify(done.data).slice(0,160)}`);
    const somunAfter = (await api('GET', `/api/items/${somunItem.id}`, { token: admin })).data.qty;
    ok('component stock decreased', somunAfter < somunBefore, `${somunBefore} → ${somunAfter}`);
  }

  const hugeProd = await api('POST', '/api/production', { token: admin, body: { itemId: setItem.id, qty: 100000 } });
  if (hugeProd.status === 201) {
    const hugeDone = await api('POST', `/api/production/${hugeProd.data.id}/complete`, { token: admin, body: { producedQty: 100000 } });
    ok('insufficient stock blocks production', hugeDone.status === 400, `got ${hugeDone.status}`);
    ok('shortfall detail returned', !!(hugeDone.data.shortfall || hugeDone.data.shortfalls), JSON.stringify(hugeDone.data).slice(0, 160));
    await api('DELETE', `/api/production/${hugeProd.data.id}`, { token: admin });
  } else ok('insufficient stock blocks production', false, `create failed ${hugeProd.status}`);

  console.log('\n=== PURCHASING ===');
  const sups = await api('GET', '/api/purchasing/suppliers', { token: admin });
  ok('suppliers listed with full card', sups.status === 200 && (sups.data.data || sups.data).length === 5);
  const pos = await api('GET', '/api/purchasing/orders', { token: admin });
  const poList = pos.data.data || pos.data;
  ok('purchase orders listed', pos.status === 200 && poList.length >= 3);
  const partial = poList.find(p => p.status === 'partially_received');
  ok('partial receipt state exists', !!partial, JSON.stringify(poList.map(p => p.status)));
  const pendingApproval = poList.find(p => p.approvalStatus === 'pending' || p.approval_status === 'pending');
  ok('PO pending approval exists', !!pendingApproval);

  if (pendingApproval) {
    const opApprove = await api('POST', `/api/purchasing/orders/${pendingApproval.id}/approve`, { token: operator });
    ok('operator cannot approve PO (403)', opApprove.status === 403, `got ${opApprove.status}`);
    const mgrApprove = await api('POST', `/api/purchasing/orders/${pendingApproval.id}/approve`, { token: manager });
    ok('manager can approve PO', mgrApprove.status === 200, `got ${mgrApprove.status} ${JSON.stringify(mgrApprove.data).slice(0,140)}`);
  }

  const rfqCompare = await api('GET', '/api/purchasing/rfqs', { token: admin });
  const rfq = (rfqCompare.data.data || rfqCompare.data)[0];
  if (rfq) {
    const cmp = await api('GET', `/api/purchasing/rfqs/${rfq.id}/compare`, { token: admin });
    ok('RFQ comparison works', cmp.status === 200, JSON.stringify(cmp.data).slice(0, 160));
  } else ok('RFQ comparison works', false, 'no rfq seeded');

  console.log('\n=== QUALITY ===');
  const insps = await api('GET', '/api/quality/inspections', { token: quality });
  const inspList = insps.data.data || insps.data;
  ok('inspections listed', insps.status === 200 && inspList.length > 0);
  const pendingInsp = inspList.find(i => i.result === 'pending');
  ok('pending incoming inspection exists', !!pendingInsp);

  if (pendingInsp) {
    const opInsp = await api('POST', `/api/quality/inspections/${pendingInsp.id}/result`, {
      token: operator, body: { result: 'accepted', acceptedQty: 300, rejectedQty: 0 }
    });
    ok('operator cannot record inspection result (403)', opInsp.status === 403, `got ${opInsp.status}`);
    const qInsp = await api('POST', `/api/quality/inspections/${pendingInsp.id}/result`, {
      token: quality, body: { result: 'accepted', acceptedQty: 300, rejectedQty: 0, lines: [] }
    });
    ok('quality can accept inspection (releases quarantine)', qInsp.status === 200, `got ${qInsp.status} ${JSON.stringify(qInsp.data).slice(0,160)}`);
  }

  const ncrs = await api('GET', '/api/quality/ncrs', { token: quality });
  ok('NCRs listed', ncrs.status === 200 && (ncrs.data.data || ncrs.data).length > 0);
  const capas = await api('GET', '/api/quality/capas', { token: quality });
  ok('CAPAs listed', capas.status === 200);
  const equip = await api('GET', '/api/quality/equipment', { token: quality });
  ok('equipment/calibration listed', equip.status === 200 && (equip.data.data || equip.data).length === 3);

  console.log('\n=== TRACEABILITY / RECALL ===');
  const setLots = (await api('GET', `/api/stock/lots?itemId=${setItem.id}&pageSize=50`, { token: admin })).data.data;
  const prodLot = setLots.find(l => l.lotNo === 'PARTI-SET-0901');
  ok('production output lot exists', !!prodLot);
  if (prodLot) {
    const back = await api('GET', `/api/quality/trace/backward/${prodLot.lotId || prodLot.id}`, { token: quality });
    ok('backward trace works (what went in)', back.status === 200, JSON.stringify(back.data).slice(0, 160));
    const fwd = await api('GET', `/api/quality/trace/forward/${prodLot.lotId || prodLot.id}`, { token: quality });
    ok('forward trace works (where it went)', fwd.status === 200);
    const recall = await api('GET', `/api/quality/recall/${prodLot.lotId || prodLot.id}`, { token: quality });
    ok('recall report identifies customers', recall.status === 200, JSON.stringify(recall.data).slice(0, 200));
  }

  console.log('\n=== SALES & PROFITABILITY ===');
  const customers = await api('GET', '/api/sales/customers', { token: admin });
  ok('customers listed', customers.status === 200 && customers.data.data.length === 3);
  const sos = await api('GET', '/api/sales/orders', { token: admin });
  ok('sales orders listed', sos.status === 200 && sos.data.data.length >= 2);
  const shipments = await api('GET', '/api/sales/shipments', { token: admin });
  ok('shipments listed', shipments.status === 200 && shipments.data.data.length >= 1);
  const shipWithLot = shipments.data.data[0];
  ok('shipment carries lot reference', shipWithLot && shipWithLot.items[0]?.lotNo, JSON.stringify(shipWithLot?.items?.[0]));

  // Regresyon: server/services/stock.js hiç var olmayan stock.allocate()/
  // stock.consume() fonksiyonlarını çağırıyordu (server/routes/sales.js:232,234) —
  // bu yüzden "Yeni Sevkiyat" HİÇBİR ZAMAN kaydedilemiyordu, ne FEFO otomatik lot
  // seçimiyle ne de elle seçilen bir lotla — her ikisi de aynı stock.consume()
  // çağrısından geçiyordu. Yukarıdaki "shipments listed" testi yalnızca SEED
  // verisindeki (sunucu başlarken elle SQL ile eklenen) sevkiyatları okuduğu için
  // bu tam kapsamlı çökme hiçbir testte hiç yakalanmamıştı. Artık gerçek bir POST
  // ile hem FEFO hem elle lot seçimi yolu kontrol ediliyor.
  const setItemBefore = (await api('GET', `/api/items/${setItem.id}`, { token: admin })).data.qty;
  const fefoShip = await api('POST', '/api/sales/shipments', {
    token: operator,
    body: { type: 'Yurt İçi', destination: 'Test Depo FEFO', items: [{ itemId: setItem.id, qty: 1 }], crates: [] }
  });
  ok('FEFO otomatik lot seçimiyle sevkiyat oluşturuluyor (stock.allocate/consume gerçekten var)',
    fefoShip.status === 201, `got ${fefoShip.status} ${JSON.stringify(fefoShip.data).slice(0, 200)}`);
  if (fefoShip.status === 201) {
    ok('FEFO sevkiyatı gerçek bir lot taşıyor', !!fefoShip.data.items[0]?.lotId, JSON.stringify(fefoShip.data.items[0]));
    const setItemAfterFefo = (await api('GET', `/api/items/${setItem.id}`, { token: admin })).data.qty;
    ok('FEFO sevkiyatı stoğu gerçekten düşürüyor', setItemAfterFefo === setItemBefore - 1, `${setItemBefore} → ${setItemAfterFefo}`);
  }

  const explicitLot = (await api('GET', `/api/stock/lots?itemId=${setItem.id}&pageSize=50`, { token: admin }))
    .data.data.find(l => l.status === 'available' && l.qty >= 1);
  if (explicitLot) {
    const explicitShip = await api('POST', '/api/sales/shipments', {
      token: operator,
      body: { type: 'Yurt İçi', destination: 'Test Depo Elle Lot', items: [{ itemId: setItem.id, qty: 1, lotId: explicitLot.id }], crates: [] }
    });
    ok('elle seçilen lotla sevkiyat oluşturuluyor', explicitShip.status === 201,
      `got ${explicitShip.status} ${JSON.stringify(explicitShip.data).slice(0, 200)}`);
  }

  const profit = await api('GET', '/api/sales/profitability?groupBy=item', { token: manager });
  ok('profitability computed', profit.status === 200 && profit.data.totals.revenueBase > 0,
    JSON.stringify(profit.data.totals));
  ok('margin uses real lot cost', profit.data?.totals?.costBase > 0);

  console.log('\n=== REPORTS ===');
  const summary = await api('GET', '/api/reports/summary', { token: viewer });
  ok('dashboard summary (viewer allowed)', summary.status === 200 && summary.data.totalValueTRY > 0,
    JSON.stringify(summary.data).slice(0, 200));
  ok('quarantine value tracked separately', summary.data.quarantineValueTRY !== undefined);
  const trends = await api('GET', '/api/reports/trends?months=12', { token: admin });
  ok('trend report works', trends.status === 200 && Array.isArray(trends.data.periods));
  const dead = await api('GET', '/api/reports/dead-stock?days=180', { token: admin });
  ok('dead stock report works', dead.status === 200 && dead.data.items.length > 0,
    `value ${dead.data.deadStockValueBase}`);
  const turn = await api('GET', '/api/reports/turnover', { token: admin });
  ok('turnover report works', turn.status === 200 && turn.data.data.length > 0);
  const abc = await api('GET', '/api/reports/abc', { token: admin });
  ok('ABC analysis works', abc.status === 200);
  const reorder = await api('GET', '/api/reports/reorder-suggestions', { token: admin });
  ok('reorder suggestions work', reorder.status === 200, `${reorder.data.count} suggestions`);
  const supPerf = await api('GET', '/api/reports/supplier-performance', { token: manager });
  ok('supplier performance scored', supPerf.status === 200 && supPerf.data.data.length === 5);
  const qkpi = await api('GET', '/api/reports/quality-kpis', { token: quality });
  ok('quality KPIs computed', qkpi.status === 200 && qkpi.data.production !== undefined);
  const val = await api('GET', '/api/reports/valuation', { token: admin });
  ok('valuation detail works', val.status === 200 && val.data.totalValueBase > 0);

  console.log('\n=== FX (historical) ===');
  const fxCur = await api('GET', '/api/exchange-rates/current', { token: admin });
  ok('current FX rates available', fxCur.status === 200 && fxCur.data.USD, JSON.stringify(fxCur.data));
  const fxAll = await api('GET', '/api/exchange-rates', { token: admin });
  ok('historical FX rates stored', fxAll.status === 200 && fxAll.data.total >= 8, `total ${fxAll.data.total}`);

  console.log('\n=== AUDIT LOG (old → new values) ===');
  const beforeName = (await api('GET', `/api/items/${sacItem.id}`, { token: admin })).data.name;
  await api('PUT', `/api/items/${sacItem.id}`, { token: admin, body: { salePrice: 999 } });
  const audit = await api('GET', '/api/audit?entityType=item&pageSize=20', { token: admin });
  const editEntry = audit.data.data.find(a => a.actionKey === 'auditItemEdit' && a.newValue);
  ok('audit records old and new values', !!(editEntry && editEntry.oldValue && editEntry.newValue),
    JSON.stringify(editEntry).slice(0, 200));

  console.log('\n=== NOTIFICATIONS ===');
  const scan = await api('POST', '/api/notifications/scan', { token: admin });
  ok('alert scan runs', scan.status === 200, JSON.stringify(scan.data));
  const notifs = await api('GET', '/api/notifications', { token: admin });
  ok('notifications generated', notifs.status === 200 && notifs.data.total > 0, `total ${notifs.data.total}`);

  console.log('\n=== STOCK COUNT ===');
  const cnt = await api('POST', '/api/stock/counts', { token: operator, body: { warehouseId: 1 } });
  ok('stock count created', cnt.status === 201, `got ${cnt.status} ${JSON.stringify(cnt.data).slice(0,140)}`);
  if (cnt.status === 201) {
    const detail = await api('GET', `/api/stock/counts/${cnt.data.id}`, { token: operator });
    ok('count sheet lists lots', detail.status === 200 && detail.data.lines.length > 0, `${detail.data?.lines?.length} lines`);
    const firstLine = detail.data.lines[0];
    const upd = await api('PUT', `/api/stock/counts/${cnt.data.id}/lines`, {
      token: operator, body: { lines: [{ id: firstLine.id, countedQty: firstLine.systemQty - 1 }] }
    });
    ok('counted quantities recorded', upd.status === 200, `got ${upd.status}`);
    const opApprove = await api('POST', `/api/stock/counts/${cnt.data.id}/approve`, { token: operator });
    ok('operator cannot approve count (403)', opApprove.status === 403, `got ${opApprove.status}`);
    const mgrApprove = await api('POST', `/api/stock/counts/${cnt.data.id}/approve`, { token: manager });
    ok('manager approves count and posts variance', mgrApprove.status === 200, `got ${mgrApprove.status} ${JSON.stringify(mgrApprove.data).slice(0,140)}`);
  }

  console.log('\n=== SESSION REVOCATION ===');
  const tmpTok = await login('viewer', 'Viewer123!');
  await api('POST', '/api/auth/logout', { token: tmpTok });
  const afterLogout = await api('GET', '/api/items', { token: tmpTok });
  ok('token revoked after logout', afterLogout.status === 401, `got ${afterLogout.status}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
