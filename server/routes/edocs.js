// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit, paginate, getSetting, setSetting } = require('../lib/core');
const einvoice = require('../services/einvoice');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator');
const MANAGER = requireRole('admin', 'manager');

function serialize(d) {
  return {
    id: d.id, docType: d.doc_type, ettn: d.ettn, documentNo: d.document_no,
    issueDate: d.issue_date, issueTime: d.issue_time,
    sourceType: d.source_type, sourceId: d.source_id,
    customerId: d.customer_id, customerName: d.customer_name || null,
    receiverAlias: d.receiver_alias, profileId: d.profile_id, currency: d.currency,
    subtotal: d.subtotal, vatTotal: d.vat_total, grandTotal: d.grand_total,
    status: d.status, provider: d.provider, providerRef: d.provider_ref,
    gibStatusCode: d.gib_status_code, gibStatusText: d.gib_status_text,
    errorMessage: d.error_message, attemptCount: d.attempt_count,
    sentAt: d.sent_at, respondedAt: d.responded_at, createdAt: d.created_at,
    xmlUrl: `/api/edocs/${d.id}/xml`
  };
}

/* ============================ LİSTE ============================ */

router.get('/', (req, res) => {
  const { docType = '', status = '', sourceId = '', page = 1, pageSize = 25 } = req.query;
  let sql = `SELECT e.*, c.name AS customer_name FROM e_documents e
             LEFT JOIN customers c ON c.id = e.customer_id WHERE 1=1`;
  const params = [];
  if (docType) { sql += ' AND e.doc_type = ?'; params.push(docType); }
  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (sourceId) { sql += ' AND e.source_id = ?'; params.push(sourceId); }
  sql += ' ORDER BY e.created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serialize);
  res.json(result);
});

router.get('/:id', (req, res) => {
  const d = db.prepare(`SELECT e.*, c.name AS customer_name FROM e_documents e
    LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`).get(req.params.id);
  if (!d) throw new AppError('e-Belge bulunamadı / e-Document not found', 404);
  const log = db.prepare(`SELECT l.*, u.username FROM e_document_log l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.e_document_id = ? ORDER BY l.ts DESC`).all(d.id);
  res.json({
    ...serialize(d),
    log: log.map(l => ({ ts: l.ts, action: l.action, status: l.status, message: l.message, username: l.username }))
  });
});

/** Belgenin kendisi. Denetimde istenen tek şey budur, saklanabilir olmalı. */
router.get('/:id/xml', (req, res) => {
  const d = db.prepare('SELECT document_no, xml FROM e_documents WHERE id = ?').get(req.params.id);
  if (!d || !d.xml) throw new AppError('e-Belge bulunamadı / e-Document not found', 404);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${d.document_no}.xml"`);
  res.send(d.xml);
});

/* ============================ ÜRETİM ============================ */

/** Müşteri faturasından e-Fatura / e-Arşiv üretir (alıcı mükellefiyetine göre). */
router.post('/from-invoice/:invoiceId', WRITE, (req, res) => {
  if (getSetting('einvoiceEnabled') !== '1') {
    throw new AppError('e-Belge modülü kapalı, Yönetim > Ayarlar\'dan açın / e-Document module is disabled', 400);
  }
  const doc = db.txImmediate(() => einvoice.buildFromInvoice(req.params.invoiceId, { userId: req.user.id }));
  logAudit(req, 'auditEDocCreate', {
    entityType: 'e_document', entityId: doc.id,
    newValue: { documentNo: doc.document_no, docType: doc.doc_type }, detail: doc.document_no
  });
  res.status(201).json(serialize(doc));
});

/** Sevkiyattan e-İrsaliye üretir. */
router.post('/from-shipment/:shipmentId', WRITE, validate(z.object({
  plateNo: z.string().max(1000).optional(), driverName: z.string().max(1000).optional()
})), (req, res) => {
  if (getSetting('einvoiceEnabled') !== '1') {
    throw new AppError('e-Belge modülü kapalı / e-Document module is disabled', 400);
  }
  const doc = db.txImmediate(() => einvoice.buildFromShipment(req.params.shipmentId, {
    userId: req.user.id, plateNo: req.valid.plateNo, driverName: req.valid.driverName
  }));
  logAudit(req, 'auditEDocCreate', {
    entityType: 'e_document', entityId: doc.id,
    newValue: { documentNo: doc.document_no, docType: 'edespatch' }, detail: doc.document_no
  });
  res.status(201).json(serialize(doc));
});

/* ============================ GÖNDERİM & DURUM ============================ */

router.post('/:id/send', MANAGER, async (req, res, next) => {
  try {
    const doc = await einvoice.sendDocument(req.params.id, { userId: req.user.id });
    logAudit(req, 'auditEDocSend', { entityType: 'e_document', entityId: doc.id, detail: doc.document_no });
    res.json(serialize(doc));
  } catch (e) { next(e); }
});

router.post('/:id/refresh', WRITE, async (req, res, next) => {
  try { res.json(serialize(await einvoice.refreshStatus(req.params.id, { userId: req.user.id }))); }
  catch (e) { next(e); }
});

router.post('/:id/cancel', MANAGER, validate(z.object({ reason: z.string().max(5000).optional() })), (req, res) => {
  const doc = einvoice.cancelDocument(req.params.id, req.valid.reason, { userId: req.user.id });
  logAudit(req, 'auditEDocCancel', { entityType: 'e_document', entityId: doc.id, detail: doc.document_no });
  res.json(serialize(doc));
});

/* ============================ MÜKELLEF SORGU ============================ */

router.post('/check-taxpayer/:customerId', WRITE, async (req, res, next) => {
  try { res.json(await einvoice.checkTaxpayer(req.params.customerId, { userId: req.user.id })); }
  catch (e) { next(e); }
});

/* ============================ AYARLAR ============================ */

router.get('/settings/current', MANAGER, (req, res) => {
  let cfg = {};
  try { cfg = JSON.parse(getSetting('einvoiceProviderConfig') || '{}'); } catch {}
  const company = db.prepare('SELECT * FROM companies WHERE id = 1').get() || {};
  res.json({
    enabled: getSetting('einvoiceEnabled') === '1',
    provider: getSetting('einvoiceProvider') || 'local',
    testMode: getSetting('einvoiceTestMode') !== '0',
    defaultVatRate: Number(getSetting('defaultVatRate') || 20),
    // API anahtarı asla geri gönderilmez; yalnızca tanımlı olup olmadığı bildirilir
    providerConfig: { baseUrl: cfg.baseUrl || '', apiKeySet: !!cfg.apiKey },
    company: {
      name: company.name, taxNo: company.tax_no, taxOffice: company.tax_office,
      address: company.address, district: company.district, city: company.city,
      postalCode: company.postal_code, mersisNo: company.mersis_no,
      tradeRegistryNo: company.trade_registry_no,
      senderAlias: company.einvoice_sender_alias, despatchAlias: company.edespatch_sender_alias
    },
    series: db.prepare('SELECT doc_type, prefix, year, next_value FROM e_document_series WHERE is_active = 1').all()
  });
});

router.put('/settings/current', MANAGER, (req, res) => {
  const b = req.body || {};
  const before = {
    enabled: getSetting('einvoiceEnabled'), provider: getSetting('einvoiceProvider'),
    testMode: getSetting('einvoiceTestMode')
  };
  if (b.enabled !== undefined) setSetting('einvoiceEnabled', b.enabled ? '1' : '0');
  if (b.provider !== undefined) setSetting('einvoiceProvider', String(b.provider));
  if (b.testMode !== undefined) setSetting('einvoiceTestMode', b.testMode ? '1' : '0');
  if (b.defaultVatRate !== undefined) setSetting('defaultVatRate', String(Number(b.defaultVatRate) || 0));

  if (b.providerConfig) {
    let cfg = {};
    try { cfg = JSON.parse(getSetting('einvoiceProviderConfig') || '{}'); } catch {}
    if (b.providerConfig.baseUrl !== undefined) cfg.baseUrl = b.providerConfig.baseUrl;
    // Boş gönderilen anahtar mevcut anahtarı silmez; kasıtlı temizleme için null gerekir
    if (b.providerConfig.apiKey) cfg.apiKey = b.providerConfig.apiKey;
    if (b.providerConfig.apiKey === null) delete cfg.apiKey;
    setSetting('einvoiceProviderConfig', JSON.stringify(cfg));
  }

  if (b.company) {
    const c = b.company;
    db.prepare(`UPDATE companies SET name=COALESCE(?,name), tax_no=COALESCE(?,tax_no), tax_office=COALESCE(?,tax_office),
      address=COALESCE(?,address), district=COALESCE(?,district), city=COALESCE(?,city), postal_code=COALESCE(?,postal_code),
      mersis_no=COALESCE(?,mersis_no), trade_registry_no=COALESCE(?,trade_registry_no),
      einvoice_sender_alias=COALESCE(?,einvoice_sender_alias), edespatch_sender_alias=COALESCE(?,edespatch_sender_alias)
      WHERE id = 1`)
      .run(c.name ?? null, c.taxNo ?? null, c.taxOffice ?? null, c.address ?? null, c.district ?? null,
           c.city ?? null, c.postalCode ?? null, c.mersisNo ?? null, c.tradeRegistryNo ?? null,
           c.senderAlias ?? null, c.despatchAlias ?? null);
  }

  if (b.series && Array.isArray(b.series)) {
    b.series.forEach(s => {
      if (!s.docType || !s.prefix) return;
      if (!/^[A-Z]{3}$/.test(s.prefix)) throw new AppError('Seri kodu 3 büyük harf olmalı / Series prefix must be 3 uppercase letters', 400);
      db.prepare('UPDATE e_document_series SET prefix = ? WHERE doc_type = ? AND year = ?')
        .run(s.prefix, s.docType, s.year || new Date().getFullYear());
    });
  }

  logAudit(req, 'auditEDocSettings', { entityType: 'settings', oldValue: before, newValue: { enabled: b.enabled, provider: b.provider, testMode: b.testMode } });
  res.json({ ok: true });
});

module.exports = router;
