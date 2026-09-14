// @ts-nocheck
/**
 * Eşzamanlı kullanıcı senaryoları / concurrent-user race tests.
 *
 * test/load.js zaten "aynı ürüne eşzamanlı stok girişi" ve "eşzamanlı sipariş
 * numarası üretimi" gibi HACİM/tekillik senaryolarını kapsıyor. Bu dosya farklı
 * bir soruyu cevaplıyor: iki FARKLI KULLANICI aynı ANDA aynı KAYDI etkileyen
 * bir durum-geçişi (onay, kısmi teslim alma) tetiklerse ne olur?
 *
 * server/index.js better-sqlite3'ü SENKRON kullanıyor ve Node tek iş
 * parçacıklıdır: bir route handler içinde `await` YOKSA (bu iki senaryodaki
 * gibi), o handler'ın tamamı (oku→karar ver→yaz) başka bir isteğin kodu
 * araya giremeden çalışır — yani klasik "iki istek aynı satırı okuyup ikisi
 * de eski değere göre yazıyor" yarış durumu burada YAPISAL olarak mümkün
 * değildir. Bu testler bunu VARSAYMAK yerine gerçek eşzamanlı HTTP
 * istekleriyle kanıtlıyor.
 *
 *   node test/concurrency-races.js   (sunucu ayakta olmalı)
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
  const admin = await login('admin', 'Admin123!');
  const mudur = await login('mudur', 'Mudur123!');
  const items = await api('GET', '/api/items?pageSize=5', { token: admin });
  const item = items.data.data[0];

  console.log('\n=== EŞZAMANLI ONAY YARIŞI / CONCURRENT APPROVAL RACE ===');
  // Müdür'ün kişisel limiti (₺250.000) içinde, ama approval_rules eşiğini
  // (₺100.000 → Müdür) geçen bir sipariş — hem admin hem Müdür onaylamaya
  // yetkili. İkisi TAM AYNI ANDA onaylamayı denerse ne olur?
  const po = await api('POST', '/api/purchasing/orders', {
    token: admin,
    body: { supplierId: 1, currency: 'TRY', items: [{ itemId: item.id, qty: 1500, price: 100 }] }
  });
  ok('₺150.000 tutarında sipariş oluşturuldu (onay bekliyor)',
    po.status === 201 && po.data.approvalStatus === 'pending', JSON.stringify(po.data).slice(0, 160));

  const [adminTry, mudurTry] = await Promise.all([
    api('POST', `/api/purchasing/orders/${po.data.id}/approve`, { token: admin }),
    api('POST', `/api/purchasing/orders/${po.data.id}/approve`, { token: mudur })
  ]);
  const approveStatuses = [adminTry.status, mudurTry.status].sort();
  ok('tam olarak biri onayı kazandı (200), diğeri temiz reddedildi (400)',
    approveStatuses[0] === 200 && approveStatuses[1] === 400,
    `admin=${adminTry.status} mudur=${mudurTry.status}`);
  const loser = adminTry.status === 400 ? adminTry : mudurTry;
  ok('kaybeden istek "onay bekliyor durumunda değil" hatası aldı (çift onay değil)',
    /onay bekliyor durumunda değil/.test(loser.data.error || ''), JSON.stringify(loser.data));

  const finalPo = await api('GET', `/api/purchasing/orders/${po.data.id}`, { token: admin });
  ok('sipariş tam olarak bir kez onaylanmış durumda (bozulmamış)',
    finalPo.data.approvalStatus === 'approved', finalPo.data.approvalStatus);

  console.log('\n=== EŞZAMANLI FAZLA TESLİM YARIŞI / CONCURRENT OVER-RECEIPT RACE ===');
  // Tolerans %0, sipariş miktarı 10. İki farklı kullanıcı AYNI ANDA 6'şar adet
  // teslim almaya çalışırsa (toplam 12 > 10): ikisi de kabul edilirse veri
  // bozulur (received_qty stok kaydından fazla görünür). Tam olarak biri
  // kabul edilmeli, diğeri "fazla teslim toleransı aşıldı" ile reddedilmeli.
  const po2 = await api('POST', '/api/purchasing/orders', {
    token: admin,
    body: { supplierId: 1, warehouseId: 1, currency: 'TRY', items: [{ itemId: item.id, qty: 10, price: 50 }] }
  });
  ok('₺500 tutarında (onay gerektirmeyen) ikinci sipariş oluşturuldu',
    po2.status === 201 && po2.data.approvalStatus !== 'pending', JSON.stringify(po2.data).slice(0, 160));
  const poItemId = po2.data.items[0].id;

  const [recvA, recvB] = await Promise.all([
    api('POST', `/api/purchasing/orders/${po2.data.id}/receipts`, {
      token: admin, body: { lines: [{ poItemId, qty: 6 }] }
    }),
    api('POST', `/api/purchasing/orders/${po2.data.id}/receipts`, {
      token: mudur, body: { lines: [{ poItemId, qty: 6 }] }
    })
  ]);
  const recvStatuses = [recvA.status, recvB.status].sort();
  ok('tam olarak bir teslim alma kabul edildi (201), diğeri tolerans aşımıyla reddedildi (400)',
    recvStatuses[0] === 201 && recvStatuses[1] === 400,
    `admin=${recvA.status} mudur=${recvB.status}`);
  const rejectedRecv = recvA.status === 400 ? recvA : recvB;
  ok('reddedilen istek "fazla teslim toleransı aşıldı" hatası aldı',
    /fazla teslim toleransı aşıldı/.test(rejectedRecv.data.error || ''), JSON.stringify(rejectedRecv.data));

  const finalPo2 = await api('GET', `/api/purchasing/orders/${po2.data.id}`, { token: admin });
  const finalLine = finalPo2.data.items.find(x => x.id === poItemId);
  ok('teslim alınan miktar TAM OLARAK 6 (12 değil — çift yazım yok)',
    finalLine.receivedQty === 6, JSON.stringify(finalLine));
  ok('sipariş "kısmen teslim alındı" durumunda (10\'un 6\'sı geldi)',
    finalPo2.data.status === 'partially_received', finalPo2.data.status);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(60));
  process.exit(fail > 0 ? 1 : 0);
})();
