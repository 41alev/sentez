// @ts-nocheck
/**
 * Saha ziyaret kaydı testleri.
 *
 * En değerli kontroller: (1) bir fırsata (opportunity) bağlı ziyaretin gerçekten
 * o fırsatla ilişkilendiği ve filtrelenebildiği, (2) konum alanlarının isteğe
 * bağlı olduğu (GPS reddedilirse de kayıt oluşabiliyor), (3) var olmayan
 * müşteri/fırsatla ziyaret oluşturulamadığı, (4) yalnızca yöneticinin bir
 * ziyaret kaydını silebildiği (elle düzeltme senaryosu).
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/visits.js
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
const dstr = (off = 0) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  const customers = await api('GET', '/api/sales/customers?pageSize=1', { token: admin });
  const custId = customers.data.data[0].id;

  const opp = await api('POST', '/api/crm/opportunities', {
    token: admin, body: { customerId: custId, customerName: customers.data.data[0].name, lines: [] }
  });
  const oppId = opp.data.id;

  console.log('\n=== YETKİ / PERMISSIONS ===');
  ok('görüntüleyici ziyaret oluşturamıyor (403)',
    (await api('POST', '/api/visits', { token: viewer, body: { customerId: custId, visitDate: dstr() } })).status === 403);
  ok('operatör listeyi görebiliyor', (await api('GET', '/api/visits', { token: operator })).status === 200);

  console.log('\n=== OLUŞTURMA / CREATE ===');
  const bad = await api('POST', '/api/visits', { token: operator, body: { customerId: 999999, visitDate: dstr() } });
  ok('var olmayan müşteri reddediliyor (404)', bad.status === 404, `got ${bad.status}`);

  const badOpp = await api('POST', '/api/visits', {
    token: operator, body: { customerId: custId, opportunityId: 'olmayan-id', visitDate: dstr() }
  });
  ok('var olmayan fırsat reddediliyor (404)', badOpp.status === 404, `got ${badOpp.status}`);

  const withoutGps = await api('POST', '/api/visits', {
    token: operator, body: { customerId: custId, visitDate: dstr(-1), purpose: 'Şikayet görüşmesi', notes: 'Müşteri memnun ayrıldı' }
  });
  ok('konum bilgisi olmadan da ziyaret oluşturulabiliyor', withoutGps.status === 201, `got ${withoutGps.status} ${JSON.stringify(withoutGps.data)}`);
  ok('konum alanları boş kaydediliyor (GPS reddedilmiş senaryosu)',
    withoutGps.data.latitude === null && withoutGps.data.longitude === null);

  const withGps = await api('POST', '/api/visits', {
    token: operator, body: {
      customerId: custId, opportunityId: oppId, visitDate: dstr(), purpose: 'Teklif sunumu',
      latitude: 41.0082, longitude: 28.9784, followUpDate: dstr(7)
    }
  });
  ok('konumlu ve fırsata bağlı ziyaret oluşturuldu', withGps.status === 201, `got ${withGps.status} ${JSON.stringify(withGps.data)}`);
  ok('konum doğru kaydedildi', withGps.data.latitude === 41.0082 && withGps.data.longitude === 28.9784, JSON.stringify(withGps.data));
  ok('fırsat ilişkisi kuruldu', withGps.data.opportunityId === oppId, withGps.data.opportunityId);
  ok('takip tarihi kaydedildi', withGps.data.followUpDate === dstr(7), withGps.data.followUpDate);

  const badLat = await api('POST', '/api/visits', {
    token: operator, body: { customerId: custId, visitDate: dstr(), latitude: 200 }
  });
  ok('geçersiz enlem reddediliyor (422)', badLat.status === 422, `got ${badLat.status}`);

  console.log('\n=== LİSTE / FİLTRE ===');
  const byOpp = await api('GET', `/api/visits?opportunityId=${oppId}`, { token: admin });
  ok('fırsata göre filtreleme çalışıyor', byOpp.data.data.length === 1 && byOpp.data.data[0].id === withGps.data.id,
    JSON.stringify(byOpp.data.data.map(v => v.id)));
  const byCustomer = await api('GET', `/api/visits?customerId=${custId}&pageSize=50`, { token: admin });
  ok('müşteriye göre filtreleme en az iki ziyaret döndürüyor', byCustomer.data.data.length >= 2, String(byCustomer.data.data.length));

  console.log('\n=== DETAY / GÜNCELLEME ===');
  const detail = await api('GET', `/api/visits/${withGps.data.id}`, { token: admin });
  ok('ziyaret detayı görüntüleniyor, ziyaret eden kullanıcı adı görünüyor', detail.status === 200 && detail.data.visitedUsername === 'operator', JSON.stringify(detail.data));

  const upd = await api('PUT', `/api/visits/${withGps.data.id}`, { token: manager, body: { notes: 'Güncellenmiş not: teklif e-posta ile de gönderildi' } });
  ok('ziyaret notu güncellendi', upd.status === 200 && /e-posta/.test(upd.data.notes), JSON.stringify(upd.data));

  console.log('\n=== SİLME / DELETE (yalnızca yönetici) ===');
  const delByOperator = await api('DELETE', `/api/visits/${withoutGps.data.id}`, { token: operator });
  ok('operatör ziyaret silemiyor (403)', delByOperator.status === 403, `got ${delByOperator.status}`);
  const delByManager = await api('DELETE', `/api/visits/${withoutGps.data.id}`, { token: manager });
  ok('yönetici ziyareti silebiliyor', delByManager.status === 204, `got ${delByManager.status}`);
  const gone = await api('GET', `/api/visits/${withoutGps.data.id}`, { token: admin });
  ok('silinen ziyaret artık bulunamıyor (404)', gone.status === 404, `got ${gone.status}`);

  console.log('\n=== İZ KAYDI / AUDIT TRAIL ===');
  const audit = await api('GET', `/api/audit?entityType=customer_visit&pageSize=20`, { token: admin });
  ok('denetim kaydına yazıldı', audit.data.data.length >= 3, `${audit.data.data.length} kayıt`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
