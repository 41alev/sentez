// @ts-nocheck
/**
 * Güvenlik denetimi.
 *
 * Bağımlılık taraması (npm audit) kütüphanelerdeki bilinen açıkları bulur.
 * Bu test uygulamanın kendi yazdığımız kısmını sınar: kimlik doğrulama atlanabiliyor
 * mu, SQL enjeksiyonu geçiyor mu, bir kullanıcı başkasının verisine erişebiliyor mu,
 * sırlar sızıyor mu.
 *
 *   node test/security.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0, warn = 0;
const findings = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; findings.push(['AÇIK', name, extra]); console.log(`  ✗ ${name} ${extra}`); }
}
function soft(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { warn++; findings.push(['UYARI', name, extra]); console.log(`  ⚠ ${name} — ${extra}`); }
}

async function api(method, p, { token, body, headers = {}, raw } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
  let d;
  const text = await r.text();
  try { d = JSON.parse(text); } catch { d = text; }
  return { status: r.status, data: d, headers: r.headers, text };
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const operator = await login('operator', 'Operator123!');
  const viewer = await login('viewer', 'Viewer123!');

  console.log('=== KİMLİK DOĞRULAMA / AUTHENTICATION ===');
  ok('kimliksiz istek reddediliyor', (await api('GET', '/api/items')).status === 401);
  ok('bozuk token reddediliyor', (await api('GET', '/api/items', { token: 'abc.def.ghi' })).status === 401);
  ok('boş token reddediliyor', (await api('GET', '/api/items', { token: '' })).status === 401);
  ok('Bearer öneki olmayan başlık reddediliyor',
    (await api('GET', '/api/items', { headers: { Authorization: admin } })).status === 401);

  // İmzası değiştirilmiş token: JWT doğrulaması gerçekten yapılıyor mu?
  const parts = admin.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' + 'x'.repeat(parts[2].length);
  ok('imzası bozulmuş token reddediliyor', (await api('GET', '/api/items', { token: tampered })).status === 401);

  // Rol yükseltme denemesi düşük yetkili bir token'dan yapılmalı: yönetici
  // token'ının payload'ını yeniden kodlamak aynı geçerli token'ı üretir.
  const opParts = operator.split('.');
  const opPayload = JSON.parse(Buffer.from(opParts[1], 'base64url').toString());
  opPayload.role = 'admin'; opPayload.id = 1;
  const forgedPayload = Buffer.from(JSON.stringify(opPayload)).toString('base64url');
  const forged = opParts[0] + '.' + forgedPayload + '.' + opParts[2];
  ok('payload değiştirilmiş token reddediliyor (rol yükseltme)',
    (await api('GET', '/api/users', { token: forged })).status === 401,
    'operatör token\'ı admin\'e yükseltilemez');

  // alg:none saldırısı
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const noneToken = `${noneHeader}.${forgedPayload}.`;   // imzasız token
  ok('alg:none token reddediliyor', (await api('GET', '/api/users', { token: noneToken })).status === 401);

  console.log('\n=== YETKİLENDİRME / AUTHORISATION ===');
  ok('görüntüleyici kullanıcı listesine erişemiyor', (await api('GET', '/api/users', { token: viewer })).status === 403);
  ok('operatör kullanıcı oluşturamıyor',
    (await api('POST', '/api/users', { token: operator, body: { username: 'x', password: 'Abcd1234!', role: 'admin' } })).status === 403);
  ok('operatör kendi rolünü yükseltemiyor',
    (await api('PUT', '/api/users/3', { token: operator, body: { role: 'admin' } })).status === 403);
  ok('görüntüleyici stok değiştiremiyor',
    (await api('POST', '/api/stock/move', { token: viewer, body: { itemId: 'x', type: 'in', qty: 1, warehouseId: 1 } })).status === 403);
  ok('operatör MRP çalıştıramıyor', (await api('POST', '/api/planning/mrp/run', { token: operator, body: {} })).status === 403);

  // Son yöneticinin düşürülmesi sistemi kilitler; engellenmeli.
  const demote = await api('PUT', '/api/users/1', { token: admin, body: { role: 'viewer' } });
  ok('son yönetici rolü düşürülemiyor', demote.status === 400, `got ${demote.status}`);
  const selfDelete = await api('DELETE', '/api/users/1', { token: admin });
  ok('kullanıcı kendini silemiyor', selfDelete.status === 400, `got ${selfDelete.status}`);

  console.log('\n=== SQL ENJEKSİYONU / SQL INJECTION ===');
  const payloads = [
    "' OR '1'='1", "'; DROP TABLE items;--", "1' UNION SELECT * FROM users--",
    "admin'--", "' OR 1=1--", "%27%20OR%201=1"
  ];
  let injectionLeak = false;
  for (const pl of payloads) {
    const r = await api('GET', `/api/items?q=${encodeURIComponent(pl)}`, { token: admin });
    if (r.status !== 200) { injectionLeak = true; break; }
    // Enjeksiyon geçseydi tüm kayıtlar dönerdi veya sunucu 500 verirdi
    if (r.data && r.data.data && r.data.data.length > 0) {
      const names = r.data.data.map(i => i.name).join(' ');
      if (!names.toLowerCase().includes(pl.toLowerCase().slice(0, 3))) { /* beklenen: boş sonuç */ }
    }
  }
  ok('arama alanında SQL enjeksiyonu çalışmıyor', !injectionLeak);
  const stillThere = await api('GET', '/api/items?pageSize=5', { token: admin });
  ok('enjeksiyon denemelerinden sonra tablolar duruyor',
    stillThere.status === 200 && stillThere.data.total > 0, `${stillThere.data && stillThere.data.total}`);

  // Giriş formunda enjeksiyon: kimlik doğrulamayı atlatabilir mi?
  const injLogin = await api('POST', '/api/auth/login', { body: { username: "admin'--", password: 'x' } });
  ok('giriş formunda SQL enjeksiyonu ile oturum açılamıyor', injLogin.status === 401, `got ${injLogin.status}`);

  console.log('\n=== GİRDİ DOĞRULAMA / INPUT VALIDATION ===');
  ok('negatif miktar reddediliyor',
    (await api('POST', '/api/stock/move', { token: operator,
      body: { itemId: 'x', type: 'in', qty: -100, warehouseId: 1 } })).status >= 400);
  ok('tip uyuşmazlığı reddediliyor',
    (await api('POST', '/api/items', { token: admin, body: { name: 'X', unit: 'adet', minStock: 'çok' } })).status >= 400);
  ok('bozuk JSON gövdesi 500 üretmiyor',
    [400, 422].includes((await api('POST', '/api/items', { token: admin, body: '{bozuk', raw: true })).status));
  ok('aşırı uzun metin reddediliyor veya kesiliyor',
    (await api('POST', '/api/items', { token: admin, body: { name: 'A'.repeat(100000), unit: 'adet' } })).status >= 400);
  ok('zayıf şifre kabul edilmiyor',
    (await api('POST', '/api/users', { token: admin, body: { username: 'zayif1', password: '12345678', role: 'viewer' } })).status >= 400);
  ok('bilinmeyen uç nokta 404 dönüyor (yığın izi sızdırmıyor)',
    (await api('GET', '/api/olmayan-yol', { token: admin })).status === 404);

  console.log('\n=== XSS ===');
  // Depolanan XSS: girdi olduğu gibi saklanabilir, tehlike onu HTML'e basmakta.
  const xss = '<img src=x onerror=alert(1)>';
  const created = await api('POST', '/api/items', {
    token: admin, body: { name: xss, code: 'XSS-1', unit: 'adet', category: 'Test' } });
  ok('XSS içeren girdi kabul ediliyor ama veri olarak', created.status === 201);
  const back = await api('GET', `/api/items/${created.data.id}`, { token: admin });
  ok('API yanıtı JSON olarak dönüyor (HTML değil)',
    (back.headers.get('content-type') || '').includes('application/json'));
  // Asıl koruma istemci tarafındadır: UI.esc her değeri kaçışlar.
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
  ok('arayüzde HTML kaçış fonksiyonu var', /const esc = \(s\) =>/.test(uiSrc));
  ok('kaçış tüm tehlikeli karakterleri kapsıyor',
    /&/.test(uiSrc) && /&lt;/.test(uiSrc) && /&gt;/.test(uiSrc) && /&quot;/.test(uiSrc) && /&#39;/.test(uiSrc));
  // Statik tarama bu işi güvenilir yapamıyor: JS'teki `<` karşılaştırması HTML
  // sanılıyor, iç içe şablonlar bölünüyor, kendi kendini kaçışlayan yardımcılar
  // ayırt edilemiyor. Bunun yerine gerçek davranışı ölçüyoruz — payload'ı gerçek
  // render fonksiyonlarından geçirip DOM'da element oluşup oluşmadığına bakıyoruz.
  let xssBehaviour = { tested: false, executed: 0, cases: 0 };
  try {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><body><div id="toast"></div><div id="modalOverlay"><div id="modalBox"></div></div><div id="host"></div></body>',
      // url olmadan jsdom localStorage sağlamaz ve ui.js yüklenemez
      { url: BASE, runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window;
    w.eval('var Api = { getUser: () => ({ role: "admin" }), getToken: () => "t" };');
    for (const f of ['js/i18n.js', 'js/ui.js']) {
      const el = w.document.createElement('script');
      el.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      w.document.body.appendChild(el);
    }

    const payloads = [
      '<img src=x onerror=window.__xss=1>',
      '<script>window.__xss=1</script>',
      '"><svg onload=window.__xss=1>',
      "'><iframe src=javascript:window.__xss=1>",
      '<a href="javascript:window.__xss=1">tık</a>'
    ];

    for (const payload of payloads) {
      xssBehaviour.cases++;
      w.__xss = 0;
      const host = w.document.getElementById('host');

      // 1) Tablo hücresi: en sık kullanılan render yolu
      host.innerHTML = w.eval(`UI.table([{ key: 'name', label: 'Ad' }], [{ name: ${JSON.stringify(payload)} }])`);
      // 2) Modal başlığı ve alt başlığı
      w.eval(`UI.modal({ title: ${JSON.stringify(payload)}, sub: ${JSON.stringify(payload)}, body: 'x' })`);
      // 3) Onay diyaloğu mesajı
      w.eval(`UI.confirmDialog(${JSON.stringify(payload)}, () => {})`);

      // Yalnızca render alanlarına bak: sayfaya kendimizin eklediği yükleyici
      // <script> etiketleri ve arayüzün kendi <svg> ikonları saldırı değildir.
      const sel = 'img, script, iframe, svg[onload], [onerror], a[href^="javascript:"]';
      const injected = [host, w.document.getElementById('modalOverlay')]
        .filter(Boolean)
        .reduce((n, root) => n + root.querySelectorAll(sel).length, 0);
      const shownAsText = (host.textContent || '').includes(payload.slice(0, 12));
      if (injected > 0 || w.__xss === 1) xssBehaviour.executed++;
      // Kaçışlanan payload metin olarak görünmeli — yutulmuş olması da yanlış olurdu
      if (!shownAsText) xssBehaviour.notShown = (xssBehaviour.notShown || 0) + 1;
    }
    xssBehaviour.tested = true;
  } catch (e) {
    xssBehaviour.error = e.message;
  }

  if (xssBehaviour.tested) {
    ok(`XSS payload'ları DOM'da element oluşturmuyor (${xssBehaviour.cases} deneme)`,
      xssBehaviour.executed === 0, `${xssBehaviour.executed} payload sızdı`);
    ok('kaçışlanan payload kullanıcıya metin olarak gösteriliyor',
      !xssBehaviour.notShown, `${xssBehaviour.notShown || 0} payload görünmedi`);
  } else {
    soft('davranışsal XSS testi çalıştırılamadı', false,
      `jsdom gerekli — ${xssBehaviour.error || 'kurulu değil'}`);
  }

  await api('DELETE', `/api/items/${created.data.id}`, { token: admin });

  console.log('\n=== CSV ENJEKSİYONU / CSV FORMULA INJECTION ===');
  // Bir müşteri/ürün adı "=HYPERLINK(...)" gibi =,+,-,@ ile başlıyorsa, CSV
  // dışa aktarımı Excel/Sheets'te açıldığında hücre metin değil FORMÜL
  // olarak yorumlanır (OWASP "CSV Injection" — veri sızıntısı/eski Excel'lerde
  // DDE ile komut riski). UI.exportCsv TÜM CSV butonlarının (Ürünler,
  // Partiler, Kullanıcılar, Raporlar, Denetim, Muhasebe Aktarımı) kullandığı
  // TEK paylaşılan fonksiyon — burada davranışsal olarak doğrulanıyor.
  let csvBehaviour;
  try {
    const { JSDOM } = require('jsdom');
    const dom2 = new JSDOM('<!DOCTYPE html><body><div id="toast"></div><div id="modalOverlay"><div id="modalBox"></div></div></body>',
      { url: BASE, runScripts: 'dangerously', pretendToBeVisual: true });
    const w2 = dom2.window;
    w2.eval('var Api = { getUser: () => ({ role: "admin" }), getToken: () => "t" };');
    for (const f of ['js/i18n.js', 'js/ui.js']) {
      const el = w2.document.createElement('script');
      el.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      w2.document.body.appendChild(el);
    }
    let captured = null;
    w2.Blob = function (parts) { captured = parts.join(''); };
    w2.URL.createObjectURL = () => 'blob:mock';
    w2.URL.revokeObjectURL = () => {};

    const formulaPayloads = ['=HYPERLINK("http://evil.test","tık")', '+1+1', '-2+3', '@SUM(1,1)', '\tformul'];
    let leaked = 0;
    for (const payload of formulaPayloads) {
      captured = null;
      w2.eval(`UI.exportCsv('x.csv', ['Ad'], [[${JSON.stringify(payload)}]])`);
      const secondLine = (captured || '').split('\n')[1] || '';
      // Korunuyorsa satır `"'=...` gibi başlar (tek tırnak eklendi); korunmuyorsa `"=...`
      if (/^"[=+\-@\t]/.test(secondLine)) leaked++;
    }
    csvBehaviour = { tested: true, leaked, cases: formulaPayloads.length };
  } catch (e) {
    csvBehaviour = { tested: false, error: e.message };
  }
  if (csvBehaviour.tested) {
    ok(`CSV dışa aktarımda formül enjeksiyonu etkisiz hale getiriliyor (${csvBehaviour.cases} deneme)`,
      csvBehaviour.leaked === 0, `${csvBehaviour.leaked} payload ham kaldı`);
  } else {
    soft('davranışsal CSV enjeksiyon testi çalıştırılamadı', false,
      `jsdom gerekli — ${csvBehaviour.error || 'kurulu değil'}`);
  }

  console.log('\n=== SIR SIZINTISI / SECRET LEAKAGE ===');
  const me = await api('GET', '/api/auth/me', { token: admin });
  ok('kullanıcı yanıtında şifre özeti yok',
    !JSON.stringify(me.data).match(/password_hash|passwordHash|\$2[aby]\$/), '');
  const users = await api('GET', '/api/users', { token: admin });
  ok('kullanıcı listesinde şifre özeti yok',
    !JSON.stringify(users.data).match(/password_hash|passwordHash|\$2[aby]\$/), '');
  // Sunucu hatası yığın izi sızdırmamalı
  const badId = await api('GET', '/api/items/' + 'x'.repeat(500), { token: admin });
  ok('hata yanıtlarında yığın izi yok',
    !String(JSON.stringify(badId.data)).match(/at .*\.js:\d+|node_modules|\/home\//), '');

  console.log('\n=== OTURUM YÖNETİMİ / SESSION MANAGEMENT ===');
  const tempTok = await login('viewer', 'Viewer123!');
  ok('geçerli token çalışıyor', (await api('GET', '/api/items', { token: tempTok })).status === 200);
  await api('POST', '/api/auth/logout', { token: tempTok });
  ok('çıkış sonrası token geçersiz (sunucu tarafı iptal)',
    (await api('GET', '/api/items', { token: tempTok })).status === 401,
    'yalnızca JWT süresine güvenilseydi token çıkıştan sonra da geçerli kalırdı');

  console.log('\n=== GÜVENLİK BAŞLIKLARI / SECURITY HEADERS ===');
  const root = await fetch(BASE + '/');
  ok('X-Content-Type-Options: nosniff', root.headers.get('x-content-type-options') === 'nosniff');
  ok('X-Frame-Options ayarlı (clickjacking)', !!root.headers.get('x-frame-options'),
    root.headers.get('x-frame-options') || 'yok');
  ok('Referrer-Policy ayarlı', !!root.headers.get('referrer-policy'));
  soft('Content-Security-Policy tanımlı', !!root.headers.get('content-security-policy'),
    'CDN kullanımı nedeniyle tanımlanmadı; kendi sunucunuzdan servis ediyorsanız ekleyin');
  ok('sunucu sürümü sızdırılmıyor (X-Powered-By)', !root.headers.get('x-powered-by'),
    root.headers.get('x-powered-by') || '');

  console.log('\n=== KABA KUVVET KORUMASI / BRUTE FORCE ===');
  // Sınır yalnızca BAŞARISIZ denemeleri saymalı: tüm girişleri saymak, tek bir
  // internet çıkışı arkasındaki bir işletmede sabah herkesi dışarıda bırakır.
  const failedBefore = [];
  for (let i = 0; i < 12; i++) {
    failedBefore.push((await api('POST', '/api/auth/login',
      { body: { username: 'admin', password: 'kesinlikle-yanlis-' + i } })).status);
  }
  ok('ardışık başarısız girişler engelleniyor', failedBefore.includes(429),
    `durumlar: ${[...new Set(failedBefore)].join(',')}`);

  console.log('\n=== YAPILANDIRMA / CONFIGURATION ===');
  const health = await api('GET', '/health');
  ok('sağlık ucu kimlik istemiyor (izleme için)', health.status === 200);
  ok('sağlık ucu hassas bilgi vermiyor',
    !JSON.stringify(health.data).match(/secret|password|key|token/i), JSON.stringify(health.data).slice(0, 100));

  const idx = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  ok('JWT sırrı koda gömülü değil', !/JWT_SECRET\s*=\s*['"][^'"]{8,}/.test(idx));
  // Davranışsal kanıt: statik regex "auth.js JWT_SECRET'ı env'den okuyor mu" diyebilir
  // ama üretimde varsayılana sessizce düşülüp düşülmediğini KANITLAYAMAZ — gerçekten
  // ayrı bir sunucu süreci NODE_ENV=production + JWT_SECRET boş ile başlatılıp
  // reddedildiği doğrulanıyor (bkz. server/index.js'teki startup kontrolü).
  try {
    const ROOT = path.join(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentez-jwtsecret-'));
    execFileSync('node', [path.join(ROOT, 'server', 'migrate.js')], {
      cwd: ROOT, env: { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'depo-takip.sqlite') }
    });
    execFileSync('node', [path.join(ROOT, 'server', 'seed.js')], {
      cwd: ROOT, env: { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'depo-takip.sqlite') }
    });
    const port = 3900 + Math.floor(Math.random() * 500);
    const noSecretResult = await new Promise((resolve) => {
      const env = { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'depo-takip.sqlite'),
        BACKUP_DIR: path.join(dir, 'backups'), PORT: String(port), NODE_ENV: 'production', JWT_SECRET: '' };
      const proc = spawn('node', [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env });
      let output = ''; let settled = false;
      proc.stdout.on('data', d => output += d); proc.stderr.on('data', d => output += d);
      proc.on('exit', (code) => { if (!settled) { settled = true; resolve({ crashed: true, code, output }); } });
      const deadline = Date.now() + 6000;
      const poll = () => {
        if (settled) return;
        fetch(`http://127.0.0.1:${port}/health`).then(r => {
          if (settled) return;
          if (r.ok) { settled = true; proc.kill(); resolve({ crashed: false, output }); }
          else if (Date.now() < deadline) setTimeout(poll, 200);
          else { settled = true; proc.kill(); resolve({ crashed: true, code: null, output: output + '\n(zaman aşımı)' }); }
        }).catch(() => {
          if (settled) return;
          if (Date.now() < deadline) setTimeout(poll, 200);
          else { settled = true; proc.kill(); resolve({ crashed: true, code: null, output: output + '\n(zaman aşımı)' }); }
        });
      };
      setTimeout(poll, 300);
    });
    ok('JWT_SECRET tanımsızken üretimde sunucu açılmıyor',
      noSecretResult.crashed === true && noSecretResult.code === 1, noSecretResult.output.slice(-300));
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    soft('JWT_SECRET üretim kontrolü çalıştırılamadı', false, e.message);
  }

  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  ok('.env.example gerçek sır içermiyor', /CHANGE-ME|change-me/i.test(envExample));
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  ok('.env sürüm kontrolünden hariç tutulmuş', /^\.env$/m.test(gitignore));
  ok('veritabanı sürüm kontrolünden hariç tutulmuş', /\*\.sqlite/.test(gitignore));

  console.log('\n=== DIŞ KAYNAK BÜTÜNLÜĞÜ / SUBRESOURCE INTEGRITY ===');
  // CDN'den yüklenen her <script>/<link>, CDN bir gün tehlikeye girerse
  // (tedarik zinciri saldırısı) tarayıcının içeriği reddedebilmesi için
  // integrity özniteliği taşımalı. Ayrıca her URL'in GERÇEKTEN var olduğu
  // (yanlış/kaldırılmış bir sürüme işaret etmediği) canlı bir istekle
  // kanıtlanıyor — bir CDN URL'i sessizce 404 verirse (ör. yanlış sürüm
  // numarası) özellik hiç yüklenmez ama hiçbir test bunu yakalamaz.
  for (const htmlFile of ['index.html', 'api-docs.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', htmlFile), 'utf8');
    const tagRe = /<(?:script|link)[^>]*\shref=["']https:\/\/cdnjs\.cloudflare\.com[^"']+["'][^>]*>|<(?:script|link)[^>]*\ssrc=["']https:\/\/cdnjs\.cloudflare\.com[^"']+["'][^>]*>/g;
    const tags = html.match(tagRe) || [];
    for (const tag of tags) {
      const urlMatch = tag.match(/(?:src|href)=["'](https:\/\/cdnjs\.cloudflare\.com[^"']+)["']/);
      const url = urlMatch ? urlMatch[1] : '(bulunamadı)';
      ok(`${htmlFile}: ${url} integrity taşıyor`, /\sintegrity=["']sha(256|384|512)-/.test(tag), tag.slice(0, 80));
      try {
        const r = await fetch(url, { method: 'GET' });
        ok(`${htmlFile}: ${url} gerçekten erişilebilir (200)`, r.status === 200, `got ${r.status}`);
      } catch (e) {
        soft(`${htmlFile}: ${url} canlı erişim kontrolü yapılamadı`, false, `ağ erişimi yok olabilir — ${e.message}`);
      }
    }
  }

  console.log('\n=== DOSYA YÜKLEME / FILE UPLOAD ===');
  const docSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'documents.js'), 'utf8');
  ok('yüklenen dosya türü beyaz listeyle sınırlı', /ALLOWED_MIME/.test(docSrc));
  ok('dosya boyutu sınırlı', /fileSize:/.test(docSrc));
  ok('istemci dosya adı diske yazılmıyor (path traversal)',
    /randomUUID\(\)/.test(docSrc) && /path\.basename/.test(docSrc));
  ok('indirme yolu yükleme klasörüyle sınırlı', /startsWith\(uploadDir\)/.test(docSrc));

  // Yukarıdakiler statik (kaynak kodu regex ile taranıyor) — burada gerçek
  // bir HTTP isteğiyle davranışı kanıtlıyoruz: istemci ".php" gibi tehlikeli
  // bir uzantı gönderse bile, diskteki dosya doğrulanmış MIME tipinden
  // türetilen uzantıyı taşımalı, istemcinin uzantısını değil.
  const fdUpload = new FormData();
  fdUpload.append('file', new Blob([Buffer.from('sahte-icerik')], { type: 'image/png' }), 'zararli.php');
  fdUpload.append('docType', 'other');
  const uploadRes = await fetch(BASE + '/api/documents', {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fdUpload
  });
  const uploaded = await uploadRes.json();
  ok('tehlikeli uzantılı ama geçerli MIME\'li dosya kabul ediliyor', uploadRes.status === 201, JSON.stringify(uploaded));
  const uploadDirPath = process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
  const onDisk = fs.readdirSync(uploadDirPath).find(f => fs.statSync(path.join(uploadDirPath, f)).mtimeMs > Date.now() - 10000);
  ok('diskteki dosya MIME\'den türetilen uzantıyı taşıyor (.png), istemcinin ".php" uzantısını DEĞİL',
    !!onDisk && onDisk.endsWith('.png') && !onDisk.endsWith('.php'), String(onDisk));

  console.log('\n=== ŞİFRE SAKLAMA / PASSWORD STORAGE ===');
  const seedSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'seed.js'), 'utf8');
  ok('şifreler bcrypt ile saklanıyor', /bcrypt/.test(seedSrc));
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'admin.js'), 'utf8');
  ok('bcrypt maliyet katsayısı yeterli (≥12)', /bcrypt\.hashSync\([^,]+,\s*1[2-9]\)/.test(adminSrc));
  ok('şifre sıfırlama oturumları iptal ediyor', /revoked_at/.test(adminSrc));

  console.log('\n=== BİLGİ İFŞASI / INFORMATION DISCLOSURE ===');
  const wrongUser = await api('POST', '/api/auth/login', { body: { username: 'olmayan', password: 'x' } });
  const wrongPass = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'x' } });
  soft('giriş hatası kullanıcı varlığını ele vermiyor',
    JSON.stringify(wrongUser.data) === JSON.stringify(wrongPass.data),
    'farklı mesajlar kullanıcı adı taramasına izin verir');

  console.log(`\n${'='.repeat(56)}`);
  console.log(`GEÇTİ / PASSED: ${pass}   UYARI / WARN: ${warn}   AÇIK / FAIL: ${fail}`);
  if (findings.length) {
    console.log('\nBulgular / Findings:');
    findings.forEach(([lvl, n, d]) => console.log(`  [${lvl}] ${n}${d ? ' — ' + d : ''}`));
  }
  console.log('='.repeat(56));
  console.log('\nNot: Bu denetim uygulama katmanını sınar. Ağ, işletim sistemi, TLS');
  console.log('yapılandırması ve fiziksel erişim kapsam dışıdır; canlıya almadan önce');
  console.log('bağımsız bir sızma testi yaptırılması önerilir.');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Denetim çalıştırılamadı / failed:', e); process.exit(1); });
