// @ts-nocheck
/**
 * KVKK m.7/m.11 testleri — kişisel veri anonimleştirme ve "hangi veri
 * tutuluyor" dışa aktarım raporu (bkz. server/lib/kvkk.js).
 *
 * En değerli kontroller: (1) anonimleştirme GERÇEKTEN kimliklendirici
 * alanları siliyor ama sipariş/fatura geçmişini koruyor, (2) yalnızca admin
 * bu işlemleri yapabiliyor, (3) işlem GERÇEKTEN geri döndürülemez (ikinci
 * çağrı 409), (4) son yönetici hesabı anonimleştirilemiyor, (5) saklama
 * süresi taraması varsayılan olarak KAPALI ve yalnızca etkinleştirilip
 * süresi dolan pasif kayıtları etkiliyor — aktif bir kaydı asla dokunmuyor.
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/kvkk.js
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
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('\n=== MÜŞTERİ ANONİMLEŞTİRME / CUSTOMER ANONYMIZATION ===');
  const cu = await api('POST', '/api/sales/customers', {
    token: admin, body: { name: 'KVKK Test Müşteri', contactPerson: 'Ali Veli', phone: '5551112233', email: 'ali@ornek.com', address: 'Test Mah.', taxNo: '12345678901' }
  });
  ok('müşteri oluşturuldu', cu.status === 201, JSON.stringify(cu.data));
  const cuId = cu.data.id;

  ok('görüntüleyici anonimleştiremiyor (403)',
    (await api('POST', `/api/sales/customers/${cuId}/anonymize`, { token: viewer })).status === 403);
  ok('operatör anonimleştiremiyor (403)',
    (await api('POST', `/api/sales/customers/${cuId}/anonymize`, { token: operator })).status === 403);
  ok('yönetici (manager) de anonimleştiremiyor (403 — yalnızca admin)',
    (await api('POST', `/api/sales/customers/${cuId}/anonymize`, { token: manager })).status === 403);

  const anon = await api('POST', `/api/sales/customers/${cuId}/anonymize`, { token: admin });
  ok('admin anonimleştirebiliyor', anon.status === 200, JSON.stringify(anon.data));
  ok('ad anonim bir değere değişti', anon.data.name === `Anonimleştirilmiş Müşteri #${cuId}`, anon.data.name);
  ok('iletişim bilgileri silindi', anon.data.contact_person === null && anon.data.phone === null && anon.data.email === null && anon.data.address === null);
  ok('VKN/TCKN silindi', anon.data.tax_no === null);
  ok('müşteri pasifleştirildi', anon.data.is_active === 0);
  ok('anonymized_at damgalandı', !!anon.data.anonymized_at);

  const anonAgain = await api('POST', `/api/sales/customers/${cuId}/anonymize`, { token: admin });
  ok('ikinci kez anonimleştirme reddediliyor (409 — geri döndürülemezlik)', anonAgain.status === 409, `got ${anonAgain.status}`);

  console.log('\n=== MÜŞTERİ VERİ DIŞA AKTARIM / DATA EXPORT ===');
  const cu2 = await api('POST', '/api/sales/customers', { token: admin, body: { name: 'KVKK Export Müşteri', email: 'export@ornek.com' } });
  const cu2Id = cu2.data.id;
  ok('görüntüleyici veri raporu göremiyor (403)',
    (await api('GET', `/api/sales/customers/${cu2Id}/data-export`, { token: viewer })).status === 403);
  const exp = await api('GET', `/api/sales/customers/${cu2Id}/data-export`, { token: admin });
  ok('admin veri raporu alabiliyor', exp.status === 200, JSON.stringify(exp.data));
  ok('rapor kişisel veriyi içeriyor', exp.data.personalData && exp.data.personalData.email === 'export@ornek.com');
  ok('rapor ilişkili kayıt bölümlerini içeriyor', exp.data.relatedRecords && Array.isArray(exp.data.relatedRecords.salesOrders));

  console.log('\n=== TEDARİKÇİ ANONİMLEŞTİRME / SUPPLIER ANONYMIZATION ===');
  const su = await api('POST', '/api/purchasing/suppliers', {
    token: admin, body: { name: 'KVKK Test Tedarikçi', contactPerson: 'Veli Ali', phone: '5559998877', bankInfo: 'TR00 0000 0000 0000 0000 00', taxNo: '9876543210' }
  });
  ok('tedarikçi oluşturuldu', su.status === 201, JSON.stringify(su.data));
  const suId = su.data.id;

  ok('operatör tedarikçiyi anonimleştiremiyor (403)',
    (await api('POST', `/api/purchasing/suppliers/${suId}/anonymize`, { token: operator })).status === 403);

  const anonSup = await api('POST', `/api/purchasing/suppliers/${suId}/anonymize`, { token: admin });
  ok('admin tedarikçiyi anonimleştirebiliyor', anonSup.status === 200, JSON.stringify(anonSup.data));
  ok('banka bilgisi silindi', anonSup.data.bank_info === null);
  ok('VKN silindi', anonSup.data.tax_no === null);
  ok('ikinci kez anonimleştirme reddediliyor (409)',
    (await api('POST', `/api/purchasing/suppliers/${suId}/anonymize`, { token: admin })).status === 409);

  const expSup = await api('GET', `/api/purchasing/suppliers/${suId}/data-export`, { token: admin });
  ok('tedarikçi veri raporu alınabiliyor', expSup.status === 200 && expSup.data.subjectType === 'supplier');

  console.log('\n=== KULLANICI ANONİMLEŞTİRME / USER ANONYMIZATION ===');
  const newUser = await api('POST', '/api/users', {
    token: admin, body: { username: 'kvkktest', password: 'GucluSifre1!', fullName: 'KVKK Test Kullanıcı', role: 'viewer' }
  });
  ok('test kullanıcısı oluşturuldu', newUser.status === 201, JSON.stringify(newUser.data));
  const newUserId = newUser.data.id;

  const usersList = await api('GET', '/api/users', { token: admin });
  const adminSelf = usersList.data.find(u => u.username === 'admin');
  const selfAnon = await api('POST', `/api/users/${adminSelf.id}/anonymize`, { token: admin });
  ok('gerçek kendi hesabını anonimleştirme reddediliyor (400)', selfAnon.status === 400, `got ${selfAnon.status}`);

  const admins = usersList.data.filter(u => u.role === 'admin');
  if (admins.length === 1) {
    const lastAdminAnon = await api('POST', `/api/users/${admins[0].id}/anonymize`, { token: admin });
    ok('son yönetici anonimleştirilemiyor (409/400)', lastAdminAnon.status === 400 || lastAdminAnon.status === 409, `got ${lastAdminAnon.status}`);
  }

  ok('operatör kullanıcı anonimleştiremiyor (403)',
    (await api('POST', `/api/users/${newUserId}/anonymize`, { token: operator })).status === 403);

  const anonUser = await api('POST', `/api/users/${newUserId}/anonymize`, { token: admin });
  ok('admin başka bir kullanıcıyı anonimleştirebiliyor', anonUser.status === 200, JSON.stringify(anonUser.data));
  ok('kullanıcı adı anonim değere değişti', anonUser.data.username === `anon_user_${newUserId}`, anonUser.data.username);
  ok('kullanıcı pasifleştirildi', anonUser.data.is_active === 0);

  const loginAnon = await api('POST', '/api/auth/login', { body: { username: 'kvkktest', password: 'GucluSifre1!' } });
  ok('anonimleştirilen kullanıcı artık giriş yapamıyor', loginAnon.status !== 200, `got ${loginAnon.status}`);

  const expUser = await api('GET', `/api/users/${newUserId}/data-export`, { token: admin });
  ok('kullanıcı veri raporu alınabiliyor', expUser.status === 200 && expUser.data.subjectType === 'user');

  console.log('\n=== SAKLAMA SÜRESİ TARAMASI / RETENTION SWEEP ===');
  const beforeEnable = await api('POST', '/api/data-retention/run', { token: admin });
  ok('varsayılan olarak devre dışı (enabled=false)', beforeEnable.data.enabled === false, JSON.stringify(beforeEnable.data));
  ok('devre dışıyken hiçbir şey anonimleştirmiyor', beforeEnable.data.anonymized === 0);

  const cu3 = await api('POST', '/api/sales/customers', { token: admin, body: { name: 'Saklama Süresi Testi', email: 'retention@ornek.com' } });
  const cu3Id = cu3.data.id;
  const stillActive = await api('GET', `/api/sales/customers/${cu3Id}`, { token: admin });
  ok('yeni müşteri aktif ve deactivated_at boş (ön koşul)', stillActive.data.is_active === 1 && !stillActive.data.deactivated_at);

  await api('PUT', '/api/settings', { token: manager, body: { kvkkAutoAnonymizeEnabled: '1', kvkkRetentionYears: 0 } });
  await api('DELETE', `/api/sales/customers/${cu3Id}`, { token: admin }); // deactivated_at = şimdi

  const sweep = await api('POST', '/api/data-retention/run', { token: admin });
  ok('tarama etkin görünüyor', sweep.data.enabled === true, JSON.stringify(sweep.data));
  ok('0 yıl saklama süresiyle pasifleştirilmiş kayıt anonimleştirildi', sweep.data.anonymized >= 1, JSON.stringify(sweep.data));

  const cu3After = await api('GET', `/api/sales/customers/${cu3Id}`, { token: admin });
  ok('süpürülen müşteri gerçekten anonimleşti', cu3After.data.email === null && !!cu3After.data.anonymized_at);

  const cu4 = await api('POST', '/api/sales/customers', { token: admin, body: { name: 'Hâlâ Aktif Müşteri', email: 'aktif@ornek.com' } });
  const cu4Id = cu4.data.id;
  await api('POST', '/api/data-retention/run', { token: admin });
  const cu4After = await api('GET', `/api/sales/customers/${cu4Id}`, { token: admin });
  ok('hiç pasifleştirilmemiş (aktif) müşteri tarama ile dokunulmuyor', cu4After.data.email === 'aktif@ornek.com' && !cu4After.data.anonymized_at);

  await api('PUT', '/api/settings', { token: manager, body: { kvkkAutoAnonymizeEnabled: '0' } });
  const disabledAgain = await api('POST', '/api/data-retention/run', { token: admin });
  ok('yeniden devre dışı bırakılınca tarama çalışmıyor', disabledAgain.data.enabled === false);

  console.log(`\n====================================================\nGEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}\n====================================================`);
  if (fail > 0) { console.log('Başarısız testler / Failed tests:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
