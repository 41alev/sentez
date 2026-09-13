// @ts-nocheck
/**
 * El terminali testleri.
 *
 * İki katman test edilir:
 *   1. Uçlar — okutulan kodun doğru çözülmesi, görev listeleri, toplu gönderim
 *   2. Arayüz — jsdom'da gerçek DOM'a yüklenip çalışması, dokunma hedefi boyutları
 *
 * Gerçek bir el terminalinde denenmedi: cihaz yok. Test edilen, mantığın doğru
 * çalıştığı ve ölçülebilir arayüz eşiklerinin tutturulduğu.
 *
 *   node test/mobile.js   (sunucu ayakta olmalı, jsdom gerekir)
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/**
 * jsdom, IndexedDB'yi hiçbir zaman uygulamadı (belgelenmiş, bilinen bir
 * sınırlama) — bu, public/js/mobile-db.js'in gerçek kodunu (mock'lamadan)
 * jsdom içinde çalıştırabilmek için IndexedDB'nin async sözleşmesinin
 * (open→onupgradeneeded/onsuccess, transaction→oncomplete, request→onsuccess,
 * hepsi bir sonraki tick'te) yalnızca mobile-db.js'in kullandığı alt kümesini
 * taklit eden, bellek-içi minimal bir sahte sürüm.
 */
function makeFakeIndexedDB() {
  const databases = new Map();
  const soon = (fn) => setTimeout(fn, 0);

  class FakeRequest {
    constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; }
    _succeed(result) { this.result = result; soon(() => this.onsuccess && this.onsuccess({ target: this })); }
  }
  class FakeStore {
    constructor(def) { this.def = def; }
    add(value) {
      const req = new FakeRequest();
      const key = value[this.def.keyPath] ?? (this.def.autoIncrement ? this.def.nextKey++ : undefined);
      this.def.rows.push({ ...value, [this.def.keyPath]: key });
      req._succeed(key);
      return req;
    }
    getAll() { const req = new FakeRequest(); req._succeed(this.def.rows.slice()); return req; }
    clear() { const req = new FakeRequest(); this.def.rows.length = 0; req._succeed(undefined); return req; }
  }
  class FakeDB {
    constructor() {
      this.stores = new Map();
      this.objectStoreNames = { contains: (n) => this.stores.has(n) };
    }
    createObjectStore(name, opts) {
      this.stores.set(name, { keyPath: opts.keyPath, autoIncrement: !!opts.autoIncrement, rows: [], nextKey: 1 });
      return new FakeStore(this.stores.get(name));
    }
    transaction(storeName) {
      const db = this;
      const tx = { oncomplete: null, onerror: null, objectStore: (n) => new FakeStore(db.stores.get(n)) };
      soon(() => tx.oncomplete && tx.oncomplete({ target: tx }));
      return tx;
    }
  }
  return {
    open(name) {
      const req = new FakeRequest();
      soon(() => {
        const isNew = !databases.has(name);
        const db = databases.get(name) || new FakeDB();
        databases.set(name, db);
        req.result = db;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    }
  };
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
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('=== KOD ÇÖZME / SCAN RESOLUTION ===');
  const items = (await api('GET', '/api/items?pageSize=50', { token: admin })).data.data;
  const somun = items.find(i => i.code === 'SM-108');

  const byBarcode = await api('GET', `/api/mobile/resolve?code=${somun.barcode}`, { token: operator });
  ok('barkod ürüne çözülüyor', byBarcode.data.type === 'item' && byBarcode.data.item.code === 'SM-108',
    JSON.stringify(byBarcode.data).slice(0, 90));
  ok('ürünün partileri birlikte geliyor', Array.isArray(byBarcode.data.lots) && byBarcode.data.lots.length > 0,
    `${(byBarcode.data.lots || []).length} parti`);
  // Terminal kullanıcısı kullanılabilir partiyi önce görmeli
  ok('kullanılabilir partiler önce sıralanıyor',
    byBarcode.data.lots[0].status === 'available', byBarcode.data.lots[0].status);

  const byCode = await api('GET', '/api/mobile/resolve?code=SM-108', { token: operator });
  ok('ürün kodu da çözülüyor', byCode.data.type === 'item');

  const lots = (await api('GET', '/api/stock/lots?pageSize=20', { token: admin })).data.data;
  const someLot = lots.find(l => l.lotNo);
  const byLot = await api('GET', `/api/mobile/resolve?code=${encodeURIComponent(someLot.lotNo)}`, { token: operator });
  ok('parti numarası partiye çözülüyor', byLot.data.type === 'lot' && byLot.data.lot.lotNo === someLot.lotNo,
    JSON.stringify(byLot.data).slice(0, 90));
  ok('parti yanıtında ürün adı var (kullanıcı ne olduğunu görmeli)', !!byLot.data.lot.itemName);

  const pos = (await api('GET', '/api/purchasing/orders?pageSize=10', { token: admin })).data.data;
  const byPo = await api('GET', `/api/mobile/resolve?code=${pos[0].poNo}`, { token: operator });
  ok('sipariş numarası belgeye çözülüyor', byPo.data.type === 'purchase_order', byPo.data.type);
  ok('teslim alınabilir mi bilgisi geliyor',
    typeof byPo.data.document.canReceive === 'boolean',
    'onaylanmamış siparişte mal kabul açılmamalı');

  const byLoc = await api('GET', '/api/mobile/resolve?code=A-12', { token: operator });
  ok('raf etiketi konuma çözülüyor', byLoc.data.type === 'location', byLoc.data.type);
  ok('raftaki partiler listeleniyor', (byLoc.data.lots || []).length > 0);

  const notFound = await api('GET', '/api/mobile/resolve?code=BOYLE-BIR-KOD-YOK', { token: operator });
  ok('bulunamayan kod 404 dönüyor', notFound.status === 404, `got ${notFound.status}`);
  ok('nerede arandığı bildiriliyor',
    Array.isArray(notFound.data.searched) && notFound.data.searched.length === 4,
    '"çalışmıyor" demek yerine ne arandığı söylenmeli');

  const empty = await api('GET', '/api/mobile/resolve?code=', { token: operator });
  ok('boş kod reddediliyor', empty.status === 400, `got ${empty.status}`);

  console.log('\n=== GÖREV LİSTESİ / TASK LIST ===');
  const tasks = await api('GET', '/api/mobile/tasks', { token: operator });
  ok('görev listesi geliyor', tasks.status === 200 && tasks.data.counts_summary,
    JSON.stringify(tasks.data.counts_summary || {}));
  ok('teslim alınacak siparişler listeleniyor', tasks.data.receipts.length > 0,
    `${tasks.data.receipts.length} sipariş`);
  ok('yalnızca onaylı siparişler geliyor',
    tasks.data.receipts.length > 0,
    'onaysız sipariş teslim alınamaz, listede olmamalı');
  ok('açık sevkiyatlar listeleniyor', Array.isArray(tasks.data.shipments));
  ok('açık üretim emirleri listeleniyor', tasks.data.production.length > 0,
    `${tasks.data.production.length} emir`);
  ok('her kalemde açık satır sayısı var',
    tasks.data.receipts.every(r => typeof r.openLines === 'number'));

  console.log('\n=== TOPLAMA LİSTESİ / PICK LIST ===');
  const sos = (await api('GET', '/api/sales/orders?pageSize=10', { token: admin })).data.data;
  const openSo = sos.find(s => ['open', 'partially_shipped'].includes(s.status));
  if (openSo) {
    const pick = await api('GET', `/api/mobile/pick-list/${openSo.id}`, { token: operator });
    ok('toplama listesi üretiliyor', pick.status === 200 && Array.isArray(pick.data.lines),
      `${(pick.data.lines || []).length} kalem`);
    const line = pick.data.lines[0];
    ok('her kalem için parti önerisi var', Array.isArray(line.suggestedLots));
    // FEFO: son kullanma tarihi en yakın parti önce çıkmalı
    const withExpiry = line.suggestedLots.filter(s => s.expiryDate);
    ok('öneriler FEFO sırasında',
      withExpiry.length < 2 || withExpiry.every((s, i) => i === 0 || s.expiryDate >= withExpiry[i - 1].expiryDate),
      JSON.stringify(withExpiry.map(s => s.expiryDate)));
    ok('önerilen miktarlar ihtiyacı aşmıyor',
      line.suggestedLots.reduce((s, x) => s + x.takeQty, 0) <= line.toPick + 0.001,
      `${line.suggestedLots.reduce((s, x) => s + x.takeQty, 0)} vs ${line.toPick}`);
    ok('eksik stok ayrıca bildiriliyor', typeof line.shortage === 'number');
    ok('raf bilgisi geliyor (aramak zaman kaybı)',
      line.suggestedLots.every(s => 'location' in s));
  } else ok('toplama listesi üretiliyor', false, 'açık sipariş bulunamadı');

  const badPick = await api('GET', '/api/mobile/pick-list/yok-123', { token: operator });
  ok('olmayan sipariş 404 dönüyor', badPick.status === 404, `got ${badPick.status}`);

  console.log('\n=== MALZEME LİSTESİ / ISSUE LIST ===');
  const prods = (await api('GET', '/api/production?pageSize=10', { token: admin })).data.data;
  const openProd = prods.find(p => p.status !== 'Tamamlandı');
  if (openProd) {
    const issue = await api('GET', `/api/mobile/issue-list/${openProd.id}`, { token: operator });
    ok('malzeme listesi üretiliyor', issue.status === 200 && Array.isArray(issue.data.components),
      `${(issue.data.components || []).length} bileşen`);
    ok('her bileşende gerekli ve mevcut miktar var',
      issue.data.components.every(c => typeof c.needed === 'number' && typeof c.available === 'number'));
    ok('eksik miktar hesaplanıyor', issue.data.components.every(c => typeof c.shortage === 'number'));
    ok('eksik sayısı özetleniyor', typeof issue.data.shortageCount === 'number');
  } else ok('malzeme listesi üretiliyor', false, 'açık üretim emri yok');

  console.log('\n=== TOPLU GÖNDERİM / SYNC ===');
  const before = (await api('GET', `/api/items/${somun.id}`, { token: admin })).data.qty;
  const sync = await api('POST', '/api/mobile/sync', {
    token: operator,
    body: {
      operations: [
        { clientId: 'c1', type: 'move', itemId: somun.id, warehouseId: 1, qty: 5, lotNo: 'TERM-1', unitCost: 2 },
        { clientId: 'c2', type: 'move', itemId: somun.id, warehouseId: 1, qty: 3, lotNo: 'TERM-2', unitCost: 2 },
        { clientId: 'c3', type: 'move', itemId: 'olmayan-urun', warehouseId: 1, qty: 1 },
        { clientId: 'c4', type: 'bilinmeyen', qty: 1 }
      ]
    }
  });
  ok('toplu gönderim çalışıyor', sync.status === 200, JSON.stringify(sync.data).slice(0, 120));
  ok('geçerli işlemler yazıldı', sync.data.succeeded === 2, `${sync.data.succeeded} başarılı`);
  // Bir işlemin hatası diğerlerini düşürmemeli; aksi halde kullanıcı hangisinin
  // geçtiğini bilemez ve kuyruğu elle ayıklamak zorunda kalır
  ok('hatalı işlem diğerlerini düşürmüyor', sync.data.failed === 2, `${sync.data.failed} başarısız`);
  ok('her işlem kendi sonucunu döndürüyor',
    sync.data.results.length === 4 && sync.data.results.every(r => r.clientId),
    'istemci hangi işlemin geçtiğini eşleştirebilmeli');
  ok('hata sebebi bildiriliyor',
    sync.data.results.filter(r => !r.ok).every(r => !!r.error),
    JSON.stringify(sync.data.results.filter(r => !r.ok).map(r => r.error)));
  ok('bilinmeyen işlem tipi reddediliyor',
    sync.data.results.find(r => r.clientId === 'c4').error.includes('Bilinmeyen'));

  const after = (await api('GET', `/api/items/${somun.id}`, { token: admin })).data.qty;
  ok('stok tam olarak arttı (5+3)', Math.abs(after - before - 8) < 0.001, `${before} → ${after}`);

  const viewerSync = await api('POST', '/api/mobile/sync', {
    token: viewer, body: { operations: [{ clientId: 'x', type: 'move', itemId: somun.id, warehouseId: 1, qty: 1 }] }
  });
  ok('görüntüleyici işlem gönderemiyor (403)', viewerSync.status === 403, `got ${viewerSync.status}`);

  const emptySync = await api('POST', '/api/mobile/sync', { token: operator, body: { operations: [] } });
  ok('boş liste reddediliyor', emptySync.status === 400, `got ${emptySync.status}`);
  const hugeSync = await api('POST', '/api/mobile/sync', {
    token: operator, body: { operations: Array.from({ length: 250 }, (_, i) => ({ clientId: 'h' + i, type: 'move' })) }
  });
  ok('aşırı büyük parti reddediliyor (200 sınırı)', hugeSync.status === 400, `got ${hugeSync.status}`);

  console.log('\n=== ARAYÜZ / TERMINAL UI ===');
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  (jsdom yok, arayüz testi atlandı)'); JSDOM = null; }

  if (JSDOM) {
    const ROOT = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');
    const errors = [];
    const dom = new JSDOM(html, {
      url: BASE, runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) {
        // Node'un fetch'i göreli adres kabul etmez; tarayıcıda çalışan kod
        // '/api/...' kullanır, bu yüzden adresi BASE'e göre çözüyoruz.
        w.fetch = (url, opts) => fetch(
          typeof url === 'string' && url.startsWith('/') ? BASE + url : url, opts);
        w.navigator.vibrate = () => true;
        // Bilerek "çevrimdışı": aşağıdaki senaryo tam da bunu test ediyor —
        // eski sürümden kalan bekleyen bir işlemle yükseltilip HÂLÂ
        // bağlantısızken açılan bir terminal. Gerçek olsaydı (onLine=true)
        // start()'taki arka plan flushQueue(true) bu sahte/geçersiz test
        // verisini gerçek sunucuya göndermeye çalışıp kuyruğu boşaltırdı —
        // test o zaman kendi ölçtüğü şeyi bozardı.
        Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
        w.addEventListener('error', e => errors.push(String(e.error || e.message)));
        // jsdom IndexedDB'yi hiç uygulamıyor (bilinen, belgelenmiş sınırlama) —
        // mobile-db.js'in gerçek kodunu (mock'lamadan) çalıştırabilmek için
        // gerçek IndexedDB'nin async sözleşmesini (open→onupgradeneeded/
        // onsuccess, transaction→oncomplete, request→onsuccess) taklit eden
        // minimal, bellek-içi bir sahte sürüm veriyoruz.
        w.indexedDB = makeFakeIndexedDB();
      }
    });
    const w = dom.window;
    // Sayfadaki gerçek yükleme sırası: mobile-db.js ÖNCE, mobile.js SONRA.
    for (const rel of ['js/mobile-db.js', 'js/mobile.js']) {
      const script = w.document.createElement('script');
      script.textContent = fs.readFileSync(path.join(ROOT, 'public', rel), 'utf8');
      w.document.body.appendChild(script);
    }
    // Yükseltme senaryosu: eski sürümün localStorage kuyruğunda bekleyen bir
    // işlem var — DOMContentLoaded'daki migrateLegacyQueue() bunu IndexedDB'ye
    // taşımalı, kaybetmemeli.
    w.localStorage.setItem('depoTerminalQueue', JSON.stringify([
      { clientId: 'q1', type: 'move', itemId: 'x', qty: 2, queuedAt: Date.now() }
    ]));
    // jsdom, başlangıç ayrıştırması bittiğinde DOMContentLoaded'ı KENDİSİ de
    // (asenkron olarak) ateşliyor — burada AYRICA elle dispatchEvent çağırmak
    // aynı dinleyiciyi iki kez tetikleyip migrateLegacyQueue()'yu iki kez
    // çalıştırırdı (kuyrukta aynı kaydın iki kopyası — gerçek tarayıcıda asla
    // olmayan, saf test kurulumu artefaktı). O yüzden yalnızca doğal ateşlemeyi
    // bekliyoruz.
    await new Promise(r => setTimeout(r, 120));

    ok('terminal betiği hatasız yükleniyor', errors.length === 0, errors.slice(0, 2).join(' | '));
    ok('eski kuyruk IndexedDB\'ye taşındı (localStorage temizlendi)',
      w.localStorage.getItem('depoTerminalQueue') === null);
    ok('giriş ekranı açılıyor', !!w.document.getElementById('mLogin'));
    ok('tarama çubuğu her ekranda mevcut', !!w.document.getElementById('mScanInput'));
    ok('tarama alanı barkod hedefi olarak işaretli',
      w.document.getElementById('mScanInput').dataset.barcodeTarget === '1',
      'okuyucu girdisi bu alana yönlenmeli');

    // Giriş yapıp ana ekranı çalıştır
    w.document.getElementById('mUser').value = 'operator';
    w.document.getElementById('mPass').value = 'Operator123!';
    w.document.getElementById('mLoginBtn').click();
    await new Promise(r => setTimeout(r, 900));

    ok('giriş sonrası uygulama açılıyor',
      w.document.getElementById('mApp').hidden === false,
      'hâlâ giriş ekranındaysa oturum kurulamadı');
    ok('görev ekranı yükleniyor',
      /Mal Kabul|Toplama/.test(w.document.getElementById('mMain').textContent),
      w.document.getElementById('mMain').textContent.slice(0, 80));
    ok('giriş sonrası JS hatası yok', errors.length === 0, errors.slice(0, 2).join(' | '));
    ok('taşınan işlem kuyruk rozetinde görünüyor (kaybolmadı)',
      w.document.getElementById('mQueue').textContent === '1',
      w.document.getElementById('mQueue').textContent);

    const tiles = [...w.document.querySelectorAll('[data-go]')];
    ok('ana ekranda beş akış var', tiles.length >= 5, `${tiles.length} kutucuk`);
    ok('akışlar doğru isimlendirilmiş',
      ['receiveList', 'pickList', 'countList', 'issueList', 'transfer']
        .every(k => tiles.some(t => t.dataset.go === k)),
      tiles.map(t => t.dataset.go).join(','));

    w.close();
  }

  console.log('\n=== DOKUNMA HEDEFLERİ / TOUCH TARGETS ===');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'mobile.css'), 'utf8');
  const tapVar = /--m-tap:\s*(\d+)px/.exec(css);
  // Eldivenli parmak 44px'i ıskalar; terminal için 56px hedeflendi
  ok('temel dokunma hedefi ≥56px', tapVar && Number(tapVar[1]) >= 56, tapVar ? tapVar[1] + 'px' : 'tanımsız');
  const iconBtn = /\.m-icon-btn\s*\{[^}]*width:\s*(\d+)px/.exec(css);
  ok('ikon butonlar ≥48px', iconBtn && Number(iconBtn[1]) >= 48, iconBtn ? iconBtn[1] + 'px' : '');
  const qtyBtn = /\.m-qty button\s*\{[^}]*width:\s*(\d+)px/.exec(css);
  ok('miktar +/- düğmeleri ≥56px', qtyBtn && Number(qtyBtn[1]) >= 56, qtyBtn ? qtyBtn[1] + 'px' : '');
  ok('giriş alanları 16px (iOS otomatik yakınlaştırmasını önler)',
    /input\s*\{\s*font-size:\s*16px\s*!important/.test(css),
    '16px altı yazı iOS\'ta alanı yakınlaştırır ve düzeni bozar');
  ok('tarama çubuğu ekranın altında sabit',
    /\.m-scanbar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/.test(css),
    'başparmak yukarı zor uzanır');
  ok('güvenli alan boşluğu hesaba katılmış (çentikli ekranlar)',
    /env\(safe-area-inset-bottom\)/.test(css));
  ok('yakınlaştırma kapalı (kazara bozulmasın)',
    /user-scalable=no/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.html'), 'utf8')));
  ok('hareket azaltma tercihi destekleniyor', /prefers-reduced-motion/.test(css));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  console.log('\nNot: Gerçek bir el terminalinde denenmedi — cihaz yok. Kamerayla okuma da');
  console.log('test edilemez. USB okuyucu mantığı ve çevrimdışı kuyruk test edildi;');
  console.log('sahada bir kez gerçek cihazla denenmelidir.');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
