/**
 * Belge şablonu testleri.
 *
 * Bu belgeler müşteriye, tedarikçiye ve denetçiye gider. Yanlış görünmesi
 * doğrudan itibar meselesidir. Test edilen: şablonun kaydedilmesi, logonun
 * saklanması, alan görünürlüğünün korunması, yetki sınırları ve varsayılana dönüş.
 *
 *   node test/templates.js
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

/** Küçük ama geçerli bir PNG (1×1 saydam). */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

async function uploadLogo(token, buffer, mime, name) {
  const fd = new FormData();
  fd.append('logo', new Blob([buffer], { type: mime }), name);
  const r = await fetch(BASE + '/api/templates/branding/logo', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('=== VARSAYILAN ŞABLONLAR / DEFAULT TEMPLATES ===');
  const all = await api('GET', '/api/templates', { token: admin });
  ok('şablonlar listeleniyor', all.status === 200 && all.data.length === 8, `${all.data.length} şablon`);
  const types = all.data.map(t => t.docType).sort();
  ok('sekiz belge tipi tanımlı',
    ['count', 'inspection', 'label', 'production_order', 'purchase_order',
     'shipment', 'stock_card', 'traceability'].every(t => types.includes(t)), types.join(','));

  const ship = await api('GET', '/api/templates/shipment', { token: operator });
  ok('operatör şablonu okuyabiliyor (yazdırma için gerekli)', ship.status === 200);
  ok('varsayılan düzen makul geliyor (A4, logo açık)',
    ship.data.layout.paperSize === 'A4' && ship.data.layout.showLogo === true,
    JSON.stringify(ship.data.layout).slice(0, 100));
  ok('alanlar varsayılan olarak görünür',
    ship.data.fields.length > 5 && ship.data.fields.every(f => f.visible),
    `${ship.data.fields.length} alan`);
  ok('imza kutuları önceden tanımlı',
    ship.data.signatures.length === 2 && ship.data.signatures.includes('Teslim Alan'),
    JSON.stringify(ship.data.signatures));

  const label = await api('GET', '/api/templates/label', { token: admin });
  // Etiket küçük kâğıda basılır; A4 varsayılanı burada yanlış olurdu.
  ok('etiket şablonu küçük kâğıt kullanıyor', label.data.layout.paperSize === 'label',
    label.data.layout.paperSize);
  ok('etikette sayfa numarası kapalı', label.data.layout.showPageNumbers === false);
  ok('etikette barkod açık', label.data.layout.showBarcode === true);
  ok('etiketin imza kutusu yok', label.data.signatures.length === 0);

  console.log('\n=== YETKİ / PERMISSIONS ===');
  const opSave = await api('PUT', '/api/templates/shipment', { token: operator, body: { headerText: 'x' } });
  ok('operatör şablon değiştiremiyor (403)', opSave.status === 403, `got ${opSave.status}`);
  const viewerSave = await api('PUT', '/api/templates/shipment', { token: viewer, body: { headerText: 'x' } });
  ok('görüntüleyici şablon değiştiremiyor (403)', viewerSave.status === 403, `got ${viewerSave.status}`);
  const opLogo = await uploadLogo(operator, PNG_1PX, 'image/png', 'logo.png');
  ok('operatör logo yükleyemiyor (403)', opLogo.status === 403, `got ${opLogo.status}`);

  console.log('\n=== ŞABLON DÜZENLEME / EDITING ===');
  const edited = await api('PUT', '/api/templates/shipment', {
    token: manager,
    body: {
      layout: { accentColor: '#1B5E20', fontSize: 11, marginMm: 18, showCompanyInfo: false },
      headerText: 'Malı teslim alırken hasarlı kasa varsa tutanak tutunuz.',
      footerText: 'Bu belge elektronik ortamda üretilmiştir.',
      signatures: ['Teslim Eden', 'Teslim Alan', 'Nakliyeci']
    }
  });
  ok('şablon kaydedildi', edited.status === 200, JSON.stringify(edited.data).slice(0, 120));
  ok('vurgu rengi kaydedildi', edited.data.layout.accentColor === '#1B5E20', edited.data.layout.accentColor);
  ok('yazı boyutu kaydedildi', edited.data.layout.fontSize === 11, String(edited.data.layout.fontSize));
  ok('kapatılan ayar korundu', edited.data.layout.showCompanyInfo === false);
  // Kısmi güncelleme: gönderilmeyen ayar eski değerini korumalı
  ok('gönderilmeyen ayar sıfırlanmadı', edited.data.layout.showLogo === true,
    'showLogo gönderilmedi ama true kalmalı');
  ok('üst not kaydedildi', /tutanak/.test(edited.data.headerText), edited.data.headerText);
  ok('imza kutusu eklenebiliyor', edited.data.signatures.length === 3, JSON.stringify(edited.data.signatures));

  const tooMany = await api('PUT', '/api/templates/shipment', {
    token: manager, body: { signatures: ['a', 'b', 'c', 'd', 'e'] } });
  ok('dörtten fazla imza kutusu reddediliyor', tooMany.status >= 400, `got ${tooMany.status}`);

  const badColor = await api('PUT', '/api/templates/shipment', {
    token: manager, body: { layout: { accentColor: 'kırmızı' } } });
  ok('geçersiz renk kodu reddediliyor', badColor.status >= 400, `got ${badColor.status}`);

  const badPaper = await api('PUT', '/api/templates/shipment', {
    token: manager, body: { layout: { paperSize: 'A0' } } });
  ok('tanımsız kâğıt boyutu reddediliyor', badPaper.status >= 400, `got ${badPaper.status}`);

  const badFont = await api('PUT', '/api/templates/shipment', {
    token: manager, body: { layout: { fontSize: 99 } } });
  ok('aşırı yazı boyutu reddediliyor', badFont.status >= 400, `got ${badFont.status}`);

  console.log('\n=== ALAN GÖRÜNÜRLÜĞÜ / FIELD VISIBILITY ===');
  const fields = edited.data.fields.map(f => ({ ...f, visible: f.key !== 'notes' && f.key !== 'carrier' }));
  const hidden = await api('PUT', '/api/templates/shipment', { token: manager, body: { fields } });
  ok('alanlar gizlenebiliyor',
    hidden.data.fields.filter(f => !f.visible).length === 2,
    `${hidden.data.fields.filter(f => !f.visible).length} gizli`);
  ok('gizlenen alanlar isimlerini koruyor',
    hidden.data.fields.find(f => f.key === 'notes').label === 'Notlar',
    'etiket kaybolmamalı, sonra tekrar açılabilmeli');
  const reread = await api('GET', '/api/templates/shipment', { token: admin });
  ok('ayar kalıcı (yeniden okundu)',
    reread.data.fields.find(f => f.key === 'carrier').visible === false);

  console.log('\n=== LOGO ===');
  const logoUp = await uploadLogo(manager, PNG_1PX, 'image/png', 'logo.png');
  ok('logo yüklendi', logoUp.status === 201, JSON.stringify(logoUp.data));
  const branding = await api('GET', '/api/templates/branding/current', { token: operator });
  ok('logo veri URL\'i olarak dönüyor',
    typeof branding.data.logo === 'string' && branding.data.logo.startsWith('data:image/png;base64,'),
    String(branding.data.logo).slice(0, 40));
  ok('yazdırma için herkes okuyabiliyor', branding.status === 200, 'operatör de belge basacak');

  // Yanlış dosya tipi: PDF logo diye yüklenirse belge bozulur
  const badLogo = await uploadLogo(manager, Buffer.from('%PDF-1.4 sahte'), 'application/pdf', 'logo.pdf');
  ok('PDF logo olarak kabul edilmiyor (415)', badLogo.status === 415, `got ${badLogo.status}`);
  const bigLogo = await uploadLogo(manager, Buffer.alloc(700 * 1024, 1), 'image/png', 'buyuk.png');
  ok('512 KB üstü logo reddediliyor', bigLogo.status >= 400, `got ${bigLogo.status}`);

  const delLogo = await api('DELETE', '/api/templates/branding/logo', { token: manager });
  ok('logo kaldırılabiliyor', delLogo.status === 204, `got ${delLogo.status}`);
  const afterDel = await api('GET', '/api/templates/branding/current', { token: admin });
  ok('kaldırılan logo geri dönmüyor', afterDel.data.logo === null);
  await uploadLogo(manager, PNG_1PX, 'image/png', 'logo.png');   // sonraki testler için geri koy

  console.log('\n=== FİRMA KİMLİĞİ / BRANDING ===');
  const brSave = await api('PUT', '/api/templates/branding/current', {
    token: manager,
    body: {
      phone: '+90 216 000 0000', website: 'www.ornekmetal.com',
      printFooter: 'Banka: TR00 0000 0000 0000 0000 0000 00'
    }
  });
  ok('firma bilgisi kaydedildi', brSave.status === 200);
  const br2 = await api('GET', '/api/templates/branding/current', { token: admin });
  ok('telefon güncellendi', br2.data.phone === '+90 216 000 0000', br2.data.phone);
  ok('ortak dipnot kaydedildi', /Banka/.test(br2.data.printFooter), br2.data.printFooter);
  ok('firma adı silinmedi (kısmi güncelleme)', !!br2.data.name, br2.data.name);
  const opBr = await api('PUT', '/api/templates/branding/current', { token: operator, body: { phone: 'x' } });
  ok('operatör firma bilgisini değiştiremiyor (403)', opBr.status === 403, `got ${opBr.status}`);

  console.log('\n=== VARSAYILANA DÖNÜŞ / RESET ===');
  const reset = await api('POST', '/api/templates/shipment/reset', { token: manager });
  ok('şablon sıfırlandı', reset.status === 200);
  ok('renk varsayılana döndü', reset.data.layout.accentColor === '#111111', reset.data.layout.accentColor);
  ok('gizlenen alanlar geri geldi', reset.data.fields.every(f => f.visible));
  ok('üst not temizlendi', !reset.data.headerText, String(reset.data.headerText));
  ok('kâğıt boyutu A4\'e döndü', reset.data.layout.paperSize === 'A4');
  const labelReset = await api('POST', '/api/templates/label/reset', { token: manager });
  ok('etiket sıfırlanınca etiket kâğıdında kalıyor',
    labelReset.data.layout.paperSize === 'label',
    'genel varsayılan uygulanırsa etiket A4 olurdu — yanlış olurdu');

  console.log('\n=== HATA DURUMLARI / ERROR CASES ===');
  const noTpl = await api('GET', '/api/templates/olmayan_tip', { token: admin });
  ok('olmayan şablon 404 dönüyor', noTpl.status === 404, `got ${noTpl.status}`);
  const noTplSave = await api('PUT', '/api/templates/olmayan_tip', { token: manager, body: { headerText: 'x' } });
  ok('olmayan şablon kaydedilemiyor', noTplSave.status === 404, `got ${noTplSave.status}`);

  console.log('\n=== DENETİM KAYDI / AUDIT ===');
  const audit = await api('GET', '/api/audit?entityType=document_template&pageSize=20', { token: admin });
  ok('şablon değişiklikleri denetime yazıldı', audit.data.data.length >= 2, `${audit.data.data.length} kayıt`);
  ok('eski ve yeni değer birlikte tutuluyor',
    audit.data.data.some(a => a.oldValue && a.newValue),
    'neyin neye dönüştüğü görülebilmeli');
  const logoAudit = await api('GET', '/api/audit?entityType=company&pageSize=20', { token: admin });
  ok('logo işlemleri denetime yazıldı', logoAudit.data.data.length >= 1, `${logoAudit.data.data.length} kayıt`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  console.log('\nNot: Basılan belgenin GÖRÜNÜMÜ bu ortamda doğrulanamaz — yazıcı ve tarayıcı');
  console.log('gerekir. Test edilen, ayarların doğru saklandığı ve yazdırma motoruna doğru');
  console.log('aktarıldığıdır. Gerçek çıktı bir kez gözle kontrol edilmelidir.');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
