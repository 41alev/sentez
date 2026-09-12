// @ts-nocheck
/**
 * Yük testi.
 *
 * Amaç bir rekor kırmak değil, iki soruyu cevaplamak:
 *   1. Tipik bir fabrika yükü altında yanıt süreleri kabul edilebilir mi?
 *   2. Eşzamanlı yazma altında veri bozuluyor mu?
 *
 * İkincisi daha önemlidir. Yavaş bir sistem can sıkar; yanlış stok sayısı üreten
 * bir sistem para kaybettirir. SQLite tek yazarlıdır ve yazmalar sıraya girer;
 * bu test o sıralamanın gerçekten koruduğunu doğrular.
 *
 *   node test/load.js
 *   CONCURRENCY=20 DURATION_SEC=15 node test/load.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const DURATION_SEC = Number(process.env.DURATION_SEC || 10);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d, ms: performance.now() - t0 };
}

/** Yüzdelik: ortalama yanıltıcıdır, kuyruk gecikmesi p95/p99'da görülür. */
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1));
}
const stats = (arr) => ({
  n: arr.length,
  min: arr.length ? Number(Math.min(...arr).toFixed(1)) : 0,
  avg: arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : 0,
  p50: pct(arr, 0.5), p95: pct(arr, 0.95), p99: pct(arr, 0.99),
  max: arr.length ? Number(Math.max(...arr).toFixed(1)) : 0
});
const line = (name, s) =>
  `  ${name.padEnd(28)} n=${String(s.n).padStart(5)}  ort=${String(s.avg).padStart(7)}ms  ` +
  `p50=${String(s.p50).padStart(6)}  p95=${String(s.p95).padStart(7)}  p99=${String(s.p99).padStart(7)}  maks=${String(s.max).padStart(7)}`;

(async () => {
  console.log(`Yük testi / Load test — eşzamanlılık: ${CONCURRENCY}, süre: ${DURATION_SEC} sn\n`);

  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const operator = await login('operator', 'Operator123!');
  ok('oturum açıldı', !!admin && !!operator);

  const items = (await api('GET', '/api/items?pageSize=100', { token: admin })).data.data;
  const target = items.find(i => i.code === 'SM-108');
  ok('test ürünü bulundu', !!target, target ? target.name : '');

  /* ============ 1. OKUMA YÜKÜ ============ */
  console.log('\n=== 1. OKUMA YÜKÜ / READ LOAD ===');
  const readPaths = [
    '/api/items?pageSize=25',
    '/api/stock/lots?pageSize=25',
    '/api/reports/summary',
    '/api/purchasing/orders?pageSize=25',
    '/api/sales/orders?pageSize=25',
    '/api/reports/valuation'
  ];
  const readTimes = {}; readPaths.forEach(p => readTimes[p] = []);
  let readErrors = 0, readCount = 0;

  const readUntil = Date.now() + DURATION_SEC * 1000;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < readUntil) {
      const p = readPaths[Math.floor(Math.random() * readPaths.length)];
      const r = await api('GET', p, { token: admin });
      readCount++;
      if (r.status !== 200) readErrors++;
      else readTimes[p].push(r.ms);
    }
  }));

  readPaths.forEach(p => console.log(line(p.replace('/api/', '').slice(0, 28), stats(readTimes[p]))));
  const allRead = readPaths.flatMap(p => readTimes[p]);
  const readStats = stats(allRead);
  const rps = Math.round(readCount / DURATION_SEC);
  console.log(`\n  Toplam / total: ${readCount} istek, ${rps} istek/sn, ${readErrors} hata`);

  ok('okuma isteklerinde hata yok', readErrors === 0, `${readErrors} hata`);
  ok('okuma p95 < 500 ms', readStats.p95 < 500, `${readStats.p95} ms`);
  ok('okuma p99 < 1500 ms', readStats.p99 < 1500, `${readStats.p99} ms`);
  // Bir fabrikada 20-30 eşzamanlı kullanıcı beklenir; 50 istek/sn fazlasıyla yeter.
  ok('okuma verimi ≥ 50 istek/sn', rps >= 50, `${rps} istek/sn`);

  // Rapor uçları ağırdır; ayrı eşik uygulanır çünkü tabloları tarar.
  const summaryStats = stats(readTimes['/api/reports/summary']);
  ok('panel özeti p95 < 800 ms', summaryStats.p95 < 800, `${summaryStats.p95} ms`);

  /* ============ 2. EŞZAMANLI YAZMA — DOĞRULUK ============ */
  console.log('\n=== 2. EŞZAMANLI YAZMA / CONCURRENT WRITES ===');
  // Asıl sınav: aynı ürüne aynı anda stok girilirse toplam doğru mu?
  const before = (await api('GET', `/api/items/${target.id}`, { token: admin })).data.qty;
  const WRITES = 60;
  const QTY = 3;
  const writeTimes = [];
  let writeErrors = 0;
  const errorSamples = [];

  const jobs = Array.from({ length: WRITES }, (_, i) => async () => {
    const r = await api('POST', '/api/stock/move', {
      token: operator,
      body: { itemId: target.id, type: 'in', qty: QTY, warehouseId: 1,
              lotNo: `YUK-${i}`, unitCost: 2.5, note: 'yük testi' }
    });
    if (r.status !== 201 && r.status !== 200) {
      writeErrors++;
      if (errorSamples.length < 3) errorSamples.push(`${r.status}: ${JSON.stringify(r.data).slice(0, 100)}`);
    } else writeTimes.push(r.ms);
  });

  // Hepsini aynı anda başlat: sıraya girme davranışını zorlamak için
  const t0 = performance.now();
  await Promise.all(jobs.map(j => j()));
  const writeElapsed = (performance.now() - t0) / 1000;

  console.log(line('stok girişi / stock-in', stats(writeTimes)));
  console.log(`  ${WRITES} yazma ${writeElapsed.toFixed(1)} sn'de, ${Math.round(WRITES / writeElapsed)} yazma/sn, ${writeErrors} hata`);

  ok('eşzamanlı yazmalarda hata yok', writeErrors === 0, errorSamples.join(' | '));

  const after = (await api('GET', `/api/items/${target.id}`, { token: admin })).data.qty;
  const expected = before + WRITES * QTY;
  // Kayıp güncelleme (lost update) olsaydı toplam eksik çıkardı.
  ok('stok toplamı tam olarak doğru (kayıp güncelleme yok)',
    Math.abs(after - expected) < 0.001, `${after} (beklenen ${expected}, başlangıç ${before})`);

  const lots = (await api('GET', `/api/stock/lots?itemId=${target.id}&pageSize=200`, { token: admin })).data.data;
  const testLots = lots.filter(l => String(l.lotNo || '').startsWith('YUK-'));
  ok('her yazma kendi partisini oluşturdu', testLots.length === WRITES, `${testLots.length}/${WRITES}`);
  const uniqueLots = new Set(testLots.map(l => l.lotNo));
  ok('parti numaraları tekilleşmedi / çakışmadı', uniqueLots.size === testLots.length,
    `${uniqueLots.size} tekil / ${testLots.length} kayıt`);

  const movements = (await api('GET', `/api/stock/movements?itemId=${target.id}&pageSize=200`, { token: admin })).data.data;
  const testMoves = movements.filter(m => m.note === 'yük testi');
  ok('her yazma hareket kaydı bıraktı', testMoves.length === WRITES, `${testMoves.length}/${WRITES}`);

  ok('yazma p95 < 1000 ms', stats(writeTimes).p95 < 1000, `${stats(writeTimes).p95} ms`);

  /* ============ 3. BELGE NUMARASI YARIŞI ============ */
  console.log('\n=== 3. BELGE NUMARASI YARIŞI / DOCUMENT NUMBER RACE ===');
  // Belge numaraları boşluksuz ve tekil olmalı; yarış durumu burada görülür.
  const suppliers = (await api('GET', '/api/purchasing/suppliers?pageSize=10', { token: admin })).data.data;
  const N_PO = 25;
  const poResults = await Promise.all(Array.from({ length: N_PO }, () =>
    api('POST', '/api/purchasing/orders', {
      token: operator,
      body: { supplierId: suppliers[0].id, warehouseId: 1, currency: 'TRY',
              items: [{ itemId: target.id, qty: 1, price: 2.5 }] }
    })));
  const created = poResults.filter(r => r.status === 201);
  ok('eşzamanlı siparişlerin hepsi oluştu', created.length === N_PO, `${created.length}/${N_PO}`);
  const poNos = created.map(r => r.data.poNo);
  ok('sipariş numaraları tekil (yarış yok)', new Set(poNos).size === poNos.length,
    `${new Set(poNos).size} tekil / ${poNos.length}`);

  /* ============ 4. HIZ SINIRLAMA ============ */
  console.log('\n=== 4. HIZ SINIRLAMA / RATE LIMITING ===');
  // Giriş uçları kaba kuvvete karşı sınırlı olmalı; sınır çalışıyor mu?
  const loginAttempts = await Promise.all(Array.from({ length: 15 }, () =>
    api('POST', '/api/auth/login', { body: { username: 'admin', password: 'yanlis' } })));
  const limited = loginAttempts.filter(r => r.status === 429).length;
  ok('başarısız giriş denemeleri sınırlanıyor', limited > 0,
    `${limited}/15 istek 429 aldı — sınır yoksa kaba kuvvet serbest kalır`);

  /* ============ 5. YÜK SONRASI TUTARLILIK ============ */
  console.log('\n=== 5. YÜK SONRASI TUTARLILIK / INTEGRITY AFTER LOAD ===');
  const health = await api('GET', '/health');
  ok('sunucu ayakta ve sağlıklı', health.status === 200 && health.data.status === 'ok');
  const summary = (await api('GET', '/api/reports/summary', { token: admin })).data;
  ok('raporlar hâlâ hesaplanabiliyor', summary.totalValueTRY > 0, `₺${summary.totalValueTRY}`);
  const val = (await api('GET', '/api/reports/valuation', { token: admin })).data;
  const targetVal = val.data.find(v => v.itemId === target.id);
  ok('değerleme raporu yeni partileri içeriyor',
    targetVal && Math.abs(targetVal.availableQty - after) < 0.001,
    `${targetVal && targetVal.availableQty} vs ${after}`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(60));
  console.log('\nNot: SQLite tek yazarlıdır — yazmalar sıraya girer. Bu, onlarca eşzamanlı');
  console.log('kullanıcı için yeterlidir; yüzlerce eşzamanlı YAZMA gerekiyorsa PostgreSQL\'e');
  console.log('geçilmelidir. Okuma tarafı WAL sayesinde yazmalardan etkilenmez.');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Yük testi çalıştırılamadı / failed:', e); process.exit(1); });
