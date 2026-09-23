// Batch 4a — KVKK kalıntı taraması, dokümanlar, arama, webhook, etiket, bildirim, şablon/firma kimliği
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { start, api, ok, snap, check, info, statusIn, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');

(async () => {
  await start({ WEBHOOK_RETRY_BASE_MS: '50', WEBHOOK_ALLOW_PRIVATE: '1' });
  const db = state.db;
  const whs = db.prepare('SELECT id FROM warehouses ORDER BY id').all().map(w => w.id);
  const sups = db.prepare('SELECT id FROM suppliers WHERE is_approved=1 ORDER BY id').all().map(s => s.id);

  // ------------------------------------------------ KVKK
  console.log('\n[KVKK] anonimleştirme kalıntı taraması (tüm tablolar/sütunlar)');
  const scan = tokens => {
    const found = {};
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
      for (const c of cols) for (const tok of tokens) {
        let n = 0; try { n = db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE CAST("${c}" AS TEXT) LIKE ?`).get('%' + tok + '%').n; } catch {}
        if (n) (found[`${t}.${c}`] = found[`${t}.${c}`] || []).push(`${tok}×${n}`);
      }
    }
    return found;
  };
  await check('KV-01', 'müşteri anonimleştirilince kimlik bilgisi hiçbir tabloda kalmamalı (F21)', async () => {
    const T = { name: 'KvkkFirmaXyz', person: 'Ayse KvkkKisi', phone: '+90 555 111 22 33', email: 'kvkk.kisi@example.org', addr: 'KvkkSokak 42 Kadikoy', tax: '99887766554' };
    const c = await ok('POST', '/sales/customers', { name: T.name, contactPerson: T.person, phone: T.phone, email: T.email, address: T.addr, taxNo: T.tax });
    const it = await ok('POST', '/items', { name: 'kvkk-urun', openingQty: 10 });
    const so = await ok('POST', '/sales/orders', { customerId: c.id, lines: [{ itemId: it.id, qty: 2, price: 5 }] });
    await ok('POST', '/sales/shipments', { soId: so.id, destination: T.addr, items: [{ itemId: it.id, qty: 1 }] });
    await ok('POST', '/crm/opportunities', { customerId: c.id, customerName: T.name, contactPerson: T.person, phone: T.phone, email: T.email });
    await ok('POST', '/support', { customerId: c.id, customerName: T.name, subject: 'Sorun ' + T.name, description: T.person + ' aradı' });
    await ok('POST', '/visits', { customerId: c.id, visitDate: '2026-09-01', notes: T.person + ' ile görüşüldü' });
    const tokens = [T.name, T.person, T.phone, T.email, T.addr, T.tax];
    const before = scan(tokens);
    await ok('POST', `/sales/customers/${c.id}/anonymize`, {});
    const after = scan(tokens);
    info('KV-01b', 'anonimleştirme sonrası kimlik kalıntısı olan tablo.sütunlar', after);
    assert.equal(Object.keys(after).length, 0, 'kalıntı: ' + Object.entries(after).map(([k, v]) => `${k} [${v.join(',')}]`).join(' | '));
  });
  await check('KV-02', 'tedarikçi anonimleştirilince kimlik bilgisi kalmamalı', async () => {
    const T = { name: 'KvkkTedarikciAbc', person: 'Mehmet KvkkT', email: 'kvkk.ted@example.org', bank: 'TR99 0001 KVKKBANK' };
    const s = await ok('POST', '/purchasing/suppliers', { name: T.name, contactPerson: T.person, email: T.email, bankInfo: T.bank, isApproved: true });
    const it = await ok('POST', '/items', { name: 'kvkk-urun2' });
    const p = await ok('POST', '/purchasing/orders', { supplierId: s.id, warehouseId: whs[0], items: [{ itemId: it.id, qty: 1, price: 1 }] });
    const tokens = [T.name, T.person, T.email, T.bank];
    await ok('POST', `/purchasing/suppliers/${s.id}/anonymize`, {});
    const after = scan(tokens); info('KV-02b', 'tedarikçi kalıntıları', after);
    assert.equal(Object.keys(after).length, 0, 'kalıntı: ' + Object.entries(after).map(([k, v]) => `${k} [${v.join(',')}]`).join(' | '));
  });
  await check('KV-03', 'kullanıcı anonimleştirilince kullanıcı adı/ad/e-posta hiçbir tabloda kalmamalı', async () => {
    const T = { u: 'kvkkuserxyz', full: 'Fatma KvkkUser', email: 'kvkk.user@example.org' };
    const u = await ok('POST', '/users', { username: T.u, password: 'Kvkk12345!', role: 'operator', fullName: T.full, email: T.email, mustChangePassword: false });
    const tok = (await api('POST', '/auth/login', { username: T.u, password: 'Kvkk12345!' }, null)).data.token;
    await api('POST', '/warehouses', { name: 'W-' + T.u }, null, { token: tok });
    await ok('POST', `/users/${u.id}/anonymize`, {});
    const after = scan([T.u, T.full, T.email]); info('KV-03b', 'kullanıcı kalıntıları', after);
    assert.equal(Object.keys(after).length, 0, 'kalıntı: ' + Object.entries(after).map(([k, v]) => `${k} [${v.join(',')}]`).join(' | '));
  });
  await check('KV-04', 'veri dışa aktarım (m.11/b) yalnız ilgili kişiye ait veriyi içerir ve yönetici dışı erişemez', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'ExportKisi' });
    const ex = await ok('GET', `/sales/customers/${c.id}/data-export`);
    assert.equal(ex.subjectType, 'customer'); assert.equal(ex.personalData.name, 'ExportKisi');
    for (const who of ['viewer', 'operator', 'manager']) statusIn(await api('GET', `/sales/customers/${c.id}/data-export`, undefined, who), [403]);
  });
  await check('KV-05', 'anonimleştirme geri alınamaz/tekrarlanamaz: ikinci çağrı 409; anonim kayıt düzenlenemez', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'IkiKez' }); await ok('POST', `/sales/customers/${c.id}/anonymize`, {});
    statusIn(await api('POST', `/sales/customers/${c.id}/anonymize`, {}), [409]);
    const r = await api('PUT', `/sales/customers/${c.id}`, { name: 'Geri Geldi', email: 'a@b.co' });
    info('KV-05b', 'anonim müşteriyi düzenle', { status: r.status });
    assert(r.status >= 400, 'anonimleştirilmiş kayıt yeniden kişisel veriyle doldurulabildi');
  });

  // ------------------------------------------------ DOKÜMAN
  console.log('\n[DOC] doküman');
  const upload = async (name, mime, content, fields = {}, who = 'admin', endpoint = '/documents') => {
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([content], { type: mime }), name);
    if (!state.tokens[who]) await api('GET', '/items', undefined, who);
    const r = await fetch(state.base + '/api' + endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + state.tokens[who] }, body: fd });
    let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d };
  };
  await check('DOC-01', 'yükleme: izinli tür 201 ve aynı içerikle iner; izinsiz tür 415; 21MB 413; boş gövde', async () => {
    const good = await upload('a.txt', 'text/plain', 'merhaba dünya', { title: 'Test', docNo: 'D-1' }); statusIn(good, [201]);
    const dl = await fetch(state.base + good.data.downloadUrl, { headers: { Authorization: 'Bearer ' + state.tokens.admin } });
    assert.equal(await dl.text(), 'merhaba dünya'); assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
    statusIn(await upload('x.html', 'text/html', '<script>1</script>', { title: 'html' }), [415]);
    statusIn(await upload('x.exe', 'application/x-msdownload', 'MZ', { title: 'exe' }), [415]);
    statusIn(await upload('big.txt', 'text/plain', Buffer.alloc(21 * 1024 * 1024, 65), { title: 'big' }), [413]);
  });
  await check('DOC-02', 'içerik doğrulaması: MIME beyanı sahte (png diye html) — kabul mü (bilgi); indirme başlıkları güvenli mi', async () => {
    const r = await upload('evil.png', 'image/png', '<html><script>alert(1)</script></html>', { title: 'spoof' });
    info('DOC-02b', "png diye yüklenen HTML", { status: r.status });
    if (r.status === 201) { const dl = await fetch(state.base + r.data.downloadUrl, { headers: { Authorization: 'Bearer ' + state.tokens.admin } }); info('DOC-02c', 'indirme', { ct: dl.headers.get('content-type'), cd: dl.headers.get('content-disposition'), nosniff: dl.headers.get('x-content-type-options') }); }
  });
  await check('DOC-03', 'revizyon zinciri: aynı belgeden iki kez revize edilince tek güncel sürüm kalmalı', async () => {
    const d = (await upload('r.txt', 'text/plain', 'v1', { title: 'Rev', docNo: 'REV-1', isControlled: 'true' })).data;
    const r2 = await upload('r2.txt', 'text/plain', 'v2', {}, 'admin', `/documents/${d.id}/revise`); statusIn(r2, [201]);
    const r3 = await upload('r3.txt', 'text/plain', 'v2b', {}, 'admin', `/documents/${d.id}/revise`);
    const current = db.prepare("SELECT id,revision,superseded_by FROM documents WHERE doc_no='REV-1' AND superseded_by IS NULL").all();
    info('DOC-03b', 'REV-1 için güncel (superseded_by boş) belge sayısı', { r3: r3.status, guncel: current.length, ayrinti: db.prepare("SELECT id,revision,superseded_by FROM documents WHERE doc_no='REV-1' ORDER BY id").all() });
    assert.equal(current.length, 1, `aynı belge no için ${current.length} güncel sürüm var (zincir dallandı)`);
  });
  await check('DOC-04', 'silinen belgenin dosyası diskte kalmamalı; kontrollü belge silinemez', async () => {
    const d = (await upload('del.txt', 'text/plain', 'silinecek', { title: 'Silinecek' })).data;
    const file = db.prepare('SELECT file_path FROM documents WHERE id=?').get(d.id).file_path;
    const dir = path.join(process.env.DATA_DIR, 'uploads');
    statusIn(await api('DELETE', '/documents/' + d.id), [204]);
    const still = fs.existsSync(path.join(dir, file));
    info('DOC-04b', 'silme sonrası dosya diskte mi', { still });
    const c = (await upload('c.txt', 'text/plain', 'kontrollü', { title: 'K', isControlled: '1' })).data;
    statusIn(await api('DELETE', '/documents/' + c.id), [400]);
    assert.equal(still, false, 'silinen belgenin dosyası diskte yetim kaldı');
  });
  await check('DOC-05', 'yol/kimlik: yol geçişi (../), olmayan id, viewer yükleyemez', async () => {
    statusIn(await api('GET', '/documents/..%2F..%2Fetc%2Fpasswd/download'), [404]);
    statusIn(await upload('v.txt', 'text/plain', 'x', { title: 'v' }, 'viewer'), [403]);
  });

  // ------------------------------------------------ ARAMA
  console.log('\n[SEARCH] genel arama');
  await check('SE-01', 'LIKE joker karakterleri: % ve _ tam eşleşme gibi davranmalı; pasif kayıtlar', async () => {
    await ok('POST', '/items', { name: 'Ürün A_1' }); await ok('POST', '/items', { name: 'Ürün AB1' });
    const r = await ok('GET', '/search?q=' + encodeURIComponent('A_1'));
    const names = r.items.map(i => i.label);
    info('SE-01b', "'A_1' araması", names);
    const p = await ok('GET', '/search?q=' + encodeURIComponent('%%'));
    info('SE-01c', "'%%' araması", { items: p.items.length, customers: p.customers.length });
    assert(!names.includes('Ürün AB1'), "'_' joker olarak davrandı: 'A_1' araması 'AB1'i buldu");
  });
  await check('SE-02', 'pasif/anonim müşteri arama sonuçlarında görünmemeli', async () => {
    const c = await ok('POST', '/sales/customers', { name: 'PasifAramaTest' }); await ok('DELETE', '/sales/customers/' + c.id);
    const r = await ok('GET', '/search?q=PasifAramaTest'); info('SE-02b', 'pasif müşteri arandı', { bulundu: r.customers.length });
    assert.equal(r.customers.length, 0, 'pasif müşteri aramada görünüyor');
  });
  await check('SE-03', 'arama: 1 karakter boş, 10.000 karakter/özel karakter 500 vermez; yetkisiz 401', async () => {
    assert.equal((await ok('GET', '/search?q=a')).items.length, 0);
    for (const q of ["'", '"', '\\', '%', 'x'.repeat(10000), ' ab', '%00']) assert((await api('GET', '/search?q=' + encodeURIComponent(q))).status < 500, q.slice(0, 10));
    assert.equal((await api('GET', '/search?q=abc', undefined, null)).status, 401);
  });

  // ------------------------------------------------ WEBHOOK
  console.log('\n[WEBHOOK] webhook');
  const received = []; let respondWith = 200;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { received.push({ headers: req.headers, body: b, url: req.url }); res.statusCode = respondWith; res.end('x'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', () => r(undefined)));
  const address = srv.address();
  if (!address || typeof address === 'string') throw new Error('Webhook test listener did not bind TCP');
  const hookUrl = 'http://127.0.0.1:' + address.port + '/hook';
  const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  await check('WH-01', 'olay teslimatı: imza (HMAC-SHA256) doğru, başlıklar ve gövde biçimi', async () => {
    const w = await ok('POST', '/webhooks', { url: hookUrl, events: ['sales_order.created'] }); assert(w.secret);
    const cust = (await api('GET', '/sales/customers')).data.data[0].id; const it = await ok('POST', '/items', { name: 'wh-item', openingQty: 5 });
    await ok('POST', '/sales/orders', { customerId: cust, lines: [{ itemId: it.id, qty: 1, price: 1 }] });
    assert(await waitFor(() => received.length >= 1), 'webhook teslim edilmedi');
    const r = received[0]; const sig = 'sha256=' + crypto.createHmac('sha256', w.secret).update(r.body).digest('hex');
    assert.equal(r.headers['x-webhook-signature'], sig); assert.equal(r.headers['x-webhook-event'], 'sales_order.created');
    assert.equal(JSON.parse(r.body).event, 'sales_order.created');
    assert.equal((await ok('GET', '/webhooks'))[0].secret, undefined, 'secret listede sızıyor');
  });
  await check('WH-02', 'olaylar: yalnız abone olunan olay gider; pasif webhook gitmez', async () => {
    received.length = 0; const it = await ok('POST', '/items', { name: 'wh-item2', openingQty: 5 }); const cust = (await api('GET', '/sales/customers')).data.data[0].id;
    await ok('POST', '/sales/shipments', { customerId: cust, destination: 'x', items: [{ itemId: it.id, qty: 1 }] });
    await new Promise(r => setTimeout(r, 400));
    assert.equal(received.filter(r => r.headers['x-webhook-event'] === 'shipment.created').length, 0, 'abone olunmayan olay gönderildi');
    const hooks = await ok('GET', '/webhooks'); await ok('PUT', '/webhooks/' + hooks[0].id, { isActive: false });
    received.length = 0; await ok('POST', '/sales/orders', { customerId: cust, lines: [{ itemId: it.id, qty: 1, price: 1 }] }); await new Promise(r => setTimeout(r, 400));
    assert.equal(received.length, 0, 'pasif webhook teslimat aldı');
    await ok('PUT', '/webhooks/' + hooks[0].id, { isActive: true });
  });
  await check('WH-03', 'başarısız teslimat: hata kaydedilir, otomatik yeniden deneme sınırlıdır (dead-letter)', async () => {
    respondWith = 500; received.length = 0;
    const cust = (await api('GET', '/sales/customers')).data.data[0].id; const it = await ok('POST', '/items', { name: 'wh-item3', openingQty: 5 });
    await ok('POST', '/sales/orders', { customerId: cust, lines: [{ itemId: it.id, qty: 1, price: 1 }] });
    await waitFor(() => received.length >= 1);
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 120)); await api('POST', '/webhooks/process-retry-queue', {}); }
    const rows = db.prepare('SELECT success,retry_count,next_retry_at FROM webhook_deliveries ORDER BY attempted_at DESC').all();
    const failed = rows.filter(r => !r.success);
    info('WH-03b', 'başarısız teslimat kayıtları', { toplamKayit: rows.length, basarisiz: failed.length, alinan: received.length, sonrakiDenemeBekleyen: failed.filter(r => r.next_retry_at).length });
    assert(failed.length >= 1); assert(received.length <= 8, 'sınırsız yeniden deneme: ' + received.length);
    respondWith = 200;
  });
  await check('WH-04', 'SSRF: iç ağ/loopback/link-local ve garip şemalar hedef olarak kabul ediliyor mu (yalnız admin)', async () => {
    const res = {};
    for (const u of ['http://127.0.0.1:1/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost/x', 'file:///etc/passwd', 'ftp://x/y', 'javascript:alert(1)', 'http://[::1]/x'])
      res[u] = (await api('POST', '/webhooks', { url: u, events: ['sales_order.created'] })).status;
    info('WH-04b', 'webhook hedef URL kabul durumu', res);
  });
  await check('WH-05', 'webhook yönetimi yalnız admin; secret yenileme eskiyi geçersiz kılar', async () => {
    for (const who of ['manager', 'operator']) statusIn(await api('GET', '/webhooks', undefined, who), [403]);
    const hooks = await ok('GET', '/webhooks'); const s1 = (await ok('POST', `/webhooks/${hooks[0].id}/regenerate-secret`, {})).secret;
    const s2 = (await ok('POST', `/webhooks/${hooks[0].id}/regenerate-secret`, {})).secret; assert.notEqual(s1, s2);
  });
  srv.close();

  // ------------------------------------------------ ETİKET
  console.log('\n[LABEL] etiket (ZPL)');
  await check('LB-01', 'ZPL: ürün adındaki ^ ve ~ komut karakterleri etikete komut enjekte edemez', async () => {
    const it = await ok('POST', '/items', { name: 'Vida^FO0,0^FDHACK^FS~JA', code: 'ZPL^1', barcode: '123' });
    const r = await fetch(state.base + `/api/labels/item/${it.id}/zpl`, { headers: { Authorization: 'Bearer ' + state.tokens.admin } }); const z = await r.text();
    info('LB-01b', 'ZPL çıktısı (ilk 400 karakter)', z.slice(0, 400));
    assert.equal((z.match(/\^XA/g) || []).length, 1); assert(!/\^FDHACK/.test(z), 'enjekte edilen ^FD komutu çıktıda');
    assert(!/~JA/.test(z), 'enjekte edilen ~ komutu çıktıda');
  });
  await check('LB-02', 'etiket: olmayan ürün/lot 404; yazdırma ucu geçersiz IP/port ile 500 vermez', async () => {
    statusIn(await api('GET', '/labels/item/nope/zpl'), [404]); statusIn(await api('GET', '/labels/lot/nope/zpl'), [404]);
    const r = await api('POST', '/labels/print', { itemId: 'nope' }); info('LB-02b', 'print olmayan ürün', { status: r.status }); assert(r.status < 500);
  });

  // ------------------------------------------------ BİLDİRİM
  console.log('\n[NOTIF] bildirim');
  await check('NT-01', 'bildirim taraması: ikinci tarama aynı uyarıyı tekrar üretmez; okundu durumu kullanıcıya özgü mü', async () => {
    await ok('POST', '/items', { name: 'notif-low', minStock: 50, openingQty: 1 });
    await ok('POST', '/notifications/scan', {}); const n1 = db.prepare('SELECT COUNT(*) c FROM notifications').get().c;
    await ok('POST', '/notifications/scan', {}); const n2 = db.prepare('SELECT COUNT(*) c FROM notifications').get().c;
    info('NT-01b', 'tarama sonuçları', { ilk: n1, ikinci: n2 });
    assert.equal(n2, n1, 'ikinci tarama tekrar bildirim üretti');
    const before = (await ok('GET', '/notifications')); const unread = (before.unread ?? (before.data || before).filter?.(x => !x.isRead).length);
    await api('POST', '/notifications/read-all', {}, 'viewer');
    const after = (await ok('GET', '/notifications')); const unread2 = (after.unread ?? (after.data || after).filter?.(x => !x.isRead).length);
    info('NT-01c', 'viewer "tümünü oku" sonrası admin okunmamış sayısı', { once: unread, sonra: unread2 });
  });

  // ------------------------------------------------ ŞABLON / FİRMA KİMLİĞİ
  console.log('\n[TEMPLATE] şablon ve firma kimliği');
  await check('TP-01', 'firma kimliği kısmi güncelleme: gönderilmeyen alanlar korunur; boş ad reddedilir', async () => {
    await ok('PUT', '/templates/branding/current', { name: 'Kimlik A.Ş.', taxOffice: 'Kadıköy', taxNo: '123', address: 'Adres 1', phone: '0212', mersisNo: 'M1', tradeRegistryNo: 'T1' });
    await ok('PUT', '/templates/branding/current', { city: 'İstanbul' });
    const b = await ok('GET', '/templates/branding/current');
    assert.equal(b.name, 'Kimlik A.Ş.'); assert.equal(b.taxOffice, 'Kadıköy'); assert.equal(b.address, 'Adres 1'); assert.equal(b.mersisNo, 'M1'); assert.equal(b.city, 'İstanbul');
    const e = await api('PUT', '/templates/branding/current', { name: '' }); const b2 = await ok('GET', '/templates/branding/current');
    info('TP-01b', "name='' gönderildi", { status: e.status, ad: b2.name });
    assert(e.status >= 400 || b2.name === 'Kimlik A.Ş.', 'firma adı boşa çekilebiliyor (yazdırma başlığı boş kalır)');
  });
  await check('TP-02', 'logo: PNG kabul; 513KB 413; yanlış tür 415; SVG içinde script saklanabiliyor mu (bilgi)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const wrongField = await upload('l.png', 'image/png', png, {}, 'admin', '/templates/branding/logo');
    info('TP-02a', "logo ucuna yanlış alan adıyla ('file') yükleme", { status: wrongField.status });
    const wrongFieldStatus = wrongField.status;
    const fd = new FormData(); fd.append('logo', new Blob([png], { type: 'image/png' }), 'l.png');
    const ok1 = await fetch(state.base + '/api/templates/branding/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + state.tokens.admin }, body: fd }); assert.equal(ok1.status, 201);
    const big = new FormData(); big.append('logo', new Blob([Buffer.alloc(513 * 1024, 1)], { type: 'image/png' }), 'b.png');
    assert.equal((await fetch(state.base + '/api/templates/branding/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + state.tokens.admin }, body: big })).status, 413);
    const bad = new FormData(); bad.append('logo', new Blob(['x'], { type: 'text/html' }), 'b.html');
    assert.equal((await fetch(state.base + '/api/templates/branding/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + state.tokens.admin }, body: bad })).status, 415);
    const svg = new FormData(); svg.append('logo', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 's.svg');
    info('TP-02b', 'script içeren SVG logo', { status: (await fetch(state.base + '/api/templates/branding/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + state.tokens.admin }, body: svg })).status });
    assert(wrongFieldStatus < 500, `beklenmeyen multipart alanı ${wrongFieldStatus} döndü (400 beklenirdi)`);
  });
  await check('TP-03', 'şablon: kısmi güncelleme diğer alanları korur; geçersiz değerler reddedilir; sıfırlama çalışır', async () => {
    const t0 = await ok('GET', '/templates/shipment'); await ok('PUT', '/templates/shipment', { headerText: 'Üst not' });
    const t1 = await ok('GET', '/templates/shipment'); assert.deepEqual(t1.fields, t0.fields); assert.deepEqual(t1.layout, t0.layout); assert.equal(t1.headerText, 'Üst not');
    for (const b of [{ layout: { accentColor: 'red' } }, { layout: { fontSize: 99 } }, { layout: { paperSize: 'A3' } }, { signatures: ['1', '2', '3', '4', '5'] }]) statusIn(await api('PUT', '/templates/shipment', b), [400, 422]);
    await ok('POST', '/templates/shipment/reset', {}); assert.equal((await ok('GET', '/templates/shipment')).headerText, null);
    statusIn(await api('GET', '/templates/nonexistent'), [404]);
  });

  await finish('b4a-misc');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
