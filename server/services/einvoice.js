/**
 * e-Belge servisi.
 *
 * Sorumluluğu: kaynak belgeden (müşteri faturası / sevkiyat) UBL-TR belgesi
 * üretmek, veritabanına yazmak ve seçilen entegratöre göndermek.
 *
 * Entegratör bir adaptör arkasındadır. Uygulamanın geri kalanı hangi entegratörün
 * kullanıldığını bilmez; entegratör değiştiğinde yalnızca yeni bir adaptör eklenir.
 * Varsayılan adaptör 'local' olup belgeyi diske yazar — kimlik bilgisi olmadan
 * tüm akışın uçtan uca denenebilmesini sağlar.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const ubl = require('../lib/ubl');
const { AppError, uuid, getSetting } = require('../lib/core');
const { toLocalDateStr } = require('../lib/dates');

/* ============================ ADAPTÖRLER ============================ */

/**
 * Adaptör sözleşmesi:
 *   name
 *   async send(doc)   → { providerRef, status, statusCode?, statusText? }
 *   async status(doc) → { status, statusCode?, statusText? }
 *   async checkTaxpayer(identityNo) → { isEinvoiceUser, alias|null }  (opsiyonel)
 *
 * status değerleri e_documents.status ile aynı sözlüktedir.
 */

/**
 * Yerel adaptör: hiçbir yere göndermez, belgeyi diske yazar.
 * Amaç geliştirme ve kabul testi. Canlıda kullanılmamalıdır.
 */
const localProvider = {
  name: 'local',
  async send(doc) {
    const dir = process.env.EDOC_DIR || path.join(db.dataDir, 'e-documents');
    const sub = path.join(dir, doc.doc_type, String(doc.issue_date).slice(0, 7));
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `${doc.document_no}.xml`), doc.xml, 'utf8');
    // Gerçek bir entegratör kuyruğa alır; burada da öyle davranıp "sent" diyoruz.
    return { providerRef: `LOCAL-${doc.document_no}`, status: 'sent',
             statusText: 'Yerel dosyaya yazıldı (entegratöre gönderilmedi)' };
  },
  async status(doc) {
    // Yerel modda GİB yanıtı yoktur; belge gönderildiği durumda kalır.
    return { status: doc.status === 'sent' ? 'sent' : doc.status,
             statusText: 'Yerel mod — GİB durumu sorgulanamaz' };
  },
  async checkTaxpayer() {
    // Mükellef listesi yalnızca entegratör üzerinden sorgulanabilir.
    return null;
  }
};

/**
 * HTTP adaptörü iskeleti. Çoğu Türk entegratörü benzer bir REST arayüzü sunar:
 * belge POST edilir, takip numarası döner, durum ayrı bir uçtan sorulur.
 *
 * Uç nokta adresleri ve alan adları entegratöre göre değişir; bu yüzden
 * ayarlardan okunur. Canlıya almadan önce entegratörün dokümanıyla eşleştirin.
 */
function httpProvider(config) {
  const required = ['baseUrl', 'apiKey'];
  const missing = required.filter(k => !config[k]);
  if (missing.length) throw new AppError(`Entegratör ayarı eksik / Missing provider config: ${missing.join(', ')}`);

  const call = async (endpoint, method, body) => {
    const res = await fetch(config.baseUrl.replace(/\/$/, '') + endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...(config.extraHeaders || {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(config.timeoutMs || 30000))
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      throw Object.assign(new Error(msg), { providerStatus: res.status, providerBody: data });
    }
    return data;
  };

  return {
    name: config.name || 'http',
    async send(doc) {
      const r = await call(config.sendPath || '/documents', 'POST', {
        type: doc.doc_type,
        uuid: doc.ettn,
        documentNumber: doc.document_no,
        receiverAlias: doc.receiver_alias,
        // Entegratörler XML'i genellikle base64 ister
        content: Buffer.from(doc.xml, 'utf8').toString('base64'),
        testMode: config.testMode ? true : false
      });
      return {
        providerRef: r.id || r.reference || r.trackingId || null,
        status: 'sent',
        statusCode: r.statusCode || null,
        statusText: r.statusText || r.message || null
      };
    },
    async status(doc) {
      const r = await call(`${config.statusPath || '/documents'}/${encodeURIComponent(doc.provider_ref || doc.ettn)}`, 'GET');
      // Entegratör durum sözlüğünü kendi sözlüğümüze indirgiyoruz
      const map = {
        'ACCEPTED': 'accepted', 'KABUL': 'accepted', 'SUCCESS': 'accepted',
        'REJECTED': 'rejected', 'RED': 'rejected', 'FAILED': 'error',
        'PENDING': 'sent', 'PROCESSING': 'sent', 'WAITING': 'sent'
      };
      const raw = String(r.status || r.state || '').toUpperCase();
      return { status: map[raw] || 'sent', statusCode: r.statusCode || raw, statusText: r.statusText || r.message || null };
    },
    async checkTaxpayer(identityNo) {
      const r = await call(`${config.taxpayerPath || '/taxpayers'}/${encodeURIComponent(identityNo)}`, 'GET');
      return {
        isEinvoiceUser: !!(r.isEinvoiceUser ?? r.registered ?? r.exists),
        alias: r.alias || r.postBox || (Array.isArray(r.aliases) ? r.aliases[0] : null) || null
      };
    }
  };
}

/** Ayarlara göre aktif adaptörü döndürür. */
function getProvider() {
  const name = getSetting('einvoiceProvider') || 'local';
  if (name === 'local') return localProvider;
  let cfg = {};
  try { cfg = JSON.parse(getSetting('einvoiceProviderConfig') || '{}'); } catch { cfg = {}; }
  return httpProvider({ ...cfg, name, testMode: getSetting('einvoiceTestMode') !== '0' });
}

/* ============================ NUMARALANDIRMA ============================ */

/**
 * Belge numarasını üretir. Sıra boşluksuz artmalıdır; bu yüzden okuma ve
 * artırma tek ifadede, çağıranın transaction'ı içinde yapılır.
 */
function nextDocumentNo(docType) {
  const year = new Date().getFullYear();
  let row = db.prepare('SELECT * FROM e_document_series WHERE doc_type = ? AND year = ? AND is_active = 1').get(docType, year);
  if (!row) {
    // Yıl döndüğünde seri otomatik açılır; prefix bir önceki yıldan devralınır.
    const prev = db.prepare('SELECT prefix FROM e_document_series WHERE doc_type = ? ORDER BY year DESC LIMIT 1').get(docType);
    const prefix = (prev && prev.prefix) || { einvoice: 'DPT', earchive: 'DPA', edespatch: 'DPI' }[docType] || 'DPT';
    db.prepare('INSERT INTO e_document_series (doc_type,prefix,year,next_value) VALUES (?,?,?,1)').run(docType, prefix, year);
    row = db.prepare('SELECT * FROM e_document_series WHERE doc_type = ? AND year = ?').get(docType, year);
  }
  const seq = row.next_value;
  db.prepare('UPDATE e_document_series SET next_value = next_value + 1 WHERE id = ?').run(row.id);
  return ubl.formatDocumentNo(row.prefix, year, seq);
}

/* ============================ TARAF BİLGİLERİ ============================ */

function supplierParty() {
  const c = db.prepare('SELECT * FROM companies WHERE id = 1').get();
  if (!c) throw new AppError('Firma bilgisi tanımlı değil / Company record missing', 400);
  return {
    name: c.name, taxNo: c.tax_no, identityNo: c.tax_no, taxOffice: c.tax_office,
    address: c.address, district: c.district, city: c.city, postalCode: c.postal_code,
    country: 'Türkiye', phone: c.phone, email: c.email, alias: c.einvoice_sender_alias
  };
}

function customerParty(customerId) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  return {
    raw: c,
    party: {
      name: c.name, taxNo: c.tax_no, identityNo: c.identity_no || c.tax_no, taxOffice: c.tax_office,
      address: c.address, district: c.district, city: c.city, postalCode: c.postal_code,
      country: c.country || 'Türkiye', phone: c.phone, email: c.email,
      alias: c.einvoice_alias
    }
  };
}

/* ============================ BELGE ÜRETİMİ ============================ */

/**
 * Müşteri faturasından e-Fatura veya e-Arşiv üretir.
 * Alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv düzenlenir — bu seçim
 * mükellefin tercihine bırakılamaz, GİB kuralıdır.
 */
/**
 * @param {number|string} invoiceId
 * @param {{ userId?: number|string }} [options]
 */
function buildFromInvoice(invoiceId, { userId } = {}) {
  const inv = db.prepare('SELECT * FROM customer_invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new AppError('Fatura bulunamadı / Invoice not found', 404);

  const existing = db.prepare(`SELECT id, document_no, status FROM e_documents
    WHERE source_type='customer_invoice' AND source_id = ? AND status NOT IN ('cancelled','error')`).get(invoiceId);
  if (existing) throw new AppError(`Bu fatura için zaten e-Belge var / e-Document already exists: ${existing.document_no}`, 409);

  const { raw: cust, party: customer } = customerParty(inv.customer_id);
  const supplier = supplierParty();

  let lines = db.prepare('SELECT * FROM customer_invoice_lines WHERE invoice_id = ? ORDER BY line_no').all(invoiceId)
    .map(l => ({
      itemName: l.item_name, itemCode: l.item_code, qty: l.qty, unit: l.unit,
      unitPrice: l.unit_price, discountRate: l.discount_rate, discountAmount: l.discount_amount,
      vatRate: l.vat_rate, vatAmount: l.vat_amount, lineTotal: l.line_total
    }));

  // Eski faturaların satırı olmayabilir; sipariş satırlarından türetiriz.
  if (!lines.length && inv.so_id) {
    const vatDefault = Number(getSetting('defaultVatRate') || 20);
    lines = db.prepare('SELECT * FROM sales_order_lines WHERE so_id = ? AND shipped_qty > 0').all(inv.so_id)
      .map(l => {
        const lineTotal = Number((l.shipped_qty * l.price).toFixed(2));
        const rate = l.vat_rate ?? vatDefault;
        return {
          itemName: l.item_name, itemCode: null, qty: l.shipped_qty, unit: 'adet',
          unitPrice: l.price, discountRate: 0, discountAmount: 0,
          vatRate: rate, vatAmount: Number((lineTotal * rate / 100).toFixed(2)), lineTotal
        };
      });
  }
  if (!lines.length) throw new AppError('Faturanın kalemi yok, e-Belge üretilemez / Invoice has no lines', 400);

  const docType = cust.is_einvoice_user ? 'einvoice' : 'earchive';
  const now = new Date();
  const payload = {
    docType,
    ettn: ubl.newEttn(),
    documentNo: nextDocumentNo(docType),
    issueDate: inv.invoice_date || toLocalDateStr(now),
    issueTime: now.toTimeString().slice(0, 8),
    profileId: docType === 'earchive' ? 'EARSIVFATURA' : 'TICARIFATURA',
    invoiceType: (inv.invoice_type || 'satis').toUpperCase(),
    supplier, customer,
    lines,
    currency: inv.currency || 'TRY',
    exchangeRate: inv.fx_rate || 1,
    orderReference: inv.so_id ? (db.prepare('SELECT so_no FROM sales_orders WHERE id = ?').get(inv.so_id) || {}).so_no : null,
    despatchReference: inv.shipment_id ? (db.prepare('SELECT shipment_no FROM shipments WHERE id = ?').get(inv.shipment_id) || {}).shipment_no : null
  };

  const errors = ubl.validateInvoiceInput(payload);
  if (errors.length) throw new AppError('e-Belge doğrulama hatası / Validation failed', 422, { details: errors.map(e => ({ field: 'einvoice', message: e })) });

  const xml = ubl.buildInvoice(payload);
  const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const vatTotal = lines.reduce((s, l) => s + Number(l.vatAmount), 0);

  const id = uuid();
  db.prepare(`INSERT INTO e_documents (id,doc_type,ettn,document_no,issue_date,issue_time,source_type,source_id,
      customer_id,receiver_alias,profile_id,currency,subtotal,vat_total,grand_total,xml,xml_hash,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,'customer_invoice',?,?,?,?,?,?,?,?,?,?,'draft',?,?)`)
    .run(id, docType, payload.ettn, payload.documentNo, payload.issueDate, payload.issueTime,
         invoiceId, inv.customer_id, customer.alias || null, payload.profileId, payload.currency,
         subtotal, vatTotal, subtotal + vatTotal, xml,
         require('crypto').createHash('sha256').update(xml).digest('hex'), userId || null, Date.now());

  db.prepare('UPDATE customer_invoices SET e_document_id = ?, subtotal = ?, vat_total = ? WHERE id = ?')
    .run(id, subtotal, vatTotal, invoiceId);

  logDoc(id, 'created', 'draft', `${docType} üretildi: ${payload.documentNo}`, userId);
  return db.prepare('SELECT * FROM e_documents WHERE id = ?').get(id);
}

/** Sevkiyattan e-İrsaliye üretir. */
/**
 * @param {number|string} shipmentId
 * @param {{ userId?: number|string, plateNo?: string, driverName?: string }} [options]
 */
function buildFromShipment(shipmentId, { userId, plateNo, driverName } = {}) {
  const sh = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId);
  if (!sh) throw new AppError('Sevkiyat bulunamadı / Shipment not found', 404);
  if (!sh.customer_id) throw new AppError('Sevkiyatın müşterisi yok, e-İrsaliye düzenlenemez / Shipment has no customer', 400);

  const existing = db.prepare(`SELECT document_no FROM e_documents
    WHERE source_type='shipment' AND source_id = ? AND status NOT IN ('cancelled','error')`).get(shipmentId);
  if (existing) throw new AppError(`Bu sevkiyat için zaten e-İrsaliye var / already exists: ${existing.document_no}`, 409);

  const { party: customer } = customerParty(sh.customer_id);
  const supplier = supplierParty();

  const items = db.prepare(`SELECT si.*, i.code AS item_code, i.unit FROM shipment_items si
    LEFT JOIN items i ON i.id = si.item_id WHERE si.shipment_id = ?`).all(shipmentId);
  if (!items.length) throw new AppError('Sevkiyatın kalemi yok / Shipment has no items', 400);

  const crates = db.prepare('SELECT * FROM shipment_crates WHERE shipment_id = ?').all(shipmentId);
  const now = new Date();

  const payload = {
    ettn: ubl.newEttn(),
    documentNo: nextDocumentNo('edespatch'),
    issueDate: sh.date || toLocalDateStr(now),
    issueTime: now.toTimeString().slice(0, 8),
    supplier, customer,
    lines: items.map(i => ({ itemName: i.item_name, itemCode: i.item_code, qty: i.qty, unit: i.unit, lotNo: i.lot_no })),
    shipmentNo: sh.shipment_no,
    deliveryAddress: sh.destination,
    despatchDate: sh.date,
    carrier: sh.carrier, plateNo, driverName,
    grossWeight: crates.reduce((s, c) => s + Number(c.weight || 0), 0) || null,
    crateCount: crates.length || null,
    orderReference: sh.so_id ? (db.prepare('SELECT so_no FROM sales_orders WHERE id = ?').get(sh.so_id) || {}).so_no : null
  };

  const xml = ubl.buildDespatchAdvice(payload);
  const id = uuid();
  db.prepare(`INSERT INTO e_documents (id,doc_type,ettn,document_no,issue_date,issue_time,source_type,source_id,
      customer_id,receiver_alias,profile_id,currency,xml,xml_hash,status,created_by,created_at)
    VALUES (?,'edespatch',?,?,?,?,'shipment',?,?,?,'TEMELIRSALIYE','TRY',?,?,'draft',?,?)`)
    .run(id, payload.ettn, payload.documentNo, payload.issueDate, payload.issueTime,
         shipmentId, sh.customer_id, customer.edespatchAlias || customer.alias || null,
         xml, require('crypto').createHash('sha256').update(xml).digest('hex'), userId || null, Date.now());

  logDoc(id, 'created', 'draft', `e-İrsaliye üretildi: ${payload.documentNo}`, userId);
  return db.prepare('SELECT * FROM e_documents WHERE id = ?').get(id);
}

/* ============================ GÖNDERİM ============================ */

/**
 * @param {number|string} docId
 * @param {{ userId?: number|string }} [options]
 */
async function sendDocument(docId, { userId } = {}) {
  const doc = db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
  if (!doc) throw new AppError('e-Belge bulunamadı / e-Document not found', 404);
  if (!['draft', 'queued', 'error'].includes(doc.status)) {
    throw new AppError(`Bu durumdaki belge gönderilemez / Cannot send a document in status "${doc.status}"`, 409);
  }

  const provider = getProvider();
  db.prepare('UPDATE e_documents SET status = ?, attempt_count = attempt_count + 1 WHERE id = ?').run('queued', docId);

  try {
    const r = await provider.send(doc);
    db.prepare(`UPDATE e_documents SET status = ?, provider = ?, provider_ref = ?,
        gib_status_code = ?, gib_status_text = ?, sent_at = ?, error_message = NULL WHERE id = ?`)
      .run(r.status || 'sent', provider.name, r.providerRef || null,
           r.statusCode || null, r.statusText || null, Date.now(), docId);
    logDoc(docId, 'sent', r.status || 'sent', r.statusText || 'Gönderildi', userId, r);
  } catch (e) {
    // Gönderim hatası belgeyi silmez: neden başarısız olduğu kayıtta kalmalı.
    db.prepare('UPDATE e_documents SET status = ?, provider = ?, error_message = ? WHERE id = ?')
      .run('error', provider.name, e.message, docId);
    logDoc(docId, 'send_failed', 'error', e.message, userId, e.providerBody);
    throw new AppError(`e-Belge gönderilemedi / Send failed: ${e.message}`, 502);
  }
  return db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
}

/**
 * @param {number|string} docId
 * @param {{ userId?: number|string }} [options]
 */
async function refreshStatus(docId, { userId } = {}) {
  const doc = db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
  if (!doc) throw new AppError('e-Belge bulunamadı / e-Document not found', 404);
  if (doc.status === 'draft') return doc;

  const provider = getProvider();
  try {
    const r = await provider.status(doc);
    if (r.status !== doc.status || r.statusText !== doc.gib_status_text) {
      db.prepare(`UPDATE e_documents SET status = ?, gib_status_code = ?, gib_status_text = ?, responded_at = ? WHERE id = ?`)
        .run(r.status, r.statusCode || null, r.statusText || null, Date.now(), docId);
      logDoc(docId, 'status_checked', r.status, r.statusText || '', userId, r);
    }
  } catch (e) {
    logDoc(docId, 'status_check_failed', doc.status, e.message, userId);
    throw new AppError(`Durum sorgulanamadı / Status check failed: ${e.message}`, 502);
  }
  return db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
}

/**
 * Alıcının e-Fatura mükellefi olup olmadığını entegratörden sorar ve müşteri
 * kaydını günceller. Bu bilgi değişkendir; fatura kesmeden önce tazelenmelidir.
 */
/**
 * @param {number|string} customerId
 * @param {{ userId?: number|string }} [options]
 */
async function checkTaxpayer(customerId, { userId } = {}) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  const id = String(c.identity_no || c.tax_no || '').replace(/\D/g, '');
  if (id.length !== 10 && id.length !== 11) {
    throw new AppError('Müşterinin VKN/TCKN bilgisi eksik veya hatalı / Missing or invalid tax identity', 400);
  }

  const provider = getProvider();
  if (!provider.checkTaxpayer) throw new AppError('Bu entegratör mükellef sorgulaması desteklemiyor', 501);
  const r = await provider.checkTaxpayer(id);
  if (!r) {
    throw new AppError('Mükellef sorgulaması yerel modda yapılamaz — entegratör tanımlayın / Not available in local mode', 501);
  }
  db.prepare('UPDATE customers SET is_einvoice_user = ?, einvoice_alias = ?, einvoice_checked_at = ? WHERE id = ?')
    .run(r.isEinvoiceUser ? 1 : 0, r.alias || null, Date.now(), customerId);
  return { customerId, isEinvoiceUser: !!r.isEinvoiceUser, alias: r.alias || null };
}

/**
 * @param {number|string} docId
 * @param {string} reason
 * @param {{ userId?: number|string }} [options]
 */
function cancelDocument(docId, reason, { userId } = {}) {
  const doc = db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
  if (!doc) throw new AppError('e-Belge bulunamadı / e-Document not found', 404);
  // Gönderilmiş e-Fatura tek taraflı iptal edilemez; iade faturası gerekir.
  if (doc.doc_type === 'einvoice' && ['sent', 'accepted'].includes(doc.status)) {
    throw new AppError('Gönderilmiş e-Fatura iptal edilemez, iade faturası düzenleyin / Issue a return invoice instead', 409);
  }
  db.prepare('UPDATE e_documents SET status = ?, error_message = ? WHERE id = ?').run('cancelled', reason || null, docId);
  logDoc(docId, 'cancelled', 'cancelled', reason || '', userId);
  return db.prepare('SELECT * FROM e_documents WHERE id = ?').get(docId);
}

function logDoc(docId, action, status, message, userId, payload) {
  db.prepare(`INSERT INTO e_document_log (e_document_id,ts,action,status,message,payload,user_id)
    VALUES (?,?,?,?,?,?,?)`)
    .run(docId, Date.now(), action, status || null, message || null,
         payload ? JSON.stringify(payload).slice(0, 4000) : null, userId || null);
}

module.exports = {
  buildFromInvoice, buildFromShipment, sendDocument, refreshStatus,
  checkTaxpayer, cancelDocument, nextDocumentNo, getProvider, logDoc,
  localProvider, httpProvider
};
