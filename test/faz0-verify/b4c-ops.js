// Batch 4c — MRP / planlama / veri sağlığı (birleştirme, toplu güncelleme) / muhasebe aktarımı / raporlar
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');
const { invariants } = require('./inv');

(async () => {
  await start({});
  const db = state.db;
  const whs = db.prepare('SELECT id FROM warehouses ORDER BY id').all().map(w => w.id);
  const sups = db.prepare('SELECT id FROM suppliers WHERE is_approved=1 ORDER BY id').all().map(s => s.id);
  db.prepare('UPDATE approval_rules SET is_active=0').run();
  let seq = 0;
  const item = async (qty = 0, extra = {}) => ok('POST', '/items', { name: 'OItem ' + (++seq), openingQty: qty, openingUnitCost: 10, ...extra });
  const cust = async n => ok('POST', '/sales/customers', { name: n });
  const timed = async fn => { const t = Date.now(); const r = await fn(); return { r, ms: Date.now() - t }; };

  /* ------------------------------------------------ MRP */
  console.log('\n[MRP]');
  let cSug, fSug, compItem, finItem;
  await check('MP-01', 'MRP: talep → mamul (make) + bileşen (buy) önerisi; miktarlar reçeteden doğru türer', async () => {
    compItem = await item(0, { procurementType: 'buy', defaultSupplierId: sups[0] });
    finItem = await ok('POST', '/items', { name: 'OFin', itemType: 'finished', procurementType: 'make', bom: [{ componentItemId: compItem.id, qtyPerUnit: 2 }] });
    const createdAs = db.prepare('SELECT procurement_type p, default_supplier_id d FROM items WHERE id IN (?,?) ORDER BY name').all(finItem.id, compItem.id);
    info('MP-00', "POST /items ile procurementType:'make' ve defaultSupplierId gönderildi; DB'de kalan", createdAs);
    state.createIgnoresProcurement = createdAs.some(r => r.p === 'buy') && db.prepare('SELECT procurement_type p FROM items WHERE id=?').get(finItem.id).p !== 'make';
    // MRP'yi sınamak için import/toplu güncelleme yolundan ata (UI'da bu alan yok)
    await ok('POST', '/data-health/bulk-update/items', { itemIds: [finItem.id], field: 'procurementType', value: 'make' });
    await ok('POST', '/data-health/bulk-update/items', { itemIds: [compItem.id], field: 'defaultSupplierId', value: sups[0] });
    const c = await cust('MrpMusteri');
    await ok('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: finItem.id, qty: 10, price: 5 }] });
    const run = await ok('POST', '/planning/mrp/run', { horizonDays: 90 });
    info('MP-01b', 'MRP çalıştırma', { onerı: run.suggestionCount, gec: run.shortageCount, dongu: run.cycles });
    const sg = (await ok('GET', '/planning/mrp/suggestions')).data;
    fSug = sg.find(s => s.itemId === finItem.id); cSug = sg.find(s => s.itemId === compItem.id);
    assert(fSug && fSug.type === 'make' && fSug.suggestedQty === 10, 'mamul önerisi: ' + JSON.stringify(fSug));
    assert(cSug && cSug.type === 'buy' && cSug.suggestedQty === 20, 'bileşen önerisi 20 olmalı: ' + JSON.stringify(cSug));
  });
  await check('MP-00', "ürün oluşturma/güncelleme API'si procurementType (make/buy) alanını KAYDETMELİ (MRP bunu kullanıyor)", async () => {
    const it = await ok('POST', '/items', { name: 'MakeTest' + (++seq), itemType: 'finished', procurementType: 'make' });
    const a = db.prepare('SELECT procurement_type p FROM items WHERE id=?').get(it.id).p;
    await api('PUT', '/items/' + it.id, { procurementType: 'make' });
    const b = db.prepare('SELECT procurement_type p FROM items WHERE id=?').get(it.id).p;
    info('MP-00b', 'create sonrası / PUT sonrası procurement_type', { create: a, put: b });
    assert.equal(b, 'make', `ürün formundan make/buy atanamıyor (create=${a}, put=${b}) → UI'da açılan mamuller MRP'de 'buy' sayılır`);
  });
  await check('MP-02', 'öneri dönüştürme: PO oluşur; ikinci dönüştürme 409, bilinmeyen id 404 (500 olmamalı); eşzamanlı çift', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
    const [a, b] = await Promise.all([api('POST', `/planning/mrp/suggestions/${cSug.id}/convert`, {}), api('POST', `/planning/mrp/suggestions/${cSug.id}/convert`, {})]);
    const after = db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
    info('MP-02a', 'eşzamanlı çift dönüştürme', { durumlar: [a.status, b.status], yeniPO: after - before });
    const again = await api('POST', `/planning/mrp/suggestions/${cSug.id}/convert`, {});
    const ghost = await api('POST', '/planning/mrp/suggestions/99999999/convert', {});
    info('MP-02b', 'tekrar dönüştürme / olmayan öneri', { tekrar: again.status, olmayan: ghost.status });
    assert.equal(after - before, 1, `aynı öneriden ${after - before} PO`);
    assert(again.status === 409 && ghost.status === 404, `tekrar=${again.status} (409 beklenir), olmayan=${ghost.status} (404 beklenir)`);
  });
  await check('MP-03', 'öneri: reddedilmiş öneri dönüştürülemez; tedarikçisiz buy önerisi 4xx; hayalet depo 4xx', async () => {
    const noSup = await item(0, { procurementType: 'buy' });
    const c = await cust('MrpM2'); await ok('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: noSup.id, qty: 3, price: 1 }] });
    await ok('POST', '/planning/mrp/run', {});
    const sg = (await ok('GET', '/planning/mrp/suggestions')).data; const s = sg.find(x => x.itemId === noSup.id);
    assert(s, 'tedarikçisiz ürün önerisi yok');
    const r1 = await api('POST', `/planning/mrp/suggestions/${s.id}/convert`, {});
    await ok('POST', `/planning/mrp/suggestions/${s.id}/dismiss`, {});
    const r2 = await api('POST', `/planning/mrp/suggestions/${s.id}/convert`, {});
    const f = sg.find(x => x.itemId === finItem.id && x.status === 'open');
    /** @type {{status: number | 'n/a'}} */
    let r3 = { status: 'n/a' };
    if (f) r3 = await api('POST', `/planning/mrp/suggestions/${f.id}/convert`, { warehouseId: 999999 });
    info('MP-03b', 'durumlar', { tedarikcisiz: r1.status, reddedilenDonustur: r2.status, hayaletDepo: r3.status });
    assert(r1.status >= 400 && r1.status < 500 && r2.status >= 400 && r2.status < 500 && (r3.status === 'n/a' || (typeof r3.status === 'number' && r3.status >= 400 && r3.status < 500)),
      `tedarikçisiz=${r1.status} reddedilen=${r2.status} hayaletDepo=${r3.status}`);
  });
  await check('MP-04', 'MRP: BOM döngüsü (DB\'ye doğrudan) sonsuz döngü/500 üretmez; döngü raporlanır', async () => {
    const a = await item(0), b = await item(0);
    await ok('PUT', '/items/' + a.id, { bom: [{ componentItemId: b.id, qtyPerUnit: 1 }] });
    try { db.prepare('INSERT INTO item_bom (item_id, component_item_id, qty_per_unit) VALUES (?,?,1)').run(b.id, a.id); } catch (e) { info('MP-04a', 'DB kısıtı döngüyü engelledi', e.message); return; }
    const c = await cust('MrpDongu'); await ok('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: a.id, qty: 1, price: 1 }] });
    const { r, ms } = await timed(() => api('POST', '/planning/mrp/run', {}));
    info('MP-04b', 'döngülü reçete ile MRP', { status: r.status, ms, dongu: r.data && r.data.cycles });
    db.prepare('DELETE FROM item_bom WHERE item_id=? AND component_item_id=?').run(b.id, a.id);
    assert(r.status === 201 && ms < 10000, `status=${r.status} süre=${ms}ms`);
  });
  await check('MP-05', 'MRP girdi doğrulama ve yetki', async () => {
    for (const b of [{ horizonDays: 0 }, { horizonDays: 731 }, { horizonDays: -1 }, { horizonDays: 'abc' }, { horizonDays: 1.5 }]) {
      const r = await api('POST', '/planning/mrp/run', b); info('MP-05a', JSON.stringify(b), { status: r.status });
      assert(r.status >= 400 && r.status < 500, `${JSON.stringify(b)} → ${r.status}`);
    }
    statusIn(await api('POST', '/planning/mrp/run', {}, 'operator'), [403]);
    statusIn(await api('POST', '/planning/mrp/suggestions/1/convert', {}, 'operator'), [403]);
  });

  /* ------------------------------------------------ PLANLAMA */
  console.log('\n[PLAN]');
  await check('PL-01', 'vardiya/iş merkezi: mükerrer kod, geçersiz saat, geçersiz depo/vardiya id → 4xx (500 olmamalı)', async () => {
    const s1 = await api('POST', '/planning/shifts', { code: 'GX', name: 'G', startTime: '08:00', endTime: '16:00', weekdays: [1, 2, 3] });
    const s2 = await api('POST', '/planning/shifts', { code: 'GX', name: 'G2', startTime: '08:00', endTime: '16:00', weekdays: [1] });
    const bad = await api('POST', '/planning/shifts', { code: 'GY', name: 'G', startTime: '99:99', endTime: '16:00', weekdays: [1] });
    const zero = await api('POST', '/planning/shifts', { code: 'GZ', name: 'G', startTime: '08:00', endTime: '08:00', weekdays: [1] });
    const brk = await api('POST', '/planning/shifts', { code: 'GB', name: 'G', startTime: '08:00', endTime: '09:00', breakMinutes: 600, weekdays: [1] });
    const dupd = await api('POST', '/planning/shifts', { code: 'GD', name: 'G', startTime: '08:00', endTime: '16:00', weekdays: [1, 1, 1] });
    const w1 = await api('POST', '/planning/work-centers', { code: 'WX', name: 'W', warehouseId: 999999 });
    const w2 = await api('POST', '/planning/work-centers', { code: 'WY', name: 'W', shiftIds: [999999] });
    const w3 = await api('POST', '/planning/work-centers', { code: 'WZ', name: 'W', capacityUnits: 0 });
    info('PL-01a', 'sonuçlar', { ilk: s1.status, mukerrerKod: s2.status, saat9999: bad.status, ayniSaat: zero.status, molaFazla: brk.status, tekrarGun: dupd.status, hayaletDepo: w1.status, hayaletVardiya: w2.status, kapasite0: w3.status });
    const five = [s2, bad, zero, brk, w1, w2].filter(r => r.status >= 500).length;
    assert.equal(five, 0, `500 dönenler: mükerrerKod=${s2.status} saat=${bad.status} ayniSaat=${zero.status} molaFazla=${brk.status} hayaletDepo=${w1.status} hayaletVardiya=${w2.status}`);
    assert(bad.status >= 400 && zero.status >= 400 && brk.status >= 400, `saat/mola doğrulaması yok: 99:99=${bad.status} aynıSaat=${zero.status} molaFazla=${brk.status}`);
  });
  await check('PL-02', 'takvim istisnası: hayalet iş merkezi, geçersiz tarih, kısmi gün saat olmadan, mükerrer', async () => {
    const g = await api('POST', '/planning/calendar-exceptions', { date: '2026-12-25', workCenterId: 999999 });
    const d = await api('POST', '/planning/calendar-exceptions', { date: '2026-13-45' });
    const p = await api('POST', '/planning/calendar-exceptions', { date: '2026-12-26', exceptionType: 'partial' });
    const a = await api('POST', '/planning/calendar-exceptions', { date: '2026-12-27' }); const b = await api('POST', '/planning/calendar-exceptions', { date: '2026-12-27' });
    info('PL-02a', 'sonuçlar', { hayaletMerkez: g.status, gecersizTarih: d.status, kismiSaatsiz: p.status, mukerrer: [a.status, b.status] });
    assert(g.status < 500, `hayalet iş merkezi → ${g.status}`); assert(d.status >= 400 && p.status >= 400, `geçersiz tarih=${d.status}, saatsiz kısmi=${p.status}`);
  });
  await check('PL-03', 'rota: hayalet/pasif iş merkezi 4xx ve mevcut rota bozulmaz; olmayan ürün 404', async () => {
    const it = await item(0); const wc = await ok('POST', '/planning/work-centers', { code: 'RW' + seq, name: 'Rota WC' });
    await ok('PUT', `/planning/routings/${it.id}`, { operations: [{ operationNo: 10, operationName: 'Kes', workCenterId: wc.id, runMinutesPerUnit: 2 }] });
    const before = await ok('GET', `/planning/routings/${it.id}`);
    const g = await api('PUT', `/planning/routings/${it.id}`, { operations: [{ operationNo: 10, operationName: 'Kes', workCenterId: 999999 }] });
    const after = await ok('GET', `/planning/routings/${it.id}`);
    info('PL-03a', 'hayalet iş merkezi', { status: g.status, rotaKorundu: JSON.stringify(before) === JSON.stringify(after) });
    await ok('DELETE', `/planning/work-centers/${wc.id}`);
    const p = await api('PUT', `/planning/routings/${it.id}`, { operations: [{ operationNo: 20, operationName: 'Pasif', workCenterId: wc.id }] });
    info('PL-03b', 'pasif iş merkezi ile rota', { status: p.status });
    statusIn(await api('PUT', '/planning/routings/ghost', { operations: [] }), [404]);
    assert.equal(JSON.stringify(before), JSON.stringify(after), 'reddedilen rota güncellemesi mevcut rotayı bozdu');
    assert(g.status >= 400 && g.status < 500 && p.status >= 400, `hayalet=${g.status} pasif=${p.status}`);
  });
  await check('PL-04', 'çizelgeleme: olmayan emir 404, geçersiz startFrom 4xx (NaN tarih yazılmamalı)', async () => {
    statusIn(await api('POST', '/planning/schedule/ghost', {}), [404]);
    const it = await ok('POST', '/items', { name: 'SchedFin', itemType: 'finished', procurementType: 'make' });
    const po = await api('POST', '/production', { itemId: it.id, qty: 1, warehouseId: whs[0] });
    if (po.status !== 201) { info('PL-04a', 'üretim emri açılamadı', { status: po.status, data: po.data }); return; }
    for (const s of ['abc', '2026-99-99', '']) { const r = await api('POST', `/planning/schedule/${po.data.id}`, { startFrom: s }); info('PL-04b', `startFrom=${JSON.stringify(s)}`, { status: r.status, data: r.status < 300 ? { start: r.data.plannedStart, end: r.data.plannedEnd } : r.data }); assert(r.status < 500, `startFrom=${s} → ${r.status}`); }
  });
  await check('PL-05', 'kapasite/OEE/vardiya kaydı: geçersiz aralık ve devasa aralık (süre), hayalet id', async () => {
    const res = {};
    for (const q of ['from=abc&to=xyz', 'from=2026-12-01&to=2026-01-01', 'from=2026-13-45&to=2026-99-99']) {
      res['cap ' + q] = (await api('GET', '/planning/capacity?' + q)).status; res['oee ' + q] = (await api('GET', '/planning/oee?' + q)).status;
    }
    info('PL-05a', 'bozuk aralık durumları', res);
    const wide = await timed(() => api('GET', '/planning/capacity?from=1900-01-01&to=2100-12-31'));
    info('PL-05b', '200 yıllık kapasite aralığı', { status: wide.r.status, ms: wide.ms });
    const sl = await api('POST', '/planning/shift-logs', { date: '2026-09-01', shiftId: 999999, workCenterId: 999999, workedMinutes: 10 });
    info('PL-05c', 'hayalet vardiya/iş merkezi ile vardiya kaydı', { status: sl.status });
    const five = Object.values(res).filter(s => s >= 500).length;
    assert(five === 0 && sl.status < 500 && wide.ms < 15000, `500 sayısı=${five}, hayaletKayıt=${sl.status}, geniş aralık=${wide.ms}ms`);
  });

  /* ------------------------------------------------ VERİ SAĞLIĞI */
  await check('INV-pre', "küresel değişmezler (veri sağlığı/birleştirme testlerinden ÖNCE)", async () => { const v = invariants(); info('INV-pre', 'ihlaller', v); assert.equal(v.length, 0, v.join('; ')); });
  console.log('\n[DATA-HEALTH]');
  await check('DH-01', 'denetim: rapor çalışır; bilinmeyen kontrol id 4xx (500 değil)', async () => {
    const rep = await ok('GET', '/data-health/report'); info('DH-01a', 'rapor özeti', Object.keys(rep).slice(0, 8));
    for (const [m, u] of [['GET', '/data-health/check/yok'], ['POST', '/data-health/check/yok/fix']]) { const r = await api(m, u, m === 'GET' ? undefined : {}); info('DH-01b', `${m} ${u}`, { status: r.status }); assert(r.status >= 400 && r.status < 500, `${m} ${u} → ${r.status}`); }
    statusIn(await api('POST', '/data-health/check/qty_cache_mismatch/fix', {}, 'operator'), [403]);
  });
  await check('DH-02', 'ürün birleştirme: aynı bileşen iki kez birleşince reçete miktarı TOPLANMALI (kod yorumu böyle diyor)', async () => {
    const A = await item(0), B = await item(0); const P = await ok('POST', '/items', { name: 'MergeP', itemType: 'finished', bom: [{ componentItemId: A.id, qtyPerUnit: 2 }, { componentItemId: B.id, qtyPerUnit: 3 }] });
    await ok('POST', '/data-health/merge/item', { sourceId: B.id, targetId: A.id, confirm: true });
    const bom = db.prepare('SELECT component_item_id c, qty_per_unit q FROM item_bom WHERE item_id=?').all(P.id);
    info('DH-02a', 'birleşme sonrası reçete', bom);
    const tot = bom.reduce((s, r) => s + r.q, 0);
    assert.equal(tot, 5, `reçete toplam bileşen miktarı ${tot} (beklenen 5): birleşme sırasında miktar KAYBOLDU`);
  });
  await check('DH-03', 'ürün birleştirme: stok/defter bütünlüğü, birim uyuşmazlığı, sevkiyat/muayene/NCR bağları', async () => {
    const A = await item(5, { unit: 'kg' }), B = await item(7, { unit: 'adet' });
    const c = await cust('MergeC'); const so = await ok('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: B.id, qty: 2, price: 1 }] });
    await ok('POST', '/sales/shipments', { soId: so.id, destination: 'x', items: [{ itemId: B.id, qty: 1 }] });
    const r = await api('POST', '/data-health/merge/item', { sourceId: B.id, targetId: A.id, confirm: true });
    const unitMismatch = r.status === 200;
    const orphanShip = db.prepare('SELECT COUNT(*) n FROM shipment_items WHERE item_id=?').get(B.id).n;
    const tgt = db.prepare('SELECT qty_cache FROM items WHERE id=?').get(A.id).qty_cache;
    const inv = invariants();
    info('DH-03a', 'kg ürünü ile adet ürünü birleştirildi mi / sevkiyat kalemi kaynakta kaldı mı', { birlesti: unitMismatch, hedefStok: tgt, kaynaktaKalanSevkKalemi: orphanShip, degismezIhlal: inv.length });
    state.mergeLeft = { A: A.id, B: B.id, soId: so.id };
    assert(!unitMismatch, 'farklı birimli ürünler (kg + adet) uyarısız birleştirildi: hedef stok ' + tgt + ' (birimsiz toplam)');
    assert.equal(orphanShip, 0, 'sevkiyat kalemleri kaynak (silinmiş) ürüne bağlı kaldı');
  });
  await check('DH-03b', 'birleştirme sonrası o ürünün sevkiyatı iptal edilirse ne olur (sevk kalemi kaynakta kaldı)', async () => {
    const sh = db.prepare('SELECT s.id FROM shipments s WHERE s.so_id=? ORDER BY s.created_at DESC').get(state.mergeLeft.soId);
    const beforeA = db.prepare('SELECT qty_cache q FROM items WHERE id=?').get(state.mergeLeft.A).q;
    const r = await api('POST', `/sales/shipments/${sh.id}/cancel`, {});
    const afterA = db.prepare('SELECT qty_cache q FROM items WHERE id=?').get(state.mergeLeft.A).q;
    const inv = invariants();
    info('DH-03c', 'birleştirilmiş ürünün sevkiyatını iptal et', { status: r.status, hedefStokOnce: beforeA, sonra: afterA, ihlaller: inv });
    assert(r.status < 500 && inv.length === 0, `status=${r.status}; ihlaller=${inv.join(' | ')}`);
  });
  await check('DH-09', 'birleştirme planı eksikliği: items/suppliers/customers\'a işaret eden TÜM yabancı anahtarlar taşınıyor mu', async () => {
    const planned = { items: new Set(['stock_lots.item_id', 'movements.item_id', 'item_bom.item_id', 'item_bom.component_item_id', 'po_items.item_id', 'sales_order_lines.item_id', 'production_orders.item_id', 'production_order_components.component_item_id', 'stock_count_lines.item_id', 'routings.item_id', 'customer_invoice_lines.item_id', 'inspections.item_id']),
      suppliers: new Set(['purchase_orders.supplier_id', 'items.default_supplier_id', 'stock_lots.supplier_id', 'supplier_invoices.supplier_id', 'purchase_requests.supplier_id']),
      customers: new Set(['sales_orders.customer_id', 'shipments.customer_id', 'customer_invoices.customer_id']) };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
    const missing = { items: [], suppliers: [], customers: [] };
    for (const t of tables) for (const fk of db.prepare(`PRAGMA foreign_key_list("${t}")`).all()) if (missing[fk.table] && !planned[fk.table].has(`${t}.${fk.from}`)) missing[fk.table].push(`${t}.${fk.from}`);
    info('DH-09a', 'FK ile bağlı ama birleştirmede TAŞINMAYAN sütunlar', missing);
    const n = missing.items.length + missing.suppliers.length + missing.customers.length;
    assert.equal(n, 0, `taşınmayan bağ sayısı ${n}: ` + JSON.stringify(missing));
  });
  await check('DH-04', 'müşteri birleştirme: fırsat/ziyaret/talep/NCR bağlı kaynak kayıt silinirken 500 (FK) veya sahipsiz bağ', async () => {
    const S = await cust('MergeSrc'), T = await cust('MergeTgt');
    await ok('POST', '/crm/opportunities', { customerId: S.id, customerName: 'x' }); await ok('POST', '/visits', { customerId: S.id, visitDate: '2026-09-01' });
    await ok('POST', '/support', { customerId: S.id, customerName: 'x', subject: 's' });
    const before = snap(); const r = await api('POST', '/data-health/merge/customer', { sourceId: S.id, targetId: T.id, confirm: true });
    const exists = !!db.prepare('SELECT 1 FROM customers WHERE id=?').get(S.id);
    const dangling = db.prepare('SELECT (SELECT COUNT(*) FROM opportunities WHERE customer_id=?)+(SELECT COUNT(*) FROM customer_visits WHERE customer_id=?)+(SELECT COUNT(*) FROM support_tickets WHERE customer_id=?) n').get(S.id, S.id, S.id).n;
    info('DH-04a', 'sonuç', { status: r.status, kaynakVarMi: exists, kaynagaBagliKalan: dangling, hata: r.status >= 400 ? r.data : undefined });
    if (r.status === 200) assert(dangling === 0, `kaynak müşteri silindi ama ${dangling} CRM/destek/ziyaret kaydı ona bağlı kaldı`);
    else assert(r.status >= 400 && r.status < 500, `müşteri birleştirme ${r.status} (FK sorunu → 500)`);
    if (r.status >= 400) assert.equal(snap(), before, 'başarısız birleştirme yarım iz bıraktı');
  });
  await check('DH-05', 'tedarikçi birleştirme: PO/varsayılan tedarikçi taşınır, kaynak silinir, defter bozulmaz', async () => {
    const S = await ok('POST', '/purchasing/suppliers', { name: 'MSrc', isApproved: true }), T = await ok('POST', '/purchasing/suppliers', { name: 'MTgt', isApproved: true });
    const it = await item(0, { defaultSupplierId: S.id });
    await ok('POST', '/purchasing/orders', { supplierId: S.id, warehouseId: whs[0], items: [{ itemId: it.id, qty: 1, price: 1 }] });
    const r = await api('POST', '/data-health/merge/supplier', { sourceId: S.id, targetId: T.id, confirm: true });
    info('DH-05a', 'sonuç', { status: r.status, data: r.status >= 400 ? r.data : r.data.totalMoved });
    assert(r.status === 200, 'tedarikçi birleştirme ' + r.status);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE supplier_id=?').get(S.id).n, 0);
    assert.equal(db.prepare('SELECT default_supplier_id d FROM items WHERE id=?').get(it.id).d, T.id);
  });
  await check('DH-06', 'birleştirme girdi/yetki: kendine, olmayan, confirm eksik, operatör', async () => {
    const a = await item(0);
    for (const b of [{ sourceId: a.id, targetId: a.id, confirm: true }, { sourceId: a.id, targetId: 'yok', confirm: true }, { sourceId: a.id, targetId: 'x' }, { sourceId: a.id, targetId: 'x', confirm: false }])
      statusIn(await api('POST', '/data-health/merge/item', b), [400, 404, 422]);
    statusIn(await api('POST', '/data-health/merge/nope', { sourceId: 1, targetId: 2, confirm: true }), [400]);
    statusIn(await api('POST', '/data-health/merge/item', { sourceId: a.id, targetId: 'x', confirm: true }, 'operator'), [403]);
  });
  await check('DH-07', 'toplu güncelleme: null/boş/mantıksız değerler 0 veya geçersiz veriye dönüşmemeli', async () => {
    const it = await item(0, { minStock: 5, vatRate: 20 }); const res = {};
    for (const [f, v] of [['minStock', null], ['minStock', ''], ['minStock', true], ['minStock', -5], ['vatRate', 1000], ['vatRate', -1], ['safetyStock', 'abc'], ['unit', ''], ['itemType', 'bogus'], ['defaultSupplierId', 'ghost'], ['defaultSupplierId', 999999], ['category', null]]) {
      const before = db.prepare('SELECT min_stock,vat_rate,safety_stock,unit,item_type,default_supplier_id,category FROM items WHERE id=?').get(it.id);
      const r = await api('POST', '/data-health/bulk-update/items', { itemIds: [it.id], field: f, value: v });
      const after = db.prepare('SELECT min_stock,vat_rate,safety_stock,unit,item_type,default_supplier_id,category FROM items WHERE id=?').get(it.id);
      res[`${f}=${JSON.stringify(v)}`] = { status: r.status, degisti: JSON.stringify(before) !== JSON.stringify(after) };
    }
    info('DH-07a', 'toplu güncelleme sonuçları', res);
    const bad = Object.entries(res).filter(([k, v]) => v.status >= 500 || (v.status === 200 && ['minStock=null', 'minStock=""', 'minStock=true', 'minStock=-5', 'vatRate=1000', 'vatRate=-1', 'unit=""', 'itemType="bogus"'].includes(k)));
    assert.equal(bad.length, 0, 'kabul edilen/500 veren: ' + bad.map(([k, v]) => `${k}→${v.status}`).join(', '));
  });
  await check('DH-08', 'pasife alınan stoklu ürün: özet rapor değeri ile değerleme raporu aynı toplamı vermeli', async () => {
    const it = await item(100, { openingUnitCost: 50 });
    const s0 = await ok('GET', '/reports/summary'), v0 = await ok('GET', '/reports/valuation');
    await ok('POST', '/data-health/bulk-update/items', { itemIds: [it.id], field: 'isActive', value: false });
    const s1 = await ok('GET', '/reports/summary'), v1 = await ok('GET', '/reports/valuation');
    info('DH-08a', 'toplam stok değeri', { ozetOnce: s0.totalValueTRY, degerlemeOnce: v0.totalValueBase, ozetSonra: s1.totalValueTRY, degerlemeSonra: v1.totalValueBase });
    assert.equal(s1.totalValueTRY, v1.totalValueBase, `özet ${s1.totalValueTRY} ≠ değerleme ${v1.totalValueBase} (pasif stoklu ürün)`);
    await ok('POST', '/data-health/bulk-update/items', { itemIds: [it.id], field: 'isActive', value: true });
  });

  /* ------------------------------------------------ MUHASEBE */
  console.log('\n[ACCOUNTING]');
  await check('AC-01', 'yevmiye: satış (KDV dahil, döviz, iade) + alış; borç=alacak; tutarlar fatura ile birebir', async () => {
    const c = await cust('AcMusteri');
    const inv = await ok('POST', '/sales/invoices', { customerId: c.id, lines: [{ itemName: 'x', qty: 3, unitPrice: 33.33, vatRate: 20 }] });
    const row = db.prepare('SELECT subtotal, vat_total, amount, fx_rate, invoice_date FROM customer_invoices WHERE id=?').get(inv.id);
    info('AC-01a', 'fatura', row);
    const p = await ok('POST', '/purchasing/orders', { supplierId: sups[0], warehouseId: whs[0], items: [{ itemId: (await item(0)).id, qty: 4, price: 25 }] });
    await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 4 }] });
    await ok('POST', '/purchasing/invoices', { invoiceNo: 'AC-P1', poId: p.id, amount: 100 });
    const day = row.invoice_date; const ex = await ok('GET', `/accounting/export?from=${day}&to=${day}`);
    info('AC-01b', 'dışa aktarım', { satir: ex.count, borc: ex.totalDebit, alacak: ex.totalCredit });
    assert.equal(ex.totalDebit, ex.totalCredit);
    const ar = ex.rows.find(r => r.sourceId === inv.id && r.debit > 0);
    assert(ar && Math.abs(ar.debit - row.amount) < 0.005, `alıcılar borcu ${ar && ar.debit} ≠ fatura tutarı ${row.amount}`);
    const hasCogs = ex.rows.some(r => /maliyet|cogs/i.test(r.accountName + r.description));
    info('AC-01c', 'satış maliyeti (COGS) satırı var mı; stok hesabı alacaklanıyor mu', { cogs: hasCogs, stokAlacak: ex.rows.some(r => r.credit > 0 && /stok|ticari mal|inventory/i.test(r.accountName)) });
  });
  await check('AC-02', 'yevmiye: iade faturası ters yönde; aşırı iade 409; döviz uyuşmazlığı 422; ödeme ucu durum kontrolü; geçersiz aralık', async () => {
    const c = await cust('AcM2'); const inv = await ok('POST', '/sales/invoices', { customerId: c.id, lines: [{ itemName: 'y', qty: 1, unitPrice: 100 }] });
    const day = db.prepare('SELECT invoice_date d FROM customer_invoices WHERE id=?').get(inv.id).d;
    const ret = await api('POST', '/sales/invoices', { customerId: c.id, invoiceType: 'iade', originalInvoiceId: inv.id, lines: [{ itemName: 'y', qty: 1, unitPrice: 50 }] });
    const over = await api('POST', '/sales/invoices', { customerId: c.id, invoiceType: 'iade', originalInvoiceId: inv.id, lines: [{ itemName: 'y', qty: 1, unitPrice: 100 }] });
    const fx = await api('POST', '/sales/invoices', { customerId: c.id, invoiceType: 'iade', originalInvoiceId: inv.id, currency: 'USD', lines: [{ itemName: 'y', qty: 1, unitPrice: 1 }] });
    const ex = await ok('GET', `/accounting/export?from=${day}&to=${day}`);
    const retRows = ex.rows.filter(r => ret.data && r.sourceId === ret.data.id);
    info('AC-02a', 'iade', { iade: ret.status, asiriIade: over.status, dovizUyusmazligi: fx.status, iadeSatiri: retRows.map(r => ({ h: r.accountCode, b: r.debit, a: r.credit })), borc: ex.totalDebit, alacak: ex.totalCredit });
    assert.equal(ret.status, 201); assert.equal(over.status, 409); assert.equal(fx.status, 422);
    assert(retRows.some(r => r.accountCode === '120' && r.credit > 0) && retRows.some(r => r.accountCode === '600' && r.debit > 0), 'iade ters yönde değil');
    assert.equal(ex.totalDebit, ex.totalCredit);
    const p1 = await api('POST', `/sales/invoices/${ret.data.id}/pay`, {}); const p2 = await api('POST', `/sales/invoices/${inv.id}/pay`, {}); const p3 = await api('POST', `/sales/invoices/${inv.id}/pay`, {});
    info('AC-02b', 'iade faturasına ödeme / asıl faturaya iki kez ödeme', { iadeOdeme: p1.status, ilkOdeme: p2.status, ikinciOdeme: p3.status });
    assert(p1.status >= 400 && p3.status >= 400, `iade faturası "ödendi" yapılabildi=${p1.status < 300}; aynı fatura ikinci kez "ödendi" yapılabildi=${p3.status < 300}`);
    statusIn(await api('GET', '/accounting/export?from=2026-12-01&to=2026-01-01'), [400]);
    statusIn(await api('GET', '/accounting/export?from=abc&to=def'), [400, 422]);
    statusIn(await api('GET', '/accounting/export?from=2026-01-01&to=2026-01-31', undefined, 'operator'), [403]);
    const big = await timed(() => api('GET', '/accounting/export?from=1900-01-01&to=2100-12-31'));
    info('AC-02b', '200 yıllık aralık', { status: big.r.status, ms: big.ms });
  });
  await check('AC-03', 'hesap eşlemesi: geçersiz anahtar 4xx, boş kod 4xx; eksik eşleme açık hata verir', async () => {
    statusIn(await api('PUT', '/accounting/mappings', { mappings: [{ key: 'bogus', accountCode: '1', accountName: 'x' }] }), [400, 422]);
    statusIn(await api('PUT', '/accounting/mappings', { mappings: [{ key: 'inventory', accountCode: '', accountName: 'x' }] }), [400, 422]);
    statusIn(await api('PUT', '/accounting/mappings', { mappings: [] }), [400, 422]);
    const m = await ok('GET', '/accounting/mappings'); info('AC-03a', 'mevcut eşlemeler', m.map(x => x.key + '=' + x.accountCode));
  });

  /* ------------------------------------------------ RAPORLAR */
  console.log('\n[REPORTS]');
  await check('RP-01', 'tüm rapor uçları 200; sayısal alanlarda NaN/Infinity/null yok; bozuk sorgu parametreleri 500 vermez', async () => {
    const eps = ['/reports/summary', '/reports/trends', '/reports/dead-stock', '/reports/turnover', '/reports/abc', '/reports/reorder-suggestions', '/reports/supplier-performance', '/reports/quality-kpis', '/reports/production-costs', '/reports/valuation'];
    const badNum = [];
    const walk = (o, p) => { if (typeof o === 'number' && !Number.isFinite(o)) badNum.push(p); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, p + '.' + k); };
    const st = {};
    for (const e of eps) { const r = await api('GET', e); st[e] = r.status; walk(r.data, e); }
    for (const q of ['days=abc', 'days=-5', 'days=1e9', 'days=0', 'months=0', 'months=-3', 'months=999', 'days=99999999999999999999']) for (const e of ['/reports/dead-stock', '/reports/turnover', '/reports/abc', '/reports/reorder-suggestions', '/reports/quality-kpis', '/reports/trends']) { const s = (await api('GET', e + '?' + q)).status; if (s >= 500) badNum.push(`${e}?${q} → ${s}`); }
    info('RP-01a', 'durumlar', st);
    assert(Object.values(st).every(s => s === 200), JSON.stringify(st)); assert.equal(badNum.length, 0, badNum.join(' | '));
  });
  await check('RP-02', 'değerleme raporu toplamı = DB\'deki uygun parti Σ(qty×unit_cost) (aktif ürünler)', async () => {
    const v = await ok('GET', '/reports/valuation');
    const exact = db.prepare("SELECT COALESCE(SUM(sl.qty*sl.unit_cost),0) v FROM stock_lots sl JOIN items i ON i.id=sl.item_id WHERE sl.status='available' AND i.is_active=1 AND i.deleted_at IS NULL").get().v;
    info('RP-02a', 'toplam', { rapor: v.totalValueBase, db: Math.round(exact) }); assert(Math.abs(v.totalValueBase - Math.round(exact)) <= 1, `rapor ${v.totalValueBase} db ${exact}`);
  });
  await check('RP-03', 'kritik stok uyarısı: min_stock=0 ve stok=0 olan ürünler "kritik" sayılmamalı (yanlış alarm)', async () => {
    const before = (await ok('GET', '/reports/summary')).lowStockCount;
    for (let i = 0; i < 3; i++) await item(0, { minStock: 0 });
    const after = (await ok('GET', '/reports/summary')).lowStockCount;
    info('RP-03a', 'kritik stok sayısı', { once: before, sonra: after }); assert.equal(after, before, `min_stock=0 olan 3 ürün kritik listesine ${after - before} eklendi`);
  });
  await check('RP-04', 'süresi geçmiş uygun parti stok değerine dahil mi (F09 politikası) — bilgi', async () => {
    const it = await item(0); await ok('POST', '/stock/move', { itemId: it.id, type: 'in', qty: 10, warehouseId: whs[0], unitCost: 100, expiryDate: '2020-01-01' }).catch(e => null);
    const s = await api('GET', '/reports/summary'); info('RP-04a', 'süresi geçmiş partili stok özet değerinde', { toplam: s.data && s.data.totalValueTRY, vadesiGecen: s.data && s.data.expiringCount });
  });
  await check('RP-05', 'pivot: geçersiz veri kaynağı/boyut/ölçü 400 (500 değil); SQL benzeri değerler zararsız; bozuk filtre', async () => {
    const cases = [{ dataSource: 'nope', dimension: 'x', metric: 'y' }, { dataSource: 'movements', dimension: "type; DROP TABLE items;--", metric: 'qty' }, { dataSource: 'movements', dimension: 'type', metric: "1) UNION SELECT password_hash FROM users--" }, { dataSource: '__proto__', dimension: 'constructor', metric: 'toString' }];
    for (const c of cases) { const r = await api('POST', '/reports/pivot', c); info('RP-05a', JSON.stringify(c).slice(0, 70), { status: r.status }); assert(r.status >= 400 && r.status < 500, `${JSON.stringify(c)} → ${r.status}`); }
    const meta = await ok('GET', '/reports/pivot-meta'); const src = Object.keys(meta.dataSources || meta)[0]; info('RP-05b', 'pivot kaynakları', Object.keys(meta.dataSources || meta));
    assert(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='items'").get().n === 1);
  });
  await check('RP-06', 'kayıtlı rapor: geçersiz boyut 400; başkasının raporunu operatör silemez; yönetici siler', async () => {
    const r = await ok('POST', '/reports/saved', { name: 'R1', dataSource: 'movements', dimension: 'type', metric: 'qty' }).catch(async () => null);
    const bad = await api('POST', '/reports/saved', { name: 'R2', dataSource: 'movements', dimension: 'yok', metric: 'qty' }); statusIn(bad, [400]);
    if (r) { statusIn(await api('DELETE', '/reports/saved/' + r.id, undefined, 'operator'), [403]); statusIn(await api('DELETE', '/reports/saved/' + r.id), [204]); }
  });

  await check('INV-post', 'küresel değişmezler (tüm batch sonrası)', async () => { const v = invariants(); info('INV-post', 'ihlaller', v); assert.equal(v.length, 0, v.join('; ')); });
  await finish('b4c-ops');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
