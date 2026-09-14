// @ts-nocheck
/**
 * Genel arama (global search) API testi — bkz. server/routes/search.js.
 *
 *   node test/search.js   (sunucu ayakta olmalı)
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
  console.log('\n=== GENEL ARAMA / GLOBAL SEARCH ===');
  const admin = await login('admin', 'Admin123!');
  const viewer = await login('viewer', 'Viewer123!');

  const noAuth = await api('GET', '/api/search?q=test');
  ok('kimlik doğrulaması olmadan reddediliyor (401)', noAuth.status === 401, `got ${noAuth.status}`);

  const tooShort = await api('GET', '/api/search?q=a', { token: admin });
  ok('tek harfli sorgu boş sonuç döner (gürültü değil)', tooShort.status === 200
    && Object.values(tooShort.data).every(arr => arr.length === 0), JSON.stringify(tooShort.data));

  const items = await api('GET', '/api/search?q=Somun', { token: admin });
  ok('ürün adına göre bulunuyor', items.data.items.some(i => i.label.includes('Somun')),
    JSON.stringify(items.data.items));

  const byCode = await api('GET', '/api/search?q=SM-108', { token: admin });
  ok('ürün koduna göre de bulunuyor', byCode.data.items.some(i => i.sub === 'SM-108'),
    JSON.stringify(byCode.data.items));

  const customers = await api('GET', '/api/search?q=Anadolu', { token: admin });
  ok('müşteri adına göre bulunuyor', customers.data.customers.some(c => c.label.includes('Anadolu')),
    JSON.stringify(customers.data.customers));

  const suppliers = await api('GET', '/api/search?q=Akım', { token: admin });
  ok('tedarikçi adına göre bulunuyor', suppliers.data.suppliers.some(s => s.label.includes('Akım')),
    JSON.stringify(suppliers.data.suppliers));

  const soSearch = await api('GET', '/api/search?q=SAT-2026', { token: admin });
  ok('satış siparişi numarasına göre bulunuyor', soSearch.data.salesOrders.length > 0,
    JSON.stringify(soSearch.data.salesOrders));
  ok('satış siparişi sonucu müşteri adını da taşıyor', soSearch.data.salesOrders.every(s => typeof s.sub === 'string'));

  const poSearch = await api('GET', '/api/search?q=SA-2026', { token: admin });
  ok('satın alma siparişi numarasına göre bulunuyor', poSearch.data.purchaseOrders.length > 0,
    JSON.stringify(poSearch.data.purchaseOrders));

  const lotSearch = await api('GET', '/api/search?q=LOT-', { token: admin });
  ok('parti numarasına göre bulunuyor', lotSearch.data.lots.length > 0, JSON.stringify(lotSearch.data.lots));
  ok('parti sonucu üst sınırı aşmıyor (≤6)', lotSearch.data.lots.length <= 6, `${lotSearch.data.lots.length}`);

  const noMatch = await api('GET', '/api/search?q=boyle-bir-kayit-hic-yok-xyz', { token: admin });
  ok('eşleşme yoksa tüm kategoriler boş dizi döner (hata değil)', noMatch.status === 200
    && Object.values(noMatch.data).every(arr => Array.isArray(arr) && arr.length === 0), JSON.stringify(noMatch.data));

  const viewerSearch = await api('GET', '/api/search?q=Somun', { token: viewer });
  ok('görüntüleyici de arayabiliyor (salt okunur, mevcut liste ekranlarıyla tutarlı)',
    viewerSearch.status === 200 && viewerSearch.data.items.length > 0, `got ${viewerSearch.status}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
