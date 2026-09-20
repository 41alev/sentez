// Batch 4b — CRM / destek / ziyaret
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');

(async () => {
  await start({});
  const db = state.db;
  const cust = async (name, extra = {}) => ok('POST', '/sales/customers', { name, ...extra });
  const item = async (name, qty = 10) => ok('POST', '/items', { name, openingQty: qty });
  const opp = async (body = {}) => ok('POST', '/crm/opportunities', { customerName: 'Aday', ...body });

  console.log('\n[CRM] fırsat hunisi');
  await check('CR-01', 'olmayan müşteri/atanan kullanıcı ile fırsat: 404/422 olmalı, 500 olmamalı; kısmi yazı yok', async () => {
    const before = snap();
    for (const b of [{ customerId: 999999 }, { assignedTo: 999999 }, { customerId: -1 }]) {
      const r = await api('POST', '/crm/opportunities', { customerName: 'X', ...b });
      info('CR-01a', JSON.stringify(b), { status: r.status });
      assert(r.status >= 400 && r.status < 500, `${JSON.stringify(b)} → ${r.status}`);
    }
    assert.deepEqual(snap(), before, 'reddedilen isteklerde kalıntı kayıt');
  });
  await check('CR-02', 'geçersiz alanlar: negatif değer, olasılık>100, geçersiz kaynak, tarih formatı, olmayan kalem ürünü', async () => {
    const bad = [{ estimatedValue: -1 }, { probability: 101 }, { probability: 1.5 }, { source: 'x' }, { lines: [{ itemId: 'i', itemName: 'n', qty: 0 }] }, { lines: [{ itemId: 'i', itemName: 'n', qty: -2 }] }];
    for (const b of bad) statusIn(await api('POST', '/crm/opportunities', { customerName: 'X', ...b }), [400, 422]);
    const dt = await api('POST', '/crm/opportunities', { customerName: 'X', estimatedCloseDate: '2026-99-99' });
    const nul = await api('POST', '/crm/opportunities', { customerName: 'X', estimatedValue: null });
    const ghost = await api('POST', '/crm/opportunities', { customerName: 'X', lines: [{ itemId: 'yok-boyle-urun', itemName: 'Hayalet', qty: 1, unitPrice: 5 }] });
    info('CR-02b', 'geçersiz tarih / null değer / hayalet ürün kalemi', { tarih: dt.status, nullDeger: nul.status, hayaletKalem: ghost.status });
    assert(dt.status >= 400, "estimatedCloseDate '2026-99-99' kabul edildi");
    assert(nul.status >= 400, 'estimatedValue null → 0 olarak kabul edildi (coerce)');
    assert(ghost.status >= 400, 'olmayan ürün kodu fırsat kalemine yazılabildi (FK/doğrulama yok)');
  });
  await check('CR-03', 'aşama akışı: geçersiz aşama 400/422, kayıp sebebi zorunlu, kapanmış fırsat yeniden açılamaz/düzenlenemez', async () => {
    const o = await opp();
    statusIn(await api('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'bogus' }), [400, 422]);
    statusIn(await api('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'lost' }), [422]);
    await ok('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'lost', lostReason: 'fiyat' });
    statusIn(await api('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'new' }), [409]);
    statusIn(await api('PUT', `/crm/opportunities/${o.id}`, { notes: 'x' }), [409]);
    const o2 = await opp(); const w = await ok('POST', `/crm/opportunities/${o2.id}/stage`, { stage: 'won' });
    info('CR-03b', "'new' → 'won' doğrudan (teklif aşaması atlanarak)", { stage: w.stage });
  });
  await check('CR-04', 'dönüştürme: kazanılmamış 409, kalemsiz 422, müşterisiz 422, çift dönüştürme 409, tek sipariş', async () => {
    const it = await item('crm-urun');
    const o = await opp({ lines: [{ itemId: it.id, itemName: it.name, qty: 2, unitPrice: 10 }] });
    statusIn(await api('POST', `/crm/opportunities/${o.id}/convert`, {}), [409]);
    await ok('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'won' });
    statusIn(await api('POST', `/crm/opportunities/${o.id}/convert`, {}), [422]);
    const c = await cust('CrmMusteri');
    const before = db.prepare('SELECT COUNT(*) n FROM sales_orders').get().n;
    const [r1, r2] = await Promise.all([api('POST', `/crm/opportunities/${o.id}/convert`, { customerId: c.id }), api('POST', `/crm/opportunities/${o.id}/convert`, { customerId: c.id })]);
    const after = db.prepare('SELECT COUNT(*) n FROM sales_orders').get().n;
    info('CR-04b', 'eşzamanlı çift dönüştürme', { durumlar: [r1.status, r2.status], yeniSiparis: after - before });
    assert.equal(after - before, 1, `aynı fırsattan ${after - before} sipariş oluştu`);
    // pasif ürünlü kalem: fırsat oluştuktan sonra ürün pasife alınırsa dönüşüm 4xx olmalı, kalıntı bırakmamalı
    const it2 = await item('crm-pasif', 0); const o3 = await opp({ lines: [{ itemId: it2.id, itemName: it2.name, qty: 1, unitPrice: 1 }] });
    await ok('POST', `/crm/opportunities/${o3.id}/stage`, { stage: 'won' }); await ok('DELETE', '/items/' + it2.id);
    const b3 = snap(); const r = await api('POST', `/crm/opportunities/${o3.id}/convert`, { customerId: c.id });
    info('CR-04c', 'pasife alınmış ürünlü kalemi dönüştür', { status: r.status, conv: db.prepare('SELECT converted_so_id FROM opportunities WHERE id=?').get(o3.id) });
    assert(r.status < 500, 'pasif ürünlü dönüşüm ' + r.status);
    if (r.status >= 400) assert.deepEqual(snap(), b3, 'reddedilen dönüşümde kalıntı');
  });
  await check('CR-05', 'pasif/anonim müşteriye fırsat dönüştürme ve yeni fırsat/talep/ziyaret açılamamalı', async () => {
    const it = await item('crm-urun2'); const c = await cust('AnonAdayXyz'); await ok('POST', `/sales/customers/${c.id}/anonymize`, {});
    const o = await opp({ customerId: c.id, lines: [{ itemId: it.id, itemName: it.name, qty: 1, unitPrice: 1 }] });
    const t = await api('POST', '/support', { customerId: c.id, customerName: 'x', subject: 's' });
    const v = await api('POST', '/visits', { customerId: c.id, visitDate: '2026-09-01' });
    await ok('POST', `/crm/opportunities/${o.id}/stage`, { stage: 'won' });
    const cv = await api('POST', `/crm/opportunities/${o.id}/convert`, {});
    info('CR-05b', 'anonim müşteri üzerinde işlemler', { firsatOlustur: 201, talep: t.status, ziyaret: v.status, donusum: cv.status });
    assert(t.status >= 400 && v.status >= 400 && cv.status >= 400, `anonim müşteriye kayıt açılabildi: talep=${t.status} ziyaret=${v.status} dönüşüm=${cv.status}`);
  });
  await check('CR-06', 'kısmi güncelleme: alan temizlenebilir mi (COALESCE deseni) — notes/telefon boşaltma', async () => {
    const o = await opp({ notes: 'not', phone: '555' });
    const r = await api('PUT', `/crm/opportunities/${o.id}`, { notes: '', phone: '' });
    const g = await ok('GET', `/crm/opportunities/${o.id}`);
    info('CR-06b', "notes='' phone='' ile PUT sonrası", { status: r.status, notes: g.notes, phone: g.phone });
    assert(!g.notes && !g.phone, `alan temizlenemedi (notes='${g.notes}', phone='${g.phone}') — S/N: COALESCE deseni`);
  });
  await check('CR-07', 'yetki: viewer yazamaz; liste sayfalama sınırları; q joker', async () => {
    statusIn(await api('POST', '/crm/opportunities', { customerName: 'x' }, 'viewer'), [403]);
    statusIn(await api('POST', '/crm/opportunities/x/stage', { stage: 'won' }, 'viewer'), [403]);
    const big = await api('GET', '/crm/opportunities?pageSize=100000&page=-5'); info('CR-07b', 'pageSize=100000&page=-5', { status: big.status, pageSize: big.data?.pageSize, n: big.data?.data?.length });
    assert(big.status < 500);
    const w = await ok('GET', '/crm/opportunities?q=' + encodeURIComponent('%')); info('CR-07c', "q='%'", { n: w.data.length });
  });

  console.log('\n[SUP] destek talepleri');
  await check('SP-01', 'talep: olmayan müşteri/kullanıcı 404/422; geçersiz enum 400/422; hayalet ilişkili kayıt kimlikleri', async () => {
    for (const b of [{ customerId: 999999 }, { assignedTo: 999999 }, { category: 'x' }, { priority: 'x' }]) {
      const r = await api('POST', '/support', { customerName: 'x', subject: 's', ...b }); info('SP-01a', JSON.stringify(b), { status: r.status });
      assert(r.status >= 400 && r.status < 500, `${JSON.stringify(b)} → ${r.status}`);
    }
    const g = await api('POST', '/support', { customerName: 'x', subject: 's', relatedOrderId: 'yok', relatedShipmentId: 'yok', relatedLotId: 'yok' });
    info('SP-01b', 'olmayan sipariş/sevkiyat/parti kimliği ile talep', { status: g.status });
    assert(g.status >= 400, 'olmayan ilişkili kayıt kimlikleri kabul edildi');
  });
  await check('SP-02', 'durum akışı: resolved için çözüm zorunlu; closed sonrası kilit; resolved→open sonrası resolved_at temizlenmeli', async () => {
    const t = await ok('POST', '/support', { customerName: 'x', subject: 's' });
    statusIn(await api('POST', `/support/${t.id}/status`, { status: 'resolved' }), [422]);
    await ok('POST', `/support/${t.id}/status`, { status: 'resolved', resolution: 'tamam' });
    const re = await ok('POST', `/support/${t.id}/status`, { status: 'open' });
    info('SP-02b', 'çözülmüş talep yeniden açıldı', { resolvedAt: re.resolvedAt, resolution: re.resolution });
    await ok('POST', `/support/${t.id}/status`, { status: 'closed' });
    statusIn(await api('POST', `/support/${t.id}/status`, { status: 'open' }), [409]);
    statusIn(await api('PUT', `/support/${t.id}`, { subject: 'y' }), [409]);
    const cm = await api('POST', `/support/${t.id}/comments`, { comment: 'kapalıya yorum' }); info('SP-02c', 'kapalı talebe yorum', { status: cm.status });
    assert(re.resolvedAt == null, 'talep yeniden açıldı ama resolvedAt dolu kaldı (SLA/çözüm süresi raporunu bozar)');
  });
  await check('SP-03', 'NCR dönüştürme: yalnız şikayet; müşterisiz 422; çift dönüşüm 409 (eşzamanlı dahil); hayalet ürün/parti', async () => {
    const c = await cust('NcrMusteri');
    const q = await ok('POST', '/support', { customerId: c.id, customerName: 'x', subject: 'soru', category: 'question' });
    statusIn(await api('POST', `/support/${q.id}/to-ncr`, {}), [409]);
    const t = await ok('POST', '/support', { customerId: c.id, customerName: 'x', subject: 'şikayet', category: 'complaint' });
    const before = db.prepare('SELECT COUNT(*) n FROM ncrs').get().n;
    const [a, b] = await Promise.all([api('POST', `/support/${t.id}/to-ncr`, {}), api('POST', `/support/${t.id}/to-ncr`, {})]);
    const after = db.prepare('SELECT COUNT(*) n FROM ncrs').get().n;
    info('SP-03b', 'eşzamanlı çift NCR dönüşümü', { durumlar: [a.status, b.status], yeniNcr: after - before });
    assert.equal(after - before, 1, `aynı talepten ${after - before} NCR`);
    const t2 = await ok('POST', '/support', { customerId: c.id, customerName: 'x', subject: 'ş2', category: 'complaint' });
    const g = await api('POST', `/support/${t2.id}/to-ncr`, { itemId: 'hayalet', lotId: 'hayalet' });
    const ncr = db.prepare('SELECT item_id,lot_id FROM ncrs ORDER BY opened_at DESC LIMIT 1').get();
    info('SP-03c', 'hayalet ürün/parti ile NCR', { status: g.status, ncr });
  });
  await check('SP-04', 'yetki ve arama: viewer yazamaz; q ile LIKE jokerleri; yorum uzunluğu sınırı', async () => {
    statusIn(await api('POST', '/support', { customerName: 'x', subject: 's' }, 'viewer'), [403]);
    const t = await ok('POST', '/support', { customerName: 'x', subject: 's' });
    statusIn(await api('POST', `/support/${t.id}/comments`, { comment: 'x'.repeat(5001) }), [400, 422]);
    statusIn(await api('POST', `/support/${t.id}/comments`, { comment: '' }), [400, 422]);
  });

  console.log('\n[VIS] ziyaretler');
  await check('VZ-01', 'ziyaret tarihi: yalnız şekil regex — 2026-13-45, 2026-02-30 ve gelecek tarih kabul ediliyor mu', async () => {
    const c = await cust('ZiyaretMusteri'); const res = {};
    for (const d of ['2026-13-45', '2026-02-30', '2099-01-01', '0001-01-01']) res[d] = (await api('POST', '/visits', { customerId: c.id, visitDate: d })).status;
    info('VZ-01b', 'ziyaret tarihi kabul durumu', res);
    assert(res['2026-13-45'] >= 400 && res['2026-02-30'] >= 400, 'takvimde olmayan tarih kabul edildi: ' + JSON.stringify(res));
  });
  await check('VZ-02', 'başka müşterinin fırsatına bağlı ziyaret; takip tarihi ziyaretten önce; koordinat sınırları', async () => {
    const c1 = await cust('ZA'); const c2 = await cust('ZB'); const o = await opp({ customerId: c1.id });
    const r = await api('POST', '/visits', { customerId: c2.id, opportunityId: o.id, visitDate: '2026-09-01' });
    info('VZ-02a', "B müşterisinin ziyareti A müşterisinin fırsatına bağlandı", { status: r.status });
    const f = await api('POST', '/visits', { customerId: c1.id, visitDate: '2026-09-10', followUpDate: '2026-09-01' });
    info('VZ-02b', 'takip tarihi ziyaret tarihinden önce', { status: f.status });
    for (const b of [{ latitude: 91 }, { longitude: 181 }, { latitude: 'abc' }, { latitude: null }]) info('VZ-02c', JSON.stringify(b), { status: (await api('POST', '/visits', { customerId: c1.id, visitDate: '2026-09-01', ...b })).status });
    assert(r.status >= 400, 'ziyaret farklı müşterinin fırsatına bağlanabildi');
  });
  await check('VZ-03', 'ziyaret silme yalnız yönetici/müdür; audit kaydı; olmayan id 404', async () => {
    const c = await cust('ZS'); const v = await ok('POST', '/visits', { customerId: c.id, visitDate: '2026-09-01' });
    statusIn(await api('DELETE', `/visits/${v.id}`, undefined, 'operator'), [403]);
    statusIn(await api('DELETE', `/visits/${v.id}`), [204]); statusIn(await api('DELETE', `/visits/${v.id}`), [404]);
    assert(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_key='auditVisitDelete'").get().n >= 1);
  });

  const { invariants } = require('./inv'); const v = invariants(); info('INV', 'küresel değişmezler', v); assert.equal(v.length, 0, v.join('; '));
  await finish('b4b-crm');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
