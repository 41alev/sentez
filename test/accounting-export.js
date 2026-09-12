/**
 * Muhasebe dışa aktarım köprüsü testleri.
 *
 * Bu bir muhasebe programı testi değil — üretilen yevmiye satırlarının
 * çift taraflı (borç=alacak) ve doğru hesap koduna gittiğinin kanıtı.
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/accounting-export.js
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

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');
const db = new Database(dbPath, { readonly: true });

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const today = new Date().toISOString().slice(0, 10);

  console.log('\n=== HESAP KODU EŞLEMESİ / ACCOUNT CODE MAPPINGS ===');
  const mappings = await api('GET', '/api/accounting/mappings', { token: admin });
  ok('6 varsayılan eşleme geldi', mappings.status === 200 && mappings.data.length === 6, JSON.stringify(mappings.data));
  const salesRevMap = mappings.data.find(m => m.key === 'sales_revenue');
  ok('satış geliri varsayılan kodu 600', salesRevMap && salesRevMap.accountCode === '600', JSON.stringify(salesRevMap));

  console.log('\n=== SATIŞ FATURASINDAN YEVMİYE / JOURNAL FROM SALES INVOICE ===');
  const customer = db.prepare("SELECT id FROM customers LIMIT 1").get();
  const salesInv = await api('POST', '/api/sales/invoices', {
    token: admin,
    body: { customerId: customer.id, currency: 'TRY', lines: [{ itemName: 'Muhasebe Test Ürünü', qty: 10, unitPrice: 100, vatRate: 20 }] }
  });
  ok('satış faturası oluşturuldu', salesInv.status === 201, JSON.stringify(salesInv.data));
  ok('alt toplam doğru (10x100)', salesInv.data.subtotal === 1000, String(salesInv.data.subtotal));
  ok('KDV doğru (%20)', salesInv.data.vat_total === 200, String(salesInv.data.vat_total));

  console.log('\n=== ALIŞ FATURASINDAN YEVMİYE / JOURNAL FROM PURCHASE INVOICE ===');
  const po1 = db.prepare("SELECT id FROM purchase_orders WHERE po_no = 'SA-2026-001'").get();
  const rcpt1 = db.prepare("SELECT id FROM po_receipts WHERE receipt_no = 'IRS-2026-001'").get();
  ok('tohum verideki PO ve teslimat bulundu', !!po1 && !!rcpt1, JSON.stringify({ po1, rcpt1 }));

  const purchInv = await api('POST', '/api/purchasing/invoices', {
    token: admin,
    body: { invoiceNo: `MT-ACC-${Date.now()}`, poId: po1.id, receiptId: rcpt1.id, invoiceDate: today, amount: 45300, currency: 'TRY' }
  });
  ok('alış faturası oluşturuldu ve eşleşti', purchInv.status === 201 && purchInv.data.matchStatus === 'matched', JSON.stringify(purchInv.data));

  console.log('\n=== DIŞA AKTARIM / EXPORT ===');
  const exp = await api('GET', `/api/accounting/export?from=${today}&to=${today}`, { token: admin });
  ok('dışa aktarım başarılı', exp.status === 200, JSON.stringify(exp.data));
  ok('borç toplamı = alacak toplamı', Math.abs(exp.data.totalDebit - exp.data.totalCredit) < 0.01,
    `${exp.data.totalDebit} vs ${exp.data.totalCredit}`);
  ok('en az iki faturanın satırları geldi (satış + alış)',
    exp.data.rows.some(r => r.sourceType === 'customer_invoice') && exp.data.rows.some(r => r.sourceType === 'supplier_invoice'),
    JSON.stringify(exp.data.rows.map(r => r.sourceType)));

  const salesRows = exp.data.rows.filter(r => r.sourceId === salesInv.data.id);
  ok('satış faturası 3 satır üretti (alıcı+gelir+KDV)', salesRows.length === 3, String(salesRows.length));
  const arRow = salesRows.find(r => r.accountCode === '120');
  ok('alıcı hesabına (120) borç yazıldı, tutar = brüt (1200)', arRow && arRow.debit === 1200, JSON.stringify(arRow));
  const revRow = salesRows.find(r => r.accountCode === '600');
  ok('satış hesabına (600) alacak yazıldı, tutar = net (1000)', revRow && revRow.credit === 1000, JSON.stringify(revRow));
  const vatRow = salesRows.find(r => r.accountCode === '391');
  ok('KDV hesabına (391) alacak yazıldı, tutar = 200', vatRow && vatRow.credit === 200, JSON.stringify(vatRow));

  const purchRows = exp.data.rows.filter(r => r.sourceId === purchInv.data.id);
  ok('alış faturası 3 satır üretti (stok+KDV+satıcı)', purchRows.length === 3, String(purchRows.length));
  const payRow = purchRows.find(r => r.accountCode === '320');
  ok('satıcı hesabına (320) alacak yazıldı', payRow && payRow.credit > 0, JSON.stringify(payRow));
  const invRow = purchRows.find(r => r.accountCode === '153');
  ok('stok hesabına (153) borç yazıldı, tutar = net (45300)', invRow && invRow.debit === 45300, JSON.stringify(invRow));

  console.log('\n=== HATA DURUMLARI / ERROR CASES ===');
  const badRange = await api('GET', `/api/accounting/export?from=${today}&to=2020-01-01`, { token: admin });
  ok('geçersiz tarih aralığı reddediliyor (400)', badRange.status === 400, JSON.stringify(badRange.data));

  const viewer = await login('viewer', 'Viewer123!');
  const viewerTry = await api('GET', '/api/accounting/export?from=2026-01-01&to=2026-01-31', { token: viewer });
  ok('görüntüleyici dışa aktarım yapamıyor (403)', viewerTry.status === 403, JSON.stringify(viewerTry.data));

  console.log('\n=== HESAP KODU EŞLEMESİ GÜNCELLEME / MAPPING UPDATE ===');
  const updated = await api('PUT', '/api/accounting/mappings', {
    token: admin, body: { mappings: [{ key: 'sales_revenue', accountCode: '600-TEST', accountName: 'Test Satış' }] }
  });
  ok('eşleme güncellendi', updated.status === 200, JSON.stringify(updated.data));
  const afterUpdate = await api('GET', '/api/accounting/mappings', { token: admin });
  const updatedMap = afterUpdate.data.find(m => m.key === 'sales_revenue');
  ok('güncellenen kod geri okunuyor', updatedMap && updatedMap.accountCode === '600-TEST', JSON.stringify(updatedMap));
  // Diğer 5 eşleme etkilenmemeli
  ok('diğer eşlemeler değişmedi', afterUpdate.data.filter(m => m.key !== 'sales_revenue').every(m => m.accountCode !== '600-TEST'));
  // Geri al: sonraki bir çalıştırmayı etkilemesin
  await api('PUT', '/api/accounting/mappings', {
    token: admin, body: { mappings: [{ key: 'sales_revenue', accountCode: '600', accountName: 'Yurtiçi Satışlar' }] }
  });

  db.close();

  console.log('\n====================================================');
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  console.log('====================================================');
  if (fail) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log(`  - ${f}`)); }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / failed:', e); process.exit(1); });
