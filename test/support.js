// @ts-nocheck
/**
 * Müşteri destek/talep (ticket) testleri.
 *
 * En değerli kontroller: (1) durum geçiş kuralları gerçekten uygulanıyor mu
 * (çözüldü işaretlemek için açıklama zorunlu, kapanmış talep yeniden
 * açılamıyor), (2) "uygunsuzluğa dönüştür" GERÇEKTEN bir NCR kaydı
 * oluşturuyor mu ve doğru müşteri/şiddet bilgisini taşıyor mu, (3) yalnızca
 * şikayet kategorisindeki ve müşterisi kayıtlı talepler dönüştürülebiliyor mu,
 * (4) aynı talep ikinci kez dönüştürülemiyor mu (idempotency).
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/support.js
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
  const manager = await login('mudur', 'Mudur123!');
  const viewer = await login('viewer', 'Viewer123!');

  const customers = await api('GET', '/api/sales/customers?pageSize=1', { token: admin });
  const custId = customers.data.data[0].id;
  const custName = customers.data.data[0].name;
  const items = await api('GET', '/api/items?pageSize=1', { token: admin });
  const itemId = items.data.data[0].id;

  console.log('\n=== YETKİ / PERMISSIONS ===');
  ok('görüntüleyici talep oluşturamıyor (403)',
    (await api('POST', '/api/support', { token: viewer, body: { customerName: 'X', subject: 'Y' } })).status === 403);
  ok('görüntüleyici listeyi görebiliyor', (await api('GET', '/api/support', { token: viewer })).status === 200);

  console.log('\n=== OLUŞTURMA / CREATE ===');
  const bad = await api('POST', '/api/support', { token: admin, body: { customerName: 'X' } });
  ok('konu (subject) zorunlu (422)', bad.status === 422, `got ${bad.status}`);

  const created = await api('POST', '/api/support', {
    token: admin, body: {
      customerId: custId, customerName: custName, subject: 'Ürün geç geldi',
      description: 'Sipariş 3 gün gecikmeli teslim edildi', category: 'complaint', priority: 'high'
    }
  });
  ok('talep oluşturuldu', created.status === 201, `got ${created.status} ${JSON.stringify(created.data).slice(0, 160)}`);
  const t1 = created.data;
  ok('talep numarası DST formatında', /^DST-\d{4}-\d{3}$/.test(t1.ticketNo), t1.ticketNo);
  ok('talep açık durumda başlıyor', t1.status === 'open', t1.status);
  ok('öncelik doğru kaydedildi', t1.priority === 'high', t1.priority);

  const notFoundCustomer = await api('POST', '/api/support', {
    token: admin, body: { customerId: 999999, customerName: 'Yok', subject: 'Test' }
  });
  ok('var olmayan müşteri reddediliyor (404)', notFoundCustomer.status === 404, `got ${notFoundCustomer.status}`);

  console.log('\n=== LİSTE / FİLTRE ===');
  const list = await api('GET', '/api/support?category=complaint&pageSize=50', { token: admin });
  ok('liste sayfalanıyor', list.status === 200 && Array.isArray(list.data.data));
  ok('en az bir şikayet listeleniyor', list.data.data.some(x => x.id === t1.id));
  const urgentFirst = await api('GET', '/api/support?pageSize=50', { token: admin });
  const priorities = urgentFirst.data.data.map(x => x.priority);
  const order = { urgent: 0, high: 1, normal: 2, low: 3 };
  ok('sonuçlar önceliğe göre sıralı (acil önce)',
    priorities.every((p, i) => i === 0 || order[priorities[i - 1]] <= order[p]), JSON.stringify(priorities));

  console.log('\n=== GÜNCELLEME / UPDATE ===');
  const upd = await api('PUT', `/api/support/${t1.id}`, { token: manager, body: { priority: 'urgent' } });
  ok('talep güncellendi', upd.status === 200 && upd.data.priority === 'urgent', JSON.stringify(upd.data));

  console.log('\n=== YORUM / COMMENTS ===');
  const c1 = await api('POST', `/api/support/${t1.id}/comments`, { token: manager, body: { comment: 'Müşteriyle görüşüldü, kargo firmasına soruldu.' } });
  ok('yorum eklendi', c1.status === 201 && !!c1.data.username, JSON.stringify(c1.data));
  const detail = await api('GET', `/api/support/${t1.id}`, { token: admin });
  ok('yorum talep detayında görünüyor', detail.data.comments.length === 1, JSON.stringify(detail.data.comments));

  console.log('\n=== DURUM GEÇİŞİ / STATUS TRANSITIONS ===');
  const noResolution = await api('POST', `/api/support/${t1.id}/status`, { token: manager, body: { status: 'resolved' } });
  ok('çözüldü işaretlemek için açıklama zorunlu (422)', noResolution.status === 422, `got ${noResolution.status}`);

  const resolved = await api('POST', `/api/support/${t1.id}/status`, {
    token: manager, body: { status: 'resolved', resolution: 'Kargo firması iade yaptı, müşteriye telafi kredisi tanımlandı.' }
  });
  ok('talep çözüldü olarak işaretlendi', resolved.status === 200 && resolved.data.status === 'resolved', JSON.stringify(resolved.data));
  ok('çözüm zamanı damgalandı', !!resolved.data.resolvedAt);

  const closed = await api('POST', `/api/support/${t1.id}/status`, { token: manager, body: { status: 'closed' } });
  ok('talep kapatıldı', closed.status === 200 && closed.data.status === 'closed');

  const reopen = await api('POST', `/api/support/${t1.id}/status`, { token: manager, body: { status: 'open' } });
  ok('kapanmış talep yeniden açılamıyor (409)', reopen.status === 409, `got ${reopen.status}`);
  const editClosed = await api('PUT', `/api/support/${t1.id}`, { token: manager, body: { subject: 'x' } });
  ok('kapanmış talep düzenlenemiyor (409)', editClosed.status === 409, `got ${editClosed.status}`);

  console.log('\n=== UYGUNSUZLUĞA DÖNÜŞTÜRME / CONVERT TO NCR ===');
  const t2 = (await api('POST', '/api/support', {
    token: admin, body: { customerId: custId, customerName: custName, subject: 'Ürün kusurlu geldi', category: 'complaint' }
  })).data;

  const t3Question = (await api('POST', '/api/support', {
    token: admin, body: { customerId: custId, customerName: custName, subject: 'Fatura sorusu', category: 'question' }
  })).data;
  const wrongCategory = await api('POST', `/api/support/${t3Question.id}/to-ncr`, { token: manager, body: {} });
  ok('sadece şikayet kategorisi uygunsuzluğa dönüştürülebiliyor (409)', wrongCategory.status === 409, `got ${wrongCategory.status}`);

  const noCustomer = (await api('POST', '/api/support', {
    token: admin, body: { customerName: 'Kaydı olmayan müşteri', subject: 'Kusurlu ürün', category: 'complaint' }
  })).data;
  const noCustomerConvert = await api('POST', `/api/support/${noCustomer.id}/to-ncr`, { token: manager, body: {} });
  ok('kayıtlı müşterisi olmayan talep dönüştürülemiyor (422)', noCustomerConvert.status === 422, `got ${noCustomerConvert.status}`);

  const convert = await api('POST', `/api/support/${t2.id}/to-ncr`, { token: manager, body: { itemId, severity: 'major', qtyAffected: 5 } });
  ok('uygunsuzluğa dönüştürüldü', convert.status === 201 && /^UYG-\d{4}-\d{3}$/.test(convert.data.ncrNo), JSON.stringify(convert.data));

  const ncrList = await api('GET', `/api/quality/ncrs?pageSize=100`, { token: admin });
  const ncr = ncrList.data.data.find(n => n.id === convert.data.ncrId);
  ok('NCR gerçekten oluştu ve doğru müşteriyi taşıyor', !!ncr && ncr.customerId === custId, JSON.stringify(ncr).slice(0, 200));
  ok('NCR kaynağı "customer"', ncr?.source === 'customer', ncr?.source);
  ok('NCR şiddeti doğru aktarıldı', ncr?.severity === 'major', ncr?.severity);

  const t2after = await api('GET', `/api/support/${t2.id}`, { token: admin });
  ok('talepte oluşan NCR referansı görünüyor', t2after.data.resultingNcrId === convert.data.ncrId, JSON.stringify(t2after.data));

  const doubleConvert = await api('POST', `/api/support/${t2.id}/to-ncr`, { token: manager, body: {} });
  ok('aynı talep ikinci kez dönüştürülemiyor (409)', doubleConvert.status === 409, `got ${doubleConvert.status}`);

  console.log('\n=== İZ KAYDI / AUDIT TRAIL ===');
  const audit = await api('GET', `/api/audit?entityType=support_ticket&pageSize=20`, { token: admin });
  ok('denetim kaydına yazıldı', audit.data.data.length >= 3, `${audit.data.data.length} kayıt`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
