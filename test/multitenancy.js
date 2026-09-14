/**
 * Çok şirketlilik altyapı hazırlığı — Aşama A doğrulaması.
 *
 * Bu paket hiçbir izolasyon davranışı test ETMEZ (henüz yok, kasıtlı).
 * Yalnızca şunu kanıtlar: 006_multitenancy_prep.js migration'ı doğru
 * çalıştı (tüm tablolar company_id'ye sahip, NULL kalmadı) ve canlı API
 * rotaları artık company_id yazıyor (daha önce sessizce NULL bırakıyordu).
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/multitenancy.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/**
 * @param {string} method
 * @param {string} p
 * @param {{ token?: string, body?: any }} [options]
 */
async function api(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d;
  try { d = await r.json(); } catch { d = null; }
  return { status: r.status, data: d };
}

// Sunucuyla aynı veritabanı dosyası — salt-okunur, WAL sayesinde sunucu
// yazarken bile güvenle okunabilir (bkz. server/db.js pragma'ları).
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');
const db = new Database(dbPath, { readonly: true });

const NEW_TABLES = [
  'sessions', 'item_bom', 'raw_materials', 'stock_lots', 'movements',
  'stock_counts', 'stock_count_lines',
  'purchase_requests', 'purchase_request_lines', 'rfqs', 'rfq_lines', 'rfq_quotes',
  'purchase_orders', 'po_items', 'po_revisions', 'po_receipts', 'po_receipt_lines',
  'landed_costs', 'supplier_invoices', 'supplier_returns', 'supplier_price_history',
  'sales_orders', 'sales_order_lines', 'shipments', 'shipment_items', 'shipment_crates',
  'customer_invoices', 'customer_invoice_lines',
  'production_orders', 'production_order_components', 'production_consumption',
  'shifts', 'work_center_shifts', 'calendar_exceptions', 'routings',
  'production_operations', 'mrp_runs', 'mrp_suggestions', 'shift_logs',
  'inspections', 'inspection_lines', 'inspection_plans', 'ncrs', 'capas',
  'documents', 'equipment', 'calibrations',
  'import_batches', 'import_rows',
  'audit_log', 'approval_rules', 'notification_rules', 'notifications', 'exchange_rates'
];
// document_templates kasıtlı olarak ayrı tutulur: NULL orada "tüm firmalar
// için geçerli varsayılan şablon" anlamına gelir (bkz. 005_templates.js),
// "unutulmuş veri" değil — 1'e doldurulmamalı.
const EXISTING_TABLES = ['users', 'warehouses', 'suppliers', 'customers', 'items', 'work_centers'];
const GLOBAL_DEFAULT_TABLE = 'document_templates';

(async () => {
  console.log('\n=== ŞEMA / SCHEMA ===');
  for (const t of [...NEW_TABLES, ...EXISTING_TABLES, GLOBAL_DEFAULT_TABLE]) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    ok(`${t}: company_id sütunu var`, cols.includes('company_id'));
  }

  console.log('\n=== NULL KALMADI / NO NULLS ANYWHERE (document_templates hariç) ===');
  for (const t of [...NEW_TABLES, ...EXISTING_TABLES]) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE company_id IS NULL`).get().c;
    ok(`${t}: NULL company_id yok`, n === 0, `${n} NULL satır`);
  }
  const templateNulls = db.prepare(`SELECT COUNT(*) c FROM ${GLOBAL_DEFAULT_TABLE} WHERE company_id IS NULL`).get().c;
  ok('document_templates: varsayılan şablonlar hâlâ NULL (kasıtlı, tüm firmalar için geçerli)',
    templateNulls === 8, `${templateNulls} NULL satır (8 bekleniyor)`);

  console.log('\n=== BÜTÜNLÜK / INTEGRITY UNCHANGED ===');
  const fkErrors = db.pragma('foreign_key_check');
  ok('yabancı anahtar hatası yok', fkErrors.length === 0, JSON.stringify(fkErrors.slice(0, 3)));

  console.log('\n=== CANLI ROTALAR ARTIK COMPANY_ID YAZIYOR / LIVE ROUTES NOW WRITE IT ===');
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');

  const rndSuffix = Date.now();

  const wh = await api('POST', '/api/warehouses', { token: admin, body: { name: `MT Depo ${rndSuffix}` } });
  ok('depo oluşturuldu', wh.status === 201, JSON.stringify(wh.data));
  const whRow = wh.data && db.prepare('SELECT company_id FROM warehouses WHERE id = ?').get(wh.data.id);
  ok('yeni depo company_id=1 aldı (daha önce NULL kalıyordu)', whRow && whRow.company_id === 1, JSON.stringify(whRow));

  const sup = await api('POST', '/api/purchasing/suppliers', {
    token: admin, body: { name: `MT Tedarikçi ${rndSuffix}`, currency: 'TRY', paymentTermsDays: 30, leadTimeDays: 7 }
  });
  ok('tedarikçi oluşturuldu', sup.status === 201, JSON.stringify(sup.data));
  const supRow = sup.data && db.prepare('SELECT company_id FROM suppliers WHERE id = ?').get(sup.data.id);
  ok('yeni tedarikçi company_id=1 aldı', supRow && supRow.company_id === 1, JSON.stringify(supRow));

  const cus = await api('POST', '/api/sales/customers', {
    token: admin, body: { name: `MT Müşteri ${rndSuffix}`, currency: 'TRY', paymentTermsDays: 30, creditLimit: 0 }
  });
  ok('müşteri oluşturuldu', cus.status === 201, JSON.stringify(cus.data));
  const cusRow = cus.data && db.prepare('SELECT company_id FROM customers WHERE id = ?').get(cus.data.id);
  ok('yeni müşteri company_id=1 aldı', cusRow && cusRow.company_id === 1, JSON.stringify(cusRow));

  const usr = await api('POST', '/api/users', {
    token: admin, body: { username: `mt_user_${rndSuffix}`, password: 'Gucl3Sifre!2026', role: 'viewer' }
  });
  ok('kullanıcı oluşturuldu', usr.status === 201, JSON.stringify(usr.data));
  const usrRow = usr.data && db.prepare('SELECT company_id FROM users WHERE id = ?').get(usr.data.id);
  ok('yeni kullanıcı company_id=1 aldı', usrRow && usrRow.company_id === 1, JSON.stringify(usrRow));

  const itm = await api('POST', '/api/items', { token: admin, body: { name: `MT Ürün ${rndSuffix}` } });
  ok('ürün oluşturuldu', itm.status === 201, JSON.stringify(itm.data));
  const itmRow = itm.data && db.prepare('SELECT company_id FROM items WHERE id = ?').get(itm.data.id);
  ok('yeni ürün company_id=1 aldı', itmRow && itmRow.company_id === 1, JSON.stringify(itmRow));

  console.log('\n=== JWT / req.user companyId (atıl — henüz filtrelemede kullanılmıyor) ===');
  const payload = JSON.parse(Buffer.from(admin.split('.')[1], 'base64url').toString('utf8'));
  ok('JWT companyId taşıyor', payload.companyId === 1, JSON.stringify(payload));

  const me = await api('GET', '/api/auth/me', { token: admin });
  ok('/auth/me hâlâ eskisi gibi çalışıyor (companyId sızdırmıyor, sözleşme bozulmadı)',
    me.status === 200 && me.data.user && !('companyId' in me.data.user), JSON.stringify(me.data));

  console.log('\n=== AŞAMA B — AYNI ŞİRKETTE TEKRAR HÂLÂ REDDEDİLİYOR / SAME-COMPANY DUPES STILL REJECTED ===');
  // Tek şirketli bugünkü kullanım için davranış değişmemeli: aynı company_id
  // içinde aynı kullanıcı adı/kod hâlâ 409 vermeli.
  const dupUser = await api('POST', '/api/users', {
    token: admin, body: { username: 'admin', password: 'BaskaSifre!2026', role: 'viewer' }
  });
  ok('aynı şirkette aynı kullanıcı adı hâlâ reddediliyor (409)', dupUser.status === 409, JSON.stringify(dupUser.data));

  const wcCodeDup = `MT-WC-${rndSuffix}`;
  const wc1 = await api('POST', '/api/planning/work-centers', { token: admin, body: { code: wcCodeDup, name: 'MT İş Merkezi 1' } });
  ok('iş merkezi oluşturuldu', wc1.status === 201, JSON.stringify(wc1.data));
  const wc2 = await api('POST', '/api/planning/work-centers', { token: admin, body: { code: wcCodeDup, name: 'MT İş Merkezi 2' } });
  ok('aynı şirkette aynı iş merkezi kodu hâlâ reddediliyor (409)', wc2.status === 409, JSON.stringify(wc2.data));

  console.log('\n=== AŞAMA B — İZOLASYON KANITI / ISOLATION PROOF (doğrudan SQL, arayüz yok) ===');
  // Gerçek bir çoklu-şirket API'si henüz yok (bkz. plan — kasıtlı olarak
  // ertelendi). Bu bölüm "şema gerçekten izolasyona hazır mı" sorusunun tek
  // gerçek kanıtı: companies tablosuna ELLE ikinci bir satır eklenir
  // (hiçbir CRUD yok, yalnızca test amaçlı) ve aynı username/kodun FARKLI
  // company_id ile çakışmadan var olabildiği doğrudan veritabanı seviyesinde
  // doğrulanır.
  const rw = new Database(dbPath);
  let secondCompanyId = null;
  try {
    secondCompanyId = rw.prepare(
      "INSERT INTO companies (name, base_currency, is_active) VALUES ('MT İkinci Test Firması', 'TRY', 1)"
    ).run().lastInsertRowid;

    let usernameIsolated = false;
    try {
      rw.prepare('INSERT INTO users (company_id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
        .run(secondCompanyId, 'admin', 'x', 'viewer', Date.now());
      usernameIsolated = true;
    } catch { usernameIsolated = false; }
    ok('farklı şirkette AYNI kullanıcı adı çakışmadan eklenebiliyor', usernameIsolated);

    let wcIsolated = false;
    try {
      rw.prepare('INSERT INTO work_centers (company_id, code, name, created_at) VALUES (?,?,?,?)')
        .run(secondCompanyId, wcCodeDup, 'MT İkinci Firma İş Merkezi', Date.now());
      wcIsolated = true;
    } catch { wcIsolated = false; }
    ok('farklı şirkette AYNI iş merkezi kodu çakışmadan eklenebiliyor', wcIsolated);

    let shiftIsolated = false;
    const shiftCodeDup = `MT-SH-${rndSuffix}`;
    rw.prepare('INSERT INTO shifts (company_id, code, name, start_time, end_time) VALUES (1,?,?,?,?)')
      .run(shiftCodeDup, 'MT Vardiya 1', '08:00', '16:00');
    try {
      rw.prepare('INSERT INTO shifts (company_id, code, name, start_time, end_time) VALUES (?,?,?,?,?)')
        .run(secondCompanyId, shiftCodeDup, 'MT İkinci Firma Vardiyası', '08:00', '16:00');
      shiftIsolated = true;
    } catch { shiftIsolated = false; }
    ok('farklı şirkette AYNI vardiya kodu çakışmadan eklenebiliyor', shiftIsolated);

    let shiftSameCompanyRejected = false;
    try {
      rw.prepare('INSERT INTO shifts (company_id, code, name, start_time, end_time) VALUES (1,?,?,?,?)')
        .run(shiftCodeDup, 'MT Tekrar', '08:00', '16:00');
    } catch (e) { shiftSameCompanyRejected = /UNIQUE/.test(e.message); }
    ok('aynı şirkette aynı vardiya kodu hâlâ reddediliyor', shiftSameCompanyRejected);
  } finally {
    // Temizlik: bu test bölümünün eklediği satırlar geri alınır.
    if (secondCompanyId) {
      rw.exec(`DELETE FROM users WHERE company_id = ${secondCompanyId}`);
      rw.exec(`DELETE FROM work_centers WHERE company_id = ${secondCompanyId}`);
      rw.exec(`DELETE FROM shifts WHERE company_id = ${secondCompanyId}`);
      rw.exec(`DELETE FROM companies WHERE id = ${secondCompanyId}`);
    }
    rw.exec(`DELETE FROM shifts WHERE code = '${`MT-SH-${rndSuffix}`}' AND company_id = 1`);
    rw.close();
  }

  db.close();

  console.log('\n====================================================');
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  console.log('====================================================');
  if (fail) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log(`  - ${f}`)); }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
