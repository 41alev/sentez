const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit } = require('../lib/core');
const health = require('../services/data-health');

const router = express.Router();
router.use(requireAuth);

const MANAGER = requireRole('admin', 'manager');

/* ============================ DENETİM ============================ */

router.get('/report', (req, res) => {
  res.json(health.runAll({ sampleLimit: Number(req.query.sampleLimit) || 25 }));
});

router.get('/check/:id', (req, res) => {
  res.json(health.runOne(req.params.id, {
    limit: Math.min(Number(req.query.limit) || 200, 1000),
    offset: Number(req.query.offset) || 0
  }));
});

router.post('/check/:id/fix', MANAGER, (req, res) => {
  const result = health.applyFix(req.params.id);
  logAudit(req, 'auditDataFix', {
    entityType: 'data_health', entityId: result.id,
    newValue: { before: result.before, after: result.after, resolved: result.resolved },
    detail: `${result.title}: ${result.resolved} kayıt düzeltildi`
  });
  res.json(result);
});

/* ============================ BİRLEŞTİRME ============================ */

/**
 * İki kaydı birleştirir: kaynak kayda ait tüm bağlar hedefe taşınır, kaynak silinir.
 *
 * Bu geri alınamaz. Bu yüzden önce hangi bağların taşınacağı sayılıp gösterilir
 * (`preview`), kullanıcı gördükten sonra onaylar. Aynı ürünün iki kaydı arasında
 * bölünmüş stoğu birleştirmenin başka yolu yoktur; elle düzeltmek hem yavaş hem
 * hataya açıktır.
 */

const MERGE_PLANS = {
  item: {
    table: 'items',
    label: 'Ürün',
    // [tablo, sütun, açıklama]
    refs: [
      ['stock_lots', 'item_id', 'stok partisi'],
      ['movements', 'item_id', 'stok hareketi'],
      ['item_bom', 'item_id', 'reçete (mamul olarak)'],
      ['item_bom', 'component_item_id', 'reçete (bileşen olarak)'],
      ['po_items', 'item_id', 'satın alma satırı'],
      ['sales_order_lines', 'item_id', 'satış satırı'],
      ['production_orders', 'item_id', 'üretim emri'],
      ['production_order_components', 'component_item_id', 'üretim bileşeni'],
      ['stock_count_lines', 'item_id', 'sayım satırı'],
      ['routings', 'item_id', 'rota'],
      ['customer_invoice_lines', 'item_id', 'fatura satırı'],
      ['inspections', 'item_id', 'muayene']
    ]
  },
  supplier: {
    table: 'suppliers', label: 'Tedarikçi',
    refs: [
      ['purchase_orders', 'supplier_id', 'satın alma siparişi'],
      ['items', 'default_supplier_id', 'ürün (varsayılan tedarikçi)'],
      ['stock_lots', 'supplier_id', 'stok partisi'],
      ['supplier_invoices', 'supplier_id', 'tedarikçi faturası'],
      ['purchase_requests', 'supplier_id', 'satın alma talebi']
    ]
  },
  customer: {
    table: 'customers', label: 'Müşteri',
    refs: [
      ['sales_orders', 'customer_id', 'satış siparişi'],
      ['shipments', 'customer_id', 'sevkiyat'],
      ['customer_invoices', 'customer_id', 'müşteri faturası']
    ]
  }
};

/** Tablo/sütun gerçekten var mı? Şema sürüme göre değişebilir. */
function refExists(table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === column);
  } catch { return false; }
}

function countRefs(plan, id) {
  const rows = [];
  for (const [table, column, label] of plan.refs) {
    if (!refExists(table, column)) continue;
    const c = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = ?`).get(id).c;
    if (c > 0) rows.push({ table, column, label, count: c });
  }
  return rows;
}

router.get('/merge/:type/preview', MANAGER, (req, res) => {
  const plan = MERGE_PLANS[req.params.type];
  if (!plan) throw new AppError('Bilinmeyen kayıt tipi / Unknown record type', 400);
  const { sourceId, targetId } = req.query;
  if (!sourceId || !targetId) throw new AppError('Kaynak ve hedef kayıt gerekli / Source and target required', 400);
  if (String(sourceId) === String(targetId)) throw new AppError('Kaynak ve hedef aynı olamaz / Source and target must differ', 400);

  const idCol = plan.table === 'items' ? 'id' : 'id';
  const source = db.prepare(`SELECT * FROM ${plan.table} WHERE ${idCol} = ?`).get(sourceId);
  const target = db.prepare(`SELECT * FROM ${plan.table} WHERE ${idCol} = ?`).get(targetId);
  if (!source || !target) throw new AppError('Kayıt bulunamadı / Record not found', 404);

  res.json({
    type: req.params.type, label: plan.label,
    source: { id: source.id, name: source.name, code: source.code },
    target: { id: target.id, name: target.name, code: target.code },
    references: countRefs(plan, sourceId),
    totalReferences: countRefs(plan, sourceId).reduce((s, r) => s + r.count, 0),
    warning: 'Bu işlem geri alınamaz. Kaynak kayıt silinir, tüm bağları hedefe taşınır.'
  });
});

router.post('/merge/:type', MANAGER, validate(z.object({
  sourceId: z.union([z.string().max(60), z.number()]),
  targetId: z.union([z.string().max(60), z.number()]),
  confirm: z.literal(true)
})), (req, res) => {
  const plan = MERGE_PLANS[req.params.type];
  if (!plan) throw new AppError('Bilinmeyen kayıt tipi / Unknown record type', 400);
  const { sourceId, targetId } = req.valid;
  if (String(sourceId) === String(targetId)) throw new AppError('Kaynak ve hedef aynı olamaz', 400);

  const source = db.prepare(`SELECT * FROM ${plan.table} WHERE id = ?`).get(sourceId);
  const target = db.prepare(`SELECT * FROM ${plan.table} WHERE id = ?`).get(targetId);
  if (!source || !target) throw new AppError('Kayıt bulunamadı / Record not found', 404);

  const moved = [];

  db.txImmediate(() => {
    for (const [table, column, label] of plan.refs) {
      if (!refExists(table, column)) continue;
      const info = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(targetId, sourceId);
      if (info.changes > 0) moved.push({ table, column, label, count: info.changes });
    }

    // Reçetede oluşabilecek kendi kendine referansı temizle: A ile B birleşince
    // "A'nın bileşeni B" satırı "A'nın bileşeni A" haline gelir.
    if (req.params.type === 'item') {
      db.prepare('DELETE FROM item_bom WHERE item_id = component_item_id').run();
      // Aynı bileşen iki kez kalırsa miktarlar toplanmalı, yoksa tüketim eksik hesaplanır
      db.prepare(`DELETE FROM item_bom WHERE id NOT IN (
        SELECT MIN(id) FROM item_bom GROUP BY item_id, component_item_id)`).run();
    }

    // Ürün birleşmesinde stok özeti yeniden hesaplanmalı
    if (req.params.type === 'item') {
      db.prepare(`UPDATE items SET qty_cache = COALESCE(
        (SELECT SUM(sl.qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)
        WHERE id = ?`).run(targetId);
      db.prepare(`UPDATE items SET avg_cost = COALESCE(
        (SELECT SUM(sl.qty*sl.unit_cost)/NULLIF(SUM(sl.qty),0) FROM stock_lots sl
         WHERE sl.item_id = items.id AND sl.status='available'), avg_cost) WHERE id = ?`).run(targetId);
      db.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").run(Date.now(), sourceId);
    } else {
      db.prepare(`DELETE FROM ${plan.table} WHERE id = ?`).run(sourceId);
    }
  });

  logAudit(req, 'auditMerge', {
    entityType: plan.table, entityId: String(targetId),
    oldValue: { source: { id: source.id, name: source.name } },
    newValue: { target: { id: target.id, name: target.name }, moved },
    detail: `${source.name} → ${target.name}`
  });

  res.json({
    merged: true, type: req.params.type,
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    moved, totalMoved: moved.reduce((s, m) => s + m.count, 0)
  });
});

/* ============================ TOPLU DÜZELTME ============================ */

/**
 * Birden fazla ürünün aynı alanını tek seferde günceller.
 * Excel'den gelen veride yüzlerce kaydın birimi veya tedarik şekli yanlış olabilir;
 * tek tek düzeltmek gerçekçi değildir.
 */
router.post('/bulk-update/items', MANAGER, validate(z.object({
  itemIds: z.array(z.string().max(60)).min(1).max(1000),
  field: z.enum(['unit', 'category', 'procurementType', 'minStock', 'safetyStock',
                 'vatRate', 'defaultSupplierId', 'itemType', 'isActive']),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()])
})), (req, res) => {
  const { itemIds, field, value } = req.valid;
  const columns = {
    unit: 'unit', category: 'category', procurementType: 'procurement_type',
    minStock: 'min_stock', safetyStock: 'safety_stock', vatRate: 'vat_rate',
    defaultSupplierId: 'default_supplier_id', itemType: 'item_type', isActive: 'is_active'
  };
  const col = columns[field];

  // Sayısal alanlara metin yazmak sessizce 0 üretir; erken reddedilmeli
  const numeric = ['min_stock', 'safety_stock', 'vat_rate'];
  let v = value;
  if (numeric.includes(col)) {
    v = Number(value);
    if (!Number.isFinite(v)) throw new AppError(`${field} sayı olmalı / must be a number`, 400);
  }
  if (col === 'is_active') v = value ? 1 : 0;
  if (col === 'procurement_type' && !['make', 'buy'].includes(v)) {
    throw new AppError('Tedarik şekli "make" veya "buy" olmalı', 400);
  }

  const placeholders = itemIds.map(() => '?').join(',');
  const info = db.txImmediate(() =>
    db.prepare(`UPDATE items SET ${col} = ? WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
      .run(v, ...itemIds));

  logAudit(req, 'auditBulkUpdate', {
    entityType: 'items', newValue: { field, value: v, count: info.changes },
    detail: `${info.changes} ürün · ${field} = ${v}`
  });
  res.json({ updated: info.changes, field, value: v });
});

/* ============================ SİSTEM DURUMU ============================ */

/**
 * Kurulum ve sürüm bilgisi. Destek isteyen birine "hangi sürümdesiniz,
 * yedeğiniz ne zaman alındı" diye sormak yerine tek ekranda görülür.
 */
router.get('/system', MANAGER, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const pkg = require('../../package.json');

  const migrations = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
  const files = fs.existsSync(path.join(__dirname, '..', 'migrations'))
    ? fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.js'))
    : [];
  const appliedSet = new Set(migrations.map(m => m.version));
  const pending = files.filter(f => !appliedSet.has(f.split('_')[0]));

  const dbPath = process.env.DB_PATH || path.join(db.dataDir, 'depo-takip.sqlite');
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

  const backupDir = process.env.BACKUP_DIR || path.join(db.dataDir, 'backups');
  let backups = [];
  if (fs.existsSync(backupDir)) {
    backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('depo-takip-') && f.endsWith('.sqlite'))
      .map(f => ({ file: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
                   size: fs.statSync(path.join(backupDir, f)).size }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  const setting = (k) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return r ? r.value : null;
  };

  res.json({
    version: pkg.version,
    nodeVersion: process.version,
    uptimeSec: Math.round(process.uptime()),
    setupCompletedAt: Number(setting('setupCompletedAt')) || null,
    database: {
      sizeBytes: dbSize,
      tables: db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c,
      integrityOk: db.pragma('integrity_check', { simple: true }) === 'ok'
    },
    migrations: {
      applied: migrations.length,
      pending: pending.length,
      pendingFiles: pending,
      last: migrations.length ? migrations[migrations.length - 1] : null
    },
    backups: {
      count: backups.length,
      latest: backups[0] ? { file: backups[0].file, at: backups[0].mtime, sizeBytes: backups[0].size } : null,
      // Yedek alınmadan geçen gün: 7 günden fazlaysa ciddi risk
      daysSinceLast: backups[0] ? Math.floor((Date.now() - backups[0].mtime) / 86400000) : null
    },
    counts: {
      users: db.prepare('SELECT COUNT(*) c FROM users WHERE is_active = 1').get().c,
      items: db.prepare('SELECT COUNT(*) c FROM items WHERE deleted_at IS NULL').get().c,
      lots: db.prepare('SELECT COUNT(*) c FROM stock_lots WHERE qty > 0').get().c,
      warehouses: db.prepare('SELECT COUNT(*) c FROM warehouses WHERE is_active = 1').get().c
    }
  });
});

module.exports = router;
