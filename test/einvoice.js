/**
 * e-Belge testleri.
 *
 * Kapsam: fatura kalemleri ve KDV hesabı, e-Fatura / e-Arşiv ayrımı, UBL-TR
 * çıktısının yapısı, doğrulama kuralları, gönderim akışı ve iptal kısıtları.
 *
 * Kapsam DIŞI: gerçek bir entegratöre veya GİB'e gönderim. Testler 'local'
 * sağlayıcıyla çalışır; belge diske yazılır. Canlıya almadan önce üretilen XML
 * seçilen entegratörün şema doğrulamasından geçirilmelidir.
 *
 *   node test/einvoice.js
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
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null;
  const text = await r.text();
  try { d = JSON.parse(text); } catch { d = text; }
  return { status: r.status, data: d };
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('\n=== AYARLAR / SETTINGS ===');
  // e-Belge kapsam dışı olduğu için varsayılan kapalı gelir; modülün kendisi
  // hâlâ çalışır durumda ve test için açılır.
  const closed = await api('GET', '/api/edocs/settings/current', { token: admin });
  ok('e-Belge varsayılan olarak kapalı geliyor', closed.data.enabled === false, String(closed.data.enabled));
  const blocked = await api('POST', '/api/edocs/from-invoice/xyz', { token: admin });
  ok('kapalıyken belge üretilemiyor', blocked.status === 400, `got ${blocked.status}`);
  await api('PUT', '/api/edocs/settings/current', { token: admin, body: { enabled: true } });

  const st = await api('GET', '/api/edocs/settings/current', { token: admin });
  ok('e-Belge ayarları okunuyor', st.status === 200 && st.data.enabled === true, JSON.stringify(st.data).slice(0, 120));
  ok('yerel sağlayıcı aktif (entegratör yok)', st.data.provider === 'local');
  ok('gönderici bilgileri tanımlı', !!(st.data.company.taxNo && st.data.company.taxOffice && st.data.company.senderAlias));
  ok('üç belge serisi tanımlı', (st.data.series || []).length === 3, JSON.stringify(st.data.series));
  const viewerSettings = await api('GET', '/api/edocs/settings/current', { token: viewer });
  ok('görüntüleyici ayarlara erişemiyor (403)', viewerSettings.status === 403, `got ${viewerSettings.status}`);
  ok('API anahtarı geri döndürülmüyor', st.data.providerConfig.apiKey === undefined);

  console.log('\n=== FATURA KALEMLERİ VE KDV ===');
  const customers = (await api('GET', '/api/sales/customers?pageSize=50', { token: admin })).data.data;
  const anadolu = customers.find(c => c.is_einvoice_user === 1);
  const ege = customers.find(c => c.is_einvoice_user === 0 && c.country === 'TR');
  ok('e-Fatura mükellefi müşteri var', !!anadolu, anadolu ? anadolu.name : '');
  ok('e-Arşiv (mükellef olmayan) müşteri var', !!ege, ege ? ege.name : '');

  const invRes = await api('POST', '/api/sales/invoices', {
    token: operator,
    body: {
      customerId: anadolu.id, currency: 'TRY',
      lines: [
        { itemName: 'Elektrik Bağlantı Seti', itemCode: 'SET-001', qty: 10, unit: 'set', unitPrice: 450, vatRate: 20 },
        { itemName: 'Montaj Paneli MP-500', itemCode: 'MP-500', qty: 2, unit: 'adet', unitPrice: 1250, discountRate: 10, vatRate: 20 }
      ]
    }
  });
  ok('kalemli fatura oluşturuldu', invRes.status === 201, `got ${invRes.status} ${JSON.stringify(invRes.data).slice(0, 140)}`);
  const invId = invRes.data.id;

  const inv = (await api('GET', `/api/sales/invoices/${invId}`, { token: admin })).data;
  // 10×450 = 4500 · 2×1250 = 2500, %10 indirim → 2250 · ara toplam 6750 · KDV %20 → 1350
  ok('ara toplam doğru hesaplandı (6750)', Math.abs(inv.subtotal - 6750) < 0.01, String(inv.subtotal));
  ok('KDV toplamı doğru hesaplandı (1350)', Math.abs(inv.vatTotal - 1350) < 0.01, String(inv.vatTotal));
  ok('indirim toplamı doğru (250)', Math.abs(inv.discountTotal - 250) < 0.01, String(inv.discountTotal));
  ok('genel toplam KDV dahil (8100)', Math.abs(inv.amount - 8100) < 0.01, String(inv.amount));
  ok('fatura iki kalem taşıyor', inv.lines.length === 2);
  ok('satır KDV tutarı satır bazında hesaplandı', Math.abs(inv.lines[1].vatAmount - 450) < 0.01, String(inv.lines[1].vatAmount));

  console.log('\n=== e-FATURA ÜRETİMİ ===');
  const noAuth = await api('POST', `/api/edocs/from-invoice/${invId}`, { token: viewer });
  ok('görüntüleyici e-Belge üretemiyor (403)', noAuth.status === 403, `got ${noAuth.status}`);

  const gen = await api('POST', `/api/edocs/from-invoice/${invId}`, { token: operator });
  ok('e-Belge üretildi', gen.status === 201, `got ${gen.status} ${JSON.stringify(gen.data).slice(0, 200)}`);
  const doc = gen.data;
  // Alıcı e-Fatura mükellefi olduğu için e-Arşiv değil e-Fatura düzenlenmeli
  ok('mükellef alıcıya e-Fatura düzenlendi', doc.docType === 'einvoice', doc.docType);
  ok('belge numarası GİB biçiminde (3 harf + yıl + 9 hane)', /^[A-Z]{3}\d{4}\d{9}$/.test(doc.documentNo), doc.documentNo);
  ok('ETTN üretildi', /^[0-9A-F-]{36}$/.test(doc.ettn), doc.ettn);
  ok('alıcı etiketi belgeye yazıldı', !!doc.receiverAlias, doc.receiverAlias);
  ok('belge taslak durumunda başlıyor', doc.status === 'draft', doc.status);
  ok('toplamlar belgeye taşındı', Math.abs(doc.grandTotal - 8100) < 0.01, String(doc.grandTotal));

  const dup = await api('POST', `/api/edocs/from-invoice/${invId}`, { token: operator });
  ok('aynı fatura için ikinci belge engellendi (409)', dup.status === 409, `got ${dup.status}`);

  console.log('\n=== UBL-TR XML ===');
  const xmlRes = await api('GET', `/api/edocs/${doc.id}/xml`, { token: admin });
  const xml = typeof xmlRes.data === 'string' ? xmlRes.data : '';
  ok('XML indirilebiliyor', xmlRes.status === 200 && xml.length > 500, `${xml.length} karakter`);
  ok('UBL-TR 1.2 özelleştirmesi belirtilmiş', xml.includes('<cbc:CustomizationID>TR1.2</cbc:CustomizationID>'));
  ok('UBL 2.1 sürümü belirtilmiş', xml.includes('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>'));
  ok('profil TICARIFATURA', xml.includes('TICARIFATURA'));
  ok('ETTN UUID alanında', xml.includes(`<cbc:UUID>${doc.ettn}</cbc:UUID>`));
  ok('gönderici VKN yazılmış', xml.includes('schemeID="VKN">1234567890'));
  ok('alıcı VKN yazılmış', xml.includes('schemeID="VKN">4445556667'));
  ok('vergi dairesi yazılmış', xml.includes('Ostim') || xml.includes('Tuzla'));
  ok('KDV vergi tipi kodu 0015', xml.includes('<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>'));
  ok('iki fatura satırı var', (xml.match(/<cac:InvoiceLine>/g) || []).length === 2);
  ok('birim kodu dönüştürülmüş (set → SET)', xml.includes('unitCode="SET"'), '');
  ok('ödenecek tutar 8100.00', xml.includes('<cbc:PayableAmount currencyID="TRY">8100.00</cbc:PayableAmount>'));
  ok('KDV toplamı 1350.00', xml.includes('<cbc:TaxAmount currencyID="TRY">1350.00</cbc:TaxAmount>'));
  ok('indirim toplamı belgede', xml.includes('<cbc:AllowanceTotalAmount currencyID="TRY">250.00</cbc:AllowanceTotalAmount>'));
  ok('satır indirimi işaretlenmiş', xml.includes('<cbc:ChargeIndicator>false</cbc:ChargeIndicator>'));
  ok('XML kaçışı yapılmış (& < > yok)', !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml));

  console.log('\n=== e-ARŞİV AYRIMI ===');
  const inv2 = await api('POST', '/api/sales/invoices', {
    token: operator,
    body: { customerId: ege.id, currency: 'TRY', lines: [{ itemName: 'Test Ürün', qty: 1, unitPrice: 100, vatRate: 20 }] }
  });
  const gen2 = await api('POST', `/api/edocs/from-invoice/${inv2.data.id}`, { token: operator });
  ok('mükellef olmayan alıcıya e-Arşiv düzenlendi', gen2.data.docType === 'earchive', gen2.data.docType);
  ok('e-Arşiv profili EARSIVFATURA', gen2.data.profileId === 'EARSIVFATURA', gen2.data.profileId);
  const xml2 = (await api('GET', `/api/edocs/${gen2.data.id}/xml`, { token: admin })).data;
  ok('e-Arşiv belgesinde etiket zorunlu değil', typeof xml2 === 'string' && xml2.includes('EARSIVFATURA'));
  ok('e-Fatura ve e-Arşiv farklı seri kullanıyor',
    doc.documentNo.slice(0, 3) !== gen2.data.documentNo.slice(0, 3),
    `${doc.documentNo.slice(0, 3)} / ${gen2.data.documentNo.slice(0, 3)}`);

  console.log('\n=== DOĞRULAMA / VALIDATION ===');
  // VKN'si olmayan müşteriye e-Belge düzenlenememeli
  const badCus = await api('POST', '/api/sales/customers', {
    token: admin, body: { name: 'VKN Yok Ltd.', currency: 'TRY' }
  });
  const badInv = await api('POST', '/api/sales/invoices', {
    token: admin, body: { customerId: badCus.data.id, lines: [{ itemName: 'X', qty: 1, unitPrice: 10, vatRate: 20 }] }
  });
  const badGen = await api('POST', `/api/edocs/from-invoice/${badInv.data.id}`, { token: admin });
  ok('VKN/TCKN eksikse belge üretilmiyor (422)', badGen.status === 422, `got ${badGen.status}`);
  ok('hata sebebi alan bazında dönüyor',
    !!(badGen.data.details && badGen.data.details.some(d => /VKN|TCKN/.test(d.message))),
    JSON.stringify(badGen.data).slice(0, 160));

  console.log('\n=== e-İRSALİYE ===');
  const shipments = (await api('GET', '/api/sales/shipments?pageSize=10', { token: admin })).data.data;
  const ship = shipments[0];
  const desp = await api('POST', `/api/edocs/from-shipment/${ship.id}`, {
    token: operator, body: { plateNo: '34 ABC 123', driverName: 'Ahmet Yıldız' }
  });
  ok('sevkiyattan e-İrsaliye üretildi', desp.status === 201, `got ${desp.status} ${JSON.stringify(desp.data).slice(0, 160)}`);
  ok('e-İrsaliye tipi doğru', desp.data.docType === 'edespatch', desp.data.docType);
  const dxml = (await api('GET', `/api/edocs/${desp.data.id}/xml`, { token: admin })).data;
  ok('DespatchAdvice kök elemanı', typeof dxml === 'string' && dxml.includes('<DespatchAdvice'));
  ok('sevk tarihi belgede', dxml.includes('<cbc:ActualDespatchDate>'));
  ok('plaka belgede', dxml.includes('34 ABC 123'));
  ok('parti (lot) numarası belgede izlenebilir', dxml.includes('<cbc:LotNumberID>'), '');
  ok('irsaliyede tutar yok (sadece miktar)', !dxml.includes('PayableAmount'));

  console.log('\n=== GÖNDERİM / SEND ===');
  const opSend = await api('POST', `/api/edocs/${doc.id}/send`, { token: operator });
  ok('operatör gönderemiyor (403)', opSend.status === 403, `got ${opSend.status}`);
  const sent = await api('POST', `/api/edocs/${doc.id}/send`, { token: manager });
  ok('müdür gönderebiliyor', sent.status === 200, `got ${sent.status} ${JSON.stringify(sent.data).slice(0, 160)}`);
  ok('belge gönderildi durumuna geçti', sent.data.status === 'sent', sent.data.status);
  ok('sağlayıcı kaydedildi', sent.data.provider === 'local', sent.data.provider);
  ok('takip numarası alındı', !!sent.data.providerRef, sent.data.providerRef);
  ok('gönderim zamanı damgalandı', !!sent.data.sentAt);

  const resend = await api('POST', `/api/edocs/${doc.id}/send`, { token: manager });
  ok('gönderilmiş belge tekrar gönderilemiyor (409)', resend.status === 409, `got ${resend.status}`);

  console.log('\n=== İPTAL KISITI / CANCELLATION RULE ===');
  // Gönderilmiş e-Fatura tek taraflı iptal edilemez; iade faturası gerekir.
  const cancelSent = await api('POST', `/api/edocs/${doc.id}/cancel`, { token: manager, body: { reason: 'test' } });
  ok('gönderilmiş e-Fatura iptal edilemiyor (409)', cancelSent.status === 409, `got ${cancelSent.status}`);
  const cancelDraft = await api('POST', `/api/edocs/${gen2.data.id}/cancel`, { token: manager, body: { reason: 'yanlış müşteri' } });
  ok('taslak belge iptal edilebiliyor', cancelDraft.status === 200 && cancelDraft.data.status === 'cancelled',
    `got ${cancelDraft.status}`);

  console.log('\n=== İZ KAYDI / AUDIT TRAIL ===');
  const detail = (await api('GET', `/api/edocs/${doc.id}`, { token: admin })).data;
  ok('belge geçmişi tutuluyor', Array.isArray(detail.log) && detail.log.length >= 2, `${(detail.log || []).length} kayıt`);
  ok('üretim ve gönderim ayrı ayrı kayıtlı',
    detail.log.some(l => l.action === 'created') && detail.log.some(l => l.action === 'sent'),
    JSON.stringify((detail.log || []).map(l => l.action)));
  ok('işlemi yapan kullanıcı kayıtlı', detail.log.some(l => l.username), '');
  const audit = (await api('GET', '/api/audit?entityType=e_document&pageSize=20', { token: admin })).data;
  ok('genel denetim kaydına da yazıldı', audit.data.length >= 2, `${audit.data.length} kayıt`);

  console.log('\n=== MÜKELLEF SORGUSU (yerel modda desteklenmez) ===');
  const tp = await api('POST', `/api/edocs/check-taxpayer/${anadolu.id}`, { token: operator });
  ok('yerel modda mükellef sorgusu açıkça reddediliyor (501)', tp.status === 501, `got ${tp.status}`);

  console.log('\n=== LİSTE / LIST ===');
  const list = await api('GET', '/api/edocs?pageSize=50', { token: admin });
  ok('e-Belge listesi sayfalanıyor', list.status === 200 && Array.isArray(list.data.data) && list.data.totalPages >= 1);
  ok('en az üç belge listeleniyor', list.data.total >= 3, String(list.data.total));
  const filtered = await api('GET', '/api/edocs?docType=edespatch', { token: admin });
  ok('belge tipine göre filtreleniyor',
    filtered.data.data.every(d => d.docType === 'edespatch') && filtered.data.data.length >= 1);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
