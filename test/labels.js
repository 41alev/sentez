/**
 * Barkod etiketi (ZPL) testleri.
 *
 * Kapsam: server/lib/zpl.js'in ürettiği komut yapısı + /api/labels
 * rotalarının gerçek davranışı. Fiziksel bir Zebra yazıcı bu ortamda yok;
 * bu yüzden "ağ yazıcısına gönderim" testleri BAĞLANTI HATASININ AÇIKÇA
 * raporlandığını doğrular — "sessizce başarılı" sanılmasın diye bu, asıl
 * kontrol edilmesi gereken şey (bkz. server/routes/labels.js'teki uyarı).
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/labels.js
 */
const { buildLabelZpl } = require('../server/lib/zpl');

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
  let d;
  try { d = await r.json(); } catch { d = null; }
  return { status: r.status, data: d };
}

async function apiText(method, p, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

(async () => {
  console.log('\n=== ZPL ÜRETİCİ / ZPL GENERATOR ===');
  const zpl = buildLabelZpl({
    title: 'Ahşap Palet 120x80', code: 'PL-120', barcodeData: '8690123456811',
    lines: [{ label: 'Birim', value: 'adet' }]
  });
  ok('etiket ^XA ile başlıyor', zpl.startsWith('^XA'));
  ok('etiket ^XZ ile bitiyor', zpl.trim().endsWith('^XZ'));
  ok('UTF-8 komutu var (Türkçe karakterler için)', zpl.includes('^CI28'));
  ok('Code128 barkod komutu var', /\^BCN,/.test(zpl));
  ok('barkod verisi alanda geçiyor', zpl.includes('^FD8690123456811^FS'));
  ok('başlık metni geçiyor', zpl.includes('Ahşap Palet 120x80'));
  ok('ürün kodu geçiyor', zpl.includes('PL-120'));
  ok('ek satır geçiyor', zpl.includes('Birim: adet'));
  ok('varsayılan tek kopya (^PQ1)', zpl.includes('^PQ1'));

  const zpl3 = buildLabelZpl({ title: 'X', barcodeData: '123', copies: 3 });
  ok('kopya sayısı ^PQ komutuna yansıyor', zpl3.includes('^PQ3'));

  ok('^ karakteri alan verisinde kaçışlanıyor', buildLabelZpl({ title: 'A^B', barcodeData: '1' }).includes('A\\5EB'));
  ok('barkod verisi olmadan hata verir (sessizce boş etiket basmaz)',
    (() => { try { buildLabelZpl({ title: 'X' }); return false; } catch { return true; } })());

  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('\n=== ZPL ÖNİZLEME/İNDİRME / ZPL PREVIEW-DOWNLOAD ===');
  const items = await api('GET', '/api/items?pageSize=1', { token: admin });
  const itemId = items.data.data[0].id;
  const lots = await api('GET', '/api/stock/lots?pageSize=1', { token: admin });
  const lotId = lots.data.data[0].id;

  const itemZpl = await apiText('GET', `/api/labels/item/${itemId}/zpl`, { token: admin });
  ok('ürün etiketi indirilebiliyor', itemZpl.status === 200);
  ok('doğru içerik tipi (text/plain)', (itemZpl.headers.get('content-type') || '').includes('text/plain'));
  ok('indirilen dosya gerçek ZPL komutu içeriyor', itemZpl.text.includes('^XA') && itemZpl.text.includes('^BCN,'));

  const lotZpl = await apiText('GET', `/api/labels/lot/${lotId}/zpl`, { token: admin });
  ok('parti etiketi indirilebiliyor', lotZpl.status === 200);
  ok('parti etiketinde parti verisi var', lotZpl.text.includes('^XA'));

  ok('görüntüleyici de önizleme indirebiliyor (salt-okunur, zararsız)',
    (await apiText('GET', `/api/labels/item/${itemId}/zpl`, { token: viewer })).status === 200);

  ok('olmayan ürün için 404', (await apiText('GET', '/api/labels/item/yok-boyle-bir-id/zpl', { token: admin })).status === 404);

  console.log('\n=== AĞ YAZICISINA GÖNDERİM / NETWORK PRINT ===');
  // Yazıcı henüz ayarlanmamışken açıkça reddedilmeli — "gönderildi" denip
  // hiçbir şeyin basılmamış olması operatörü yanıltır.
  await api('PUT', '/api/settings', { token: admin, body: { labelPrinterIp: '' } });
  const noPrinter = await api('POST', '/api/labels/print', { token: admin, body: { type: 'item', id: itemId } });
  ok('yazıcı ayarlanmamışken açık hata (400)', noPrinter.status === 400, JSON.stringify(noPrinter.data));

  ok('görüntüleyici yazdıramıyor (403)',
    (await api('POST', '/api/labels/print', { token: viewer, body: { type: 'item', id: itemId } })).status === 403);

  // Ulaşılamayan bir IP: bağlantı reddi ya da zaman aşımı — HER İKİSİ DE
  // "başarısız" olarak dönmeli, asla sessiz başarı değil.
  await api('PUT', '/api/settings', { token: admin, body: { labelPrinterIp: '127.0.0.1', labelPrinterPort: 9999 } });
  const unreachable = await api('POST', '/api/labels/print', { token: admin, body: { type: 'item', id: itemId } });
  ok('ulaşılamayan yazıcı için açık hata (502)', unreachable.status === 502, JSON.stringify(unreachable.data));
  ok('hata mesajı yazdırma başarısızlığını açıklıyor', /[Yy]az[ıi]c[ıi]/.test((unreachable.data && unreachable.data.error) || ''));

  await api('PUT', '/api/settings', { token: admin, body: { labelPrinterIp: '' } }); // testten kalıntı bırakma

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})();
