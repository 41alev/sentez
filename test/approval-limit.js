// @ts-nocheck
/**
 * Onay limiti sınır durumu: approval_rules eşiği ("₺100.000 üstü Müdür onaylar")
 * ile onaylayan KULLANICININ KENDİ approval_limit'i (server/routes/purchasing.js
 * router.post('/orders/:id/approve') içindeki approver.approval_limit kontrolü)
 * iki ayrı kuraldır. Bir sipariş approval_rules'a göre "Müdür onaylayabilir"
 * eşiğinde olsa bile, o siparişin tutarı o Müdür'ün KİŞİSEL limitini aşıyorsa
 * onay reddedilmelidir — rol yeterli olması TEK BAŞINA yeterli değildir.
 * Bu test tam bu sınırı (Müdür limiti ₺250.000, sipariş ₺300.000) kanıtlar.
 *
 * Run: node test/approval-limit.js  (sunucu ayakta olmalı)
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';
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
  console.log('\n=== ONAY LİMİTİ SINIR DURUMU / APPROVAL LIMIT BOUNDARY ===');

  const admin = await login('admin', 'Admin123!');
  const mudur = await login('mudur', 'Mudur123!');

  const items = await api('GET', '/api/items?pageSize=5', { token: admin });
  const item = items.data.data[0];

  const po = await api('POST', '/api/purchasing/orders', {
    token: admin,
    body: { supplierId: 1, currency: 'TRY', items: [{ itemId: item.id, qty: 3000, price: 100 }] }
  });
  ok('₺300.000 tutarında sipariş oluşturuldu (onay bekliyor)',
    po.status === 201 && po.data.totalBase === 300000 && po.data.approvalStatus === 'pending');

  // Müdür'ün kişisel onay limiti (seed: ₺250.000) bu tutarın altında —
  // approval_rules eşiği (₺100.000 → Müdür) sağlansa bile REDDEDİLMELİ.
  const mudurTry = await api('POST', `/api/purchasing/orders/${po.data.id}/approve`, { token: mudur });
  ok('Müdür kendi limitinin üstündeki siparişi onaylayamıyor (403)',
    mudurTry.status === 403 && /Onay limitiniz/.test(mudurTry.data.error || ''),
    JSON.stringify(mudurTry.data));

  const stillPending = await api('GET', `/api/purchasing/orders/${po.data.id}`, { token: admin });
  ok('Reddedilen onay denemesi sonrası sipariş hâlâ onay bekliyor durumunda',
    stillPending.data.approvalStatus === 'pending');

  // Yönetici (admin) kişisel limit kontrolüne tabi değil — onaylayabilmeli.
  const adminApprove = await api('POST', `/api/purchasing/orders/${po.data.id}/approve`, { token: admin });
  ok('Yönetici (admin) aynı siparişi limit kontrolüne takılmadan onaylayabiliyor',
    adminApprove.status === 200 && adminApprove.data.ok === true,
    JSON.stringify(adminApprove.data));
  const nowApproved = await api('GET', `/api/purchasing/orders/${po.data.id}`, { token: admin });
  ok('Sipariş onaylandı durumuna geçti', nowApproved.data.approvalStatus === 'approved',
    JSON.stringify(nowApproved.data.approvalStatus));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
