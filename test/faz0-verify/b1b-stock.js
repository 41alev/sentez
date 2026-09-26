// Batch 1b — sayım, tedarikçi iadesi, kalite, stok hareketleri, üretim, ürün
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');
const { invariants } = require('./inv');

(async () => {
  await start();
  const db = state.db;
  const whs = db.prepare('SELECT id FROM warehouses ORDER BY id').all().map(w => w.id);
  const sups = db.prepare('SELECT id FROM suppliers ORDER BY id').all().map(s => s.id);
  let seq = 0;
  const item = async (qty = 100, cost = 10, extra = {}) => {
    const it = await ok('POST', '/items', { name: 'BItem ' + (++seq), openingQty: qty, openingUnitCost: cost, ...extra });
    const lots = db.prepare('SELECT * FROM stock_lots WHERE item_id=? ORDER BY received_at').all(it.id);
    return { ...it, lot: lots[0], lots };
  };
  const lotOf = id => db.prepare('SELECT * FROM stock_lots WHERE id=?').get(id);
  const cacheOf = id => db.prepare('SELECT qty_cache FROM items WHERE id=?').get(id).qty_cache;
  const unchanged = async (fn, codes = [400, 404, 409, 422]) => {
    const before = snap(); const r = await fn(); statusIn(r, codes);
    assert.equal(snap(), before, 'durum değişti (kısmi yazma)'); return r;
  };
  const countLines = id => db.prepare('SELECT * FROM stock_count_lines WHERE count_id=?').all(id);

  console.log('\n[COUNT] sayım');
  await check('CNT-01', 'sayılmış satır yoksa onay 422', async () => {
    await item(5); const c = await ok('POST', '/stock/counts', {});
    await unchanged(() => api('POST', `/stock/counts/${c.id}/approve`, {}), [422]);
  });
  await check('CNT-02', 'temel akış: eksik/fazla sayım stok ve defteri doğru düzeltir; ikinci onay 409', async () => {
    const a = await item(50, 4), b = await item(30, 6); const c = await ok('POST', '/stock/counts', { warehouseId: a.lot.warehouse_id });
    const la = countLines(c.id).find(l => l.lot_id === a.lot.id), lb = countLines(c.id).find(l => l.lot_id === b.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: la.id, countedQty: 47, reason: 'fire' }, { id: lb.id, countedQty: 33 }] });
    const r = await ok('POST', `/stock/counts/${c.id}/approve`, {});
    assert.equal(r.adjusted, 2); assert.equal(r.totalDiff, 0);
    assert.equal(lotOf(a.lot.id).qty, 47); assert.equal(lotOf(b.lot.id).qty, 33);
    assert.equal(cacheOf(a.id), 47);
    statusIn(await api('POST', `/stock/counts/${c.id}/approve`, {}), [409]);
  });
  await check('CNT-03', 'satır doğrulaması: başka sayımın satırı, tekrar, negatif, NaN/metin, sonsuz', async () => {
    const a = await item(10); const c1 = await ok('POST', '/stock/counts', {}); const c2 = await ok('POST', '/stock/counts', {});
    const l1 = countLines(c1.id)[0], l2 = countLines(c2.id)[0];
    const put = lines => api('PUT', `/stock/counts/${c1.id}/lines`, { lines });
    await unchanged(() => put([{ id: l2.id, countedQty: 1 }]), [422]);
    await unchanged(() => put([{ id: l1.id, countedQty: 1 }, { id: l1.id, countedQty: 2 }]), [422]);
    await unchanged(() => put([]), [400, 422]);
    await unchanged(() => api('PUT', '/stock/counts/nope/lines', { lines: [{ id: 1, countedQty: 1 }] }), [404]);
    const accepted = [];
    for (const q of [-1, 'abc', null, '', ' ', false, [], true]) {
      const before = snap(); const r = await put([{ id: l1.id, countedQty: q }]);
      const stored = db.prepare('SELECT counted_qty FROM stock_count_lines WHERE id=?').get(l1.id).counted_qty;
      info('CNT-03b', `countedQty=${JSON.stringify(q)}`, { status: r.status, saklanan: stored });
      if (r.status === 200) accepted.push(`${JSON.stringify(q)}→${stored}`);
      db.prepare('UPDATE stock_count_lines SET counted_qty=NULL, difference=NULL WHERE id=?').run(l1.id);
      db.prepare("UPDATE stock_counts SET status='open' WHERE id=?").run(c1.id);
    }
    assert.equal(accepted.length, 0, 'boş/geçersiz girdi sayım miktarı olarak KABUL edildi: ' + accepted.join(', '));
  });
  await check('CNT-04', 'sayım açıldıktan sonra sayılan lotta hareket varsa onay 409', async () => {
    const a = await item(20); const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id).find(x => x.lot_id === a.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 20 }] });
    await ok('POST', '/stock/move', { itemId: a.id, type: 'out', qty: 1 });
    await unchanged(() => api('POST', `/stock/counts/${c.id}/approve`, {}), [409]);
  });
  await check('CNT-05', '0 sayılırsa parti tükenmiş olur, negatif oluşmaz', async () => {
    const a = await item(8); const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id).find(x => x.lot_id === a.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 0 }] });
    await ok('POST', `/stock/counts/${c.id}/approve`, {});
    assert.equal(lotOf(a.lot.id).qty, 0); assert.equal(lotOf(a.lot.id).status, 'consumed'); assert.equal(cacheOf(a.id), 0);
  });
  await check('CNT-06', 'rol matrisi (kayıt): viewer sayım açamaz/kaydedemez/onaylayamaz', async () => {
    const a = await item(5); const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id)[0];
    const matrix = {};
    for (const who of ['viewer', 'operator', 'quality', 'manager']) {
      matrix[who] = {
        create: (await api('POST', '/stock/counts', {}, who)).status,
        save: (await api('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 5 }] }, who)).status,
        approve: (await api('POST', `/stock/counts/${c.id}/approve`, {}, who)).status
      };
    }
    info('CNT-06b', 'sayım rol matrisi (create/save/approve HTTP kodu)', matrix);
    for (const k of ['create', 'save', 'approve']) assert.equal(matrix.viewer[k], 403, 'viewer ' + k);
  });
  await check('CNT-07', 'kapalı/olmayan sayımda kayıt: 409/404', async () => {
    const a = await item(5); const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id).find(x => x.lot_id === a.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 5 }] });
    await ok('POST', `/stock/counts/${c.id}/approve`, {});
    await unchanged(() => api('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 9 }] }), [409]);
  });
  await check('CNT-08', 'karantina lot sayımı kullanılabilir stok önbelleğini değiştirmez', async () => {
    const a = await item(10); await ok('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'quarantine' });
    const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id).find(x => x.lot_id === a.lot.id); assert(l, 'karantina lot sayıma girmedi');
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 9 }] });
    await ok('POST', `/stock/counts/${c.id}/approve`, {});
    assert.equal(lotOf(a.lot.id).qty, 9); assert.equal(cacheOf(a.id), 0);
  });
  await check('CNT-09', 'eşzamanlı iki onay: yalnız biri başarılı olur, çift düzeltme olmaz', async () => {
    const a = await item(10); const c = await ok('POST', '/stock/counts', {}); const l = countLines(c.id).find(x => x.lot_id === a.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: l.id, countedQty: 7 }] });
    const rs = await Promise.all([api('POST', `/stock/counts/${c.id}/approve`, {}), api('POST', `/stock/counts/${c.id}/approve`, {})]);
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
    assert.equal(lotOf(a.lot.id).qty, 7);
  });
  await check('CNT-10', 'sayım: sayılmayan lotlarda hareket onayı engellemez (yalnız sayılan satırlar)', async () => {
    const a = await item(10), b = await item(10); const c = await ok('POST', '/stock/counts', {});
    const la = countLines(c.id).find(x => x.lot_id === a.lot.id);
    await ok('PUT', `/stock/counts/${c.id}/lines`, { lines: [{ id: la.id, countedQty: 10 }] });
    await ok('POST', '/stock/move', { itemId: b.id, type: 'out', qty: 1 });
    const r = await api('POST', `/stock/counts/${c.id}/approve`, {});
    info('CNT-10b', 'başka lottaki hareket sonrası onay', { status: r.status });
    statusIn(r, [200]);
  });

  console.log('\n[RETURN] tedarikçi iadesi');
  await check('RET-01', 'lot tedarikçisi farklıysa veya belli değilse rastgele tedarikçiye iade edilemez', async () => {
    const a = await item(20); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    await unchanged(() => api('POST', '/purchasing/returns', { supplierId: sups[1], lotId: a.lot.id, qty: 1 }), [422]);
    const b = await item(20);
    const r = await api('POST', '/purchasing/returns', { supplierId: sups[1], lotId: b.lot.id, qty: 1 });
    info('RET-01b', 'tedarikçisi olmayan lot, rastgele tedarikçiye iade', { status: r.status });
    assert.equal(r.status, 422);
  });
  await check('RET-02', 'geçersiz miktar/lot/tedarikçi: 4xx (500 değil)', async () => {
    const a = await item(10); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    await unchanged(() => api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: 11 }));
    for (const q of [0, -1, 'x']) await unchanged(() => api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: q }), [400, 422]);
    await unchanged(() => api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: 'nope', qty: 1 }), [404]);
    const r = await api('POST', '/purchasing/returns', { supplierId: 999999, lotId: (await item(5)).lot.id, qty: 1 });
    info('RET-02b', 'olmayan tedarikçi id', { status: r.status });
    assert(r.status < 500, 'olmayan tedarikçi 500 verdi');
  });
  await check('RET-03', 'kullanılabilir (kalite onaylı) lottan iade kabul: mevcut davranış', async () => {
    const a = await item(10); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    const r = await api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: 2 });
    info('RET-03b', 'available lottan tedarikçi iadesi', { status: r.status });
  });
  await check('RET-04', 'iade kayıtları listelenir ve yalnız sıralı, yetkili durum geçişi kabul edilir', async () => {
    const a = await item(10); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    const created = await ok('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: 2, reason: 'Hasarlı malzeme' });
    const g = await api('GET', '/purchasing/returns'); statusIn(g, [200]);
    assert(g.data.data.some(x => x.id === created.id && x.status === 'open'));
    statusIn(await api('POST', `/purchasing/returns/${created.id}/status`, { status: 'credited' }), [409]);
    for (const status of ['shipped', 'credited', 'closed']) statusIn(await api('POST', `/purchasing/returns/${created.id}/status`, { status }), [200]);
    assert.equal(db.prepare('SELECT status FROM supplier_returns WHERE id=?').get(created.id).status, 'closed');
    const mv = db.prepare("SELECT item_name FROM movements WHERE ref_type='supplier_return' LIMIT 1").get();
    info('RET-04d', 'iade hareketinde ürün adı', { itemName: mv && mv.item_name }); assert(mv.item_name, 'ürün adı hareket izinde yok');
  });
  await check('RET-05', 'eşzamanlı iadeler lot miktarını aşamaz', async () => {
    const a = await item(100); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    const rs = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: 30 })));
    assert.equal(rs.filter(r => r.status === 201).length, 3); assert.equal(lotOf(a.lot.id).qty, 10);
  });
  await check('RET-06', 'rol: viewer/quality iade yapamaz mı (kayıt), viewer kesin 403', async () => {
    const a = await item(10); db.prepare('UPDATE stock_lots SET supplier_id=? WHERE id=?').run(sups[0], a.lot.id);
    const m = {}; for (const who of ['viewer', 'quality', 'operator']) m[who] = (await api('POST', '/purchasing/returns', { supplierId: sups[0], lotId: a.lot.id, qty: 1 }, who)).status;
    info('RET-06b', 'iade rol matrisi', m); assert.equal(m.viewer, 403);
  });

  console.log('\n[QUALITY] kalite');
  const qLot = async (qty = 10) => { const a = await item(qty); await ok('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'quarantine' }); return a; };
  const insp = async (a, type = 'incoming') => ok('POST', '/quality/inspections', { type, lotId: a.lot.id });
  const result = (id, body, who) => api('POST', `/quality/inspections/${id}/result`,
    { ...body, signaturePassword: who === 'quality' ? 'Kalite123!' : 'Admin123!' }, who);
  await check('Q-01', 'tam kabul: karantina → kullanılabilir; ikinci sonuç 4xx', async () => {
    const a = await qLot(10); const i = await insp(a);
    statusIn(await result(i.id, { result: 'accepted', acceptedQty: 10, rejectedQty: 0 }), [200]);
    assert.equal(lotOf(a.lot.id).status, 'available'); assert.equal(cacheOf(a.id), 10);
    await unchanged(() => result(i.id, { result: 'accepted' }), [400, 409]);
  });
  await check('Q-02', 'negatif/ondalık/fazla miktar reddedilir', async () => {
    const a = await qLot(10); const i = await insp(a);
    for (const b of [{ result: 'accepted', acceptedQty: -1 }, { result: 'accepted', acceptedQty: 11 }, { result: 'rejected', rejectedQty: 5, acceptedQty: 4 }, { result: 'conditional', acceptedQty: 5.5, rejectedQty: 4 }])
      await unchanged(() => result(i.id, b), [400, 422]);
  });
  await check('Q-03', 'tam ret: lot rejected + NCR açılır', async () => {
    const a = await qLot(6); const i = await insp(a);
    const r = await ok('POST', `/quality/inspections/${i.id}/result`, { result: 'rejected', signaturePassword: 'Admin123!' });
    assert(r.ncrId); assert.equal(lotOf(a.lot.id).status, 'rejected'); assert.equal(cacheOf(a.id), 0);
  });
  await check('Q-04', 'rol: viewer/operator kalite sonucu giremez', async () => {
    const a = await qLot(3); const i = await insp(a);
    for (const who of ['viewer', 'operator']) await unchanged(() => result(i.id, { result: 'accepted' }, who), [403]);
  });
  await check('Q-05', 'lot miktarı muayeneden sonra değiştiyse sonuç 409', async () => {
    const a = await qLot(10); const i = await insp(a); db.prepare('UPDATE stock_lots SET qty=9 WHERE id=?').run(a.lot.id);
    await unchanged(() => result(i.id, { result: 'accepted' }), [409]);
    db.prepare('UPDATE stock_lots SET qty=10 WHERE id=?').run(a.lot.id);
  });
  await check('Q-06', 'ölçüm satırı FAIL iken genel sonuç ACCEPTED kabul ediliyor mu (bilgi)', async () => {
    const a = await item(10); await ok('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'quarantine' });
    await ok('POST', '/quality/plans', { itemId: a.id, type: 'incoming', characteristic: 'Kalınlık', specMin: 1.9, specMax: 2.1 }).catch(() => {});
    const i = await insp(a); const line = (await ok('GET', '/quality/inspections/' + i.id)).lines[0];
    if (!line) return info('Q-06b', 'plan satırı oluşmadı', {});
    const r = await result(i.id, { result: 'accepted', lines: [{ id: line.id, measuredValue: 9.9, result: 'fail' }] });
    info('Q-06b', 'ölçüm 9.9 (spec 1.9–2.1), satır=fail, genel=accepted', { status: r.status, lot: lotOf(a.lot.id).status });
  });
  await check('Q-07', 'partisiz (final/in_process) muayenede kabul/ret adedi girilebiliyor mu', async () => {
    const a = await item(5);
    const i = await ok('POST', '/quality/inspections', { type: 'final', itemId: a.id, sampleSize: 10 });
    const r = await result(i.id, { result: 'conditional', acceptedQty: 8, rejectedQty: 2 });
    info('Q-07b', 'partisiz muayene 8 kabul / 2 ret', { status: r.status, body: r.data });
    const r2 = await api('POST', '/quality/inspections', { type: 'final', itemId: a.id, sampleSize: 10 }).then(x => x.data);
    const r3 = await result(r2.id, { result: 'accepted' });
    info('Q-07c', 'partisiz muayene accepted (adetsiz)', { status: r3.status });
  });
  await check('Q-08', 'eşzamanlı iki sonuç girişi: biri başarılı', async () => {
    const a = await qLot(10); const i = await insp(a);
    const rs = await Promise.all([result(i.id, { result: 'accepted' }), result(i.id, { result: 'rejected' })]);
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 400]);
  });
  await check('Q-09', 'geçersiz tip/olmayan lot 4xx', async () => {
    statusIn(await api('POST', '/quality/inspections', { type: 'xx', lotId: 'a' }), [400, 422]);
    statusIn(await api('POST', '/quality/inspections', { type: 'incoming', lotId: 'nope' }), [404]);
    statusIn(await api('POST', '/quality/inspections', { type: 'incoming' }), [400]);
  });

  console.log('\n[MOVE] stok hareketleri, durum, transfer');
  await check('MV-01', 'manuel çıkış: stoğu aşan 400, tam çıkış lotu tüketir, olmayan ürün 404, geçersiz miktar 4xx', async () => {
    const a = await item(10);
    await unchanged(() => api('POST', '/stock/move', { itemId: a.id, type: 'out', qty: 11 }), [400]);
    for (const q of [0, -1, 'x']) await unchanged(() => api('POST', '/stock/move', { itemId: a.id, type: 'out', qty: q }), [400, 422]);
    statusIn(await api('POST', '/stock/move', { itemId: a.id, type: 'out', qty: 10 }), [200]);
    assert.equal(lotOf(a.lot.id).status, 'consumed');
    statusIn(await api('POST', '/stock/move', { itemId: 'nope', type: 'in', qty: 1 }), [404]);
  });
  await check('MV-02', 'giriş: olmayan depo, negatif maliyet, geçersiz son kullanma tarihi 4xx', async () => {
    const a = await item(1);
    const cases = [{ warehouseId: 999999 }, { unitCost: -1 }, { expiryDate: 'abc' }, { expiryDate: '2026-02-30' }];
    const bad = [];
    for (const c of cases) {
      const r = await api('POST', '/stock/move', { itemId: a.id, type: 'in', qty: 1, ...c });
      info('MV-02b', JSON.stringify(c), { status: r.status });
      if (r.status >= 500 || (c.expiryDate && r.status === 200)) bad.push(JSON.stringify(c) + ' -> ' + r.status);
    }
    assert.equal(bad.length, 0, 'sorunlu: ' + bad.join('; '));
  });
  await check('MV-03', 'lot durum değişimi: fazla miktar, tükenmiş lot, kısmi bölme, yetkisiz rol', async () => {
    const a = await item(10);
    await unchanged(() => api('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'blocked', qty: 11 }), [400, 422]);
    await unchanged(() => api('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'blocked', qty: 0 }), [400, 422]);
    await unchanged(() => api('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'consumed' }), [400, 422]);
    await ok('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'quarantine', qty: 4 });
    assert.equal(cacheOf(a.id), 6);
    const m = {}; for (const who of ['viewer', 'operator', 'quality', 'manager']) m[who] = (await api('POST', '/stock/lot-status', { lotId: a.lot.id, toStatus: 'available', qty: 1 }, who)).status;
    info('MV-03b', 'lot-status rol matrisi', m); assert.equal(m.viewer, 403);
  });
  await check('MV-04', 'transfer: fazla miktar, aynı depo, olmayan depo, tükenmiş lot', async () => {
    const a = await item(10); const other = whs.find(w => w !== a.lot.warehouse_id);
    await unchanged(() => api('POST', '/stock/transfer', { lotId: a.lot.id, targetWarehouseId: other, qty: 11 }), [400, 422]);
    await unchanged(() => api('POST', '/stock/transfer', { lotId: a.lot.id, targetWarehouseId: a.lot.warehouse_id }), [400, 422]);
    await unchanged(() => api('POST', '/stock/transfer', { lotId: a.lot.id, targetWarehouseId: 999999 }), [404]);
    await ok('POST', '/stock/move', { itemId: a.id, type: 'out', qty: 10 });
    await unchanged(() => api('POST', '/stock/transfer', { lotId: a.lot.id, targetWarehouseId: other }), [400, 422]);
  });
  await check('MV-05', 'eşzamanlı manuel çıkışlar stoğu aşamaz', async () => {
    const a = await item(10);
    const rs = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/stock/move', { itemId: a.id, type: 'out', qty: 3 })));
    assert.equal(rs.filter(r => r.status === 200).length, 3); assert.equal(cacheOf(a.id), 1);
  });
  await check('MV-06', 'pasif (soft-delete) depo ve hareket listeleri sayfalama sınırı', async () => {
    const r = await api('GET', '/stock/movements?pageSize=100000&page=-3'); info('MV-06b', 'movements pageSize=100000,page=-3', { status: r.status, pageSize: r.data && r.data.pageSize });
    assert(r.status < 500);
  });

  console.log('\n[PROD] üretim');
  const mkBom = async (qtyComp = 100) => {
    const c1 = await item(qtyComp, 10), c2 = await item(qtyComp, 20);
    const fin = await ok('POST', '/items', { name: 'BFinal ' + (++seq), itemType: 'finished', bom: [{ componentItemId: c1.id, qtyPerUnit: 2, scrapPct: 10 }, { componentItemId: c2.id, qtyPerUnit: 1 }] });
    return { c1, c2, fin };
  };
  await check('PR-01', 'üretim tamamlama: hammadde tüketimi (fire dahil), çıktı lotu, maliyet', async () => {
    const { c1, c2, fin } = await mkBom(); const po = await ok('POST', '/production', { itemId: fin.id, qty: 10, laborCost: 50, overheadCost: 30 });
    const r = await ok('POST', `/production/${po.id}/complete`, {});
    assert(Math.abs(cacheOf(c1.id) - (100 - 22)) < 1e-6, 'c1 ' + cacheOf(c1.id)); assert.equal(cacheOf(c2.id), 90);
    assert.equal(cacheOf(fin.id), 10);
    const mat = 22 * 10 + 10 * 20; const unit = (mat + 50 + 30) / 10;
    const out = lotOf(r.outputLotId); assert(Math.abs(out.unit_cost - unit) < 1e-6, `birim maliyet ${out.unit_cost} beklenen ${unit}`);
  });
  await check('PR-02', 'yetersiz hammaddede tamamlama 400 ve kısmi tüketim yok', async () => {
    const { c1, c2, fin } = await mkBom(); await ok('POST', '/stock/move', { itemId: c2.id, type: 'out', qty: 95 });
    const po = await ok('POST', '/production', { itemId: fin.id, qty: 10 });
    await unchanged(() => api('POST', `/production/${po.id}/complete`, {}), [400]);
  });
  await check('PR-03', 'iki kez tamamlama reddedilir; eşzamanlı iki tamamlama tek etki', async () => {
    const { fin, c1 } = await mkBom(); const po = await ok('POST', '/production', { itemId: fin.id, qty: 5 });
    const rs = await Promise.all([api('POST', `/production/${po.id}/complete`, {}), api('POST', `/production/${po.id}/complete`, {})]);
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 400]);
    assert.equal(cacheOf(fin.id), 5);
  });
  await check('PR-04', 'üretilen 0 + fire > 0: çıktı lotu yok, tüketim var', async () => {
    const { fin, c2 } = await mkBom(); const po = await ok('POST', '/production', { itemId: fin.id, qty: 5 });
    const r = await ok('POST', `/production/${po.id}/complete`, { producedQty: 0, scrapQty: 5 });
    assert.equal(r.outputLotId, null); assert.equal(cacheOf(fin.id), 0); assert.equal(cacheOf(c2.id), 95);
  });
  await check('PR-05', 'silme: tamamlanan 400; planlı 204; operasyonu planlanmış emir silinince (FK) 500 olmamalı', async () => {
    const { fin } = await mkBom(); const done = await ok('POST', '/production', { itemId: fin.id, qty: 1 }); await ok('POST', `/production/${done.id}/complete`, {});
    await unchanged(() => api('DELETE', '/production/' + done.id), [400]);
    const plan = await ok('POST', '/production', { itemId: fin.id, qty: 1 });
    const shf = (await ok('POST', '/planning/shifts', { code: 'V' + Date.now(), name: 'V', startTime: '08:00', endTime: '16:00', weekdays: [1, 2, 3, 4, 5, 6, 7] })).id;
    const wc = (await ok('POST', '/planning/work-centers', { code: 'W' + Date.now(), name: 'V', shiftIds: [shf] })).id;
    await ok('PUT', '/planning/routings/' + fin.id, { operations: [{ operationNo: 10, operationName: 'Op', workCenterId: wc, runMinutesPerUnit: 5 }] });
    const sched = await api('POST', '/planning/schedule/' + plan.id, {});
    info('PR-05b', 'operasyon planlama', { status: sched.status, ops: db.prepare('SELECT COUNT(*) n FROM production_operations WHERE production_order_id=?').get(plan.id).n });
    const del = await api('DELETE', '/production/' + plan.id);
    info('PR-05c', 'planlı (operasyonlu) emir sil', { status: del.status, body: del.data });
    assert(del.status < 500, 'silme 500 verdi');
  });
  await check('PR-06', 'reçetesiz ürün 400; bileşen override ile olmayan ürün', async () => {
    const a = await item(5); statusIn(await api('POST', '/production', { itemId: a.id, qty: 1 }), [400]);
    const { fin } = await mkBom();
    const r = await api('POST', '/production', { itemId: fin.id, qty: 1, components: [{ componentItemId: 'nope', qty: 1 }] });
    info('PR-06b', 'bileşen override: olmayan ürün id', { status: r.status });
    if (r.status === 201) { const c = await api('POST', `/production/${r.data.id}/complete`, {}); info('PR-06c', 'sahte bileşenli emri tamamla', { status: c.status, body: c.data }); assert(c.status < 500); }
  });
  await check('PR-07', 'karantinadaki hammadde tüketilmez', async () => {
    const { c1, fin } = await mkBom(); await ok('POST', '/stock/lot-status', { lotId: c1.lot.id, toStatus: 'quarantine' });
    const po = await ok('POST', '/production', { itemId: fin.id, qty: 5 });
    await unchanged(() => api('POST', `/production/${po.id}/complete`, {}), [400]);
  });
  await check('PR-08', 'geçersiz üretim miktarları reddedilir', async () => {
    const { fin } = await mkBom(); for (const q of [0, -1, 'x']) statusIn(await api('POST', '/production', { itemId: fin.id, qty: q }), [400, 422]);
    const po = await ok('POST', '/production', { itemId: fin.id, qty: 1 });
    for (const b of [{ producedQty: -1 }, { scrapQty: -1 }, { producedQty: 'x' }]) await unchanged(() => api('POST', `/production/${po.id}/complete`, b), [400, 422]);
  });
  await check('PR-09', 'rol: viewer üretim oluşturamaz/tamamlayamaz', async () => {
    const { fin } = await mkBom(); const po = await ok('POST', '/production', { itemId: fin.id, qty: 1 });
    statusIn(await api('POST', '/production', { itemId: fin.id, qty: 1 }, 'viewer'), [403]);
    await unchanged(() => api('POST', `/production/${po.id}/complete`, {}, 'viewer'), [403]);
  });

  console.log('\n[ITEM] ürün kartı');
  await check('IT-01', 'stoklu ürün silinemez; silinen ürünün kullanımı tutarlı mı (bilgi)', async () => {
    const a = await item(5); await unchanged(() => api('DELETE', '/items/' + a.id), [400]);
    const z = await item(0); statusIn(await api('DELETE', '/items/' + z.id), [204]);
    const cust = (await api('GET', '/sales/customers')).data.data[0].id;
    const so = await api('POST', '/sales/orders', { customerId: cust, lines: [{ itemId: z.id, qty: 1, price: 1 }] });
    const mv = await api('POST', '/stock/move', { itemId: z.id, type: 'in', qty: 1 });
    const pr = await api('POST', '/production', { itemId: z.id, qty: 1 });
    info('IT-01b', 'silinmiş ürüne: sipariş / stok girişi / üretim', { siparis: so.status, giris: mv.status, uretim: pr.status });
  });
  await check('IT-02', 'reçetede kullanılan ürün silinemez; mükerrer kod/barkod 409', async () => {
    const comp = await item(0); const fin = await ok('POST', '/items', { name: 'F', itemType: 'finished', bom: [{ componentItemId: comp.id, qtyPerUnit: 1 }] });
    const d = await api('DELETE', '/items/' + comp.id); info('IT-02b', 'reçete bileşeni ürünü sil', { status: d.status });
    const c1 = await api('POST', '/items', { name: 'dupA', code: 'DUPCODE', barcode: 'DUPBAR' });
    const c2 = await api('POST', '/items', { name: 'dupB', code: 'DUPCODE', barcode: 'DUPBAR' });
    info('IT-02c', 'mükerrer kod/barkod', { ilk: c1.status, ikinci: c2.status });
    assert.equal(d.status, 409, 'aktif reçete bileşeni silinebildi');
    assert.equal(c1.status, 201); assert.equal(c2.status, 409, 'mükerrer kod/barkod reddedilmedi');
  });
  await check('IT-03', 'BOM: dolaylı döngü (A→B→A) reddedilmeli; mükerrer/olmayan bileşen davranışı', async () => {
    const a = await item(0), b = await item(0);
    await ok('PUT', '/items/' + a.id, { bom: [{ componentItemId: b.id, qtyPerUnit: 1 }] });
    const r = await api('PUT', '/items/' + b.id, { bom: [{ componentItemId: a.id, qtyPerUnit: 1 }] });
    info('IT-03b', 'A→B sonra B→A', { status: r.status });
    const dup = await api('PUT', '/items/' + a.id, { bom: [{ componentItemId: b.id, qtyPerUnit: 1 }, { componentItemId: b.id, qtyPerUnit: 2 }] });
    info('IT-03c', 'mükerrer bileşen satırı', { status: dup.status });
    const ghost = await api('PUT', '/items/' + a.id, { bom: [{ componentItemId: 'ghost', qtyPerUnit: 1 }] });
    info('IT-03d', 'olmayan bileşen id', { status: ghost.status, bom: ghost.data && ghost.data.bom });
    assert(dup.status < 500, 'mükerrer bileşen 500');
    assert(r.status >= 400, 'dolaylı BOM döngüsü kabul edildi');
  });
  await check('IT-04', 'olmayan depo ile ürün oluşturma 4xx', async () => {
    const r = await api('POST', '/items', { name: 'depo yok', warehouseId: 999999, openingQty: 1 });
    info('IT-04b', 'olmayan depo id', { status: r.status }); assert(r.status < 500, '500');
  });
  await check('IT-05', 'ürün alan sınırları: çok uzun ad/negatif/NaN/eksik', async () => {
    for (const b of [{ name: '' }, { name: 'x'.repeat(500) }, { name: 'ok', minStock: -1 }, { name: 'ok', salePrice: 'abc' }, { name: 'ok', openingQty: -5 }, { name: 'ok', itemType: 'zzz' }])
      statusIn(await api('POST', '/items', b), [400, 422]);
  });

  console.log('\n[COERCE] boş/null/false değerlerin sayıya sessizce 0 olarak dönüşmesi (girdi doğrulama)');
  const cust0 = (await api('GET', '/sales/customers')).data.data[0].id;
  await check('CO-01', "satış siparişi satır fiyatı ''/null/false → 0 olarak KABUL edilmemeli", async () => {
    const a = await item(5); const acc = [];
    for (const p of ['', null, false, []]) {
      const r = await api('POST', '/sales/orders', { customerId: cust0, lines: [{ itemId: a.id, qty: 1, price: p }] });
      info('CO-01b', `price=${JSON.stringify(p)}`, { status: r.status });
      if (r.status === 201) acc.push(JSON.stringify(p));
    }
    assert.equal(acc.length, 0, 'fiyatı boş/geçersiz sipariş kabul edildi: ' + acc.join(', '));
  });
  await check('CO-02', "stok girişinde unitCost ''/null → 0 maliyetli parti oluşmamalı", async () => {
    const a = await item(10, 50); const acc = [];
    for (const c of ['', null, false]) {
      const r = await api('POST', '/stock/move', { itemId: a.id, type: 'in', qty: 1, unitCost: c });
      const avg = db.prepare('SELECT avg_cost FROM items WHERE id=?').get(a.id).avg_cost;
      info('CO-02b', `unitCost=${JSON.stringify(c)}`, { status: r.status, ortMaliyet: avg });
      if (r.status === 200) acc.push(JSON.stringify(c));
    }
    assert.equal(acc.length, 0, 'boş maliyet 0 olarak kabul edildi: ' + acc.join(', '));
  });
  await check('CO-03', "müşteri PUT creditLimit ''/null → kredi limiti sessizce kaldırılmamalı", async () => {
    const c = await ok('POST', '/sales/customers', { name: 'Limit 500', creditLimit: 500 });
    const invalid = await api('PUT', '/sales/customers/' + c.id, { creditLimit: '' });
    assert.equal(invalid.status, 422, `boş kredi limiti 422 yerine ${invalid.status} döndü`);
    const after = (await ok('GET', '/sales/customers/' + c.id)).credit_limit;
    info('CO-03b', "creditLimit='' gönderildi", { status: invalid.status, sonuc: after });
    assert.equal(after, 500, 'kredi limiti 500 iken boş girdiyle ' + after + ' oldu (0 = limitsiz)');
  });
  await check('CO-04', "ürün minStock/salePrice ''/null → 0'a dönüşmemeli", async () => {
    const acc = [];
    for (const f of ['minStock', 'salePrice', 'reorderQty']) for (const v of ['', null]) {
      const r = await api('POST', '/items', { name: 'co-' + f, [f]: v }); info('CO-04b', `${f}=${JSON.stringify(v)}`, { status: r.status });
      if (r.status === 201) acc.push(`${f}=${JSON.stringify(v)}`);
    }
    assert.equal(acc.length, 0, 'kabul edilenler: ' + acc.join(', '));
  });
  await check('CO-05', "boolean alanlar: 'false' metni true olmamalı (isLotTracked)", async () => {
    const r = await ok('POST', '/items', { name: 'boolean-test', isLotTracked: 'false' });
    info('CO-05b', "isLotTracked='false'", { saklanan: r.isLotTracked });
    assert.equal(r.isLotTracked, false);
  });
  await check('CO-06', 'BOM güncellemesinde olmayan bileşen id, mevcut reçeteyi sessizce silmemeli', async () => {
    const comp = await item(0), fin = await ok('POST', '/items', { name: 'bom-wipe', itemType: 'finished', bom: [{ componentItemId: comp.id, qtyPerUnit: 3 }] });
    assert.equal(fin.bom.length, 1);
    const r = await api('PUT', '/items/' + fin.id, { bom: [{ componentItemId: 'ghost-id', qtyPerUnit: 1 }] });
    const bomNow = db.prepare('SELECT COUNT(*) n FROM item_bom WHERE item_id=?').get(fin.id).n;
    info('CO-06b', 'yalnız olmayan bileşenli BOM gönderildi', { status: r.status, kalanBomSatiri: bomNow });
    assert(r.status >= 400 || bomNow === 1, `HTTP ${r.status}: mevcut reçete (1 satır) sessizce ${bomNow} satıra düştü`);
  });

  console.log('\n[INVARIANTS]');
  await check('INV-ALL', 'küresel değişmezler', async () => { const v = invariants(); assert.equal(v.length, 0, v.slice(0, 12).join('\n')); });
  await finish('b1b-stock');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
