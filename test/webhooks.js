// @ts-nocheck
/**
 * Webhook altyapısı testleri.
 *
 * Gerçek bir HTTP alıcı taklit edilir (yerel, geçici bir sunucu — bkz.
 * test/email.js'teki aynı desen) — bu, imzanın gerçekten doğrulanabilir
 * olduğunu ve olay gövdesinin gerçekten doğru veriyi taşıdığını kanıtlar,
 * yalnızca "istek atıldı" değil.
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/webhooks.js
 */
const http = require('http');
const crypto = require('crypto');

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Gelen webhook isteklerini yakalayan geçici, gerçek bir HTTP sunucusu. */
function startReceiver() {
  const received = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
  });
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');

  console.log('\n=== YETKİ / PERMISSIONS ===');
  ok('yönetici olmayan webhook listeleyemiyor (403)', (await api('GET', '/api/webhooks', { token: manager })).status === 403);
  ok('yönetici olmayan webhook oluşturamıyor (403)',
    (await api('POST', '/api/webhooks', { token: manager, body: { url: 'https://example.com', events: ['ncr.opened'] } })).status === 403);

  console.log('\n=== OLAY KATALOĞU / EVENT CATALOG ===');
  const catalog = await api('GET', '/api/webhooks/events', { token: admin });
  ok('olay kataloğu geldi', catalog.status === 200 && Array.isArray(catalog.data) && catalog.data.includes('ncr.opened'));

  console.log('\n=== OLUŞTURMA / CREATE ===');
  const badUrl = await api('POST', '/api/webhooks', { token: admin, body: { url: 'boyle-bir-url-yok', events: ['ncr.opened'] } });
  ok('geçersiz URL reddediliyor (422)', badUrl.status === 422);
  const noEvents = await api('POST', '/api/webhooks', { token: admin, body: { url: 'https://example.com', events: [] } });
  ok('boş olay listesi reddediliyor (422)', noEvents.status === 422);

  const { server, port, received } = await startReceiver();
  const created = await api('POST', '/api/webhooks', {
    token: admin,
    body: { url: `http://127.0.0.1:${port}/hook`, events: ['ncr.opened'], description: 'Test webhook' }
  });
  ok('webhook oluşturuldu (201)', created.status === 201);
  ok('oluşturma yanıtı gizli anahtarı bir kez döndürüyor', typeof created.data.secret === 'string' && created.data.secret.length >= 32);
  const webhookId = created.data.id;
  const secret = created.data.secret;

  console.log('\n=== LİSTELEME — GİZLİ ANAHTAR GİZLİ / LIST — SECRET HIDDEN ===');
  const list = await api('GET', '/api/webhooks', { token: admin });
  const listed = list.data.find(w => w.id === webhookId);
  ok('liste yanıtında secret alanı YOK', listed && listed.secret === undefined);
  ok('liste doğru olayları gösteriyor', listed && JSON.stringify(listed.events) === JSON.stringify(['ncr.opened']));

  console.log('\n=== TEST GÖNDERİMİ / TEST PING ===');
  const pingRes = await api('POST', `/api/webhooks/${webhookId}/test`, { token: admin });
  await sleep(50);
  ok('test bildirimi başarılı raporlanıyor', pingRes.data.success === true, JSON.stringify(pingRes.data));
  ok('alıcı gerçekten bir istek aldı', received.length === 1);
  if (received.length) {
    const sig = received[0].headers['x-webhook-signature'];
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(received[0].body).digest('hex');
    ok('imza doğrulanabiliyor (HMAC-SHA256)', sig === expected, `got ${sig}`);
    ok('olay başlığı doğru', received[0].headers['x-webhook-event'] === 'ping');
  }

  console.log('\n=== GERÇEK İŞ OLAYI / REAL BUSINESS EVENT ===');
  received.length = 0;
  const ncr = await api('POST', '/api/quality/ncrs', {
    token: admin,
    body: { source: 'internal', severity: 'major', description: 'Webhook testi için NCR' }
  });
  ok('NCR oluşturuldu', ncr.status === 201, JSON.stringify(ncr.data));
  await sleep(150); // dispatch fire-and-forget'tir; küçük bir bekleme payı
  ok('NCR açılınca webhook tetiklendi', received.length === 1);
  if (received.length) {
    const payload = JSON.parse(received[0].body);
    ok('olay adı doğru', payload.event === 'ncr.opened');
    ok('olay verisi gerçek NCR alanlarını taşıyor', payload.data.ncrNo === ncr.data.ncrNo);
  }

  console.log('\n=== TESLİMAT GEÇMİŞİ / DELIVERY LOG ===');
  const deliveries = await api('GET', `/api/webhooks/${webhookId}/deliveries`, { token: admin });
  ok('teslimat listesi zarf döndürüyor', Array.isArray(deliveries.data.data) && deliveries.data.total >= 2);
  ok('kayıtlı teslimat başarılı işaretli', deliveries.data.data.every(d => d.success === true));

  console.log('\n=== BAŞARISIZ TESLİMAT VE YENİDEN DENEME / FAILED DELIVERY + RETRY ===');
  // Hiçbir şeyin dinlemediği bir port — bağlantı reddi kesin.
  const deadHook = await api('POST', '/api/webhooks', {
    token: admin, body: { url: 'http://127.0.0.1:1/unreachable', events: ['ncr.opened'] }
  });
  const deadId = deadHook.data.id;
  const failPing = await api('POST', `/api/webhooks/${deadId}/test`, { token: admin });
  ok('ulaşılamayan uç için açık başarısızlık raporu', failPing.data.success === false && !!failPing.data.error, JSON.stringify(failPing.data));

  const failDeliveries = await api('GET', `/api/webhooks/${deadId}/deliveries`, { token: admin });
  const failedDelivery = failDeliveries.data.data[0];
  ok('başarısız teslimat kaydedildi (sessizce kaybolmadı)', failedDelivery && failedDelivery.success === false);

  const retry = await api('POST', `/api/webhooks/${deadId}/deliveries/${failedDelivery.id}/retry`, { token: admin });
  ok('yeniden deneme çalışıyor (aynı şekilde başarısız olsa da)', retry.data.success === false);

  console.log('\n=== SİLME / DELETE ===');
  ok('webhook silinebiliyor (204)', (await api('DELETE', `/api/webhooks/${webhookId}`, { token: admin })).status === 204);
  ok('ikinci test webhook\'u silinebiliyor', (await api('DELETE', `/api/webhooks/${deadId}`, { token: admin })).status === 204);
  ok('silinen webhook artık listede yok', !(await api('GET', '/api/webhooks', { token: admin })).data.find(w => w.id === webhookId));

  server.close();

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})();
