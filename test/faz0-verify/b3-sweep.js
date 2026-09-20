// Batch 3 — tüm uç noktaların sistematik taraması: kimlik doğrulama, rol matrisi, fuzz (500 / bilgi sızıntısı)
const fs = require('node:fs');
const path = require('node:path');
const { start, api, ok, check, info, finish, state } = require('./lib');
/** @type {typeof import('node:assert/strict')} */
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..'); // test/faz0-verify -> test -> proje kökü
const PREFIX = {
  accounting: '/accounting', admin: '', auth: '/auth', crm: '/crm', 'data-health': '/data-health', docs: '/docs', documents: '/documents',
  import: '/import', items: '/items', labels: '/labels', mobile: '/mobile', notifications: '/notifications', planning: '/planning',
  production: '/production', purchasing: '/purchasing', quality: '/quality', reports: '/reports', sales: '/sales', search: '/search',
  stock: '/stock', support: '/support', templates: '/templates', visits: '/visits', webhooks: '/webhooks'
};
function discoverRoutes() {
  const out = [];
  for (const [file, prefix] of Object.entries(PREFIX)) {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', file + '.js'), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) out.push({ method: m[1].toUpperCase(), path: prefix + (m[2] === '/' ? '' : m[2]), file });
  }
  return out;
}
const fill = (p, v = '1') => p.replace(/:[A-Za-z]+/g, v);

(async () => {
  await start();
  const db = state.db;
  const allRoutes = discoverRoutes();
  // Oturumu kapatan/şifre değiştiren uçlar test kimliklerini bozar: taramanın dışında tutulur, ayrıca AU-* testlerinde denendi.
  const SKIP = new Set(['POST /auth/logout', 'POST /auth/change-password', 'POST /auth/login']);
  const routes = allRoutes.filter(r => !SKIP.has(r.method + ' ' + r.path));
  info('SW-00', 'keşfedilen uç nokta sayısı', { toplam: routes.length, mobilHaric: routes.filter(r => r.file !== 'mobile').length });
  const PUBLIC = new Set(['POST /auth/login', 'GET /docs/openapi.json']);

  await check('SW-01', 'kimlik doğrulama: herkese açık olmayan HER uç nokta tokensiz 401 döner', async () => {
    const leaks = [];
    for (const r of routes) {
      if (PUBLIC.has(r.method + ' ' + r.path)) continue;
      const x = await api(r.method, fill(r.path), r.method === 'GET' ? undefined : {}, null);
      if (x.status !== 401) leaks.push(`${r.method} /api${r.path} -> ${x.status}`);
    }
    assert.equal(leaks.length, 0, leaks.slice(0, 20).join('\n'));
  });

  await check('SW-02', 'HTTP yöntemleri: tanımsız yöntemler 404/405 (500 değil); OPTIONS/HEAD güvenli', async () => {
    const bad = [];
    for (const [m, u] of [['PATCH', '/items'], ['PUT', '/stock/lots'], ['DELETE', '/reports/summary'], ['HEAD', '/items'], ['OPTIONS', '/items']]) {
      const r = await fetch(state.base + '/api' + u, { method: m, headers: { Authorization: 'Bearer ' + (await (async () => { await api('GET', '/items'); return state.tokens.admin; })()) } });
      if (r.status >= 500) bad.push(`${m} ${u} -> ${r.status}`);
    }
    assert.equal(bad.length, 0, bad.join(', '));
  });

  // ---- Yetki matrisi
  const ROLES = ['viewer', 'operator', 'quality', 'manager'];
  const matrix = {}; const mutating = routes.filter(r => r.method !== 'GET' && r.file !== 'mobile');
  await check('SW-03', 'yetki matrisi: her mutasyon ucu her role karşı denenir (2xx/validasyon = yetki geçti)', async () => {
    for (const r of mutating) {
      const key = `${r.method} ${r.path}`; matrix[key] = {};
      for (const who of ROLES) {
        const x = await api(r.method, fill(r.path), {}, who);
        matrix[key][who] = x.status === 403 ? 'X' : (x.status === 401 ? '401' : (x.status < 300 ? '2xx' : 'ok(' + x.status + ')'));
      }
    }
    fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'results', 'authz-matrix.json'), JSON.stringify(matrix, null, 1));
  });
  await check('SW-04', 'viewer (salt okunur) hiçbir mutasyon ucuna yetkili değil (raporlama/kişisel işlemler hariç)', async () => {
    const allowed = new Set(['POST /reports/pivot', 'POST /reports/saved', 'DELETE /reports/saved/:id', 'POST /auth/logout', 'POST /auth/change-password',
      'POST /notifications/:id/read', 'POST /notifications/read-all']);
    const leaks = Object.entries(matrix).filter(([k, v]) => v.viewer !== 'X' && !allowed.has(k)).map(([k, v]) => `${k} -> ${v.viewer}`);
    info('SW-04b', 'viewer için "X" olmayan mutasyon uçları', leaks);
    assert.equal(leaks.length, 0, leaks.join('\n'));
  });
  await check('SW-05', 'quality/operator/manager için beklenmeyen yetkiler (bilgi: her rol için izinli mutasyon sayısı)', async () => {
    const summary = {};
    for (const who of ROLES) summary[who] = Object.entries(matrix).filter(([, v]) => v[who] !== 'X').map(([k]) => k);
    fs.writeFileSync(path.join(__dirname, 'results', 'role-permissions.json'), JSON.stringify(summary, null, 1));
    info('SW-05b', 'izinli mutasyon sayıları', Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.length])));
  });
  await check('SW-06', 'yönetim/güvenlik uçları yalnız admin: kullanıcı, webhook, veri saklama, onay kuralı, lisans, anonimleştirme', async () => {
    const adminOnly = ['POST /users', 'PUT /users/:id', 'DELETE /users/:id', 'POST /users/:id/anonymize', 'POST /approval-rules', 'DELETE /approval-rules/:id',
      'POST /webhooks', 'PUT /webhooks/:id', 'DELETE /webhooks/:id', 'POST /data-retention/run', 'POST /sales/customers/:id/anonymize', 'POST /purchasing/suppliers/:id/anonymize', 'POST /users/:id/unlock'];
    const bad = adminOnly.filter(k => matrix[k] && ['viewer', 'operator', 'quality', 'manager'].some(w => matrix[k][w] !== 'X')).map(k => `${k}: ${JSON.stringify(matrix[k])}`);
    assert.equal(bad.length, 0, bad.join('\n'));
  });

  // ---- Fuzz
  const results = { fivexx: [], leaks: [] };
  const bodies = [
    ['{}', {}], ['dizi', []], ['null-alanlar', { a: null, b: null, id: null, name: null, qty: null }],
    ['iç içe', { a: { b: [1, 2, { c: null }] }, items: [{}], lines: [null], operations: [{}] }],
    ['tip karışık', { name: 123, qty: 'abc', price: {}, id: [], date: true, items: 'x', lines: 5 }],
    ['sql/tırnak', { name: "x'); DROP TABLE users;--", q: '"\'%_\\', code: '🙂💥\u0000\u202e', title: '<script>alert(1)</script>' }],
    ['dev', { name: 'x'.repeat(300000) }],
    ['negatif/sonsuz', { qty: -1e308, price: 1e308, amount: -1, page: -5, pageSize: 1e9, id: -1 }]
  ];
  const queries = ['', '?page=-1', '?page=abc&pageSize=abc', "?q='%22;--", '?q=%25&status=%27', '?pageSize=100000', '?from=abc&to=2026-99-99', '?days=abc', '?itemId[]=1&itemId[]=2', '?a=' + 'z'.repeat(20000)];
  const pathVals = ["'", '%00', '../../etc/passwd', '9'.repeat(400), '-1', 'null', 'undefined', '<script>'];
  const seen = new Set();
  const flag = (tag, r, x) => {
    const body = typeof x.data === 'string' ? x.data : JSON.stringify(x.data || '');
    if (x.status >= 500) results.fivexx.push(`${tag} -> ${x.status}`);
    if (/SQLITE|SqliteError|\bat [A-Za-z.<>]+ \(.*\.js:\d+|node_modules|C:\\\\/.test(body)) results.leaks.push(`${tag} -> gövdede iç bilgi: ${body.slice(0, 120)}`);
  };
  await check('SW-07', 'fuzz: hiçbir uç nokta bozuk gövde/sorgu/yol parametresiyle 500 veya iç bilgi (stack/SQL/yol) sızdırmamalı', async () => {
    for (const r of routes) {
      if (r.file === 'mobile') continue;
      if (['/documents', '/import/preview', '/templates/branding/logo', '/documents/:id/revise'].some(p => r.path === p && r.method === 'POST') || r.path.includes('anonymize') === false && false) continue;
      const t = fill(r.path);
      if (r.method === 'GET') {
        for (const q of queries) { const x = await api('GET', t + q); flag(`GET ${r.path}${q.slice(0, 30)}`, r, x); }
      } else {
        for (const [name, body] of bodies) { const x = await api(r.method, t, body); flag(`${r.method} ${r.path} [${name}]`, r, x); }
      }
      if (r.path.includes(':')) for (const v of pathVals) { const x = await api(r.method, fill(r.path, encodeURIComponent(v)), r.method === 'GET' ? undefined : {}); flag(`${r.method} ${r.path} [yol=${v.slice(0, 12)}]`, r, x); }
    }
    const uniq = [...new Set(results.fivexx.map(s => s.replace(/\[.*?\]/, '[…]').replace(/\?.*? ->/, ' ->')))];
    fs.writeFileSync(path.join(__dirname, 'results', 'fuzz-500.json'), JSON.stringify({ fivexx: results.fivexx, leaks: results.leaks }, null, 1));
    info('SW-07b', '500 veren farklı uç noktalar', uniq.slice(0, 80));
    assert.equal(results.fivexx.length + results.leaks.length, 0, `${results.fivexx.length} adet 500, ${results.leaks.length} adet sızıntı; ilk örnekler:\n` + [...results.fivexx.slice(0, 15), ...results.leaks.slice(0, 5)].join('\n'));
  });

  // ---- güvenlik başlıkları / yapılandırma
  await check('SW-08', 'güvenlik başlıkları: CSP, nosniff, frame, referrer; X-Powered-By yok; /health bilgi sızıntısı', async () => {
    const r = await fetch(state.base + '/'); const h = k => r.headers.get(k);
    assert(h('content-security-policy')); assert.equal(h('x-content-type-options'), 'nosniff'); assert(h('x-frame-options')); assert.equal(h('x-powered-by'), null);
    const hh = await (await fetch(state.base + '/health')).json();
    info('SW-08b', '/health kimliksiz döndürdükleri', hh);
  });
  await check('SW-09', 'hız sınırı: sahte X-Forwarded-For ile giriş denemesi sınırı aşılabiliyor mu (trust proxy=1)', async () => {
    let limited = false;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(state.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${i % 250}.${(i * 7) % 250}` }, body: JSON.stringify({ username: 'ghost' + i, password: 'x' }) });
      if (r.status === 429) limited = true;
    }
    info('SW-09b', '40 başarısız girişte (her biri farklı XFF) sınır devreye girdi mi', { limited });
    let limited2 = false;
    for (let i = 0; i < 40; i++) { const r = await fetch(state.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ghost', password: 'x' }) }); if (r.status === 429) limited2 = true; }
    info('SW-09c', 'aynı kaynaktan 40 başarısız giriş (XFF yok)', { limited: limited2 });
    // Ortam bu testte LOGIN_RATE_LIMIT yüksek verildi → bu kontrol yalnız bilgi amaçlı; ayrıntı b3b'de düşük limitle
  });
  await check('SW-10', 'audit kaydına IP yazılıyor mu; sahte XFF ile IP taklit edilebiliyor mu', async () => {
    await fetch(state.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '6.6.6.6' }, body: JSON.stringify({ username: 'ghost', password: 'x' }) });
    const row = db.prepare("SELECT ip FROM audit_log ORDER BY ts DESC LIMIT 5").all().map(r => r.ip);
    info('SW-10b', 'son audit IP değerleri', row);
  });
  await check('SW-11', 'CORS: Origin başlığı olan istekte izinli origin politikası (üretim varsayılanı)', async () => {
    const r = await fetch(state.base + '/api/items', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer x' } });
    info('SW-11b', 'evil origin için Access-Control-Allow-Origin', { acao: r.headers.get('access-control-allow-origin') });
  });
  await check('SW-12', 'JSON gövde sınırı: 3MB gövde 413; bozuk JSON 400', async () => {
    const big = await fetch(state.base + '/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.tokens.admin }, body: JSON.stringify({ name: 'x'.repeat(3 * 1024 * 1024) }) });
    const bad = await fetch(state.base + '/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.tokens.admin }, body: '{bozuk' });
    assert.equal(big.status, 413); assert.equal(bad.status, 400);
  });
  await finish('b3-sweep');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
