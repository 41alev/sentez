/**
 * Barkod okuma testi.
 *
 * Kamera testi bu ortamda mümkün değil — kamera yok, jsdom'da MediaDevices yok.
 * Ancak fabrikada asıl kullanılan yöntem USB okuyucudur ve o tamamen test edilebilir:
 * okuyucu klavye gibi davranır, karakterleri çok hızlı yazar ve Enter ile bitirir.
 *
 * Bu test, okuyucu girdisinin insan yazışından doğru ayrıldığını, yanlışlıkla
 * form alanlarını ele geçirmediğini ve kamera yokken arayüzün kullanılabilir
 * kaldığını doğrular.
 *
 *   node test/barcode.js      (jsdom gerekir, sunucu gerekmez)
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.error('jsdom kurulu değil / not installed: npm install --no-save jsdom'); process.exit(2); }

  const ROOT = path.join(__dirname, '..');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="toast"></div><div id="modalOverlay"><div id="modalBox"></div></div><input id="other"></body>',
    { url: 'http://localhost:3000', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;

  // Api ve UI birbirine bağlı; Api'yi asgari düzeyde sahteliyoruz.
  window.eval('var Api = { getUser: () => ({ role: "admin" }), getToken: () => "t" };');
  for (const f of ['js/i18n.js', 'js/ui.js']) {
    const el = doc.createElement('script');
    el.textContent = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    doc.body.appendChild(el);
  }
  ok('UI modülü yüklendi', window.eval('typeof UI !== "undefined"'));
  ok('onBarcodeScan dışa aktarıldı', window.eval('typeof UI.onBarcodeScan === "function"'));

  /** Tuş dizisini verilen aralıkla gönderir. */
  async function type(text, gapMs, { target = doc.body, enter = true } = {}) {
    for (const ch of text) {
      target.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
      await sleep(gapMs);
    }
    if (enter) {
      target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(5);
    }
  }

  console.log('\n=== USB OKUYUCU ALGILAMA / SCANNER DETECTION ===');
  let scanned = [];
  let stop = window.eval('UI.onBarcodeScan(c => globalThis.__hit(c))');
  window.__hit = (c) => scanned.push(c);

  await type('8690123456781', 5);
  ok('hızlı yazılan barkod yakalandı', scanned.length === 1 && scanned[0] === '8690123456781',
    JSON.stringify(scanned));

  scanned = [];
  // İnsan yazışı: tuşlar arası 120 ms. Bu barkod sayılmamalı.
  await type('8690123456781', 120);
  ok('insan hızında yazış barkod sayılmıyor', scanned.length === 0, JSON.stringify(scanned));

  scanned = [];
  await type('ABC', 5);
  ok('çok kısa dizi barkod sayılmıyor (min 6)', scanned.length === 0, JSON.stringify(scanned));

  scanned = [];
  await type('LOT-SC-2501', 5);
  ok('harf içeren barkod (lot no) yakalanıyor', scanned.length === 1 && scanned[0] === 'LOT-SC-2501',
    JSON.stringify(scanned));

  scanned = [];
  // Enter gelmezse tetiklenmemeli: yarım okuma kayıt açmamalı
  await type('8690123456798', 5, { enter: false });
  ok('Enter gelmeden tetiklenmiyor', scanned.length === 0);
  // Yarım kalan okuma unutulmalı: kullanıcı bir süre sonra Enter'a bastığında
  // eski karakterler kayda geçmemeli.
  await sleep(200);
  await type('', 5, { enter: true });
  ok('duraklamadan sonra basılan Enter yarım diziyi kabul etmiyor',
    scanned.length === 0, JSON.stringify(scanned));

  console.log('\n=== FORM ALANLARIYLA ÇAKIŞMA / NO INTERFERENCE WITH TYPING ===');
  scanned = [];
  const other = doc.getElementById('other');
  await type('8690123456781', 5, { target: other });
  ok('normal bir alana hızlı yazarken devreye girmiyor', scanned.length === 0,
    'aksi halde kullanıcının yazdığı her şey barkod sanılırdı');

  scanned = [];
  other.dataset.barcodeTarget = '1';
  await type('8690123456781', 5, { target: other });
  ok('barkod hedefi işaretli alanda çalışıyor', scanned.length === 1, JSON.stringify(scanned));
  delete other.dataset.barcodeTarget;

  console.log('\n=== DİNLEYİCİ TEMİZLİĞİ / LISTENER CLEANUP ===');
  scanned = [];
  stop();
  await type('8690123456781', 5);
  ok('durdurulduktan sonra dinlemiyor', scanned.length === 0,
    'temizlenmezse pencere kapandıktan sonra da tetiklenirdi');

  // İki kez dinlemek çift kayıt açar; her açılışta önceki durdurulmalı.
  scanned = [];
  const s1 = window.eval('UI.onBarcodeScan(c => globalThis.__hit(c))');
  const s2 = window.eval('UI.onBarcodeScan(c => globalThis.__hit(c))');
  await type('8690123456781', 5);
  ok('iki dinleyici iki kez tetikler (bu yüzden temizlik şart)', scanned.length === 2, String(scanned.length));
  s1(); s2();

  console.log('\n=== KAMERA YOKKEN / WITHOUT A CAMERA ===');
  ok('BarcodeDetector bu ortamda yok (beklenen)', typeof window.BarcodeDetector === 'undefined');
  const itemsSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'views', 'items.js'), 'utf8');
  ok('kod BarcodeDetector varlığını kontrol ediyor', itemsSrc.includes("'BarcodeDetector' in window"));
  ok('kamera yoksa elle giriş yolu açıklanıyor',
    /USB okuyucu|USB reader/.test(itemsSrc) && /Elle|type it in/i.test(itemsSrc));
  ok('kamera izni reddedilirse ayrı mesaj var',
    /izin verilmemiş|permission denied/i.test(itemsSrc));
  ok('kamera akışı kapatılıyor (getTracks/stop)',
    /getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(itemsSrc),
    'kapatılmazsa kamera ışığı açık kalır');
  ok('tarama döngüsü temizleniyor (clearInterval)', /clearInterval\(scanTimer\)/.test(itemsSrc));

  console.log('\n=== BARKOD BİÇİMLERİ / SUPPORTED FORMATS ===');
  const formats = /formats:\s*\[([^\]]*)\]/.exec(itemsSrc);
  const list = formats ? formats[1] : '';
  ok('EAN-13 destekleniyor (perakende standardı)', /ean_13/.test(list));
  ok('Code 128 destekleniyor (lojistik standardı)', /code_128/.test(list));
  ok('QR kod destekleniyor', /qr_code/.test(list));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  console.log('\nNot: Gerçek kamera ile okuma bu ortamda test edilemez. Kameralı okuma');
  console.log('Chrome/Edge\'de BarcodeDetector API ile çalışır; Safari ve Firefox desteklemez,');
  console.log('o tarayıcılarda USB okuyucu veya elle giriş devreye girer.');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
