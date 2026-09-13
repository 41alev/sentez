// @ts-nocheck
/**
 * BI/raporlama derinliği: özel rapor (pivot) + kayıtlı raporlar testleri
 * (Aşama 8).
 *
 * En değerli kontrol: boyut/ölçü whitelist'inin GERÇEKTEN SQL enjeksiyonuna
 * kapalı olduğu — kullanıcı girdisi asla ham SQL'e karışmıyor, yalnızca
 * sabit anahtar kelimelerle eşleştiriliyor (bkz. server/services/pivot.js).
 * Ayrıca kayıtlı rapor silme yetkisinin (sahibi veya yönetici) gerçekten
 * uygulandığı.
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/pivot.js
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

  console.log('\n=== META / WHITELIST ===');
  const meta = await api('GET', '/api/reports/pivot-meta', { token: viewer });
  ok('meta kimlik doğrulaması yeterli (viewer okuyabiliyor)', meta.status === 200);
  ok('boyut listesi geliyor', Array.isArray(meta.data.dimensions) && meta.data.dimensions.some(d => d.key === 'month'));
  ok('ölçü listesi geliyor', Array.isArray(meta.data.metrics) && meta.data.metrics.some(m => m.key === 'value'));
  ok('hareket tipi listesi geliyor', meta.data.movementTypes.includes('in'));

  console.log('\n=== PIVOT ÇALIŞTIRMA / RUN PIVOT ===');
  const byType = await api('POST', '/api/reports/pivot', { token: viewer, body: { dimension: 'type', metric: 'qty', filters: {} } });
  ok('görüntüleyici de pivot çalıştırabiliyor (salt okunur)', byType.status === 200);
  ok('en az bir satır dönüyor (tohum verisi hareket içeriyor)', byType.data.data.length > 0, JSON.stringify(byType.data));
  ok('sonuç dim/val alanlarını taşıyor', byType.data.data.every(r => 'dim' in r && 'val' in r));

  console.log('\n=== GÜVENLİK — SQL ENJEKSİYONU / SQL INJECTION ===');
  const badDim = await api('POST', '/api/reports/pivot', { token: admin, body: { dimension: "1); DROP TABLE users;--", metric: 'qty', filters: {} } });
  ok('bilinmeyen boyut reddediliyor (400) — enjeksiyon SQL\'e hiç ulaşmıyor', badDim.status === 400);
  const badMetric = await api('POST', '/api/reports/pivot', { token: admin, body: { dimension: 'month', metric: "SUM(1); DROP TABLE users;--", filters: {} } });
  ok('bilinmeyen ölçü reddediliyor (400)', badMetric.status === 400);
  const badType = await api('POST', '/api/reports/pivot', { token: admin, body: { dimension: 'type', metric: 'qty', filters: { type: "x' OR '1'='1" } } });
  ok('bilinmeyen hareket tipi filtresi reddediliyor (400)', badType.status === 400);
  const stillWorks = await api('GET', '/api/items?pageSize=1', { token: admin });
  ok('enjeksiyon denemelerinden sonra veritabanı sağlam (users tablosu duruyor)', stillWorks.status === 200);

  console.log('\n=== FİLTRELER / FILTERS ===');
  const filtered = await api('POST', '/api/reports/pivot', { token: admin, body: { dimension: 'type', metric: 'count', filters: { type: 'in' } } });
  ok('tek tipe filtrelenince tek satır dönüyor', filtered.data.data.length === 1 && filtered.data.data[0].dim === 'in', JSON.stringify(filtered.data));

  console.log('\n=== KAYITLI RAPORLAR / SAVED REPORTS ===');
  const created = await api('POST', '/api/reports/saved', {
    token: admin, body: { name: 'Test Raporu', dimension: 'month', metric: 'value', chartType: 'line', filters: { type: 'in' } }
  });
  ok('kayıtlı rapor oluşturuldu (201)', created.status === 201, JSON.stringify(created.data));
  ok('filtreler geri okunuyor', created.data.filters.type === 'in');
  const reportId = created.data.id;

  const badSave = await api('POST', '/api/reports/saved', { token: admin, body: { name: 'X', dimension: 'yok-boyle-bir-sey', metric: 'qty' } });
  ok('geçersiz boyutla kayıt reddediliyor (400)', badSave.status === 400);

  const list = await api('GET', '/api/reports/saved', { token: viewer });
  ok('görüntüleyici de kayıtlı raporları görebiliyor', list.status === 200 && list.data.some(r => r.id === reportId));

  console.log('\n=== SİLME YETKİSİ / DELETE PERMISSION ===');
  const viewerCreated = await api('POST', '/api/reports/saved', {
    token: viewer, body: { name: 'Viewer Raporu', dimension: 'day', metric: 'count' }
  });
  ok('görüntüleyici de kendi raporunu oluşturabiliyor (salt okunur bir tercih, iş verisi değil)', viewerCreated.status === 201);

  const otherDeletesViewer = await api('DELETE', `/api/reports/saved/${viewerCreated.data.id}`, { token: admin });
  ok('yönetici başkasının raporunu silebiliyor', otherDeletesViewer.status === 204);

  const viewerCreated2 = await api('POST', '/api/reports/saved', {
    token: viewer, body: { name: 'Viewer Raporu 2', dimension: 'day', metric: 'count' }
  });
  const operatorLogin = await login('operator', 'Operator123!');
  const operatorDeletesViewer = await api('DELETE', `/api/reports/saved/${viewerCreated2.data.id}`, { token: operatorLogin });
  ok('operatör (yönetici olmayan) başkasının raporunu SİLEMİYOR (403)', operatorDeletesViewer.status === 403);

  const ownerDeletes = await api('DELETE', `/api/reports/saved/${viewerCreated2.data.id}`, { token: viewer });
  ok('sahibi kendi raporunu silebiliyor', ownerDeletes.status === 204);

  const cleanup = await api('DELETE', `/api/reports/saved/${reportId}`, { token: admin });
  ok('temizlik: test raporu silindi', cleanup.status === 204);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exitCode = fail ? 1 : 0; // process.exit() Windows'ta fetch handle'larıyla nadir bir libuv crash'ine yol açabiliyor
})();
