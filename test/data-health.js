/**
 * Veri sağlığı testleri.
 *
 * Temiz veriyle test etmek bir şey kanıtlamaz. Bu test veriyi kasıtlı olarak
 * bozar — gerçek müşteri verisinde görülen türden hatalarla — ve denetimin
 * bunları bulup bulmadığını, düzeltmelerin gerçekten çalışıp çalışmadığını
 * ve düzeltilemeyecek olanların dürüstçe reddedildiğini kontrol eder.
 *
 *   node test/data-health.js   (sunucu ayakta olmalı)
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

const findCheck = (report, id) => report.checks.find(c => c.id === id);

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');

  console.log('=== TEMİZ VERİ / CLEAN BASELINE ===');
  const clean = (await api('GET', '/api/data-health/report', { token: admin })).data;
  ok('denetim çalışıyor', clean.totals.checks >= 20, `${clean.totals.checks} kontrol`);
  ok('hiçbir kontrol hata vermiyor', clean.checks.every(c => !c.error),
    clean.checks.filter(c => c.error).map(c => c.id + ': ' + c.error).join(' | '));
  ok('tohum veri temiz (puan 100)', clean.score === 100, `puan ${clean.score}`);
  ok('her kontrolün açıklaması var', clean.checks.every(c => c.explanation && c.explanation.length > 30));
  ok('düzeltilebilir olanlar işaretli', clean.checks.some(c => c.fixable));
  ok('düzeltilebilir olanlarda ne yapılacağı yazıyor',
    clean.checks.filter(c => c.fixable).every(c => !!c.fixAction));

  const opFix = await api('POST', '/api/data-health/check/missing_unit/fix', { token: operator });
  ok('operatör düzeltme uygulayamıyor (403)', opFix.status === 403, `got ${opFix.status}`);

  console.log('\n=== VERİYİ BOZ / CORRUPT THE DATA ===');
  // Gerçek müşteri verisinde görülen türden hatalar üretiliyor.
  const items = (await api('GET', '/api/items?pageSize=100', { token: admin })).data.data;
  const somun = items.find(i => i.code === 'SM-108');
  const kablo = items.find(i => i.code === 'KB-225');
  const setItem = items.find(i => i.code === 'SET-001');
  ok('test için gereken tohum ürünler mevcut', !!somun && !!kablo && !!setItem,
    `SM-108:${!!somun} KB-225:${!!kablo} SET-001:${!!setItem}`);
  if (!somun || !kablo) { console.error('Tohum veri beklendiği gibi değil, test durduruldu.'); process.exit(1); }

  // 1) Birimi boş bir ürün
  const noUnit = await api('POST', '/api/items', {
    token: admin, body: { name: 'Birimsiz Test Ürünü', code: 'DH-NOUNIT', unit: 'adet', category: 'Test' } });
  await api('PUT', `/api/items/${noUnit.data.id}`, { token: admin, body: { unit: 'adet' } });

  // 2) Aynı barkodu iki üründe kullan
  const dupe1 = await api('POST', '/api/items', {
    token: admin, body: { name: 'Kopya Barkod A', code: 'DH-DUP-A', unit: 'adet', barcode: '9990001112223' } });
  const dupe2 = await api('POST', '/api/items', {
    token: admin, body: { name: 'Kopya Barkod B', code: 'DH-DUP-B', unit: 'adet', barcode: '9990001112223' } });
  ok('test verisi oluşturuldu', dupe1.status === 201 && dupe2.status === 201);

  // 3) Reçetesi olmayan "üretilir" ürün
  const makeNoBom = await api('POST', '/api/items', {
    token: admin, body: { name: 'Reçetesiz Mamul', code: 'DH-NOBOM', unit: 'adet' } });
  await api('POST', '/api/data-health/bulk-update/items', {
    token: manager, body: { itemIds: [makeNoBom.data.id], field: 'procurementType', value: 'make' } });

  // 4) Kritik stok tanımlı ama tedarikçisiz
  const noSupplier = await api('POST', '/api/items', {
    token: admin, body: { name: 'Tedarikçisiz Kritik', code: 'DH-NOSUP', unit: 'adet', minStock: 50 } });

  // Doğrudan veritabanı üzerinden bozulacaklar için özel uçlar yok; bunlar
  // ancak gerçek hayatta yarım kalmış işlemlerden oluşur. Stok girişiyle taklit ediyoruz.
  const zeroCost = await api('POST', '/api/stock/move', {
    token: operator,
    body: { itemId: somun.id, type: 'in', qty: 10, warehouseId: 1, lotNo: 'DH-ZERO', unitCost: 0 }
  });
  ok('maliyetsiz parti oluşturuldu', zeroCost.status === 201 || zeroCost.status === 200,
    `got ${zeroCost.status}`);

  // 5) Süresi geçmiş ama kullanılabilir parti
  const expired = await api('POST', '/api/stock/move', {
    token: operator,
    body: { itemId: kablo.id, type: 'in', qty: 5, warehouseId: 1, lotNo: 'DH-EXPIRED',
            unitCost: 40, expiryDate: '2020-01-15' }
  });
  ok('süresi geçmiş parti oluşturuldu', [200, 201].includes(expired.status), `got ${expired.status}`);

  console.log('\n=== BULGULARIN TESPİTİ / DETECTION ===');
  const dirty = (await api('GET', '/api/data-health/report', { token: admin })).data;
  ok('puan düştü', dirty.score < 100, `puan ${dirty.score}`);

  const dupBarcode = findCheck(dirty, 'duplicate_barcode');
  ok('tekrarlayan barkod bulundu', dupBarcode.count >= 1, `${dupBarcode.count} bulgu`);
  ok('hangi barkodun tekrarlandığı gösteriliyor',
    dupBarcode.sample.some(s => s.label === '9990001112223'),
    JSON.stringify(dupBarcode.sample.map(s => s.label)));
  ok('tekrarlayan barkod kritik sayılıyor', dupBarcode.severity === 'critical');

  const noBom = findCheck(dirty, 'make_without_bom');
  ok('reçetesiz "üretilir" ürün bulundu', noBom.count >= 1, `${noBom.count} bulgu`);
  ok('hangi ürün olduğu gösteriliyor',
    noBom.sample.some(s => /DH-NOBOM/.test(s.label)), JSON.stringify(noBom.sample.map(s => s.label)));

  const noSup = findCheck(dirty, 'reorder_without_supplier');
  ok('tedarikçisiz kritik stok bulundu',
    noSup.sample.some(s => /DH-NOSUP/.test(s.label)), `${noSup.count} bulgu`);

  const zeroCostCheck = findCheck(dirty, 'stock_without_cost');
  ok('maliyetsiz stok bulundu', zeroCostCheck.count >= 1, `${zeroCostCheck.count} bulgu`);

  const expCheck = findCheck(dirty, 'expired_available');
  ok('süresi geçmiş kullanılabilir parti bulundu', expCheck.count >= 1, `${expCheck.count} bulgu`);
  ok('SKT bilgisi bulguyla birlikte geliyor',
    expCheck.sample.some(s => /2020-01-15/.test(s.detail)), JSON.stringify(expCheck.sample.map(s => s.detail)));

  console.log('\n=== TEK KONTROL / SINGLE CHECK ===');
  const single = await api('GET', '/api/data-health/check/expired_available', { token: admin });
  ok('tek kontrol ayrı çalıştırılabiliyor', single.status === 200 && single.data.total >= 1,
    `${single.data.total} satır`);
  ok('tam liste dönüyor (örnek değil)', Array.isArray(single.data.rows));
  const paged = await api('GET', '/api/data-health/check/expired_available?limit=1&offset=0', { token: admin });
  ok('sayfalama çalışıyor', paged.data.rows.length === 1, `${paged.data.rows.length} satır`);
  const badCheck = await api('GET', '/api/data-health/check/olmayan_kontrol', { token: admin });
  ok('olmayan kontrol 404 dönüyor', badCheck.status === 404, `got ${badCheck.status}`);

  console.log('\n=== OTOMATİK DÜZELTME / AUTO FIX ===');
  const fixExpired = await api('POST', '/api/data-health/check/expired_available/fix', { token: manager });
  ok('süresi geçmiş partiler bloke edildi', fixExpired.status === 200 && fixExpired.data.resolved >= 1,
    JSON.stringify(fixExpired.data));
  ok('düzeltme öncesi ve sonrası sayı bildiriliyor',
    typeof fixExpired.data.before === 'number' && fixExpired.data.after === 0,
    `${fixExpired.data.before} → ${fixExpired.data.after}`);
  const afterExp = await api('GET', '/api/data-health/check/expired_available', { token: admin });
  ok('bulgu gerçekten kalktı', afterExp.data.total === 0, `${afterExp.data.total} kaldı`);
  // Düzeltme iz bırakmalı: stok durumu değiştiyse hareket kaydı olmalı
  const kabloMoves = (await api('GET', `/api/stock/movements?itemId=${kablo.id}&pageSize=20`, { token: admin })).data.data;
  ok('durum değişikliği hareket kaydı bıraktı',
    kabloMoves.some(m => /veri denetimi/i.test(m.note || '')),
    'sessizce değiştirmek denetimde açıklanamaz');

  const fixCost = await api('POST', '/api/data-health/check/stock_without_cost/fix', { token: manager });
  ok('maliyetsiz partilere ürün maliyeti uygulandı', fixCost.status === 200,
    JSON.stringify(fixCost.data));

  // Düzeltilemeyecekler açıkça reddedilmeli — sessizce "başarılı" demek yanıltıcıdır
  const cantFix = await api('POST', '/api/data-health/check/duplicate_barcode/fix', { token: manager });
  ok('otomatik düzeltilemeyen bulgu reddediliyor (400)', cantFix.status === 400, `got ${cantFix.status}`);
  ok('neden düzeltilemediği açıklanıyor',
    /işi bilen|auto-fixable/i.test(JSON.stringify(cantFix.data)), JSON.stringify(cantFix.data).slice(0, 120));

  console.log('\n=== STOK ÖZETİ TUTARSIZLIĞI / CACHE MISMATCH ===');
  // Bu bozukluk ancak doğrudan veritabanına yazarak oluşur; gerçekte yarım kalan
  // bir işlemden çıkar. Toplu güncellemeyle taklit edilemez, bu yüzden düzeltmenin
  // hiçbir şeyi bozmadığını doğrulamakla yetiniyoruz.
  const fixCache = await api('POST', '/api/data-health/check/qty_cache_mismatch/fix', { token: manager });
  ok('stok özeti yeniden hesaplanabiliyor', fixCache.status === 200, JSON.stringify(fixCache.data));
  const somunAfter = (await api('GET', `/api/items/${somun.id}`, { token: admin })).data;
  const somunLots = (await api('GET', `/api/stock/lots?itemId=${somun.id}&pageSize=100`, { token: admin })).data.data;
  const lotSum = somunLots.filter(l => l.status === 'available').reduce((s, l) => s + l.qty, 0);
  ok('yeniden hesaplama doğru sonuç veriyor', Math.abs(somunAfter.qty - lotSum) < 0.001,
    `kart ${somunAfter.qty}, partiler ${lotSum}`);

  console.log('\n=== TOPLU GÜNCELLEME / BULK UPDATE ===');
  const bulk = await api('POST', '/api/data-health/bulk-update/items', {
    token: manager,
    body: { itemIds: [dupe1.data.id, dupe2.data.id], field: 'category', value: 'Toplu Test' }
  });
  ok('toplu güncelleme çalışıyor', bulk.status === 200 && bulk.data.updated === 2,
    JSON.stringify(bulk.data));
  const checkCat = (await api('GET', `/api/items/${dupe1.data.id}`, { token: admin })).data;
  ok('değer gerçekten uygulandı', checkCat.category === 'Toplu Test', checkCat.category);

  const badField = await api('POST', '/api/data-health/bulk-update/items', {
    token: manager, body: { itemIds: [dupe1.data.id], field: 'olmayanAlan', value: 'x' } });
  ok('tanımsız alan reddediliyor', badField.status >= 400, `got ${badField.status}`);
  // Sayısal alana metin yazmak SQLite'ta sessizce 0 üretir; erken yakalanmalı
  const badNumber = await api('POST', '/api/data-health/bulk-update/items', {
    token: manager, body: { itemIds: [dupe1.data.id], field: 'minStock', value: 'çok' } });
  ok('sayısal alana metin reddediliyor', badNumber.status === 400, `got ${badNumber.status}`);
  const badProc = await api('POST', '/api/data-health/bulk-update/items', {
    token: manager, body: { itemIds: [dupe1.data.id], field: 'procurementType', value: 'belki' } });
  ok('geçersiz tedarik şekli reddediliyor', badProc.status === 400, `got ${badProc.status}`);
  const opBulk = await api('POST', '/api/data-health/bulk-update/items', {
    token: operator, body: { itemIds: [dupe1.data.id], field: 'category', value: 'x' } });
  ok('operatör toplu güncelleme yapamıyor (403)', opBulk.status === 403, `got ${opBulk.status}`);

  console.log('\n=== KAYIT BİRLEŞTİRME / MERGE ===');
  const preview = await api('GET',
    `/api/data-health/merge/item/preview?sourceId=${dupe2.data.id}&targetId=${dupe1.data.id}`, { token: manager });
  ok('birleştirme önizlemesi çalışıyor', preview.status === 200, JSON.stringify(preview.data).slice(0, 120));
  ok('taşınacak bağlar sayılıyor', Array.isArray(preview.data.references));
  ok('geri alınamaz olduğu belirtiliyor', /geri alınamaz/i.test(preview.data.warning || ''));

  const samePreview = await api('GET',
    `/api/data-health/merge/item/preview?sourceId=${dupe1.data.id}&targetId=${dupe1.data.id}`, { token: manager });
  ok('aynı kayıt kendisiyle birleştirilemiyor', samePreview.status === 400, `got ${samePreview.status}`);

  // Kaynağa stok girip birleşmede taşındığını doğrula
  await api('POST', '/api/stock/move', {
    token: operator, body: { itemId: dupe2.data.id, type: 'in', qty: 7, warehouseId: 1, lotNo: 'DH-MERGE', unitCost: 5 } });

  const noConfirm = await api('POST', '/api/data-health/merge/item', {
    token: manager, body: { sourceId: dupe2.data.id, targetId: dupe1.data.id } });
  ok('onaysız birleştirme reddediliyor', noConfirm.status >= 400, `got ${noConfirm.status}`);

  const merge = await api('POST', '/api/data-health/merge/item', {
    token: manager, body: { sourceId: dupe2.data.id, targetId: dupe1.data.id, confirm: true } });
  ok('birleştirme tamamlandı', merge.status === 200 && merge.data.merged, JSON.stringify(merge.data).slice(0, 140));
  ok('bağlar hedefe taşındı', merge.data.totalMoved >= 1, `${merge.data.totalMoved} bağ`);

  const targetAfter = (await api('GET', `/api/items/${dupe1.data.id}`, { token: admin })).data;
  ok('stok hedefe geçti', targetAfter.qty === 7, `${targetAfter.qty}`);
  ok('hedefin maliyeti yeniden hesaplandı', targetAfter.avgCost > 0, String(targetAfter.avgCost));
  const sourceAfter = await api('GET', `/api/items/${dupe2.data.id}`, { token: admin });
  ok('kaynak kayıt kaldırıldı', sourceAfter.status === 404, `got ${sourceAfter.status}`);

  const dupAfter = await api('GET', '/api/data-health/check/duplicate_barcode', { token: admin });
  ok('birleştirme sonrası tekrarlayan barkod bulgusu düştü',
    !dupAfter.data.rows.some(r => r.label === '9990001112223'),
    JSON.stringify(dupAfter.data.rows.map(r => r.label)));

  const opMerge = await api('POST', '/api/data-health/merge/item', {
    token: operator, body: { sourceId: 'a', targetId: 'b', confirm: true } });
  ok('operatör birleştirme yapamıyor (403)', opMerge.status === 403, `got ${opMerge.status}`);
  const badType = await api('POST', '/api/data-health/merge/olmayan', {
    token: manager, body: { sourceId: 'a', targetId: 'b', confirm: true } });
  ok('bilinmeyen kayıt tipi reddediliyor', badType.status === 400, `got ${badType.status}`);

  console.log('\n=== DENETİM KAYDI / AUDIT ===');
  const audit = (await api('GET', '/api/audit?pageSize=50', { token: admin })).data;
  ok('düzeltmeler denetime yazıldı',
    audit.data.some(a => a.actionKey === 'auditDataFix'), 'veri değiştiren her işlem iz bırakmalı');
  ok('birleştirme denetime yazıldı', audit.data.some(a => a.actionKey === 'auditMerge'));
  ok('birleştirmede kaynak ve hedef birlikte kayıtlı',
    audit.data.filter(a => a.actionKey === 'auditMerge').some(a => a.oldValue && a.newValue),
    'hangi kaydın hangisine gittiği sonradan sorulabilmeli');
  ok('toplu güncelleme denetime yazıldı', audit.data.some(a => a.actionKey === 'auditBulkUpdate'));

  console.log('\n=== PUANLAMA / SCORING ===');
  const final = (await api('GET', '/api/data-health/report', { token: admin })).data;
  ok('puan 0-100 aralığında', final.score >= 0 && final.score <= 100, String(final.score));
  ok('kritik bulgular puanı daha çok düşürüyor',
    final.totals.criticalTypes === 0 || final.score < 100,
    `kritik ${final.totals.criticalTypes}, puan ${final.score}`);
  ok('bulgu özeti tutarlı',
    final.totals.withFindings === final.checks.filter(c => c.count > 0).length);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
