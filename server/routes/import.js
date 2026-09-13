// @ts-nocheck
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError, logAudit, paginate } = require('../lib/core');
const importer = require('../services/import');
const writer = require('../services/import-commit');

const router = express.Router();
router.use(requireAuth);

// Aktarım toplu ve geri dönüşü zor bir işlemdir; müdür ve üstü yapabilir.
const MANAGER = requireRole('admin', 'manager');

// Dosya diske yazılmaz: tek seferlik okunur, işlenir, atılır.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // MIME tarayıcıdan tarayıcıya güvenilmez şekilde değişir (bazıları .xlsx
    // için application/octet-stream gönderir) — bu yüzden MIME bir bilgi
    // notu, gerçek kapı değil. Uzantı ZORUNLU; asıl içerik doğrulaması
    // ExcelJS'in dosyayı gerçekten açabilmesiyle yapılır (services/import.js).
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
      return cb(new AppError('Yalnızca .xlsx dosyası yükleyebilirsiniz / Only .xlsx files are accepted', 415));
    }
    cb(null, true);
  }
});

/* ============================ TİPLER VE ŞABLON ============================ */

router.get('/types', (req, res) => {
  res.json(Object.entries(importer.SCHEMAS).map(([key, s]) => ({
    key, label: s.label,
    fields: Object.entries(s.fields).map(([name, def]) => ({
      name, label: writer.HEADERS[name] || name,
      required: !!def.required,
      type: def.type || 'text',
      options: def.enum || null,
      default: def.default ?? null
    })),
    // Bağımlılık sırası: kullanıcı hangi dosyayı önce yüklemeli
    dependsOn: { opening_stock: ['items'], boms: ['items'], routings: ['items', 'work_centers'], items: ['suppliers'] }[key] || []
  })));
});

router.get('/template/:type', MANAGER, async (req, res, next) => {
  try {
    const buffer = await writer.template(req.params.type);
    const label = importer.SCHEMAS[req.params.type].label;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="sablon-${req.params.type}.xlsx"; filename*=UTF-8''${encodeURIComponent(label)}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
});

/* ============================ ÖNİZLEME ============================ */

/** Dosyayı okur ve doğrular. Hiçbir iş kaydı yazılmaz. */
router.post('/preview', MANAGER, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('Dosya yüklenmedi / No file uploaded', 400);
    const { importType, duplicateMode } = req.body || {};
    const result = await importer.preview({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      importType,
      duplicateMode: duplicateMode || 'skip',
      userId: req.user.id
    });
    logAudit(req, 'auditImportPreview', {
      entityType: 'import_batch', entityId: result.batchId,
      newValue: { type: importType, total: result.totalRows, valid: result.validRows },
      detail: `${result.batchNo} · ${req.file.originalname}`
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** Önizlemedeki tüm satırlar (sayfalı) — kullanıcı hepsini görebilmeli. */
router.get('/batches/:id/rows', (req, res) => {
  const { onlyErrors = '', page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM import_rows WHERE batch_id = ?';
  const params = [req.params.id];
  if (onlyErrors === '1') sql += ' AND is_valid = 0';
  sql += ' ORDER BY row_no';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(r => ({
    rowNo: r.row_no,
    data: r.parsed_data ? JSON.parse(r.parsed_data) : {},
    isValid: !!r.is_valid,
    errors: r.errors ? JSON.parse(r.errors) : [],
    warnings: r.warnings ? JSON.parse(r.warnings) : [],
    action: r.action, targetTable: r.target_table, targetId: r.target_id
  }));
  res.json(result);
});

/* ============================ KAYDETME VE GERİ ALMA ============================ */

router.post('/batches/:id/commit', MANAGER, (req, res) => {
  const result = writer.commit(req.params.id, { userId: req.user.id });
  logAudit(req, 'auditImportCommit', {
    entityType: 'import_batch', entityId: req.params.id,
    newValue: result, detail: `${result.batchNo}: ${result.created} yeni, ${result.updated} güncel`
  });
  res.json(result);
});

router.post('/batches/:id/revert', MANAGER, (req, res) => {
  const result = writer.revert(req.params.id, { userId: req.user.id });
  logAudit(req, 'auditImportRevert', {
    entityType: 'import_batch', entityId: req.params.id,
    newValue: { deleted: result.deleted, kept: result.kept },
    detail: `${result.deleted} kayıt silindi, ${result.kept} korundu`
  });
  res.json(result);
});

/** Önizlemesi onaylanmadan bırakılan parti silinebilir. */
router.delete('/batches/:id', MANAGER, (req, res) => {
  const b = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(req.params.id);
  if (!b) throw new AppError('Aktarım bulunamadı / Import batch not found', 404);
  if (b.status !== 'preview') {
    throw new AppError('Yalnızca kaydedilmemiş önizlemeler silinebilir / Only uncommitted previews can be deleted', 409);
  }
  db.prepare('DELETE FROM import_batches WHERE id = ?').run(b.id);
  res.status(204).end();
});

/* ============================ GEÇMİŞ ============================ */

router.get('/batches', (req, res) => {
  const { status = '', importType = '', page = 1, pageSize = 25 } = req.query;
  let sql = `SELECT b.*, u.username, r.username AS reverted_by_name
    FROM import_batches b LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN users r ON r.id = b.reverted_by WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND b.status = ?'; params.push(status); }
  if (importType) { sql += ' AND b.import_type = ?'; params.push(importType); }
  sql += ' ORDER BY b.created_at DESC';
  const result = paginate(sql, params, page, pageSize);
  result.data = result.data.map(b => ({
    id: b.id, batchNo: b.batch_no, importType: b.import_type,
    label: (importer.SCHEMAS[b.import_type] || {}).label || b.import_type,
    fileName: b.file_name, fileSize: b.file_size,
    totalRows: b.total_rows, validRows: b.valid_rows, errorRows: b.error_rows,
    importedRows: b.imported_rows, skippedRows: b.skipped_rows,
    status: b.status, duplicateMode: b.duplicate_mode, errorMessage: b.error_message,
    username: b.username, revertedByName: b.reverted_by_name,
    createdAt: b.created_at, committedAt: b.committed_at, revertedAt: b.reverted_at
  }));
  res.json(result);
});

router.get('/batches/:id', (req, res) => {
  const b = db.prepare(`SELECT b.*, u.username FROM import_batches b
    LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?`).get(req.params.id);
  if (!b) throw new AppError('Aktarım bulunamadı / Import batch not found', 404);
  const counts = db.prepare(`SELECT action, COUNT(*) c FROM import_rows
    WHERE batch_id = ? AND action IS NOT NULL GROUP BY action`).all(b.id);
  res.json({
    id: b.id, batchNo: b.batch_no, importType: b.import_type,
    label: (importer.SCHEMAS[b.import_type] || {}).label || b.import_type,
    fileName: b.file_name, totalRows: b.total_rows, validRows: b.valid_rows,
    errorRows: b.error_rows, importedRows: b.imported_rows, skippedRows: b.skipped_rows,
    status: b.status, duplicateMode: b.duplicate_mode, username: b.username,
    createdAt: b.created_at, committedAt: b.committed_at, revertedAt: b.reverted_at,
    actionCounts: Object.fromEntries(counts.map(c => [c.action, c.c]))
  });
});

module.exports = router;
