// Faz 0 doğrulama altyapısı: izole sandbox + gerçek sunucu süreci + doğrudan DB erişimi.
// Gerçek proje klasörüne/verisine dokunmaz (kopya üzerinde, OS geçici dizininde çalışır).
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const ROOT = path.join(__dirname, '..', '..'); // test/faz0-verify -> test -> proje kökü
const { createSandbox } = require(path.join(ROOT, 'test', 'helpers', 'sandbox'));

const state = { results: [], base: null, tokens: {}, proc: null, sandbox: null, db: null };
const USERS = {
  admin: ['admin', 'Admin123!'], manager: ['mudur', 'Mudur123!'], operator: ['operator', 'Operator123!'],
  quality: ['kalite', 'Kalite123!'], viewer: ['viewer', 'Viewer123!']
};

async function start(extraEnv = {}) {
  state.sandbox = createSandbox();
  const env = { ...state.sandbox.env, API_RATE_LIMIT: '2000000', LOGIN_RATE_LIMIT: '1000000', ...extraEnv };
  Object.assign(process.env, env);
  state.proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  state.out = '';
  state.proc.stdout.on('data', d => { state.out += d; });
  state.proc.stderr.on('data', d => { state.out += d; });
  state.base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout\n' + state.out.slice(-800))), 30000);
    state.proc.once('exit', c => { clearTimeout(t); reject(new Error('server exited ' + c + '\n' + state.out.slice(-800))); });
    state.proc.on('message', m => { if (m.type === 'listening') { clearTimeout(t); resolve('http://127.0.0.1:' + m.port); } });
  });
  state.db = require(path.join(ROOT, 'server', 'db'));
  return state;
}

async function api(method, route, body, who = 'admin', opts = {}) {
  let token = opts.token;
  if (!token && who) {
    if (!state.tokens[who]) {
      const [u, p] = USERS[who];
      const r = await fetch(state.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      const j = await r.json();
      if (!j.token) throw new Error('login failed for ' + who + ': ' + JSON.stringify(j));
      state.tokens[who] = j.token;
    }
    token = state.tokens[who];
  }
  const r = await fetch(state.base + '/api' + route, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let data;
  const text = await r.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
async function ok(method, route, body, who) {
  const r = await api(method, route, body, who);
  if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${route} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

/** Durum değişmezlerini yakalamak için önemli tabloların özeti. */
function snap(extra = []) {
  const db = state.db;
  const q = sql => db.prepare(sql).all();
  return JSON.stringify({
    lots: q('SELECT id,item_id,warehouse_id,qty,status,unit_cost FROM stock_lots ORDER BY id'),
    cache: q('SELECT id,qty_cache,avg_cost FROM items ORDER BY id'),
    movements: q('SELECT COUNT(*) c FROM movements')[0].c,
    shipments: q('SELECT id,status FROM shipments ORDER BY id'),
    sol: q('SELECT id,shipped_qty,cogs_base FROM sales_order_lines ORDER BY id'),
    so: q('SELECT id,status FROM sales_orders ORDER BY id'),
    po: q('SELECT id,status,approval_status,total_base FROM purchase_orders ORDER BY id'),
    poi: q('SELECT id,received_qty,rejected_qty FROM po_items ORDER BY id'),
    inv: q('SELECT id,status,amount FROM customer_invoices ORDER BY id'),
    prod: q('SELECT id,status,produced_qty FROM production_orders ORDER BY id'),
    ...Object.fromEntries(extra.map(([k, s]) => [k, q(s)]))
  });
}

async function check(id, desc, fn) {
  try { await fn(); state.results.push({ id, desc, status: 'PASS' }); console.log('  ✓', id, desc); }
  catch (e) {
    const isAssert = e instanceof assert.AssertionError || e.code === 'ERR_ASSERTION';
    state.results.push({ id, desc, status: isAssert ? 'FAIL' : 'ERROR', detail: String(e.message).slice(0, 600) });
    console.log(isAssert ? '  ✗ FAIL' : '  ! ERROR', id, desc, '\n      ', String(e.message).split('\n').slice(0, 4).join('\n       '));
  }
}
/** Politika/karar gerektiren gözlemler: geçti/kaldı değil, mevcut davranışı kaydeder. */
function info(id, desc, value) {
  state.results.push({ id, desc, status: 'INFO', detail: typeof value === 'string' ? value : JSON.stringify(value) });
  console.log('  i INFO', id, desc, '=>', typeof value === 'string' ? value : JSON.stringify(value).slice(0, 300));
}
const statusIn = (r, codes, msg = '') => assert(codes.includes(r.status), `${msg} beklenen ${codes.join('/')} gelen ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);

async function finish(name) {
  const p = state.results.filter(r => r.status === 'PASS').length;
  const f = state.results.filter(r => r.status === 'FAIL').length;
  const e = state.results.filter(r => r.status === 'ERROR').length;
  console.log(`\n=== ${name}: ${p} geçti, ${f} BAŞARISIZ, ${e} HATA (toplam ${state.results.length}) ===`);
  const resultsDir = process.env.FAZ0_RESULTS_DIR || path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const outFile = path.join(resultsDir, `${name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(state.results, null, 2));
  console.log('(sonuçlar:', outFile, ')');
  try { state.db.close(); } catch {}
  await new Promise(res => { if (state.proc.exitCode !== null) return res(undefined); state.proc.once('exit', res); state.proc.kill(); });
  try { state.sandbox.cleanup(); } catch (err) { console.log('cleanup:', err.message); }
  process.exit(f + e ? 1 : 0);
}

module.exports = { start, api, ok, snap, check, info, statusIn, finish, assert, state, USERS };
