// @ts-nocheck
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { AppError, logAudit } = require('../lib/core');
const health = require('../services/data-health');
const license = require('../lib/license');

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
      ['inspections', 'item_id', 'muayene'],
      // shipment_items.item_id has no declared FK, so discovery below misses it.
      ['shipment_items', 'item_id', 'sevkiyat kalemi']
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

/** Şema geliştikçe yeni FK bağları gözden kaçmasın; sabit listeye ekle. */
function mergePlan(type) {
  const base = MERGE_PLANS[type];
  if (!base) return null;
  const refs = base.refs.map(ref => [...ref]);
  const seen = new Set(refs.map(([table, column]) => `${table}.${column}`));
  for (const { name: table } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) continue;
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
      const key = `${table}.${fk.from}`;
      if (fk.table !== base.table || fk.to !== 'id' || seen.has(key) ||
          !/^[a-z_][a-z0-9_]*$/i.test(fk.from)) continue;
      refs.push([table, fk.from, `${table}.${fk.from}`]);
      seen.add(key);
    }
  }
  return { ...base, refs };
}

/**
 * BOM handling for an item merge (T04). Returns a conflict message or null;
 * with `apply` it also rewrites item_bom inside the caller's transaction.
 *  - Source used as a component where the parent already uses the target:
 *    quantities are the same material now, so they are summed (units are
 *    equal, enforced above). Different scrap allowances cannot be summed → 409.
 *  - Source and target both have their own recipe: identical recipes collapse,
 *    different ones need a person to decide → 409.
 *  - A merge that would make an item its own component → 409.
 */
function planItemBom(source, target, apply) {
  const rows = db.prepare(`SELECT rowid AS rid, item_id, component_item_id, qty_per_unit, scrap_pct FROM item_bom
    WHERE item_id IN (?,?) OR component_item_id IN (?,?)`).all(source.id, target.id, source.id, target.id);
  const map = id => (id === source.id ? target.id : id);
  if (rows.some(r => map(r.item_id) === map(r.component_item_id))) {
    return 'Birleştirme kendi kendine reçete oluşturur / Self-referencing BOM';
  }
  const sourceRecipe = rows.filter(r => r.item_id === source.id);
  const targetRecipe = rows.filter(r => r.item_id === target.id);
  if (sourceRecipe.length && targetRecipe.length) {
    const norm = list => list.map(r => `${map(r.component_item_id)}|${r.qty_per_unit}|${r.scrap_pct || 0}`).sort().join(';');
    if (norm(sourceRecipe) !== norm(targetRecipe)) {
      return 'Reçeteler farklı: iki ürünün de kendi reçetesi var, hangisinin geçerli olduğu elle belirlenmeli / Both items have different recipes';
    }
    if (apply) sourceRecipe.forEach(r => db.prepare('DELETE FROM item_bom WHERE rowid = ?').run(r.rid));
  }
  const byParent = new Map();
  for (const r of rows.filter(x => x.item_id !== source.id || !targetRecipe.length)) {
    const key = `${map(r.item_id)}\u0000${map(r.component_item_id)}`;
    const other = byParent.get(key);
    if (!other) { byParent.set(key, r); continue; }
    if ((other.scrap_pct || 0) !== (r.scrap_pct || 0)) {
      return 'Reçete satırlarının fire oranları farklı; elle uzlaştırılmalı / BOM scrap allowances differ';
    }
    if (apply) {
      const keep = other.component_item_id === target.id ? other : r;
      const drop = keep === other ? r : other;
      db.prepare('UPDATE item_bom SET qty_per_unit = qty_per_unit + ? WHERE rowid = ?').run(drop.qty_per_unit, keep.rid);
      db.prepare('DELETE FROM item_bom WHERE rowid = ?').run(drop.rid);
    }
  }
  return null;
}

function mergeConflict(type, source, target) {
  if (type !== 'item') return null;
  if (source.deleted_at || target.deleted_at) return 'Silinmiş ürün birleştirilemez / Deleted item cannot be merged';
  if (source.unit !== target.unit) return 'Farklı birimdeki ürünler birleştirilemez / Item units differ';
  return planItemBom(source, target, false);
}

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
  const plan = mergePlan(req.params.type);
  if (!plan) throw new AppError('Bilinmeyen kayıt tipi / Unknown record type', 400);
  const { sourceId, targetId } = req.query;
  if (!sourceId || !targetId) throw new AppError('Kaynak ve hedef kayıt gerekli / Source and target required', 400);
  if (String(sourceId) === String(targetId)) throw new AppError('Kaynak ve hedef aynı olamaz / Source and target must differ', 400);

  const idCol = plan.table === 'items' ? 'id' : 'id';
  const source = db.prepare(`SELECT * FROM ${plan.table} WHERE ${idCol} = ?`).get(sourceId);
  const target = db.prepare(`SELECT * FROM ${plan.table} WHERE ${idCol} = ?`).get(targetId);
  if (!source || !target) throw new AppError('Kayıt bulunamadı / Record not found', 404);

  const conflict = mergeConflict(req.params.type, source, target);
  const references = countRefs(plan, sourceId);

  res.json({
    type: req.params.type, label: plan.label,
    source: { id: source.id, name: source.name, code: source.code },
    target: { id: target.id, name: target.name, code: target.code },
    references, totalReferences: references.reduce((s, r) => s + r.count, 0),
    plannedRefs: plan.refs.map(([table, column]) => `${table}.${column}`),
    canMerge: !conflict, conflict,
    warning: 'Bu işlem geri alınamaz. Kaynak kayıt silinir, tüm bağları hedefe taşınır.'
  });
});

router.post('/merge/:type', MANAGER, validate(z.object({
  sourceId: z.union([z.string().max(60), z.number()]),
  targetId: z.union([z.string().max(60), z.number()]),
  confirm: z.literal(true)
})), (req, res) => {
  const plan = mergePlan(req.params.type);
  if (!plan) throw new AppError('Bilinmeyen kayıt tipi / Unknown record type', 400);
  const { sourceId, targetId } = req.valid;
  if (String(sourceId) === String(targetId)) throw new AppError('Kaynak ve hedef aynı olamaz', 400);

  const moved = [];
  let source, target;
  db.txImmediate(() => {
    source = db.prepare(`SELECT * FROM ${plan.table} WHERE id = ?`).get(sourceId);
    target = db.prepare(`SELECT * FROM ${plan.table} WHERE id = ?`).get(targetId);
    if (!source || !target) throw new AppError('Kayıt bulunamadı / Record not found', 404);
    const conflict = mergeConflict(req.params.type, source, target);
    if (conflict) throw new AppError(conflict, 409);
    if (req.params.type === 'item') planItemBom(source, target, true);
    for (const [table, column, label] of plan.refs) {
      if (!refExists(table, column)) continue;
      const info = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(targetId, sourceId);
      if (info.changes > 0) moved.push({ table, column, label, count: info.changes });
    }

    // Ürün birleşmesinde stok özeti yeniden hesaplanmalı
    if (req.params.type === 'item') {
      db.prepare(`UPDATE items SET qty_cache = COALESCE(
        (SELECT SUM(sl.qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)
        WHERE id = ?`).run(targetId);
      db.prepare(`UPDATE items SET avg_cost = COALESCE(
        (SELECT SUM(sl.qty*sl.unit_cost)/NULLIF(SUM(sl.qty),0) FROM stock_lots sl
         WHERE sl.item_id = items.id AND sl.status='available'), avg_cost) WHERE id = ?`).run(targetId);
      db.prepare("UPDATE items SET qty_cache=0, deleted_at = ? WHERE id = ?").run(Date.now(), sourceId);
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

  // Each field has its own rule; nothing is silently coerced to 0 (Faz 0 DH-07).
  const validators = {
    unit: z.string().trim().min(1).max(50),
    category: z.string().trim().min(1).max(200),
    procurementType: z.enum(['make', 'buy']),
    minStock: z.number().min(0).max(1e12),
    safetyStock: z.number().min(0).max(1e12),
    vatRate: z.number().min(0).max(100),
    defaultSupplierId: z.number().int().positive().nullable(),
    itemType: z.enum(['raw', 'semi', 'finished', 'consumable']),
    isActive: z.boolean()
  };
  const parsed = validators[field].safeParse(value);
  if (!parsed.success) throw new AppError(`${field}: geçersiz değer / invalid value`, 422);
  let v = parsed.data;
  if (col === 'default_supplier_id' && v != null && !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(v)) {
    throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
  }
  if (col === 'is_active') v = v ? 1 : 0;

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
    // Routine backups are DB + uploads bundles (directories) since T02; older
    // installations may still hold single-file .sqlite backups.
    backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('depo-takip-') && (f.endsWith('.bundle') || f.endsWith('.sqlite')))
      .map(f => {
        const full = path.join(backupDir, f);
        const isBundle = f.endsWith('.bundle');
        const dbFile = isBundle ? path.join(full, 'database.sqlite') : full;
        return { file: f, kind: isBundle ? 'bundle' : 'database-only', mtime: fs.statSync(full).mtimeMs,
                 size: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
                 complete: !isBundle || fs.existsSync(path.join(full, 'manifest.json')) };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  const setting = (k) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return r ? r.value : null;
  };

  const lic = license.currentStatus();
  res.json({
    version: pkg.version,
    nodeVersion: process.version,
    uptimeSec: Math.round(process.uptime()),
    setupCompletedAt: Number(setting('setupCompletedAt')) || null,
    license: lic.enforced
      ? { enforced: true, valid: !!lic.valid, licensee: lic.license?.licensee || null,
          daysRemaining: lic.daysRemaining ?? null, reason: lic.valid ? null : lic.reason }
      : { enforced: false },
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
      latest: backups[0] ? { file: backups[0].file, kind: backups[0].kind, complete: backups[0].complete,
        at: backups[0].mtime, sizeBytes: backups[0].size } : null,
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
