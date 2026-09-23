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
const { resolveTarget, isBlockedAddress } = require('../server/lib/webhook-target');

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
  console.log('\n=== HEDEF POLİTİKASI / TARGET POLICY ===');
  for (const [address, family] of [['127.0.0.1', 4], ['169.254.169.254', 4], ['10.0.0.1', 4], ['::1', 6], ['::ffff:127.0.0.1', 6]]) {
    ok(`${address} özel adres olarak tanındı`, isBlockedAddress(address, family));
  }
  for (const url of ['http://example.com/x', 'file:///etc/passwd', 'https://127.0.0.1/x', 'https://[::1]/x']) {
    let rejected = false;
    try { await resolveTarget(url); } catch (e) { rejected = e.status === 422; }
    ok(`${url} güvenli hedef değil (422)`, rejected);
  }
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
    ok('kalıcı olay kimliği gövde ve başlıkta aynı', typeof payload.id === 'string' && received[0].headers['x-webhook-id'] === payload.id);
  }

  const outbox = await api('GET', `/api/webhooks/${webhookId}/outbox`, { token: admin });
  const ncrEvent = outbox.data.data.find(e => e.event === 'ncr.opened');
  ok('iş olayı kalıcı outbox kaydından teslim edilmiş', outbox.status === 200 && ncrEvent && ncrEvent.deliveredAt && ncrEvent.attemptCount === 1,
    JSON.stringify(outbox.data));

  const beforeRejected = outbox.data.total;
  await api('POST', '/api/quality/ncrs', { token: admin, body: { source: 'yanlis', severity: 'major', description: 'reddedilmeli' } });
  const afterRejected = await api('GET', `/api/webhooks/${webhookId}/outbox`, { token: admin });
  ok('başarısız iş işlemi outbox kalıntısı bırakmıyor', afterRejected.data.total === beforeRejected);

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

  console.log('\n=== OTOMATİK YENİDEN DENEME KUYRUĞU / AUTO-RETRY QUEUE ===');
  ok('ilk başarısızlık otomatik kuyruğa alınmış (nextRetryAt dolu)', failedDelivery.retryCount === 0 && failedDelivery.nextRetryAt > Date.now(),
    JSON.stringify({ retryCount: failedDelivery.retryCount, nextRetryAt: failedDelivery.nextRetryAt }));

  // Yukarıdaki elle "retry" çağrısı da kendi kaydını (retryCount=0) ekleyip
  // kuyruğa aldığı için, otomatik kuyruğu İZOLE test etmek adına TAZE,
  // ayrı bir ulaşılamayan webhook kullanılıyor — karışma olmasın.
  const deadHook2 = await api('POST', '/api/webhooks', {
    token: admin, body: { url: 'http://127.0.0.1:2/unreachable', events: ['ncr.opened'] }
  });
  const deadId2 = deadHook2.data.id;
  await api('POST', `/api/webhooks/${deadId2}/test`, { token: admin });
  const before = await api('GET', `/api/webhooks/${deadId2}/deliveries`, { token: admin });
  ok('izole webhook\'ta tam olarak bir başarısız kayıt var', before.data.total === 1, JSON.stringify(before.data));

  // WEBHOOK_RETRY_BASE_MS test ortamında küçük tutulur (bkz. test/run-all.js)
  // — nextRetryAt'in gerçekten geçmişte kalmasını garantiye almak için bekle.
  await sleep(300);
  const triggered = await api('POST', '/api/webhooks/process-retry-queue', { token: admin });
  ok('kuyruk tetikleme çalışıyor (admin)', triggered.status === 200);
  await sleep(150); // sendDelivery fire-and-forget'tir; küçük bir bekleme payı

  const after = await api('GET', `/api/webhooks/${deadId2}/deliveries`, { token: admin });
  ok('otomatik yeniden deneme GERÇEKTEN yeni bir teslimat denemesi yaptı', after.data.total === 2, `beklenen 2, gelen ${after.data.total}`);
  const original = after.data.data.find(d => d.id === before.data.data[0].id);
  const autoRetried = after.data.data.find(d => d.id !== before.data.data[0].id);
  ok('otomatik denemenin retryCount\'u arttı (1)', autoRetried && autoRetried.retryCount === 1, JSON.stringify(autoRetried));
  ok('ilk denemenin nextRetryAt\'i temizlendi (iki kez işlenmesin diye)', original && original.nextRetryAt === null);

  await api('POST', '/api/quality/ncrs', {
    token: admin, body: { source: 'internal', severity: 'minor', description: 'Outbox retry testi' }
  });
  await sleep(150);
  const failedOutbox = await api('GET', `/api/webhooks/${deadId2}/outbox`, { token: admin });
  const queuedEvent = failedOutbox.data.data.find(e => e.event === 'ncr.opened');
  ok('iş olayı başarısızsa outbox içinde görünür ve yeniden denemeye planlanır',
    queuedEvent && !queuedEvent.deliveredAt && queuedEvent.lastError && queuedEvent.nextAttemptAt,
    JSON.stringify(failedOutbox.data));
  await sleep(300);
  await api('POST', '/api/webhooks/process-retry-queue', { token: admin });
  await sleep(150);
  const retriedOutbox = await api('GET', `/api/webhooks/${deadId2}/outbox`, { token: admin });
  const retriedEvent = retriedOutbox.data.data.find(e => e.id === queuedEvent?.id);
  ok('outbox başarısız iş olayını aynı olay kimliğiyle yeniden deniyor', retriedEvent && retriedEvent.attemptCount >= 2 && !retriedEvent.deliveredAt,
    JSON.stringify(retriedEvent));

  ok('yönetici olmayan kuyruğu elle tetikleyemiyor (403)',
    (await api('POST', '/api/webhooks/process-retry-queue', { token: manager })).status === 403);

  console.log('\n=== SİLME / DELETE ===');
  ok('webhook silinebiliyor (204)', (await api('DELETE', `/api/webhooks/${webhookId}`, { token: admin })).status === 204);
  ok('ikinci test webhook\'u silinebiliyor', (await api('DELETE', `/api/webhooks/${deadId}`, { token: admin })).status === 204);
  await api('DELETE', `/api/webhooks/${deadId2}`, { token: admin });
  ok('silinen webhook artık listede yok', !(await api('GET', '/api/webhooks', { token: admin })).data.find(w => w.id === webhookId));

  server.close();

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exitCode = fail ? 1 : 0; // process.exit() Windows'ta fetch handle'larıyla nadir bir libuv crash'ine yol açabiliyor
})();
