const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit } = require('../lib/core');

const router = express.Router();
router.use(requireAuth);

const MANAGER = requireRole('admin', 'manager');

/**
 * Logo veritabanında base64 olarak saklanır.
 * Gerekçe: yazdırma penceresi ayrı bir belge olduğu için dosya yolu yerine gömülü
 * veri kullanmak, yetkilendirme ve yol sorunlarını tamamen ortadan kaldırır.
 * Boyut sınırı bu yüzden dar tutulur.
 */
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(file.mimetype)) {
      return cb(new AppError('Logo PNG, JPEG, SVG veya WEBP olmalı / Logo must be PNG, JPEG, SVG or WEBP', 415));
    }
    cb(null, true);
  }
});

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function serialize(t) {
  return {
    id: t.id, docType: t.doc_type, name: t.name,
    layout: parse(t.layout, {}),
    fields: parse(t.fields, []),
    signatures: parse(t.signatures, []),
    headerText: t.header_text, footerText: t.footer_text,
    isDefault: !!t.is_default, isActive: !!t.is_active, updatedAt: t.updated_at
  };
}

/* ============================ ŞABLONLAR ============================ */

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM document_templates WHERE is_active = 1 ORDER BY doc_type').all();
  res.json(rows.map(serialize));
});

router.get('/:docType', (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE doc_type = ? AND is_default = 1 AND is_active = 1')
    .get(req.params.docType);
  if (!t) throw new AppError('Şablon bulunamadı / Template not found', 404);
  res.json(serialize(t));
});

const templateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  layout: z.object({
    paperSize: z.enum(['A4', 'A5', 'letter', 'label']).optional(),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    marginMm: z.coerce.number().min(0).max(50).optional(),
    fontSize: z.coerce.number().min(6).max(20).optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    showLogo: z.boolean().optional(),
    showCompanyInfo: z.boolean().optional(),
    showDocumentDate: z.boolean().optional(),
    showPageNumbers: z.boolean().optional(),
    showBarcode: z.boolean().optional(),
    logoHeightMm: z.coerce.number().min(5).max(40).optional(),
    tableStriped: z.boolean().optional()
  }).optional(),
  fields: z.array(z.object({
    key: z.string().max(60),
    label: z.string().max(120),
    visible: z.boolean(),
    order: z.coerce.number().int()
  })).optional(),
  signatures: z.array(z.string().max(60)).max(4).optional(),
  headerText: z.string().max(500).optional(),
  footerText: z.string().max(1000).optional()
});

router.put('/:docType', MANAGER, validate(templateSchema), (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE doc_type = ? AND is_default = 1').get(req.params.docType);
  if (!t) throw new AppError('Şablon bulunamadı / Template not found', 404);
  const b = req.valid;

  // Kısmi güncelleme: gönderilmeyen ayar mevcut değerini korur
  const layout = b.layout ? { ...parse(t.layout, {}), ...b.layout } : parse(t.layout, {});

  db.prepare(`UPDATE document_templates SET name=COALESCE(?,name), layout=?, fields=COALESCE(?,fields),
    signatures=COALESCE(?,signatures), header_text=COALESCE(?,header_text),
    footer_text=COALESCE(?,footer_text), updated_by=?, updated_at=? WHERE id=?`)
    .run(b.name ?? null, JSON.stringify(layout),
         b.fields ? JSON.stringify(b.fields) : null,
         b.signatures ? JSON.stringify(b.signatures) : null,
         b.headerText ?? null, b.footerText ?? null,
         req.user.id, Date.now(), t.id);

  logAudit(req, 'auditTemplateUpdate', {
    entityType: 'document_template', entityId: t.id,
    oldValue: { layout: parse(t.layout, {}) }, newValue: { layout },
    detail: t.name
  });
  res.json(serialize(db.prepare('SELECT * FROM document_templates WHERE id = ?').get(t.id)));
});

/** Varsayılana dön: kullanıcı ayarları bozduğunda çıkış yolu olmalı. */
router.post('/:docType/reset', MANAGER, (req, res) => {
  const t = db.prepare('SELECT * FROM document_templates WHERE doc_type = ? AND is_default = 1').get(req.params.docType);
  if (!t) throw new AppError('Şablon bulunamadı / Template not found', 404);
  const fields = parse(t.fields, []).map((f, i) => ({ ...f, visible: true, order: i }));
  const base = {
    paperSize: t.doc_type === 'label' ? 'label' : 'A4', orientation: 'portrait',
    marginMm: t.doc_type === 'label' ? 4 : 14, fontSize: t.doc_type === 'label' ? 10 : 12,
    accentColor: '#111111', showLogo: true, showCompanyInfo: true, showDocumentDate: true,
    showPageNumbers: t.doc_type !== 'label', showBarcode: t.doc_type === 'label',
    logoHeightMm: t.doc_type === 'label' ? 8 : 16, tableStriped: true
  };
  db.prepare('UPDATE document_templates SET layout=?, fields=?, header_text=NULL, footer_text=NULL, updated_at=? WHERE id=?')
    .run(JSON.stringify(base), JSON.stringify(fields), Date.now(), t.id);
  logAudit(req, 'auditTemplateReset', { entityType: 'document_template', entityId: t.id, detail: t.name });
  res.json(serialize(db.prepare('SELECT * FROM document_templates WHERE id = ?').get(t.id)));
});

/* ============================ FİRMA KİMLİĞİ ============================ */

/** Belgelerin üstünde çıkacak firma bilgisi — arayüz bunu bir kez okuyup saklar. */
router.get('/branding/current', (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id = 1').get() || {};
  res.json({
    name: c.name || '', taxNo: c.tax_no || '', taxOffice: c.tax_office || '',
    address: c.address || '', district: c.district || '', city: c.city || '',
    postalCode: c.postal_code || '', phone: c.phone || '', email: c.email || '',
    website: c.website || '', mersisNo: c.mersis_no || '',
    tradeRegistryNo: c.trade_registry_no || '',
    printFooter: c.print_footer || '',
    logo: c.logo_data || null
  });
});

router.put('/branding/current', MANAGER, validate(z.object({
  name: z.string().max(200).optional(), phone: z.string().max(40).optional(),
  email: z.string().max(120).optional(), website: z.string().max(200).optional(),
  address: z.string().max(500).optional(), printFooter: z.string().max(1000).optional()
})), (req, res) => {
  const b = req.valid;
  db.prepare(`UPDATE companies SET name=COALESCE(?,name), phone=COALESCE(?,phone), email=COALESCE(?,email),
    website=COALESCE(?,website), address=COALESCE(?,address), print_footer=COALESCE(?,print_footer)
    WHERE id = 1`)
    .run(b.name ?? null, b.phone ?? null, b.email ?? null, b.website ?? null,
         b.address ?? null, b.printFooter ?? null);
  logAudit(req, 'auditBrandingUpdate', { entityType: 'company', entityId: 1, newValue: b });
  res.json({ ok: true });
});

router.post('/branding/logo', MANAGER, logoUpload.single('logo'), (req, res) => {
  if (!req.file) throw new AppError('Logo yüklenmedi / No logo uploaded', 400);
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  db.prepare('UPDATE companies SET logo_data = ?, logo_mime = ? WHERE id = 1').run(dataUrl, req.file.mimetype);
  logAudit(req, 'auditLogoUpload', {
    entityType: 'company', entityId: 1,
    detail: `${req.file.originalname} (${Math.round(req.file.size / 1024)} KB)`
  });
  res.status(201).json({ ok: true, size: req.file.size, mime: req.file.mimetype });
});

router.delete('/branding/logo', MANAGER, (req, res) => {
  db.prepare('UPDATE companies SET logo_data = NULL, logo_mime = NULL WHERE id = 1').run();
  logAudit(req, 'auditLogoDelete', { entityType: 'company', entityId: 1 });
  res.status(204).end();
});

module.exports = router;
