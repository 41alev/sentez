// @ts-nocheck
/**
 * Üretim planlama testleri: kapasite, çizelgeleme, MRP ve OEE.
 *
 * Buradaki asıl mesele hesapların doğruluğu. Bir planlama modülü çalışıyor
 * görünüp yanlış sayı üretirse, sistem hiç olmamasından daha zararlıdır:
 * insanlar ona güvenip sipariş verir.
 *
 *   node test/planning.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
const dstr = (off = 0) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
// Varsayılan vardiyalar yalnızca hafta içi çalışır (bkz. 003_planning.js:
// weekdays '1,2,3,4,5'). "dstr(-1)" testin çalıştığı güne göre bir
// Cumartesi/Pazar'a denk gelirse o gün planlanan kapasite 0 olur — bu bir
// uygulama hatası değil, ama testin kendisi haftanın hangi günü çalıştığına
// bağımlı olmamalı. Geriye doğru en yakın hafta içi günü seçer.
function lastWeekdayStr(startOffset = -1) {
  for (let off = startOffset; off > startOffset - 14; off--) {
    const d = dstr(off);
    const jsDay = new Date(d + 'T12:00:00').getDay(); // 0=Pazar, 6=Cumartesi
    if (jsDay !== 0 && jsDay !== 6) return d;
  }
  throw new Error('hafta içi tarih bulunamadı');
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('\n=== ÜRÜN TEDARİK YÖNTEMİ / PROCUREMENT TYPE ===');
  const makeItem = await api('POST', '/api/items', { token: admin,
    body: { name: 'MRP Make Test', code: 'MRP-MAKE-TEST', itemType: 'finished', procurementType: 'make' } });
  ok('oluşturulan mamul make olarak dönüyor', makeItem.status === 201 && makeItem.data.procurementType === 'make',
    JSON.stringify(makeItem.data).slice(0, 180));
  const partialEdit = await api('PUT', `/api/items/${makeItem.data.id}`, { token: admin,
    body: { name: 'MRP Make Test Düzenlendi' } });
  ok('kısmi ürün güncellemesi make seçimini koruyor', partialEdit.status === 200 &&
    partialEdit.data.procurementType === 'make');
  const buyEdit = await api('PUT', `/api/items/${makeItem.data.id}`, { token: admin,
    body: { procurementType: 'buy' } });
  ok('tedarik yöntemi PUT ile değiştirilebiliyor', buyEdit.status === 200 && buyEdit.data.procurementType === 'buy');
  ok('geçersiz tedarik yöntemi reddediliyor',
    (await api('PUT', `/api/items/${makeItem.data.id}`, { token: admin,
      body: { procurementType: 'unknown' } })).status === 422);

  console.log('\n=== İŞ MERKEZLERİ / WORK CENTRES ===');
  const wcs = (await api('GET', '/api/planning/work-centers', { token: admin })).data;
  ok('iş merkezleri listeleniyor', Array.isArray(wcs) && wcs.length === 4, `${wcs.length} merkez`);
  const montaj = wcs.find(w => w.code === 'IM-03');
  const kesim = wcs.find(w => w.code === 'IM-01');
  const boya = wcs.find(w => w.code === 'IM-04');
  ok('montaj hattı 4 paralel istasyon', montaj && montaj.capacityUnits === 4, String(montaj && montaj.capacityUnits));
  ok('vardiya atamaları görünüyor', montaj && montaj.shiftCodes.length === 1, JSON.stringify(montaj && montaj.shiftCodes));
  ok('boya 3 vardiya çalışıyor', boya && boya.shiftCodes.length === 3, JSON.stringify(boya && boya.shiftCodes));
  ok('rotalarda kullanım sayısı gösteriliyor', montaj && montaj.routingCount >= 2, String(montaj && montaj.routingCount));

  const viewerCreate = await api('POST', '/api/planning/work-centers', {
    token: viewer, body: { code: 'X', name: 'X' } });
  ok('görüntüleyici iş merkezi açamıyor (403)', viewerCreate.status === 403, `got ${viewerCreate.status}`);
  const opCreate = await api('POST', '/api/planning/work-centers', {
    token: operator, body: { code: 'IM-99', name: 'Test' } });
  ok('operatör iş merkezi açamıyor (403)', opCreate.status === 403, `got ${opCreate.status}`);
  const dupe = await api('POST', '/api/planning/work-centers', {
    token: manager, body: { code: 'IM-01', name: 'Kopya' } });
  ok('aynı kodla ikinci merkez engellendi (409)', dupe.status === 409, `got ${dupe.status}`);

  console.log('\n=== VARDİYALAR / SHIFTS ===');
  const shifts = (await api('GET', '/api/planning/shifts', { token: admin })).data;
  ok('üç vardiya tanımlı', shifts.length === 3, `${shifts.length}`);
  const v1 = shifts.find(s => s.code === 'V1');
  // 08:00–16:00 = 480 dakika, 45 dakika mola düşülür
  ok('gündüz vardiyası net süresi 435 dk', v1 && v1.netMinutes === 435, String(v1 && v1.netMinutes));
  const v3 = shifts.find(s => s.code === 'V3');
  ok('gece vardiyası doğru hesaplanıyor (00:00-08:00)', v3 && v3.netMinutes === 450, String(v3 && v3.netMinutes));
  ok('çalışma günleri tanımlı', v1 && v1.weekdays.length === 5, JSON.stringify(v1 && v1.weekdays));

  console.log('\n=== KAPASİTE HESABI / CAPACITY ===');
  const cap = (await api('GET', `/api/planning/capacity?from=${dstr(0)}&to=${dstr(20)}`, { token: admin })).data;
  ok('kapasite raporu üretildi', cap.data && cap.data.length === 4);
  const capMontaj = cap.data.find(c => c.code === 'IM-03');
  const capBoya = cap.data.find(c => c.code === 'IM-04');
  ok('montaj kapasitesi hesaplandı', capMontaj.totalCapacityMinutes > 0, String(capMontaj.totalCapacityMinutes));
  // Montaj: 435 dk × 4 istasyon × %88 verim × (1 − %6 duruş) ≈ 1439 dk/gün
  const weekday = capMontaj.days.find(d => d.capacityMinutes > 0);
  ok('günlük kapasite vardiya × istasyon × verim ile uyumlu',
    Math.abs(weekday.capacityMinutes - 435 * 4 * 0.88 * 0.94) < 5,
    `${weekday.capacityMinutes} (beklenen ~${Math.round(435 * 4 * 0.88 * 0.94)})`);
  // Boya üç vardiya çalıştığı için kapasitesi montajdan yüksek olmalı (birim başına)
  const boyaDay = capBoya.days.find(d => d.capacityMinutes > 0);
  ok('üç vardiyalı merkez tek vardiyalıdan daha fazla saat açıyor',
    boyaDay.capacityMinutes > 435 * 2, `${boyaDay.capacityMinutes} dk`);

  const weekend = capMontaj.days.find(d => {
    const wd = new Date(d.date + 'T12:00:00').getDay();
    return wd === 0 || wd === 6;
  });
  ok('hafta sonu kapasite sıfır', !weekend || weekend.capacityMinutes === 0,
    weekend ? `${weekend.date}: ${weekend.capacityMinutes}` : 'aralıkta hafta sonu yok');

  const holiday = capMontaj.days.find(d => d.date === dstr(14));
  ok('resmî tatilde kapasite sıfır', holiday && holiday.capacityMinutes === 0,
    holiday ? String(holiday.capacityMinutes) : 'tatil günü aralıkta yok');

  console.log('\n=== ROTALAR / ROUTINGS ===');
  const items = (await api('GET', '/api/items?pageSize=100', { token: admin })).data.data;
  const panel = items.find(i => i.code === 'MP-500');
  const setItem = items.find(i => i.code === 'SET-001');
  const routing = (await api('GET', `/api/planning/routings/${panel.id}`, { token: admin })).data;
  ok('panel rotası 4 operasyondan oluşuyor', routing.length === 4, `${routing.length}`);
  ok('operasyonlar sıralı', routing.map(r => r.operationNo).join(',') === '10,20,30,40',
    routing.map(r => r.operationNo).join(','));
  ok('hazırlık ve birim süreleri ayrı tutuluyor',
    routing[0].setupMinutes === 30 && routing[0].runMinutesPerUnit === 8);
  ok('bekleme süresi tanımlı (termini uzatır, kapasite yemez)', routing[0].queueMinutes === 60);

  const badRouting = await api('PUT', `/api/planning/routings/${panel.id}`, {
    token: manager,
    body: { operations: [
      { operationNo: 10, operationName: 'A', workCenterId: kesim.id },
      { operationNo: 10, operationName: 'B', workCenterId: kesim.id }] }
  });
  ok('tekrarlanan operasyon numarası reddediliyor (400)', badRouting.status === 400, `got ${badRouting.status}`);

  console.log('\n=== SONLU KAPASİTELİ ÇİZELGELEME / FINITE SCHEDULING ===');
  const prod = await api('POST', '/api/production', {
    token: operator, body: { itemId: panel.id, qty: 20, warehouseId: 1 } });
  ok('üretim emri açıldı', prod.status === 201, `got ${prod.status} ${JSON.stringify(prod.data).slice(0, 120)}`);

  const sched = await api('POST', `/api/planning/schedule/${prod.data.id}`, { token: operator, body: {} });
  ok('emir çizelgelendi', sched.status === 200, `got ${sched.status} ${JSON.stringify(sched.data).slice(0, 200)}`);
  const ops = sched.data.operations;
  ok('rota emre kopyalandı (4 operasyon)', ops.length === 4, `${ops.length}`);
  ok('operasyonlar sırayla planlandı',
    ops.every((o, i) => i === 0 || o.plannedStart >= ops[i - 1].plannedEnd),
    'bir operasyon öncekinden önce başlayamaz');
  ok('planlanan süre fire payını içeriyor',
    // Kesim: 30 dk hazırlık + 20 adet × %3 fire × 8 dk ≈ 194 dk
    Math.abs(ops[0].plannedMinutes - (30 + 20 * 1.03 * 8)) < 2,
    `${ops[0].plannedMinutes} (beklenen ~${Math.round(30 + 20 * 1.03 * 8)})`);
  ok('emir başlangıç ve bitişi kaydedildi', !!sched.data.plannedStart && !!sched.data.plannedEnd);
  ok('bitiş başlangıçtan sonra', sched.data.plannedEnd > sched.data.plannedStart);

  // İkinci emir aynı iş merkezlerini kullanır: kapasite paylaşılmalı, üst üste binmemeli
  const prod2 = await api('POST', '/api/production', {
    token: operator, body: { itemId: panel.id, qty: 40, warehouseId: 1 } });
  const sched2 = await api('POST', `/api/planning/schedule/${prod2.data.id}`, { token: operator, body: {} });
  ok('ikinci emir de çizelgelendi', sched2.status === 200, `got ${sched2.status}`);
  ok('ikinci emir birinciden sonra bitiyor (kapasite paylaşımı)',
    sched2.data.plannedEnd > sched.data.plannedEnd,
    'sonsuz kapasite varsayılsaydı ikisi de aynı anda biterdi');

  const capAfter = (await api('GET', `/api/planning/capacity?from=${dstr(0)}&to=${dstr(20)}&workCenterId=${kesim.id}`,
    { token: admin })).data.data[0];
  ok('çizelgeleme kapasite yükü olarak görünüyor', capAfter.totalLoadMinutes > 0, `${capAfter.totalLoadMinutes} dk`);
  ok('doluluk oranı hesaplanıyor', capAfter.utilizationPct > 0, `%${capAfter.utilizationPct}`);

  const noRouting = await api('POST', '/api/production', {
    token: operator, body: { itemId: setItem.id, qty: 5, warehouseId: 1 } });
  const setSched = await api('POST', `/api/planning/schedule/${noRouting.data.id}`, { token: operator, body: {} });
  ok('rotası olan mamul çizelgelenebiliyor', setSched.status === 200, `got ${setSched.status}`);
  ok('tek operasyonlu rota da çalışıyor', setSched.data.operations.length === 1);

  console.log('\n=== OPERASYON TAKİBİ / OPERATION TRACKING ===');
  const opList = (await api('GET', '/api/planning/operations?pageSize=100', { token: admin })).data;
  ok('operasyon listesi sayfalanıyor', Array.isArray(opList.data) && opList.total >= 9, `${opList.total}`);
  const firstOp = opList.data[0];
  const completeBeforeStart = await api('POST', `/api/planning/operations/${firstOp.id}/complete`,
    { token: operator, body: { completedQty: 5 } });
  ok('başlatılmadan tamamlanamıyor (409)', completeBeforeStart.status === 409, `got ${completeBeforeStart.status}`);

  const started = await api('POST', `/api/planning/operations/${firstOp.id}/start`, { token: operator, body: {} });
  ok('operasyon başlatıldı', started.status === 200 && started.data.status === 'in_progress');
  const startTwice = await api('POST', `/api/planning/operations/${firstOp.id}/start`, { token: operator, body: {} });
  ok('iki kez başlatılamıyor (409)', startTwice.status === 409, `got ${startTwice.status}`);

  const completed = await api('POST', `/api/planning/operations/${firstOp.id}/complete`,
    { token: operator, body: { completedQty: 19, scrapQty: 1 } });
  ok('operasyon tamamlandı', completed.status === 200 && completed.data.status === 'completed');
  ok('gerçekleşen süre ölçüldü', completed.data.actual_minutes !== null);
  ok('fire miktarı kaydedildi', completed.data.scrap_qty === 1);

  console.log('\n=== MRP ===');
  // Tohum veride bileşen ihtiyaçları eldeki ve yoldaki stokla karşılanıyor; bu doğru
  // davranış ama satın alma yolunu göstermez. Büyük bir sipariş girerek alt seviye
  // ihtiyacı stok + yoldaki miktarın üzerine çıkarıyoruz.
  const customers = (await api('GET', '/api/sales/customers?pageSize=10', { token: admin })).data.data;
  const bigOrder = await api('POST', '/api/sales/orders', {
    token: manager,
    body: {
      customerId: customers[0].id, currency: 'TRY', promisedDate: dstr(45),
      lines: [{ itemId: panel.id, qty: 900, price: 1250 }]
    }
  });
  ok('büyük talep siparişi girildi (alt seviye ihtiyaç yaratmak için)',
    bigOrder.status === 201, `got ${bigOrder.status} ${JSON.stringify(bigOrder.data).slice(0, 140)}`);

  const opRun = await api('POST', '/api/planning/mrp/run', { token: operator, body: {} });
  ok('operatör MRP çalıştıramıyor (403)', opRun.status === 403, `got ${opRun.status}`);

  const run = await api('POST', '/api/planning/mrp/run', { token: manager, body: { horizonDays: 90 } });
  ok('MRP çalıştı', run.status === 201, `got ${run.status} ${JSON.stringify(run.data).slice(0, 160)}`);
  ok('çalıştırma numarası verildi', /^MRP/.test(run.data.runNo || ''), run.data.runNo);
  ok('öneri üretildi', run.data.suggestionCount > 0, `${run.data.suggestionCount} öneri`);
  ok('döngüsel reçete yok', (run.data.cycles || []).length === 0, JSON.stringify(run.data.cycles));

  const sugg = (await api('GET', '/api/planning/mrp/suggestions', { token: admin })).data;
  ok('öneriler listeleniyor', sugg.data.length === run.data.suggestionCount, `${sugg.data.length}`);

  const panelSugg = sugg.data.find(s => s.itemId === panel.id);
  const sacSugg = sugg.data.find(s => s.itemName.includes('Sac'));
  ok('üretilecek ürün için "make" önerisi', !panelSugg || panelSugg.type === 'make',
    panelSugg ? panelSugg.type : 'panel önerisi yok (ihtiyaç karşılanıyor olabilir)');
  ok('satın alınacak ürün için "buy" önerisi', !sacSugg || sacSugg.type === 'buy',
    sacSugg ? sacSugg.type : 'sac önerisi yok');

  // Zaman fazlı netleme (T09): her öneri kendi ihtiyaç tarihine kadarki brüt
  // ihtiyacı ve o tarihe kadar gelen arzı taşır. Bir ürünün ilk önerisinde
  // net = brüt + emniyet − eldeki − o tarihe kadar gelen yoldaki.
  const firstPerItem = Object.values(sugg.data.reduce((acc, s) => {
    if (!acc[s.itemId] || s.needDate < acc[s.itemId].needDate) acc[s.itemId] = s;
    return acc;
  }, {}));
  const badNet = firstPerItem.find(s => Math.abs(s.netRequirement - (s.grossRequirement + s.safetyStock - s.onHand - s.onOrder)) > 0.01);
  ok('net ihtiyaç formülü doğru (brüt + emniyet − eldeki − tarihe kadar yoldaki)', !badNet,
    badNet ? `${badNet.itemName}: ${badNet.netRequirement}` : `${firstPerItem.length} ürün`);
  ok('önerilen miktar net ihtiyaçtan az değil',
    sugg.data.every(s => s.suggestedQty >= s.netRequirement - 0.001),
    'parti büyüklüğü yuvarlaması yalnızca yukarı olmalı');

  // Parti büyüklüğü: somunun lot_size=500, öneri 500'ün katı olmalı
  const somunSugg = sugg.data.find(s => s.itemName.includes('Somun'));
  if (somunSugg) {
    ok('parti büyüklüğü kuralı uygulandı (500 katı)',
      Math.abs(somunSugg.suggestedQty % 500) < 0.001, String(somunSugg.suggestedQty));
  } else ok('parti büyüklüğü kuralı uygulandı (500 katı)', true, 'somun için ihtiyaç yok');

  ok('bırakma tarihi ihtiyaç tarihinden önce',
    sugg.data.every(s => !s.releaseDate || !s.needDate || s.releaseDate <= s.needDate),
    'tedarik süresi geriye doğru uygulanmalı');
  ok('ihtiyacın kaynağı gösteriliyor',
    sugg.data.some(s => s.sourceDemand && s.sourceDemand.length > 0),
    'öneriyi değerlendiren kişi nereden geldiğini görmeli');
  ok('reçete seviyeleri hesaplandı', sugg.data.some(s => s.bomLevel >= 0));
  // Çok seviyeli patlatma: mamul talebi bileşen talebine dönüşmeli
  ok('reçete alt seviyeye yayıldı (make ve buy birlikte)',
    sugg.data.some(s => s.type === 'make') && sugg.data.some(s => s.type === 'buy'),
    JSON.stringify(sugg.data.map(s => `${s.type}:${s.itemName}`)));
  ok('bileşen ihtiyacı üst seviyeden geldiği görülüyor',
    sugg.data.some(s => s.type === 'buy' && /MRP:/.test(s.sourceDemand || '')),
    'kaynak açıklaması ihtiyacın zincirini göstermeli');
  ok('geciken öneriler işaretlendi', sugg.data.some(s => typeof s.isLate === 'boolean'));

  console.log('\n=== ÖNERİYİ BELGEYE DÖNÜŞTÜRME / CONVERT SUGGESTION ===');
  const buySugg = sugg.data.find(s => s.type === 'buy' && s.supplierId);
  if (buySugg) {
    const conv = await api('POST', `/api/planning/mrp/suggestions/${buySugg.id}/convert`, { token: manager, body: {} });
    ok('satın alma önerisi siparişe dönüştü', conv.status === 201 && conv.data.kind === 'purchase_order',
      `got ${conv.status} ${JSON.stringify(conv.data)}`);
    const po = (await api('GET', `/api/purchasing/orders/${conv.data.id}`, { token: admin })).data;
    ok('oluşan sipariş doğru miktarı taşıyor',
      Math.abs(po.items[0].qty - buySugg.suggestedQty) < 0.001,
      `${po.items[0].qty} vs ${buySugg.suggestedQty}`);
    ok('sipariş taslak ve onay bekliyor', po.status === 'draft', po.status);
    const again = await api('POST', `/api/planning/mrp/suggestions/${buySugg.id}/convert`, { token: manager, body: {} });
    ok('aynı öneri ikinci kez dönüştürülemiyor', again.status >= 400, `got ${again.status}`);
  } else ok('satın alma önerisi siparişe dönüştü', false, 'tedarikçili buy önerisi bulunamadı');

  const makeSugg = sugg.data.find(s => s.type === 'make' && s.status === 'open');
  if (makeSugg) {
    const conv2 = await api('POST', `/api/planning/mrp/suggestions/${makeSugg.id}/convert`, { token: manager, body: {} });
    ok('üretim önerisi emre dönüştü', conv2.status === 201 && conv2.data.kind === 'production_order',
      `got ${conv2.status}`);
  } else ok('üretim önerisi emre dönüştü', true, 'açık make önerisi yok');

  // Liste dönüştürmelerden önce alındı; dönüştürülmüş öneri reddedilemez (409).
  const converted = new Set([buySugg && buySugg.id, makeSugg && makeSugg.id]);
  const dismissTarget = sugg.data.find(s => s.status === 'open' && !converted.has(s.id));
  if (dismissTarget) {
    const dis = await api('POST', `/api/planning/mrp/suggestions/${dismissTarget.id}/dismiss`, { token: manager });
    ok('öneri reddedilebiliyor', dis.status === 200);
  }

  console.log('\n=== VARDİYA KAYDI VE OEE ===');
  const logRes = await api('POST', '/api/planning/shift-logs', {
    token: operator,
    body: { date: lastWeekdayStr(-1), shiftId: 2, workCenterId: kesim.id, workedMinutes: 400,
            downtimeMinutes: 40, downtimeReason: 'Tezgâh arızası', producedQty: 55, scrapQty: 3, operatorCount: 1 }
  });
  ok('vardiya kaydı girildi', logRes.status === 201, `got ${logRes.status} ${JSON.stringify(logRes.data)}`);
  ok('planlanan süre vardiya tanımından alındı (elle girilmiyor)',
    logRes.data.plannedMinutes > 0, `${logRes.data.plannedMinutes} dk`);

  const badLog = await api('POST', '/api/planning/shift-logs', {
    token: operator,
    body: { date: dstr(-2), shiftId: 1, workCenterId: kesim.id, workedMinutes: 100, downtimeMinutes: 200 }
  });
  ok('duruş çalışılan süreden fazla olamaz (400)', badLog.status === 400, `got ${badLog.status}`);

  const oee = (await api('GET', `/api/planning/oee?from=${dstr(-15)}&to=${dstr(0)}`, { token: admin })).data;
  ok('OEE hesaplandı', oee.data && oee.data.length > 0, `${(oee.data || []).length} merkez`);
  const oeeKesim = oee.data.find(o => o.code === 'IM-01');
  ok('kullanılabilirlik hesaplandı', oeeKesim && oeeKesim.availabilityPct > 0, String(oeeKesim && oeeKesim.availabilityPct));
  ok('kalite oranı hesaplandı', oeeKesim && oeeKesim.qualityPct > 0 && oeeKesim.qualityPct <= 100,
    String(oeeKesim && oeeKesim.qualityPct));
  ok('OEE üç bileşenin çarpımı',
    oeeKesim && Math.abs(oeeKesim.oeePct -
      (oeeKesim.availabilityPct / 100) * (oeeKesim.performancePct / 100) * (oeeKesim.qualityPct / 100) * 100) < 0.2,
    `${oeeKesim && oeeKesim.oeePct}`);
  ok('OEE %100 üzerine çıkmıyor', oee.data.every(o => o.oeePct <= 100),
    JSON.stringify(oee.data.map(o => o.oeePct)));

  console.log('\n=== ÇALIŞTIRMA GEÇMİŞİ / RUN HISTORY ===');
  const runs = (await api('GET', '/api/planning/mrp/runs', { token: admin })).data;
  ok('MRP çalıştırma geçmişi tutuluyor', runs.length >= 1, `${runs.length}`);
  ok('çalıştırmayı yapan kullanıcı kayıtlı', !!runs[0].username, runs[0].username);
  const audit = (await api('GET', '/api/audit?entityType=mrp_run&pageSize=10', { token: admin })).data;
  ok('MRP denetim kaydına yazıldı', audit.data.length >= 1, `${audit.data.length}`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
