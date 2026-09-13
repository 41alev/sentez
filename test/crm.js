// @ts-nocheck
/**
 * CRM / satış hunisi testleri (Aşama 7).
 *
 * En değerli kontroller: (1) aşama geçiş kuralları gerçekten uygulanıyor mu
 * (kaybedilme sebebi zorunlu, kapanmış fırsat yeniden açılamıyor), (2)
 * "kazanılmış fırsatı dönüştür" GERÇEKTEN bir satış siparişi oluşturuyor mu
 * (server/services/sales-orders.js — sales.js ile aynı kod yolu) ve bu
 * sipariş doğru müşteri/kalemleri taşıyor mu, (3) aynı fırsat ikinci kez
 * dönüştürülemiyor mu (idempotency).
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/crm.js
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

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const viewer = await login('viewer', 'Viewer123!');

  const items = await api('GET', '/api/items?pageSize=1', { token: admin });
  const itemId = items.data.data[0].id;
  const customers = await api('GET', '/api/sales/customers?pageSize=1', { token: admin });
  const custId = customers.data.data[0].id;
  const custName = customers.data.data[0].name;

  console.log('\n=== YETKİ / PERMISSIONS ===');
  ok('görüntüleyici fırsat oluşturamıyor (403)',
    (await api('POST', '/api/crm/opportunities', { token: viewer, body: { customerName: 'X', lines: [] } })).status === 403);

  console.log('\n=== OLUŞTURMA / CREATE ===');
  const created = await api('POST', '/api/crm/opportunities', {
    token: admin,
    body: {
      customerId: custId, customerName: custName, source: 'web', estimatedValue: 5000, probability: 30,
      lines: [{ itemId, itemName: 'test', qty: 3, unitPrice: 100 }]
    }
  });
  ok('fırsat oluşturuldu (201)', created.status === 201, JSON.stringify(created.data));
  ok('fırsat numarası üretildi (FRS- ile başlıyor)', /^FRS-/.test(created.data.oppNo || ''));
  ok('yeni fırsat "new" aşamasında başlıyor', created.data.stage === 'new');
  ok('kalemler kaydedildi', created.data.lines.length === 1 && created.data.lines[0].qty === 3);
  const oppId = created.data.id;

  console.log('\n=== YENİ ADAY (MÜŞTERİ OLMADAN) / NEW LEAD (NO CUSTOMER) ===');
  const lead = await api('POST', '/api/crm/opportunities', {
    token: admin, body: { customerName: 'Henüz Müşteri Olmayan A.Ş.', source: 'fuar', lines: [] }
  });
  ok('müşteri kimliği olmadan da fırsat oluşturulabiliyor (yeni aday)', lead.status === 201);
  ok('customerId boş kalıyor', lead.data.customerId === null || lead.data.customerId === undefined);
  const leadId = lead.data.id;

  console.log('\n=== LİSTE VE HUNİ / LIST AND PIPELINE ===');
  const list = await api('GET', '/api/crm/opportunities', { token: admin });
  ok('liste zarfı doğru', Array.isArray(list.data.data) && list.data.total >= 2);
  const filtered = await api('GET', '/api/crm/opportunities?stage=new', { token: admin });
  ok('aşama filtresi çalışıyor', filtered.data.data.every(o => o.stage === 'new'));

  const pipeline = await api('GET', '/api/crm/opportunities/pipeline', { token: admin });
  ok('huni 4 aktif aşama döndürüyor (lost hariç)', pipeline.data.stages.length === 4);
  const newCol = pipeline.data.stages.find(s => s.stage === 'new');
  ok('huni doğru fırsatları gruplamış', newCol.opportunities.some(o => o.id === oppId));
  ok('huni toplam tahmini değeri hesaplıyor', newCol.totalValue >= 5000);

  console.log('\n=== AŞAMA GEÇİŞİ / STAGE TRANSITIONS ===');
  const noReason = await api('POST', `/api/crm/opportunities/${oppId}/stage`, { token: admin, body: { stage: 'lost' } });
  ok('kaybedilme sebebi olmadan reddediliyor (422)', noReason.status === 422);

  const toContacted = await api('POST', `/api/crm/opportunities/${oppId}/stage`, { token: admin, body: { stage: 'contacted' } });
  ok('iletişime geçildi aşamasına ilerletildi', toContacted.data.stage === 'contacted');

  const toWon = await api('POST', `/api/crm/opportunities/${oppId}/stage`, { token: admin, body: { stage: 'won' } });
  ok('kazanıldı olarak işaretlendi', toWon.data.stage === 'won');
  ok('kapanış zamanı damgalandı', typeof toWon.data.closedAt === 'number' && toWon.data.closedAt > 0);

  const reopenAttempt = await api('POST', `/api/crm/opportunities/${oppId}/stage`, { token: admin, body: { stage: 'contacted' } });
  ok('kapanmış fırsat yeniden açılamıyor (409)', reopenAttempt.status === 409);

  const editClosedAttempt = await api('PUT', `/api/crm/opportunities/${oppId}`, { token: admin, body: { estimatedValue: 1 } });
  ok('kapanmış fırsat düzenlenemiyor (409)', editClosedAttempt.status === 409);

  console.log('\n=== KAYBEDİLDİ AKIŞI / LOST FLOW ===');
  const lostResult = await api('POST', `/api/crm/opportunities/${leadId}/stage`, {
    token: admin, body: { stage: 'lost', lostReason: 'Fiyat çok yüksek bulundu' }
  });
  ok('sebep verilince kaybedildi olarak işaretlenebiliyor', lostResult.data.stage === 'lost');
  ok('kaybedilme sebebi kaydedildi', lostResult.data.lostReason === 'Fiyat çok yüksek bulundu');

  console.log('\n=== SATIŞ SİPARİŞİNE DÖNÜŞTÜRME / CONVERT TO SALES ORDER ===');
  const wonBeforeConvert = await api('GET', `/api/crm/opportunities/${leadId}`, { token: admin });
  const convertNotWon = await api('POST', `/api/crm/opportunities/${leadId}/convert`, { token: admin, body: {} });
  ok('kazanılmamış (kaybedilmiş) fırsat dönüştürülemiyor (409)', convertNotWon.status === 409, JSON.stringify(wonBeforeConvert.data.stage));

  const convert = await api('POST', `/api/crm/opportunities/${oppId}/convert`, { token: admin, body: {} });
  ok('kazanılmış fırsat dönüştürüldü (201)', convert.status === 201, JSON.stringify(convert.data));
  ok('gerçek bir satış siparişi oluştu (SAT- ile başlıyor)', /^SAT-/.test((convert.data.salesOrder || {}).soNo || ''));

  const so = await api('GET', `/api/sales/orders/${convert.data.salesOrder.id}`, { token: admin });
  ok('oluşan sipariş doğru müşteriyi taşıyor', so.data.customerId === custId);
  ok('oluşan sipariş fırsatın kalemini taşıyor', so.data.lines.length === 1 && so.data.lines[0].qty === 3 && so.data.lines[0].price === 100);

  const afterConvert = await api('GET', `/api/crm/opportunities/${oppId}`, { token: admin });
  ok('fırsat dönüştürülmüş sipariş kimliğini taşıyor', afterConvert.data.convertedSoId === convert.data.salesOrder.id);

  const secondConvert = await api('POST', `/api/crm/opportunities/${oppId}/convert`, { token: admin, body: {} });
  ok('aynı fırsat ikinci kez dönüştürülemiyor (409)', secondConvert.status === 409);

  console.log('\n=== MÜŞTERİSİZ ADAYI DÖNÜŞTÜRME / CONVERTING A CUSTOMER-LESS LEAD ===');
  const lead2 = await api('POST', '/api/crm/opportunities', {
    token: admin, body: { customerName: 'İkinci Aday', source: 'diger', lines: [{ itemId, itemName: 'test', qty: 1, unitPrice: 50 }] }
  });
  await api('POST', `/api/crm/opportunities/${lead2.data.id}/stage`, { token: admin, body: { stage: 'won' } });
  const convertNoCustomer = await api('POST', `/api/crm/opportunities/${lead2.data.id}/convert`, { token: admin, body: {} });
  ok('müşteri belirtilmeden dönüştürme reddediliyor (422)', convertNoCustomer.status === 422);
  const convertWithCustomer = await api('POST', `/api/crm/opportunities/${lead2.data.id}/convert`, { token: admin, body: { customerId: custId } });
  ok('dönüştürme sırasında müşteri belirtilince başarılı oluyor', convertWithCustomer.status === 201, JSON.stringify(convertWithCustomer.data));

  console.log('\n=== BOŞ KALEM / NO LINES ===');
  const noLines = await api('POST', '/api/crm/opportunities', { token: admin, body: { customerName: 'Kalemsiz', lines: [] } });
  await api('POST', `/api/crm/opportunities/${noLines.data.id}/stage`, { token: admin, body: { stage: 'won' } });
  const convertNoLines = await api('POST', `/api/crm/opportunities/${noLines.data.id}/convert`, { token: admin, body: { customerId: custId } });
  ok('kalemsiz fırsat dönüştürülemiyor (422)', convertNoLines.status === 422);

  console.log('\n=== WEBHOOK OLAYI / WEBHOOK EVENT ===');
  const catalog = await api('GET', '/api/webhooks/events', { token: admin });
  ok('opportunity.won olay kataloğunda', catalog.data.includes('opportunity.won'));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exitCode = fail ? 1 : 0; // process.exit() Windows'ta fetch handle'larıyla nadir bir libuv crash'ine yol açabiliyor
})();
