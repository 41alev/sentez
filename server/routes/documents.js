const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit, paginate } = require('../lib/core');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager', 'operator', 'quality');
const MANAGER = requireRole('admin', 'manager');

/* ============================ FILE UPLOAD ============================ */

const uploadDir = process.env.UPLOAD_DIR || path.join(require('../db').dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Never trust the client filename on disk; keep the original only as metadata.
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^A-Za-z0-9.]/g, '');
    cb(null, `${Date.now()}-${require('crypto').randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new AppError('Bu dosya türü desteklenmiyor / File type not allowed', 415));
    }
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  const { refType = '', refId = '', docType = '', controlled = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM documents WHERE 1=1';
  const params = [];
  if (refType) { sql += ' AND ref_type = ?'; params.push(refType); }
  if (refId) { sql += ' AND ref_id = ?'; params.push(String(refId)); }
  if (docType) { sql += ' AND doc_type = ?'; params.push(docType); }
  if (controlled === '1') sql += ' AND is_controlled = 1';
  sql += ' ORDER BY uploaded_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(serializeDoc);
  res.json(result);
});

function serializeDoc(d) {
  return {
    id: d.id, docNo: d.doc_no, title: d.title, docType: d.doc_type, revision: d.revision,
    originalName: d.original_name, mimeType: d.mime_type, sizeBytes: d.size_bytes,
    refType: d.ref_type, refId: d.ref_id, isControlled: !!d.is_controlled,
    effectiveDate: d.effective_date, reviewDate: d.review_date, supersededBy: d.superseded_by,
    uploadedBy: d.uploaded_by, uploadedAt: d.uploaded_at,
    downloadUrl: `/api/documents/${d.id}/download`
  };
}

router.post('/', WRITE, upload.single('file'), (req, res) => {
  const b = req.body || {};
  if (!b.title && !req.file) throw new AppError('Başlık veya dosya gerekli / Title or file required');

  const info = db.prepare(`INSERT INTO documents (doc_no,title,doc_type,revision,file_path,original_name,mime_type,size_bytes,
      ref_type,ref_id,is_controlled,effective_date,review_date,uploaded_by,uploaded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.docNo || null,
    b.title || (req.file ? req.file.originalname : 'Doküman'),
    b.docType || 'other',
    b.revision || '1',
    req.file ? path.basename(req.file.path) : null,
    req.file ? req.file.originalname : null,
    req.file ? req.file.mimetype : null,
    req.file ? req.file.size : null,
    b.refType || null, b.refId ? String(b.refId) : null,
    b.isControlled === 'true' || b.isControlled === '1' ? 1 : 0,
    b.effectiveDate || null, b.reviewDate || null,
    req.user.id, Date.now()
  );

  // Attaching a CoA to a lot is a quality record — link it back onto the lot
  if (b.docType === 'coa' && b.refType === 'lot' && b.refId) {
    db.prepare('UPDATE stock_lots SET coa_document_id = ? WHERE id = ?').run(info.lastInsertRowid, String(b.refId));
  }

  logAudit(req, 'auditDocumentAdd', {
    entityType: 'document', entityId: info.lastInsertRowid,
    newValue: { title: b.title, docType: b.docType, refType: b.refType, refId: b.refId },
    detail: b.title || (req.file && req.file.originalname)
  });
  res.status(201).json(serializeDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid)));
});

router.get('/:id/download', (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!d || !d.file_path) throw new AppError('Doküman bulunamadı / Document not found', 404);
  // Resolve inside uploadDir only — guards against path traversal via stored names
  const full = path.join(uploadDir, path.basename(d.file_path));
  if (!full.startsWith(uploadDir) || !fs.existsSync(full)) throw new AppError('Dosya bulunamadı / File missing', 404);
  res.setHeader('Content-Type', d.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.original_name || 'file')}"`);
  fs.createReadStream(full).pipe(res);
});

/**
 * New revision of a controlled document: the old one is marked superseded rather
 * than overwritten, which is what ISO document control actually requires.
 */
router.post('/:id/revise', MANAGER, upload.single('file'), (req, res) => {
  const old = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!old) throw new AppError('Doküman bulunamadı / Document not found', 404);
  const b = req.body || {};
  const newRev = b.revision || String(Number(old.revision) + 1 || 2);

  const info = db.prepare(`INSERT INTO documents (doc_no,title,doc_type,revision,file_path,original_name,mime_type,size_bytes,
      ref_type,ref_id,is_controlled,effective_date,review_date,uploaded_by,uploaded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    old.doc_no, b.title || old.title, old.doc_type, newRev,
    req.file ? path.basename(req.file.path) : old.file_path,
    req.file ? req.file.originalname : old.original_name,
    req.file ? req.file.mimetype : old.mime_type,
    req.file ? req.file.size : old.size_bytes,
    old.ref_type, old.ref_id, old.is_controlled,
    b.effectiveDate || null, b.reviewDate || null, req.user.id, Date.now()
  );
  db.prepare('UPDATE documents SET superseded_by = ? WHERE id = ?').run(info.lastInsertRowid, old.id);
  logAudit(req, 'auditDocumentRevise', {
    entityType: 'document', entityId: info.lastInsertRowid,
    oldValue: { revision: old.revision }, newValue: { revision: newRev }, detail: old.title
  });
  res.status(201).json(serializeDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid)));
});

router.delete('/:id', MANAGER, (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!d) throw new AppError('Doküman bulunamadı / Document not found', 404);
  if (d.is_controlled) throw new AppError('Kontrollü doküman silinemez, yeni revizyon oluşturun / Controlled documents cannot be deleted — create a revision');
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  logAudit(req, 'auditDocumentDelete', { entityType: 'document', entityId: d.id, detail: d.title });
  res.status(204).end();
});

module.exports = router;
module.exports.uploadDir = uploadDir;
