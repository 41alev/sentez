// Batch 1a — sevkiyat, iptal, sipariş, fatura: iyi + kötü senaryolar
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');
const { invariants } = require('./inv');

(async () => {
  await start();
  const db = state.db;
  const whs = db.prepare('SELECT id FROM warehouses ORDER BY id').all().map(w => w.id);
  const cust = await ok('POST', '/sales/customers', { name: 'V Müşteri', paymentTermsDays: 30 });
  const cust2 = await ok('POST', '/sales/customers', { name: 'V Müşteri 2' });
  let seq = 0;
  const item = async (qty = 100, cost = 10, extra = {}) => {
    const it = await ok('POST', '/items', { name: 'VItem ' + (++seq), openingQty: qty, openingUnitCost: cost, ...extra });
    const lots = db.prepare('SELECT * FROM stock_lots WHERE item_id=? ORDER BY received_at').all(it.id);
    return { ...it, lot: lots[0], lots };
  };
  const order = (customerId, lines, extra = {}) => ok('POST', '/sales/orders', { customerId, lines, ...extra });
  const shipBody = (items, extra = {}) => ({ customerId: cust.id, destination: 'V', items, ...extra });
  const ship = (items, extra = {}, who) => api('POST', '/sales/shipments', shipBody(items, extra), who);
  const lotOf = id => db.prepare('SELECT * FROM stock_lots WHERE id=?').get(id);
  const unchanged = async (fn, expectCodes = [400, 404, 409, 422]) => {
    const before = snap(); const r = await fn(); statusIn(r, expectCodes);
    assert.equal(snap(), before, 'durum değişti (kısmi yazma)'); return r;
  };

  console.log('\n[SHIP] sevkiyat');
  await check('SHIP-01', 'otomatik dağıtımda yetersiz stok reddedilir, hiçbir şey değişmez', async () => {
    const it = await item(10);
    await unchanged(() => ship([{ itemId: it.id, qty: 11 }]));
  });
  await check('SHIP-02', 'aynı lot iki satırda toplamda aşılamaz (60+60 / 100)', async () => {
    const it = await item(100);
    await unchanged(() => ship([{ itemId: it.id, lotId: it.lot.id, qty: 60 }, { itemId: it.id, lotId: it.lot.id, qty: 60 }]));
    assert.equal(lotOf(it.lot.id).qty, 100);
  });
  await check('SHIP-03', 'geçersiz miktarlar (0, negatif, metin) reddedilir', async () => {
    const it = await item(50);
    for (const q of [0, -5, 'abc', null]) await unchanged(() => ship([{ itemId: it.id, qty: q }]), [400, 422]);
  });
  await check('SHIP-04', 'uygun olmayan lot durumları (quarantine/blocked/rejected/consumed) sevk edilemez', async () => {
    for (const st of ['quarantine', 'blocked', 'rejected']) {
      const it = await item(20);
      await ok('POST', '/stock/lot-status', { lotId: it.lot.id, toStatus: st });
      await unchanged(() => ship([{ itemId: it.id, lotId: it.lot.id, qty: 1 }]));
    }
    const done = await item(5);
    await ok('POST', '/sales/shipments', shipBody([{ itemId: done.id, lotId: done.lot.id, qty: 5 }]));
    assert.equal(lotOf(done.lot.id).status, 'consumed');
    await unchanged(() => ship([{ itemId: done.id, lotId: done.lot.id, qty: 1 }]));
  });
  await check('SHIP-06', 'sipariş başka müşteriye aitse reddedilir', async () => {
    const it = await item(20); const so = await order(cust.id, [{ itemId: it.id, qty: 2, price: 5 }]);
    await unchanged(() => api('POST', '/sales/shipments', { customerId: cust2.id, soId: so.id, destination: 'V', items: [{ itemId: it.id, qty: 1 }] }), [422]);
  });
  await check('SHIP-07', 'siparişte olmayan ürün sessizce eklenmez', async () => {
    const a = await item(20), b = await item(20); const so = await order(cust.id, [{ itemId: a.id, qty: 2, price: 5 }]);
    await unchanged(() => api('POST', '/sales/shipments', { soId: so.id, destination: 'V', items: [{ itemId: b.id, qty: 1 }] }), [422]);
  });
  await check('SHIP-08', 'sipariş durumu open/partially_shipped dışındaysa (closed/invoiced/draft/shipped) sevk reddedilir', async () => {
    for (const st of ['closed', 'invoiced', 'draft', 'shipped', 'cancelled']) {
      const it = await item(20); const so = await order(cust.id, [{ itemId: it.id, qty: 2, price: 5 }]);
      db.prepare('UPDATE sales_orders SET status=? WHERE id=?').run(st, so.id);
      await unchanged(() => api('POST', '/sales/shipments', { soId: so.id, destination: 'V', items: [{ itemId: it.id, qty: 1 }] }), [409]);
    }
  });
  await check('SHIP-09', 'aynı ürün iki sipariş satırında: belirsizlik reddedilir, satır bazlı sınır uygulanır', async () => {
    const it = await item(100);
    const so = await order(cust.id, [{ itemId: it.id, qty: 3, price: 5 }, { itemId: it.id, qty: 5, price: 6 }]);
    const [l1, l2] = so.lines;
    await unchanged(() => api('POST', '/sales/shipments', { soId: so.id, destination: 'V', items: [{ itemId: it.id, qty: 1 }] }), [422]);
    await unchanged(() => api('POST', '/sales/shipments', { soId: so.id, destination: 'V', items: [{ itemId: it.id, qty: 4, salesOrderLineId: l1.id }] }), [409]);
    await unchanged(() => api('POST', '/sales/shipments', { soId: so.id, destination: 'V', items: [{ itemId: it.id, qty: 2, salesOrderLineId: 99999999 }] }), [422]);
    const r = await ship([{ itemId: it.id, qty: 5, salesOrderLineId: l2.id }], { soId: so.id }); statusIn(r, [201]);
    const after = await ok('GET', '/sales/orders/' + so.id);
    assert.equal(after.lines.find(l => l.id === l2.id).shippedQty, 5);
    assert.equal(after.lines.find(l => l.id === l1.id).shippedQty, 0);
  });
  await check('SHIP-10', 'eşzamanlı sevkiyat: stok aşılamaz, negatif parti oluşmaz', async () => {
    const it = await item(100);
    const rs = await Promise.all(Array.from({ length: 10 }, () => ship([{ itemId: it.id, qty: 15 }])));
    const okCount = rs.filter(r => r.status === 201).length;
    assert.equal(okCount, 6, 'başarılı sayısı ' + okCount);
    assert.equal(db.prepare('SELECT SUM(qty) q FROM stock_lots WHERE item_id=?').get(it.id).q, 10);
  });
  await check('SHIP-11', 'rol yetkisi: viewer ve quality sevkiyat oluşturamaz', async () => {
    const it = await item(20);
    for (const who of ['viewer', 'quality']) await unchanged(() => ship([{ itemId: it.id, qty: 1 }], {}, who), [403]);
  });
  await check('SHIP-12', 'olmayan sipariş/ürün/lot için 4xx (500 değil)', async () => {
    const it = await item(20);
    await unchanged(() => api('POST', '/sales/shipments', { soId: 'nope', destination: 'V', items: [{ itemId: it.id, qty: 1 }] }), [404]);
    await unchanged(() => ship([{ itemId: 'nope', qty: 1 }]), [404]);
    await unchanged(() => ship([{ itemId: it.id, lotId: 'nope', qty: 1 }]), [400, 404]);
  });
  await check('SHIP-13', 'depo filtresi: yalnızca seçilen depodaki stok kullanılır', async () => {
    const it = await item(10);
    const other = whs.find(w => w !== it.lot.warehouse_id);
    await ok('POST', '/stock/transfer', { lotId: it.lot.id, targetWarehouseId: other, qty: 4 });
    await unchanged(() => ship([{ itemId: it.id, qty: 8 }], { warehouseId: other }));
    const r = await ship([{ itemId: it.id, qty: 4 }], { warehouseId: other }); statusIn(r, [201]);
  });
  await check('SHIP-14', 'durum ilerletme: Hazırlanıyor→Yolda→Teslim Edildi→409; viewer 403', async () => {
    const it = await item(10); const s = (await ship([{ itemId: it.id, qty: 1 }])).data;
    statusIn(await api('PATCH', `/sales/shipments/${s.id}/status`, {}, 'viewer'), [403]);
    statusIn(await api('PATCH', `/sales/shipments/${s.id}/status`, {}), [200]);
    statusIn(await api('PATCH', `/sales/shipments/${s.id}/status`, {}), [200]);
    const third = await api('PATCH', `/sales/shipments/${s.id}/status`, {});
    info('SHIP-14b', "'Teslim Edildi' sonrası PATCH", { status: third.status, body: third.data && third.data.status });
  });
  await check('SHIP-15', 'geçersiz tarih metni sevkiyatta 4xx vermeli (S16 sınıfı)', async () => {
    const it = await item(10);
    const r = await ship([{ itemId: it.id, qty: 1 }], { date: 'abc' });
    info('SHIP-15b', 'sevkiyat date="abc"', { status: r.status, date: r.data && r.data.date });
    assert(r.status >= 400 && r.status < 500, 'geçersiz tarih kabul edildi: ' + r.status);
  });
  await check('SHIP-16', 'sevkiyat: miktar ondalık/çok büyük değerlerde 500 üretmez', async () => {
    const it = await item(10);
    for (const q of [1e308, 0.000000001, 1e-12, Number.MAX_SAFE_INTEGER + 1]) {
      const r = await ship([{ itemId: it.id, qty: q }]); assert(r.status < 500, `qty=${q} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  });

  console.log('\n[CANCEL] sevkiyat iptali');
  await check('CAN-01', "yola çıkmış ('Yolda') sevkiyat iptal edilemez", async () => {
    const it = await item(10); const s = (await ship([{ itemId: it.id, qty: 2 }])).data;
    await ok('PATCH', `/sales/shipments/${s.id}/status`, {});
    await unchanged(() => api('DELETE', '/sales/shipments/' + s.id), [409]);
  });
  await check('CAN-02', 'faturaya bağlı sevkiyat iptal edilemez', async () => {
    const it = await item(10); const so = await order(cust.id, [{ itemId: it.id, qty: 2, price: 5 }]);
    const s = (await ship([{ itemId: it.id, qty: 2 }], { soId: so.id })).data;
    await ok('POST', '/sales/invoices', { customerId: cust.id, soId: so.id });
    await unchanged(() => api('DELETE', '/sales/shipments/' + s.id), [409]);
  });
  await check('CAN-03', 'iptal → aynı miktarı yeniden sevk: sipariş/COGS/stok tutarlı', async () => {
    const it = await item(20, 7); const so = await order(cust.id, [{ itemId: it.id, qty: 5, price: 9 }]);
    const s1 = (await ship([{ itemId: it.id, qty: 5 }], { soId: so.id })).data;
    statusIn(await api('DELETE', '/sales/shipments/' + s1.id), [204]);
    let o = await ok('GET', '/sales/orders/' + so.id); assert.equal(o.status, 'open'); assert.equal(o.lines[0].shippedQty, 0);
    const s2 = await ship([{ itemId: it.id, qty: 5 }], { soId: so.id }); statusIn(s2, [201]);
    o = await ok('GET', '/sales/orders/' + so.id); assert.equal(o.status, 'shipped'); assert.equal(o.lines[0].shippedQty, 5);
    assert(Math.abs(o.lines[0].cogsBase - 35) < 1e-6, 'COGS ' + o.lines[0].cogsBase);
    assert.equal(db.prepare('SELECT qty_cache FROM items WHERE id=?').get(it.id).qty_cache, 15);
  });
  await check('CAN-04', 'lotun kalanı başka depoya taşındıktan sonra iptal: stok doğru depoya döner', async () => {
    const it = await item(100); const other = whs.find(w => w !== it.lot.warehouse_id);
    const s = (await ship([{ itemId: it.id, lotId: it.lot.id, qty: 3 }])).data;
    await ok('POST', '/stock/transfer', { lotId: it.lot.id, targetWarehouseId: other });
    statusIn(await api('DELETE', '/sales/shipments/' + s.id), [204]);
    assert.equal(db.prepare('SELECT qty_cache FROM items WHERE id=?').get(it.id).qty_cache, 100);
  });
  await check('CAN-05', 'iptal yetkisi: yalnız admin (manager/operator 403)', async () => {
    const it = await item(10); const s = (await ship([{ itemId: it.id, qty: 1 }])).data;
    for (const who of ['manager', 'operator', 'quality', 'viewer']) await unchanged(() => api('DELETE', '/sales/shipments/' + s.id, undefined, who), [403]);
  });
  await check('CAN-06', 'olmayan sevkiyat 404; ikinci iptal etkisiz', async () => {
    statusIn(await api('DELETE', '/sales/shipments/nope'), [404]);
    const it = await item(10); const s = (await ship([{ itemId: it.id, qty: 1 }])).data;
    statusIn(await api('DELETE', '/sales/shipments/' + s.id), [204]);
    await unchanged(() => api('DELETE', '/sales/shipments/' + s.id), [204]);
  });
  await check('CAN-07', 'lot sonradan reddedildiyse iptalde stok reddedilmiş durumda geri gelir (kullanılabilir olmaz)', async () => {
    const it = await item(10); const s = (await ship([{ itemId: it.id, lotId: it.lot.id, qty: 4 }])).data;
    db.prepare("UPDATE stock_lots SET status='rejected' WHERE id=?").run(it.lot.id);
    statusIn(await api('DELETE', '/sales/shipments/' + s.id), [204]);
    const restored = db.prepare("SELECT * FROM stock_lots WHERE source_type='shipment_cancel' AND source_id=?").get(s.id);
    assert.equal(restored.status, 'rejected');
  });
  await check('CAN-08', 'FEFO ile iki lottan çıkan sevkiyat iptalinde ikisi de geri gelir', async () => {
    const it = await item(5); await ok('POST', '/stock/move', { itemId: it.id, type: 'in', qty: 5, lotNo: 'L2' });
    const s = (await ship([{ itemId: it.id, qty: 8 }])).data;
    assert.equal(s.items.length, 2);
    statusIn(await api('DELETE', '/sales/shipments/' + s.id), [204]);
    assert.equal(db.prepare('SELECT qty_cache FROM items WHERE id=?').get(it.id).qty_cache, 10);
  });

  console.log('\n[ORDER] sipariş');
  await check('ORD-01', 'kısmen sevk edilmiş sipariş iptali: mevcut davranış', async () => {
    const it = await item(20); const so = await order(cust.id, [{ itemId: it.id, qty: 6, price: 5 }]);
    const s = (await ship([{ itemId: it.id, qty: 2 }], { soId: so.id })).data;
    const r = await api('POST', `/sales/orders/${so.id}/cancel`, {});
    info('ORD-01b', 'kısmi sevkli sipariş iptal', { status: r.status });
    if (r.status === 200) {
      const p = await api('PATCH', `/sales/shipments/${s.id}/status`, {});
      info('ORD-01c', 'iptal siparişin mevcut sevkiyatı ilerletilebilir mi', { status: p.status });
    }
  });
  await check('ORD-02', 'olmayan ürünle sipariş 4xx (FK/500 değil)', async () => {
    const r = await api('POST', '/sales/orders', { customerId: cust.id, lines: [{ itemId: 'nope', qty: 1, price: 1 }] });
    assert(r.status >= 400 && r.status < 500, 'status ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 200));
  });
  await check('ORD-03', 'olmayan müşteri 404; pasif müşteri için sipariş: mevcut davranış', async () => {
    statusIn(await api('POST', '/sales/orders', { customerId: 99999, lines: [{ itemId: 'x', qty: 1, price: 1 }] }), [404]);
    const c = await ok('POST', '/sales/customers', { name: 'Pasif' }); await ok('DELETE', '/sales/customers/' + c.id).catch(() => {});
    await api('DELETE', '/sales/customers/' + c.id);
    const it = await item(5); const r = await api('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: it.id, qty: 1, price: 1 }] });
    info('ORD-03b', 'pasif müşteriye sipariş', { status: r.status });
  });
  await check('ORD-04', 'kredi limiti sınırı: limit aşımı 400, eşit tutar kabul', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'Limitli', creditLimit: 100 }); const it = await item(5);
    statusIn(await api('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: it.id, qty: 1, price: 100.01 }] }), [400]);
    statusIn(await api('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: it.id, qty: 1, price: 100 }] }), [201]);
  });
  await check('ORD-05', 'geçersiz miktar/fiyat/boş satır reddedilir', async () => {
    const it = await item(5);
    for (const lines of [[], [{ itemId: it.id, qty: 0, price: 1 }], [{ itemId: it.id, qty: -1, price: 1 }], [{ itemId: it.id, qty: 1, price: -1 }]])
      statusIn(await api('POST', '/sales/orders', { customerId: cust.id, lines }), [400, 422]);
  });
  await check('ORD-06', 'sipariş tarihi geçersiz metin 4xx vermeli', async () => {
    const it = await item(5);
    const r = await api('POST', '/sales/orders', { customerId: cust.id, date: 'abc', lines: [{ itemId: it.id, qty: 1, price: 1 }] });
    info('ORD-06b', 'sipariş date="abc"', { status: r.status });
    assert(r.status >= 400 && r.status < 500, 'geçersiz tarih kabul edildi/500: ' + r.status);
  });

  console.log('\n[INVOICE] fatura');
  await check('INV-01', 'geçersiz fatura tarihi 4xx vermeli, 500 vermemeli', async () => {
    const bad = [];
    for (const d of ['abc', '2026-02-30', '2026-13-01', '99999-01-01', '', '2026/09/20', '20.09.2026']) {
      const r = await api('POST', '/sales/invoices', { customerId: cust.id, amount: 10, invoiceDate: d });
      info('INV-01b', `invoiceDate=${JSON.stringify(d)}`, { status: r.status, saved: r.data && r.data.invoice_date, due: r.data && r.data.due_date });
      if (r.status >= 500) bad.push(`${JSON.stringify(d)} -> ${r.status}`);
    }
    assert.equal(bad.length, 0, '500 dönen tarihler: ' + bad.join(', '));
  });
  await check('INV-02', 'ödeme: iade (kredi) faturası "ödendi" yapılamamalı, ödenmiş/iptal faturaya tekrar ödeme etkisiz', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'Ödeme testi' });
    const base = await ok('POST', '/sales/invoices', { customerId: c.id, amount: 100 });
    const cr = await ok('POST', '/sales/invoices', { customerId: c.id, amount: 40, invoiceType: 'iade', originalInvoiceId: base.id });
    assert.equal((await ok('GET', '/sales/customers/' + c.id)).openBalanceBase, 60);
    const r = await api('POST', `/sales/invoices/${cr.id}/pay`, {});
    const bal = (await ok('GET', '/sales/customers/' + c.id)).openBalanceBase;
    info('INV-02b', 'iade faturasını öde', { status: r.status, bakiyeSonra: bal });
    assert(r.status >= 400 || bal === 60, `iade faturası ödendi olarak işaretlenince müşteri bakiyesi ${bal} oldu (60 kalmalıydı)`);
  });
  await check('INV-03', 'ödeme uç noktası: olmayan fatura 404; viewer 403; ödenmiş faturayı tekrar ödeme', async () => {
    statusIn(await api('POST', '/sales/invoices/nope/pay', {}), [404]);
    const inv = await ok('POST', '/sales/invoices', { customerId: cust.id, amount: 5 });
    statusIn(await api('POST', `/sales/invoices/${inv.id}/pay`, {}, 'viewer'), [403]);
    statusIn(await api('POST', `/sales/invoices/${inv.id}/pay`, {}), [200]);
    const again = await api('POST', `/sales/invoices/${inv.id}/pay`, {});
    info('INV-03b', 'ödenmiş faturayı tekrar öde', { status: again.status });
  });
  await check('INV-04', 'iade: tam tutara kadar kabul, +0.01 red; ödenmiş faturanın iadesi', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'İade testi' });
    const base = await ok('POST', '/sales/invoices', { customerId: c.id, amount: 100 });
    for (const a of [30, 30, 40]) statusIn(await api('POST', '/sales/invoices', { customerId: c.id, amount: a, invoiceType: 'iade', originalInvoiceId: base.id }), [201]);
    statusIn(await api('POST', '/sales/invoices', { customerId: c.id, amount: 0.01, invoiceType: 'iade', originalInvoiceId: base.id }), [409]);
    assert.equal((await ok('GET', '/sales/customers/' + c.id)).openBalanceBase, 0);
  });
  await check('INV-05', 'iade faturası siparişe bağlı: yeni tahsis oluşturmaz, sevk faturalamayı bozmaz', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'İade sipariş testi' }); const it = await item(20);
    const so = await order(c.id, [{ itemId: it.id, qty: 4, price: 10 }]);
    await ship([{ itemId: it.id, qty: 4 }], { soId: so.id, customerId: c.id });
    const inv = await ok('POST', '/sales/invoices', { customerId: c.id, soId: so.id });
    const before = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty),0) q FROM invoice_shipment_allocations').get();
    const cr = await api('POST', '/sales/invoices', { customerId: c.id, soId: so.id, invoiceType: 'iade', originalInvoiceId: inv.id, amount: 10 });
    info('INV-05b', 'siparişe bağlı iade', { status: cr.status, err: cr.status >= 400 ? cr.data : undefined });
    const after = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty),0) q FROM invoice_shipment_allocations').get();
    assert.deepEqual(after, before, 'iade faturası tahsis tablosunu değiştirdi');
  });
  await check('INV-06', 'geçersiz tutar/tür: negatif, 0 (kalemsiz), bilinmeyen tür reddedilir', async () => {
    for (const body of [{ amount: -5 }, { amount: 0 }, { amount: 5, invoiceType: 'xx' }, { amount: 'abc' }])
      statusIn(await api('POST', '/sales/invoices', { customerId: cust.id, ...body }), [400, 422]);
  });
  await check('INV-07', 'kuruş yuvarlama: KDV ve iskontolu kalem hesabı bağımsız hesapla eşleşir', async () => {
    const inv = await ok('POST', '/sales/invoices', { customerId: cust.id, lines: [{ itemName: 'X', qty: 3, unitPrice: 33.33, discountRate: 10, vatRate: 20 }] });
    assert.equal(inv.amount, 107.99);
    assert(Math.abs(inv.subtotal + inv.vat_total - inv.amount) < 1e-9);
    // yarım kuruş sınırı: 1.005 * 1
    const half = await ok('POST', '/sales/invoices', { customerId: cust.id, lines: [{ itemName: 'Y', qty: 1, unitPrice: 1.005, vatRate: 0 }] });
    info('INV-07b', '1 x 1.005 (KDV 0)', { amount: half.amount, beklenenYarimYukari: 1.01 });
    const many = await ok('POST', '/sales/invoices', { customerId: cust.id, lines: Array.from({ length: 10 }, () => ({ itemName: 'Z', qty: 1, unitPrice: 0.1, vatRate: 18 })) });
    info('INV-07c', '10 x 0.10 (KDV %18): kalem başına yuvarlama toplamı 1.20, toplamdan yuvarlama 1.18 verir — politika kararı', { amount: many.amount });
  });
  await check('INV-08', 'siparişsiz/sevksiz fatura tutarı yalnız amount ile: serbest fatura kabul', async () => {
    const inv = await api('POST', '/sales/invoices', { customerId: cust.id, amount: 12.34 }); statusIn(inv, [201]);
  });
  await check('INV-09', 'sevk edilmemiş siparişin faturası 409', async () => {
    const it = await item(5); const so = await order(cust.id, [{ itemId: it.id, qty: 2, price: 5 }]);
    statusIn(await api('POST', '/sales/invoices', { customerId: cust.id, soId: so.id }), [409]);
  });
  await check('INV-10', 'faturada fiyat: sipariş fiyatından farklı manuel kalem fiyatı kabul edilir mi (bilgi)', async () => {
    const it = await item(5); const so = await order(cust.id, [{ itemId: it.id, qty: 2, price: 100 }]);
    await ship([{ itemId: it.id, qty: 2 }], { soId: so.id });
    const r = await api('POST', '/sales/invoices', { customerId: cust.id, soId: so.id, lines: [{ itemId: it.id, itemName: 'x', qty: 2, unitPrice: 1 }] });
    info('INV-10b', 'sipariş fiyatı 100, faturaya 1 yazıldı', { status: r.status, amount: r.data && r.data.amount });
  });

  console.log('\n[INVARIANTS]');
  await check('INV-ALL', 'küresel değişmezler (defter, önbellek, negatif parti, tahsis, FK, bütünlük)', async () => {
    const v = invariants(); assert.equal(v.length, 0, v.slice(0, 10).join('\n'));
  });
  await finish('b1a-sales');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
