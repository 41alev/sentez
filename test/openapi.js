// @ts-nocheck
/**
 * OpenAPI şema testleri.
 *
 * En değerli kontrol: server/lib/openapi.js elle yazılan onlarca `$ref`
 * içeriyor — bunlardan biri yanlış yazılırsa (ör. `#/components/schemas/Itme`)
 * Swagger UI sessizce boş/bozuk bir şema gösterir, hata fırlatmaz. Bu test
 * dokümanın TAMAMINI gezip her `$ref`'in gerçekten var olan bir şemaya
 * işaret ettiğini kanıtlar.
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/openapi.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/** Nesneyi derinlemesine gezip her `$ref`'i toplar. */
function collectRefs(node, out = []) {
  if (Array.isArray(node)) { node.forEach(n => collectRefs(n, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

(async () => {
  console.log('\n=== ŞEMA ERİŞİMİ / SCHEMA ACCESS ===');
  const res = await fetch(BASE + '/api/docs/openapi.json');
  ok('kimlik doğrulama olmadan erişilebiliyor (200)', res.status === 200);
  const spec = await res.json();

  ok('OpenAPI 3.0 belgesi', spec.openapi && spec.openapi.startsWith('3.0'));
  ok('başlık ve sürüm var', !!spec.info?.title && !!spec.info?.version);
  ok('en az bir güvenlik şeması tanımlı (bearerAuth)', !!spec.components?.securitySchemes?.bearerAuth);

  console.log('\n=== ANA KAYNAKLAR BELGELENMİŞ / CORE RESOURCES DOCUMENTED ===');
  const expectedPaths = [
    '/auth/login', '/items', '/items/{id}', '/items/barcode/{code}',
    '/stock/lots', '/stock/move',
    '/purchasing/suppliers', '/purchasing/orders', '/purchasing/orders/{id}/approve', '/purchasing/orders/{id}/receipts',
    '/sales/customers', '/sales/orders', '/sales/shipments', '/sales/shipments/{id}/status',
    '/production', '/production/{id}/complete',
    '/quality/inspections', '/quality/ncrs',
    '/notifications', '/webhooks', '/webhooks/events', '/webhooks/{id}/deliveries',
    '/labels/item/{id}/zpl', '/labels/print',
    '/crm/opportunities', '/crm/opportunities/pipeline', '/crm/opportunities/{id}',
    '/crm/opportunities/{id}/stage', '/crm/opportunities/{id}/convert',
    '/support', '/support/{id}', '/support/{id}/status', '/support/{id}/comments', '/support/{id}/to-ncr',
    '/visits', '/visits/{id}',
    '/reports/pivot-meta', '/reports/pivot', '/reports/saved', '/reports/saved/{id}'
  ];
  const missing = expectedPaths.filter(p => !spec.paths[p]);
  ok('beklenen tüm uçlar mevcut', missing.length === 0, missing.length ? 'eksik: ' + missing.join(', ') : '');

  console.log('\n=== $REF BÜTÜNLÜĞÜ / $REF INTEGRITY (en değerli kontrol) ===');
  const refs = collectRefs(spec);
  ok('en az bir $ref bulundu (kontrolün anlamlı olması için)', refs.length > 10, String(refs.length));
  const schemaNames = new Set(Object.keys(spec.components?.schemas || {}));
  const badRefs = refs.filter(r => {
    if (!r.startsWith('#/components/schemas/')) return true;
    const name = r.replace('#/components/schemas/', '');
    return !schemaNames.has(name);
  });
  ok('her $ref var olan bir şemaya işaret ediyor', badRefs.length === 0, badRefs.length ? 'kırık: ' + [...new Set(badRefs)].join(', ') : '');

  console.log('\n=== HER YOL EN AZ BİR YANITTA ŞEMA TANIMLIYOR / EVERY OPERATION HAS RESPONSES ===');
  let opsWithoutResponses = [];
  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (!op.responses || !Object.keys(op.responses).length) opsWithoutResponses.push(`${m.toUpperCase()} ${p}`);
      if (!op.tags || !op.tags.length) opsWithoutResponses.push(`${m.toUpperCase()} ${p} (tag yok)`);
    }
  }
  ok('her operasyonun yanıtı ve etiketi var', opsWithoutResponses.length === 0, opsWithoutResponses.join(', '));

  console.log('\n=== DOKÜMAN SAYFASI / DOCS PAGE ===');
  const page = await fetch(BASE + '/api-docs.html');
  ok('interaktif doküman sayfası servis ediliyor', page.status === 200);
  ok('sayfa openapi.json\'a işaret ediyor', (await page.text()).includes('/api/docs/openapi.json'));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  // process.exit(...) DEĞİL: bu, Node'un fetch (undici) ile açtığı handle'ları
  // kapatırken Windows'ta bir libuv assertion crash'ine yol açabiliyor
  // (native "UV_HANDLE_CLOSING" hatası) — process.exitCode ile Node'un
  // event loop'u doğal biçimde boşaltıp temiz çıkmasına izin veriliyor.
  process.exitCode = fail ? 1 : 0;
})();
