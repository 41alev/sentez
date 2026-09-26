// Batch 2 — satın alma, finans/kur, kimlik, yönetim, ayarlar, rol/yetki
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');
const { invariants } = require('./inv');

(async () => {
  await start({ DEMO_DATA: '1' });
  const db = state.db;
  const whs = db.prepare('SELECT id FROM warehouses ORDER BY id').all().map(w => w.id);
  const sups = db.prepare('SELECT id FROM suppliers WHERE is_approved=1 ORDER BY id').all().map(s => s.id);
  let seq = 0;
  const item = async (qty = 0, cost = 10, extra = {}) => ok('POST', '/items', { name: 'PItem ' + (++seq), openingQty: qty, openingUnitCost: cost, ...extra });
  const lotsOf = id => db.prepare('SELECT * FROM stock_lots WHERE item_id=? ORDER BY received_at').all(id);
  const cacheOf = id => db.prepare('SELECT qty_cache FROM items WHERE id=?').get(id).qty_cache;
  const unchanged = async (fn, codes = [400, 404, 409, 422]) => {
    const before = snap(); const r = await fn(); statusIn(r, codes);
    assert.equal(snap(), before, 'durum değişti'); return r;
  };
  // Onay kuralı kalabalığı test sonuçlarını bozmasın: varsayılan kuralları pasifleştir
  db.prepare('UPDATE approval_rules SET is_active=0').run();
  const po = async (items, extra = {}, who) => api('POST', '/purchasing/orders', { supplierId: sups[0], warehouseId: whs[0], items, ...extra }, who);
  const poOk = async (items, extra = {}) => { const r = await po(items, extra); if (r.status !== 201) throw new Error('PO ' + r.status + JSON.stringify(r.data)); return r.data; };
  const recv = (poId, lines, who) => api('POST', `/purchasing/orders/${poId}/receipts`, { lines }, who);

  console.log('\n[PR/RFQ] talep ve teklif');
  await check('PR-01', 'talep: geçersiz miktar/boş satır 4xx; olmayan ürün id ile (satır adıyla) kabul', async () => {
    for (const lines of [[], [{ itemName: 'x', qty: 0 }], [{ itemName: 'x', qty: -1 }]]) statusIn(await api('POST', '/purchasing/requests', { lines }), [400, 422]);
    const r = await api('POST', '/purchasing/requests', { lines: [{ itemId: 'ghost', qty: 1 }] }); info('PR-01b', 'olmayan itemId', { status: r.status });
    assert(r.status < 500, '500');
  });
  await check('PR-02', 'talep onay/red: durum geçişi kontrolü (reddedilen sonra onaylanabilir mi, onaylı tekrar reddedilebilir mi)', async () => {
    const pr = (await ok('POST', '/purchasing/requests', { lines: [{ itemName: 'x', qty: 1 }] })).id;
    await ok('POST', `/purchasing/requests/${pr}/reject`, { reason: 'test' });
    const a = await api('POST', `/purchasing/requests/${pr}/approve`, {});
    info('PR-02b', 'reddedilmiş talebi onayla', { status: a.status });
    const r2 = await api('POST', `/purchasing/requests/${pr}/reject`, {}); info('PR-02c', 'onaylı talebi reddet', { status: r2.status });
    assert(a.status >= 400, 'reddedilmiş talep onaylanabildi (durum kontrolü yok)');
  });
  await check('PR-03', 'talep: kendi talebini onaylama (dört göz) — mevcut davranış', async () => {
    const pr = (await ok('POST', '/purchasing/requests', { lines: [{ itemName: 'x', qty: 1 }] }, 'manager')).id;
    const a = await api('POST', `/purchasing/requests/${pr}/approve`, {}, 'manager'); info('PR-03b', 'talep sahibi kendi talebini onaylar', { status: a.status });
  });
  await check('PR-04', 'talep onay kuralı (purchase_request eşiği) uygulanıyor mu', async () => {
    db.prepare("INSERT INTO approval_rules(doc_type,threshold_base,required_role,is_active) VALUES ('purchase_request',0,'admin',1)").run();
    const pr = (await ok('POST', '/purchasing/requests', { lines: [{ itemName: 'x', qty: 1 }] })).id;
    const a = await api('POST', `/purchasing/requests/${pr}/approve`, {}, 'manager');
    info('PR-04b', "'purchase_request' kuralı admin rolü şart koşarken müdür onaylar", { status: a.status });
    db.prepare("UPDATE approval_rules SET is_active=0").run();
    assert.equal(a.status, 403, 'talep onay kuralı hiç uygulanmıyor');
  });
  await check('RFQ-01', 'teklif: olmayan tedarikçi/ürün, RFQ dışı ürün, negatif fiyat; RFQ ödül/sipariş dönüşümü uçları', async () => {
    const it = await item(); const rfq = (await ok('POST', '/purchasing/rfqs', { lines: [{ itemId: it.id, qty: 5 }], supplierIds: [sups[0]] })).id;
    const other = await item();
    const cases = {
      olmayanTedarikci: { supplierId: 999999, itemId: it.id, unitPrice: 1 },
      rfqDisiUrun: { supplierId: sups[0], itemId: other.id, unitPrice: 1 },
      negatifFiyat: { supplierId: sups[0], itemId: it.id, unitPrice: -1 },
      olmayanUrun: { supplierId: sups[0], itemId: 'ghost', unitPrice: 1 }
    };
    const res = {}; for (const [k, b] of Object.entries(cases)) res[k] = (await api('POST', `/purchasing/rfqs/${rfq}/quotes`, b)).status;
    info('RFQ-01b', 'teklif doğrulama sonuçları', res);
    const aw = await api('POST', `/purchasing/rfqs/${rfq}/award`, {}); info('RFQ-01c', 'RFQ ödüllendirme ucu', { status: aw.status });
    assert(Object.values(res).every(s => s < 500), 'teklifte 500: ' + JSON.stringify(res));
    assert.equal(res.negatifFiyat, 422); assert(res.rfqDisiUrun >= 400, 'RFQ satırında olmayan ürüne teklif kabul edildi');
  });

  console.log('\n[PO] satın alma siparişi');
  await check('PO-01', 'sipariş: olmayan ürün/depo/tedarikçi/pasif tedarikçi 4xx; negatif/0 miktar', async () => {
    const it = await item();
    const res = {
      olmayanUrun: (await po([{ itemId: 'ghost', qty: 1, price: 1 }])).status,
      olmayanDepo: (await po([{ itemId: it.id, qty: 1, price: 1 }], { warehouseId: 999999 })).status,
      olmayanTedarikci: (await po([{ itemId: it.id, qty: 1, price: 1 }], { supplierId: 999999 })).status,
      sifirMiktar: (await po([{ itemId: it.id, qty: 0, price: 1 }])).status,
      negatifFiyat: (await po([{ itemId: it.id, qty: 1, price: -1 }])).status,
      bosFiyat: (await po([{ itemId: it.id, qty: 1, price: '' }])).status,
      gecersizTarih: (await po([{ itemId: it.id, qty: 1, price: 1 }], { date: 'abc' })).status
    };
    info('PO-01b', 'sipariş doğrulama sonuçları', res);
    const bad = Object.entries(res).filter(([k, s]) => s >= 500 || (['bosFiyat', 'gecersizTarih'].includes(k) && s === 201)).map(([k, s]) => `${k}:${s}`);
    assert.equal(bad.length, 0, 'sorunlu: ' + bad.join(', '));
  });
  await check('PO-02', 'pasif (onaysız) tedarikçiye sipariş açılamaz', async () => {
    const s = await ok('POST', '/purchasing/suppliers', { name: 'Onaysız', isApproved: false }); const it = await item();
    statusIn(await po([{ itemId: it.id, qty: 1, price: 1 }], { supplierId: s.id }), [400, 409, 422]);
  });
  await check('PO-03', 'onay: eşik altı/üstü, yetki limiti, çift onay, reddedilmiş onay', async () => {
    db.prepare("INSERT INTO approval_rules(doc_type,threshold_base,required_role,is_active) VALUES ('purchase_order',100,'manager',1)").run();
    const it = await item();
    const low = await poOk([{ itemId: it.id, qty: 1, price: 50 }]); assert.equal(low.approvalStatus, 'not_required'); assert.equal(low.status, 'approved');
    const high = await poOk([{ itemId: it.id, qty: 1, price: 150 }]); assert.equal(high.approvalStatus, 'pending');
    statusIn(await recv(high.id, [{ poItemId: high.items[0].id, qty: 1 }]), [400]);
    statusIn(await api('POST', `/purchasing/orders/${high.id}/approve`, {}, 'operator'), [403]);
    statusIn(await api('POST', `/purchasing/orders/${high.id}/approve`, {}, 'manager'), [200]);
    statusIn(await api('POST', `/purchasing/orders/${high.id}/approve`, {}, 'manager'), [400]);
    db.prepare('UPDATE approval_rules SET is_active=0').run();
  });
  await check('PO-04', 'onay limiti: personel limiti aşan tutar 403; limit 0 = limitsiz (kayıt)', async () => {
    db.prepare("INSERT INTO approval_rules(doc_type,threshold_base,required_role,is_active) VALUES ('purchase_order',1,'manager',1)").run();
    const it = await item(); const big = await poOk([{ itemId: it.id, qty: 1, price: 999999 }]);
    const mudurLimit = db.prepare("SELECT approval_limit l FROM users WHERE username='mudur'").get().l;
    const r = await api('POST', `/purchasing/orders/${big.id}/approve`, {}, 'manager');
    info('PO-04b', 'müdür limiti / tutar 999999', { limit: mudurLimit, status: r.status });
    if (mudurLimit > 0) assert.equal(r.status, 403);
    db.prepare('UPDATE approval_rules SET is_active=0').run();
  });
  await check('PO-05', 'red: onaylanmış/teslim alınmış siparişi reddetmek durumu bozmamalı', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 5, price: 1 }]);
    await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 2 }] });
    const r = await api('POST', `/purchasing/orders/${p.id}/reject`, { reason: 'x' });
    const st = db.prepare('SELECT status,approval_status FROM purchase_orders WHERE id=?').get(p.id);
    info('PO-05b', 'kısmen teslim alınmış siparişi reddet', { http: r.status, durum: st });
    assert(r.status >= 400, `kısmen teslim alınmış sipariş reddedilebildi → durum ${st.status}`);
  });
  await check('PO-06', 'sipariş iptal/kapatma/düzenleme uçları var mı (bilgi)', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 1, price: 1 }]);
    const res = {};
    for (const [m, u] of [['POST', `/purchasing/orders/${p.id}/cancel`], ['POST', `/purchasing/orders/${p.id}/close`], ['PUT', `/purchasing/orders/${p.id}`], ['DELETE', `/purchasing/orders/${p.id}`]]) res[m + ' ' + u.split('/').pop()] = (await api(m, u, {})).status;
    info('PO-06b', 'iptal/kapat/düzenle/sil', res);
  });

  console.log('\n[RECEIPT] mal kabul');
  await check('RC-01', 'mal kabul: fazla teslim tolerans, kalan, statü geçişleri, 0/negatif miktar, başka siparişin kalemi', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 10, price: 2, tolerancePct: 10 }]); const other = await poOk([{ itemId: it.id, qty: 5, price: 2 }]);
    const l = p.items[0].id;
    await unchanged(() => recv(p.id, [{ poItemId: l, qty: 12 }]), [400]);
    for (const q of [0, -1, 'x']) await unchanged(() => recv(p.id, [{ poItemId: l, qty: q }]), [400, 422]);
    await unchanged(() => recv(p.id, [{ poItemId: other.items[0].id, qty: 1 }]), [404]);
    statusIn(await recv(p.id, [{ poItemId: l, qty: 6 }]), [201]); assert.equal((await ok('GET', '/purchasing/orders/' + p.id)).status, 'partially_received');
    statusIn(await recv(p.id, [{ poItemId: l, qty: 5 }]), [201]); assert.equal((await ok('GET', '/purchasing/orders/' + p.id)).status, 'received');
    await unchanged(() => recv(p.id, [{ poItemId: l, qty: 1 }]), [400]);
    assert.equal(cacheOf(it.id), 11);
  });
  await check('RC-02', 'mal kabul: siparişte depo yoksa 422; geçersiz son kullanma tarihi kabul mü', async () => {
    const it = await item(); const p = await api('POST', '/purchasing/orders', { supplierId: sups[0], items: [{ itemId: it.id, qty: 2, price: 1 }] });
    statusIn(await recv(p.data.id, [{ poItemId: p.data.items[0].id, qty: 1 }]), [422]);
    const p2 = await poOk([{ itemId: it.id, qty: 2, price: 1 }]);
    const r = await recv(p2.id, [{ poItemId: p2.items[0].id, qty: 1, expiryDate: 'abc' }]); info('RC-02b', "expiryDate='abc'", { status: r.status });
    assert(r.status !== 201, 'geçersiz son kullanma tarihi kabul edildi');
  });
  await check('RC-03', 'kalite muayenesi gerektiren ürün karantinaya girer; kullanılabilir stok artmaz', async () => {
    const it = await item(0, 0, { requiresIncomingInspection: true }); const p = await poOk([{ itemId: it.id, qty: 4, price: 3 }]);
    await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 4 }] });
    assert.equal(cacheOf(it.id), 0); assert.equal(lotsOf(it.id)[0].status, 'quarantine');
  });
  await check('RC-04', 'eşzamanlı iki mal kabul aynı satırı toleransın üstüne çıkaramaz', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 10, price: 1 }]);
    const rs = await Promise.all(Array.from({ length: 4 }, () => recv(p.id, [{ poItemId: p.items[0].id, qty: 4 }])));
    assert.equal(rs.filter(r => r.status === 201).length, 2); assert.equal(cacheOf(it.id), 8);
  });
  await check('RC-05', 'mal kabul rolleri: viewer/quality 403; operator izin (kayıt)', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 3, price: 1 }]);
    for (const who of ['viewer', 'quality']) await unchanged(() => recv(p.id, [{ poItemId: p.items[0].id, qty: 1 }], who), [403]);
    const r = await recv(p.id, [{ poItemId: p.items[0].id, qty: 1 }], 'operator'); info('RC-05b', 'operator mal kabul', { status: r.status });
  });
  await check('RC-06', 'yanlış mal kabulü geri alma/düzeltme yolu var mı (bilgi)', async () => {
    const res = {}; for (const [m, u] of [['DELETE', '/purchasing/receipts/x'], ['POST', '/purchasing/receipts/x/cancel'], ['POST', '/purchasing/receipts/x/reverse']]) res[m + u] = (await api(m, u, {})).status;
    info('RC-06b', 'mal kabul iptal uçları', res);
  });

  console.log('\n[LANDED] ek maliyet');
  await check('LC-01', 'demo tohumundaki mal kabul (IRS-2026-001) yeni ek maliyet kabul ediyor mu', async () => {
    const rc = db.prepare("SELECT id FROM po_receipts WHERE receipt_no='IRS-2026-001'").get();
    if (!rc) return info('LC-01b', 'tohum irsaliyesi yok', {});
    const r = await api('POST', `/purchasing/receipts/${rc.id}/landed-costs`, { costType: 'freight', amount: 100 });
    info('LC-01b', 'tohum irsaliyesine ek maliyet', { status: r.status, body: r.data && (r.data.error || r.data) });
    // 26.09 yeniden sınıflandırma: tohum irsaliyesinin partileri tüketilmiş; tüketilmiş
    // maliyete sessizce ek maliyet dağıtmak yanlış COGS üretir. 409 + mutabakat bilinçli koruma.
    assert(r.status === 201 || r.status === 409, 'beklenmeyen durum: ' + r.status);
    if (r.status === 409) assert(/mutabakat|reconciliation/i.test(r.data.error), 'mutabakat gerekçesi yok');
  });
  await check('LC-02', 'ek maliyet: negatif/boş tutar, olmayan irsaliye, aynı iş iki kez', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 10, price: 10 }]);
    const rc = (await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 10 }] })).receiptId;
    await unchanged(() => api('POST', `/purchasing/receipts/${rc}/landed-costs`, { costType: 'freight', amount: -5 }), [400, 422]);
    await unchanged(() => api('POST', '/purchasing/receipts/nope/landed-costs', { costType: 'freight', amount: 5 }), [404]);
    const empty = await api('POST', `/purchasing/receipts/${rc}/landed-costs`, { costType: 'freight', amount: '' }); info('LC-02b', "amount=''", { status: empty.status });
    statusIn(await api('POST', `/purchasing/receipts/${rc}/landed-costs`, { costType: 'freight', amount: 100 }), [201]);
    const avg = db.prepare('SELECT avg_cost FROM items WHERE id=?').get(it.id).avg_cost; assert(Math.abs(avg - 20) < 1e-6, 'ortalama maliyet ' + avg);
    assert(empty.status >= 400, 'boş ek maliyet tutarı kabul edildi');
  });
  await check('LC-03', 'ek maliyet USD: masraf kuruyla çevrilir ve tahsis toplamı tutar', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 10, price: 10 }]);
    const rc = (await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 10 }] })).receiptId;
    await ok('POST', `/purchasing/receipts/${rc}/landed-costs`, { costType: 'customs', amount: 10, currency: 'USD' });
    const rate = db.prepare("SELECT rate FROM exchange_rates WHERE currency='USD' ORDER BY rate_date DESC LIMIT 1").get().rate;
    const al = db.prepare('SELECT SUM(a.amount_base) v FROM landed_cost_allocations a JOIN landed_costs c ON c.id=a.cost_id WHERE c.receipt_id=?').get(rc).v;
    assert(Math.abs(al - 10 * rate) < 1e-6, `tahsis ${al} beklenen ${10 * rate}`);
  });

  console.log('\n[SUP-INV] tedarikçi faturası / 3\'lü eşleştirme');
  await check('SI-01', 'karma dövizli siparişte alınan tutar satır kuruyla hesaplanmalı', async () => {
    const it = await item();
    const p = await poOk([{ itemId: it.id, qty: 2, price: 10, currency: 'USD' }, { itemId: it.id, qty: 2, price: 10, currency: 'EUR' }], { currency: 'USD' });
    await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: p.items.map(l => ({ poItemId: l.id, qty: 2 })) });
    const usd = db.prepare("SELECT rate FROM exchange_rates WHERE currency='USD' ORDER BY rate_date DESC LIMIT 1").get().rate;
    const eur = db.prepare("SELECT rate FROM exchange_rates WHERE currency='EUR' ORDER BY rate_date DESC LIMIT 1").get().rate;
    const exact = 2 * 10 * usd + 2 * 10 * eur;
    const r = await ok('POST', '/purchasing/invoices', { invoiceNo: 'MIX-1', poId: p.id, amount: exact / usd, currency: 'USD' });
    info('SI-01b', 'karma döviz 3lü eşleştirme', { receivedBase: r.receivedBase, beklenen: exact, fark: r.receivedBase - exact, durum: r.matchStatus });
    assert(Math.abs(r.receivedBase - exact) < 0.01, `alınan tutar ${r.receivedBase} beklenen ${exact}`);
  });
  await check('SI-02', 'fatura: mükerrer fatura no (aynı tedarikçi), başka siparişin irsaliyesi, geçersiz tarih', async () => {
    const it = await item(); const p = await poOk([{ itemId: it.id, qty: 2, price: 5 }]); const p2 = await poOk([{ itemId: it.id, qty: 2, price: 5 }]);
    const rc2 = (await ok('POST', `/purchasing/orders/${p2.id}/receipts`, { lines: [{ poItemId: p2.items[0].id, qty: 2 }] })).receiptId;
    const a = await api('POST', '/purchasing/invoices', { invoiceNo: 'DUP-1', poId: p.id, amount: 10 });
    const b = await api('POST', '/purchasing/invoices', { invoiceNo: 'DUP-1', poId: p.id, amount: 10 });
    const c = await api('POST', '/purchasing/invoices', { invoiceNo: 'X-2', poId: p.id, receiptId: rc2, amount: 10 });
    const d = await api('POST', '/purchasing/invoices', { invoiceNo: 'X-3', poId: p.id, amount: 10, invoiceDate: 'abc' });
    info('SI-02b', 'fatura doğrulama', { ilk: a.status, mukerrer: b.status, baskaSiparisIrsaliyesi: c.status, gecersizTarih: d.status });
    assert.equal(b.status >= 400, true, 'aynı fatura no ikinci kez kabul edildi (mükerrer ödeme riski)');
    assert(c.status >= 400, 'başka siparişin irsaliyesi ile fatura kabul edildi');
    assert(d.status < 500, 'geçersiz tarih 500');
  });
  await check('SI-03', 'tedarikçi faturası durum ilerletme/ödeme uçları (bilgi)', async () => {
    const res = {}; for (const [m, u] of [['POST', '/purchasing/invoices/x/approve'], ['POST', '/purchasing/invoices/x/pay'], ['PATCH', '/purchasing/invoices/x/status']]) res[m + u.split('/').slice(-1)] = (await api(m, u, {})).status;
    info('SI-03b', 'ödeme uçları', res);
  });
  await check('SI-04', 'tolerans: %2 içi eşleşir, dışı uyuşmazlık', async () => {
    // 26.09: her fatura teslim miktarını tüketir (T06); ikinci faturanın aynı teslimi
    // tekrar faturalaması 409 olur. Tolerans bu yüzden iki ayrı siparişle ölçülür.
    for (const [no, amount, expected] of [['T1', 1019, 'matched'], ['T2', 1021, 'discrepancy']]) {
      const it = await item(); const p = await poOk([{ itemId: it.id, qty: 100, price: 10 }]);
      await ok('POST', `/purchasing/orders/${p.id}/receipts`, { lines: [{ poItemId: p.items[0].id, qty: 100 }] });
      assert.equal((await ok('POST', '/purchasing/invoices', { invoiceNo: no, poId: p.id, amount })).matchStatus, expected);
    }
  });

  console.log('\n[FX] kur');
  await check('FX-01', 'kur girişi: geçersiz tarih/oran; geçmiş kur değişince mevcut belge değişmez', async () => {
    for (const b of [{ currency: 'USD', rate: 0 }, { currency: 'USD', rate: -1 }, { currency: 'USD', rate: 'x' }, { currency: 'ABC', rate: 1 }, { currency: 'USD', rate: 34, rateDate: '2026-99-99' }])
      { const r = await api('POST', '/exchange-rates', b); info('FX-01b', JSON.stringify(b), { status: r.status }); }
    const bad = await api('POST', '/exchange-rates', { currency: 'USD', rate: 34, rateDate: '2026-99-99' });
    assert(bad.status >= 400, 'geçersiz takvim tarihi kur olarak kaydedildi');
  });
  await check('FX-02', 'uçtan uç kur uygunsuzluğu: aşırı oranlar (0.0000001 / 1e12) kabul mü (bilgi)', async () => {
    const a = await api('POST', '/exchange-rates', { currency: 'EUR', rate: 0.0000001, rateDate: '2026-09-01' });
    const b = await api('POST', '/exchange-rates', { currency: 'EUR', rate: 1e12, rateDate: '2026-09-02' });
    info('FX-02b', 'aşırı kurlar', { kucuk: a.status, buyuk: b.status });
  });

  console.log('\n[AUTH] kimlik');
  await check('AU-01', 'giriş: yanlış şifre 401, olmayan kullanıcı 401 (aynı mesaj), pasif kullanıcı ve kilit yanıtları ayırt edilebilir mi', async () => {
    const u = await ok('POST', '/users', { username: 'enumtest', password: 'Enum12345!', role: 'operator', mustChangePassword: false });
    const wrong = await api('POST', '/auth/login', { username: 'enumtest', password: 'zzzzzzzz1' }, null);
    const ghost = await api('POST', '/auth/login', { username: 'no-such-user', password: 'zzzzzzzz1' }, null);
    assert.equal(wrong.status, 401); assert.equal(ghost.status, 401); assert.deepEqual(wrong.data, ghost.data);
    await ok('PUT', '/users/' + u.id, { isActive: false });
    const dis = await api('POST', '/auth/login', { username: 'enumtest', password: 'Enum12345!' }, null);
    info('AU-01b', 'pasif kullanıcı doğru şifre', { status: dis.status, mesaj: dis.data && dis.data.error });
    assert.equal(dis.status === 401, true, `pasif kullanıcı ${dis.status} döndürdü: kullanıcı adı varlığı sızıyor`);
  });
  await check('AU-02', 'kilitlenme: 5 hata → kilit; kilit bitince TEK yanlış deneme yeniden kilitlemesin', async () => {
    const u = await ok('POST', '/users', { username: 'locktest', password: 'Lock12345!', role: 'operator', mustChangePassword: false });
    for (let i = 0; i < 5; i++) await api('POST', '/auth/login', { username: 'locktest', password: 'bad-pass-1' }, null);
    const locked = await api('POST', '/auth/login', { username: 'locktest', password: 'Lock12345!' }, null); assert.equal(locked.status, 429);
    db.prepare('UPDATE users SET locked_until=? WHERE id=?').run(Date.now() - 1000, u.id);
    const oneWrong = await api('POST', '/auth/login', { username: 'locktest', password: 'bad-pass-1' }, null);
    const next = await api('POST', '/auth/login', { username: 'locktest', password: 'Lock12345!' }, null);
    info('AU-02b', 'kilit bittikten sonra 1 yanlış + 1 doğru deneme', { yanlis: oneWrong.status, dogru: next.status });
    assert.equal(next.status, 200, 'kilit süresi bittikten sonra tek yanlış deneme hesabı yeniden kilitledi (sayaç sıfırlanmıyor)');
  });
  await check('AU-03', 'şifre değiştirme: yanlış mevcut şifre 400; aynı şifreyle "değiştirme" zorunlu değişimi atlatmamalı', async () => {
    const u = await ok('POST', '/users', { username: 'pwtest', password: 'Pw123456a!', role: 'operator', mustChangePassword: true });
    const tok = (await api('POST', '/auth/login', { username: 'pwtest', password: 'Pw123456a!' }, null)).data.token;
    statusIn(await api('POST', '/auth/change-password', { currentPassword: 'wrong', newPassword: 'Newpass123' }, null, { token: tok }), [400]);
    const same = await api('POST', '/auth/change-password', { currentPassword: 'Pw123456a!', newPassword: 'Pw123456a!' }, null, { token: tok });
    info('AU-03b', 'aynı şifreye değiştirme', { status: same.status });
    assert(same.status >= 400, 'zorunlu şifre değişimi aynı şifreyle atlatılabiliyor');
  });
  await check('AU-04', 'şifre politikası tutarlılığı: yönetici belirlemesi ile kendi değişimi aynı kuralları uygular', async () => {
    const pwList = ['abcdefgh', 'Abcdefgh', 'abcdefg!', 'abcdefg1', '12345678', 'Password1', 'aaaaaaaa1'];
    const admin = {}, self = {};
    let n = 0;
    for (const pw of pwList) {
      const nm = 'polusr' + (++n);
      const c = await api('POST', '/users', { username: nm, password: pw, role: 'viewer', mustChangePassword: false }); admin[pw] = c.status;
      const u2 = await ok('POST', '/users', { username: nm + 'b', password: 'Base12345!', role: 'viewer', mustChangePassword: false });
      const tok = (await api('POST', '/auth/login', { username: nm + 'b', password: 'Base12345!' }, null)).data.token;
      self[pw] = (await api('POST', '/auth/change-password', { currentPassword: 'Base12345!', newPassword: pw }, null, { token: tok })).status;
    }
    info('AU-04b', 'yönetici (create) vs kendi değişimi', { admin, self });
    const diff = pwList.filter(pw => (admin[pw] === 201) !== (self[pw] === 200));
    assert.equal(diff.length, 0, 'tutarsız politika: ' + diff.join(', '));
  });
  await check('AU-05', 'oturum: çıkış sonrası token 401; şifre sıfırlanınca eski oturumlar düşer; pasif kullanıcı token 401', async () => {
    const u = await ok('POST', '/users', { username: 'sesstest', password: 'Sess12345!', role: 'operator', mustChangePassword: false });
    const login = async () => (await api('POST', '/auth/login', { username: 'sesstest', password: 'Sess12345!' }, null)).data.token;
    const t1 = await login(); statusIn(await api('GET', '/items', undefined, null, { token: t1 }), [200]);
    await api('POST', '/auth/logout', {}, null, { token: t1 }); statusIn(await api('GET', '/items', undefined, null, { token: t1 }), [401]);
    const t2 = await login(); await ok('PUT', '/users/' + u.id, { isActive: false }); statusIn(await api('GET', '/items', undefined, null, { token: t2 }), [401]);
  });
  await check('AU-06', 'sahte/bozuk token: none alg, süresi geçmiş, başka imza, boş, çok uzun', async () => {
    const jwt = require('jsonwebtoken'); const secret = process.env.JWT_SECRET;
    const good = (await api('POST', '/auth/login', { username: 'admin', password: 'Admin123!' }, null)).data.token;
    const p = jwt.decode(good);
    const forged = {
      none: Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: 1, username: 'admin', role: 'admin', jti: p.jti })).toString('base64url') + '.',
      baskaSecret: jwt.sign({ id: 1, username: 'admin', role: 'admin', jti: p.jti }, 'other-secret'),
      suresiGecmis: jwt.sign({ id: 1, username: 'admin', role: 'admin', jti: p.jti }, secret, { expiresIn: -10 }),
      hs512: jwt.sign({ id: 1, username: 'admin', role: 'admin', jti: p.jti }, secret, { algorithm: 'HS512' }),
      jtiYok: jwt.sign({ id: 1, username: 'admin', role: 'admin', jti: 'nope' }, secret),
      cokUzun: 'a.'.repeat(50000)
    };
    // 26.09: 100 KB'lık başlık Node HTTP katmanında 431 ile reddedilir (uygulamaya ulaşmaz) — doğru davranış.
    for (const [k, t] of Object.entries(forged)) { const r = await api('GET', '/items', undefined, null, { token: t }); assert(r.status === 401 || (k === 'cokUzun' && r.status === 431), `${k} -> ${r.status}`); }
    assert.equal((await api('GET', '/items', undefined, null)).status, 401);
  });
  await check('AU-07', 'JWT içindeki rol/kimlik yerine DB kullanılıyor: rol düşürülünce mevcut token yetkisini kaybeder', async () => {
    const u = await ok('POST', '/users', { username: 'roletest', password: 'Role12345!', role: 'manager', mustChangePassword: false });
    const t = (await api('POST', '/auth/login', { username: 'roletest', password: 'Role12345!' }, null)).data.token;
    statusIn(await api('POST', '/production', { itemId: 'x', qty: 1 }, null, { token: t }), [400, 404, 422]);
    await ok('PUT', '/users/' + u.id, { role: 'viewer' });
    statusIn(await api('POST', '/production', { itemId: 'x', qty: 1 }, null, { token: t }), [403]);
  });

  console.log('\n[ADMIN] yönetim');
  await check('AD-01', 'kullanıcı: son admin korunur, kendini silemez, mükerrer/benzer kullanıcı adı, e-posta doğrulama', async () => {
    const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1").all();
    assert.equal(admins.length, 1);
    await unchanged(() => api('PUT', '/users/' + admins[0].id, { role: 'viewer' }), [400, 409]);
    await unchanged(() => api('PUT', '/users/' + admins[0].id, { isActive: false }), [400, 409]);
    await unchanged(() => api('DELETE', '/users/' + admins[0].id), [400, 409]);
    statusIn(await api('POST', '/users', { username: 'admin', password: 'Dup12345!', role: 'viewer' }), [409]);
    const ci = await api('POST', '/users', { username: 'Admin', password: 'Dup12345!', role: 'viewer' }); info('AD-01b', "'Admin' (büyük harf) kullanıcı adı", { status: ci.status });
    statusIn(await api('POST', '/users', { username: 'mailtest', password: 'Mail12345!', role: 'viewer', email: 'not-an-email' }), [400, 422]);
    assert.equal(ci.status, 409, "'Admin' ile 'admin' ayrı kullanıcı olarak oluşturulabiliyor (karışıklık/taklit riski)");
  });
  await check('AD-02', 'yetki: yönetim uçları yalnız admin/manager; viewer/operator/quality kapalı', async () => {
    const eps = [['GET', '/users'], ['POST', '/users'], ['GET', '/audit'], ['GET', '/settings'], ['PUT', '/settings'], ['POST', '/approval-rules'], ['GET', '/notification-rules'], ['GET', '/approval-rules'], ['POST', '/exchange-rates'], ['GET', '/warehouses']];
    const m = {};
    for (const who of ['viewer', 'operator', 'quality', 'manager']) { m[who] = {}; for (const [meth, url] of eps) m[who][meth + ' ' + url] = (await api(meth, url, meth === 'GET' ? undefined : {}, who)).status; }
    info('AD-02b', 'yönetim uçları rol matrisi', m);
    const leaks = ['GET /audit', 'GET /settings', 'GET /notification-rules', 'GET /approval-rules'].filter(k => m.viewer[k] === 200);
    assert.equal(leaks.length, 0, 'viewer rolü şunları okuyabiliyor: ' + leaks.join(', '));
  });
  await check('AD-03', 'ayarlar doğrulaması: geçersiz değerler kaydedilmemeli (KDV, para birimi, sayılar)', async () => {
    const bad = [{ defaultVatRate: 'abc' }, { defaultVatRate: -5 }, { defaultVatRate: 1e9 }, { baseCurrency: 'ZZZ' }, { expiryWarningDays: 'x' }, { defaultLaborRate: -1 }, { labelPrinterPort: 99999 }, { companyName: '' }];
    const accepted = [];
    for (const b of bad) { const r = await api('PUT', '/settings', b); const s = (await ok('GET', '/settings')); info('AD-03b', JSON.stringify(b), { status: r.status, okunan: Object.fromEntries(Object.keys(b).map(k => [k, s[k]])) }); if (r.status === 200) accepted.push(JSON.stringify(b)); }
    // temizle
    await api('PUT', '/settings', { defaultVatRate: 20, baseCurrency: 'TRY', expiryWarningDays: 30, defaultLaborRate: 250, labelPrinterPort: 9100, companyName: 'Test A.Ş.' });
    assert.equal(accepted.length, 0, 'doğrulanmadan kaydedilenler: ' + accepted.join(' | '));
  });
  await check('AD-04', 'bozuk KDV ayarı faturalamayı bozar mı (NaN)', async () => {
    await api('PUT', '/settings', { defaultVatRate: 'abc' });
    const r = await api('POST', '/sales/invoices', { customerId: (await api('GET', '/sales/customers')).data.data[0].id, lines: [{ itemName: 'x', qty: 1, unitPrice: 100 }] });
    info('AD-04b', "defaultVatRate='abc' iken KDV'siz-belirtilmemiş kalemli fatura", { status: r.status, tutar: r.data && r.data.amount, err: r.status >= 400 ? r.data : undefined });
    await api('PUT', '/settings', { defaultVatRate: 20 });
    assert(r.status === 201 && Number.isFinite(r.data.amount) && r.data.amount === 120, `fatura tutarı ${r.data && r.data.amount} (HTTP ${r.status})`);
  });
  await check('AD-05', 'boolean ayarlar: false gönderilince kapanıyor mu (lowStockCheckEnabled)', async () => {
    await api('PUT', '/settings', { lowStockCheckEnabled: false }); const a = (await ok('GET', '/settings')).lowStockCheckEnabled;
    await api('PUT', '/settings', { lowStockCheckEnabled: 0 }); const b = (await ok('GET', '/settings')).lowStockCheckEnabled;
    await api('PUT', '/settings', { lowStockCheckEnabled: '0' }); const c = (await ok('GET', '/settings')).lowStockCheckEnabled;
    info('AD-05b', 'false / 0 / "0" gönderimi sonucu', { false: a, sifir: b, metinSifir: c });
    await api('PUT', '/settings', { lowStockCheckEnabled: '1' });
    assert.equal(a, false, 'JSON false ayarı kapatmıyor');
  });
  await check('AD-06', 'depo: boş ad, tipsiz gövde, stoklu depoyu pasifleştirme', async () => {
    const w = await ok('POST', '/warehouses', { name: 'Test Depo ' + Date.now() });
    const e = await api('PUT', '/warehouses/' + w.id, { name: '' }); info('AD-06b', "PUT name=''", { status: e.status, ad: e.data && e.data.name });
    const t = await api('PUT', '/warehouses/' + w.id, { name: { x: 1 } }); info('AD-06c', 'PUT name=obje', { status: t.status });
    const it = await ok('POST', '/items', { name: 'depo-stok', warehouseId: w.id, openingQty: 5 });
    const d = await api('PUT', '/warehouses/' + w.id, { isActive: false }); info('AD-06d', 'stoklu depoyu pasifleştir', { status: d.status });
    assert(e.status >= 400, 'boş depo adı kabul edildi'); assert(t.status < 500, 'tipsiz gövde 500'); assert(d.status >= 400, 'stoklu depo pasifleştirilebildi');
  });
  await check('AD-07', 'onay kuralı/bildirim kuralı: geçersiz değerler ve silme sonrası davranış', async () => {
    for (const b of [{ docType: 'purchase_order', thresholdBase: -1, requiredRole: 'admin' }, { docType: 'x', thresholdBase: 1, requiredRole: 'admin' }, { docType: 'purchase_order', thresholdBase: 1, requiredRole: 'viewer' }])
      statusIn(await api('POST', '/approval-rules', b), [400, 422]);
    for (const b of [{ ruleType: 'x' }, { ruleType: 'low_stock', channel: 'sms' }, { ruleType: 'expiry', thresholdDays: 'abc' }]) statusIn(await api('POST', '/notification-rules', b), [400, 422]);
  });
  await check('AD-08', 'kullanıcı güncelleme: geçersiz e-posta, onay limiti NaN/negatif/çok büyük, uzun ad', async () => {
    const u = await ok('POST', '/users', { username: 'updtest', password: 'Upd12345!', role: 'operator', mustChangePassword: false });
    for (const b of [{ email: 'bad' }, { approvalLimit: -1 }, { approvalLimit: 'x' }, { fullName: 'x'.repeat(5000) }, { role: 'root' }]) statusIn(await api('PUT', '/users/' + u.id, b), [400, 422]);
    const big = await api('PUT', '/users/' + u.id, { approvalLimit: 1e300 }); info('AD-08b', 'approvalLimit=1e300', { status: big.status });
  });
  await check('AD-09', 'denetim kaydı: yazma işlemleri kayıt bırakır; kayıtlar silinemez/değiştirilemez uç yok', async () => {
    const before = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c; await ok('POST', '/warehouses', { name: 'Audit Depo ' + Date.now() });
    assert(db.prepare('SELECT COUNT(*) c FROM audit_log').get().c > before);
    for (const [m, u] of [['DELETE', '/audit'], ['PUT', '/audit/x'], ['DELETE', '/audit/x']]) assert.equal((await api(m, u)).status, 404);
  });

  console.log('\n[INVARIANTS]');
  await check('INV-ALL', 'küresel değişmezler', async () => { const v = invariants(); assert.equal(v.length, 0, v.slice(0, 12).join('\n')); });
  await finish('b2-purch-auth');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
