// @ts-nocheck
/**
 * UI smoke test. Loads the real index.html into a DOM, runs the actual view code
 * against the running server, walks every screen and opens the main dialogs.
 *
 * This catches what the other two suites cannot: runtime errors in the view layer —
 * a mistyped element id, a null reference, a handler wired to something that isn't
 * there. Those never show up in a syntax check or an API test, but they leave a
 * dead button in front of the user.
 *
 * Requires jsdom (dev-only), the React build, and a running server:
 *   npm install --no-save jsdom && npm run build && node test/ui-smoke.js
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
const jsErrors = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Wait until a condition holds, so we assert on settled UI rather than a race. */
async function until(fn, timeout = 6000, step = 60) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (fn()) return true; } catch {}
    await sleep(step);
  }
  return false;
}

(async () => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch {
    console.error('jsdom kurulu değil / jsdom not installed:\n  npm install --no-save jsdom');
    process.exit(2);
  }

  const REACT_BUNDLE = path.join(ROOT, 'public', 'dist', 'react-views.js');
  if (!fs.existsSync(REACT_BUNDLE)) {
    console.error('React derlemesi bulunamadı / React bundle not found:\n  npm run build');
    process.exit(2);
  }

  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: BASE,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: undefined            // we inject scripts ourselves; no CDN fetches
  });
  const { window } = dom;

  // Surface anything the view code throws, instead of letting it die silently.
  window.addEventListener('error', e => jsErrors.push(String(e.error || e.message)));
  window.onerror = (m) => { jsErrors.push(String(m)); };
  process.on('unhandledRejection', r => jsErrors.push('unhandledRejection: ' + (r && r.message || r)));

  // Real network to the running server.
  window.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
  window.localStorage.clear();

  // Chart.js comes from a CDN the container cannot reach; the view code guards on
  // `typeof Chart === 'undefined'`, but stub it so chart paths still execute.
  const chartCalls = [];
  window.Chart = function (ctx, cfg) { chartCalls.push(cfg && cfg.type); this.destroy = () => {}; };
  window.Chart.prototype.destroy = () => {};

  // jsdom has no canvas backend; the views only need getContext to not throw.
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.print = () => {};
  window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() {} });
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};

  // Load application scripts in the same order index.html does. Dashboard is now
  // React (frontend-react/{DashboardView,ItemsView}.jsx) — the built bundle is
  // loaded here, same as the browser loads it, so this test exercises the
  // actual production artifact rather than superseded source. One bundle now
  // defines both ViewDashboard and ViewItems.
  const files = [
    'js/i18n.js', 'js/api.js', 'js/ui.js',
    'dist/react-views.js',
    'js/views/purchasing.js', 'js/views/sales.js', 'js/views/planning.js',
    'js/views/quality.js', 'js/views/admin.js', 'js/app.js'
  ];
  console.log('\n=== BETİK YÜKLEME / SCRIPT LOADING ===');
  // Inject as real <script> elements so top-level `const` lands in the shared global
  // lexical scope, exactly as the browser loads them. window.eval would sandbox each file.
  for (const f of files) {
    const before = jsErrors.length;
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    window.document.body.appendChild(el);
    const name = f.split('/').pop().replace('.js', '');
    const globalNames = {
      'i18n': ['I18N'], 'api': ['Api'], 'ui': ['UI'], 'app': ['App'],
      'react-views': ['ViewDashboard', 'ViewItems', 'ViewCounts', 'ViewLots', 'ViewProduction', 'ViewReports'], // frontend-react/main.jsx defines these globals
      'production': ['ViewProduction'], 'purchasing': ['ViewPurchasing'], 'sales': ['ViewSales'],
      'quality': ['ViewQuality'], 'reports': ['ViewReports'], 'admin': ['ViewAdmin'], 'planning': ['ViewPlanning']
    }[name];
    const loaded = globalNames.every(g => window.eval(`typeof ${g} !== 'undefined'`));
    check(f, loaded && jsErrors.length === before, jsErrors.slice(before).join(' | '));
  }

  // app.js binds on DOMContentLoaded, which already fired while we were injecting.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await sleep(300);

  console.log('\n=== GİRİŞ / LOGIN ===');
  const doc = window.document;
  check('login screen is visible', doc.getElementById('loginScreen').style.display !== 'none');

  doc.getElementById('loginUsername').value = 'admin';
  doc.getElementById('loginPassword').value = 'Admin123!';
  doc.getElementById('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const loggedIn = await until(() => doc.getElementById('appShell').style.display === 'grid');
  check('login switches to the app shell', loggedIn,
    loggedIn ? '' : 'hata / error: ' + (doc.getElementById('loginError').textContent || '—'));
  if (!loggedIn) { report(); return; }

  check('role is applied to <body> for permission gating', doc.body.dataset.role === 'admin', doc.body.dataset.role);
  check('user name is shown in the sidebar', (doc.getElementById('userName').textContent || '').length > 0);

  // Bridge into the page's lexical scope
  const go = (v) => window.eval(`App.go(${JSON.stringify(v)})`);
  const closeModalIn = () => window.eval('UI.closeModal()');

  console.log('\n=== EKRANLAR / VIEWS ===');
  // Every screen must render real content, not stay on the spinner and not go blank.
  const views = ['dashboard', 'items', 'lots', 'counts', 'production', 'purchasing', 'sales', 'planning', 'quality', 'reports', 'admin'];
  for (const v of views) {
    const before = jsErrors.length;
    go(v);
    const el = doc.getElementById('view-' + v);
    const rendered = await until(() => el.querySelector('.topbar') && !el.querySelector('.loading'));
    const hasContent = el.querySelector('table, .stat, .card, .empty');
    check(`${v} renders`, rendered && !!hasContent && jsErrors.length === before,
      !rendered ? 'yüklenmede takıldı / stuck loading'
        : !hasContent ? 'içerik yok / no content'
        : 'JS hatası / JS error: ' + jsErrors.slice(before).join(' | '));
  }

  console.log('\n=== SEKMELER / TABS ===');
  // Tabbed modules re-render on click; a broken tab handler leaves the pane empty.
  for (const [view, count] of [['purchasing', 5], ['sales', 6], ['planning', 5], ['quality', 6], ['reports', 9], ['admin', 11]]) {
    go(view);
    await until(() => doc.getElementById('view-' + view).querySelector('.chip-row'));
    const chips = [...doc.getElementById('view-' + view).querySelectorAll('.chip-row .chip')];
    check(`${view} exposes ${count} tabs`, chips.length === count, `bulundu / found ${chips.length}`);

    for (const chip of chips) {
      const label = chip.textContent.trim();
      const before = jsErrors.length;
      chip.click();
      const ok = await until(() => {
        const host = doc.getElementById('view-' + view);
        const pane = host.querySelector('#purchBody, #salesBody, #qBody, #repBody, #adBody, #planBody');
        return pane && !pane.querySelector('.loading');
      });
      check(`  ${view} › ${label}`, ok && jsErrors.length === before,
        !ok ? 'yüklenmede takıldı / stuck' : jsErrors.slice(before).join(' | '));
    }
  }

  console.log('\n=== DİYALOGLAR / DIALOGS ===');
  const overlay = doc.getElementById('modalOverlay');
  const closeModal = () => { closeModalIn(); };

  async function openAndCheck(label, view, prep) {
    go(view);
    await until(() => doc.getElementById('view-' + view).querySelector('.topbar'));
    await sleep(250);
    const before = jsErrors.length;
    const opened = await prep();
    if (opened === false) return check(label, false, 'tetikleyici bulunamadı / trigger not found');
    const shown = await until(() => overlay.classList.contains('show') && doc.getElementById('modalBox').querySelector('.modal-head'));
    check(label, shown && jsErrors.length === before,
      !shown ? 'açılmadı / did not open' : jsErrors.slice(before).join(' | '));
    closeModal();
    await sleep(120);
  }

  const clickFirst = (sel, view) => {
    const host = view ? doc.getElementById('view-' + view) : doc;
    const b = host.querySelector(sel);
    if (!b) return false;
    b.click();
    return true;
  };

  /** Tabbed views keep their last tab; select the one this assertion needs. */
  async function selectTab(view, re) {
    const host = doc.getElementById('view-' + view);
    await until(() => host.querySelector('.chip-row .chip'));
    const chip = [...host.querySelectorAll('.chip-row .chip')].find(c => re.test(c.textContent));
    if (!chip) return false;
    if (!chip.classList.contains('active')) {
      chip.click();
      await until(() => {
        const pane = host.querySelector('#purchBody, #salesBody, #qBody, #repBody, #adBody, #planBody');
        return pane && !pane.querySelector('.loading');
      });
    }
    await sleep(150);
    return true;
  }

  await openAndCheck('item card opens', 'items', () => clickFirst('[data-open]', 'items'));
  await openAndCheck('new item form opens', 'items', () => clickFirst('#itNew', 'items'));
  await openAndCheck('stock-in dialog opens', 'items', () => clickFirst('[data-in]', 'items'));
  await openAndCheck('lot traceability dialog opens', 'lots', () => clickFirst('[data-trace]', 'lots'));
  await openAndCheck('lot status dialog opens', 'lots', () => clickFirst('[data-status]', 'lots'));
  await openAndCheck('lot transfer dialog opens', 'lots', () => clickFirst('[data-transfer]', 'lots'));
  await openAndCheck('new count dialog opens', 'counts', () => clickFirst('#cNew', 'counts'));
  // Create a count so there is a sheet to open (fresh database has none)
  {
    const tok = (await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin123!' })
    })).json()).token;
    await fetch(BASE + '/api/stock/counts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ warehouseId: 1 })
    });
  }
  await openAndCheck('count sheet opens', 'counts', () => clickFirst('[data-open]', 'counts'));
  await openAndCheck('production order detail opens', 'production', () => clickFirst('[data-open]', 'production'));
  await openAndCheck('new production form opens', 'production', () => clickFirst('#pNew', 'production'));
  await openAndCheck('purchase order detail opens', 'purchasing', async () =>
    await selectTab('purchasing', /Sipariş|Order/i) && clickFirst('#purchBody [data-open]'));
  await openAndCheck('new purchase order form opens', 'purchasing', async () =>
    await selectTab('purchasing', /Sipariş|Order/i) && clickFirst('#poNew'));

  await openAndCheck('supplier detail opens', 'purchasing', async () =>
    await selectTab('purchasing', /Tedarik|Suppl/i) && clickFirst('#purchBody [data-open]'));

  await openAndCheck('sales order detail opens', 'sales', async () =>
    await selectTab('sales', /Satış Sipariş|Sales Order/i) && clickFirst('#salesBody [data-open]'));
  await openAndCheck('new sales order form opens', 'sales', async () =>
    await selectTab('sales', /Satış Sipariş|Sales Order/i) && clickFirst('#soNew'));

  await openAndCheck('shipment form opens (lot picking)', 'sales', async () =>
    await selectTab('sales', /Sevkiyat|Shipment/i) && clickFirst('#shNew'));

  await openAndCheck('inspection detail opens', 'quality', async () =>
    await selectTab('quality', /Muayene|Inspection/i) && clickFirst('#qBody [data-open]'));
  await openAndCheck('inspection result dialog opens', 'quality', async () =>
    await selectTab('quality', /Muayene|Inspection/i) && clickFirst('#qBody [data-res]'));

  await openAndCheck('new user form opens', 'admin', async () =>
    await selectTab('admin', /Kullanıcı|User/i) && clickFirst('#usNew'));

  console.log('\n=== BİLDİRİM PANELİ / NOTIFICATIONS ===');
  {
    const before = jsErrors.length;
    doc.getElementById('btnNotifications').click();
    const ok = await until(() => doc.getElementById('notifPanel').classList.contains('show')
      && !doc.getElementById('notifList').querySelector('.loading'));
    check('notification panel opens and loads', ok && jsErrors.length === before, jsErrors.slice(before).join(' | '));
    doc.getElementById('btnNotifClose').click();
  }

  console.log('\n=== DİL DEĞİŞTİRME / LANGUAGE SWITCH ===');
  {
    const before = jsErrors.length;
    const sel = doc.getElementById('langSelect');
    sel.value = 'en';
    sel.dispatchEvent(new window.Event('change'));
    await sleep(700);
    const navText = doc.querySelector('.nav-tab[data-view="items"] span').textContent;
    check('switching to English re-labels the navigation', navText === 'Items', navText);
    check('language switch throws nothing', jsErrors.length === before, jsErrors.slice(before).join(' | '));
    sel.value = 'tr';
    sel.dispatchEvent(new window.Event('change'));
    await sleep(700);
  }

  console.log('\n=== GRAFİKLER / CHARTS ===');
  check('dashboard and report charts are constructed', chartCalls.length > 0, `${chartCalls.length} grafik / charts`);

  console.log('\n=== YAKALANAN JS HATALARI / UNCAUGHT JS ERRORS ===');
  check('no uncaught errors during the whole walkthrough', jsErrors.length === 0,
    jsErrors.slice(0, 6).join(' | '));

  report();

  function report() {
    console.log(`\n${'='.repeat(52)}`);
    console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
    if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(52));
    process.exit(fail > 0 ? 1 : 0);
  }
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
