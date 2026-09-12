// @ts-nocheck
const express = require('express');
const db = require('../db');
const { AppError, uuid, logAudit, diff } = require('../lib/core');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate, validateQuery, z, pageQuery, currency } = require('../middleware/validate');
const stock = require('../services/stock');

const router = express.Router();
router.use(requireAuth);

const AUDIT_FIELDS = ['name','code','barcode','category','item_type','origin','unit','min_stock','reorder_qty',
  'costing_method','standard_cost','sale_price','sale_currency','is_lot_tracked','is_serial_tracked',
  'shelf_life_days','requires_incoming_inspection','hs_code','supplier','description','location'];

function serializeItem(row, { withBom = true, withLots = false } = {}) {
  const out = {
    id: row.id, name: row.name, code: row.code, barcode: row.barcode, category: row.category,
    itemType: row.item_type, origin: row.origin, warehouseId: row.default_warehouse_id,
    warehouse: row.warehouse_name || null, location: row.location, unit: row.unit,
    qty: row.qty_cache, minStock: row.min_stock, reorderQty: row.reorder_qty,
    costingMethod: row.costing_method, avgCost: row.avg_cost, standardCost: row.standard_cost,
    salePrice: row.sale_price, saleCurrency: row.sale_currency,
    isLotTracked: !!row.is_lot_tracked, isSerialTracked: !!row.is_serial_tracked,
    shelfLifeDays: row.shelf_life_days, requiresIncomingInspection: !!row.requires_incoming_inspection,
    hsCode: row.hs_code, defaultSupplierId: row.default_supplier_id, imagePath: row.image_path,
    supplier: row.supplier, description: row.description, isActive: !!row.is_active
  };
  if (withBom) {
    out.bom = db.prepare(`SELECT b.component_item_id AS componentItemId, i.name AS componentName,
      b.qty_per_unit AS qtyPerUnit, b.scrap_pct AS scrapPct, b.unit
      FROM item_bom b LEFT JOIN items i ON i.id = b.component_item_id WHERE b.item_id = ?`).all(row.id);
    out.rawMaterials = db.prepare('SELECT name, qty, unit, price, currency FROM raw_materials WHERE item_id = ?').all(row.id);
  }
  if (withLots) {
    out.lots = db.prepare(`SELECT sl.id, sl.lot_no AS lotNo, sl.serial_no AS serialNo, sl.qty, sl.status,
      sl.expiry_date AS expiryDate, sl.unit_cost AS unitCost, sl.received_at AS receivedAt, w.name AS warehouse
      FROM stock_lots sl LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE sl.item_id = ? AND sl.qty > 0 ORDER BY (sl.expiry_date IS NULL), sl.expiry_date`).all(row.id);
    // Keyed object with every bucket always present, so the UI can render all four
    // rows without special-casing statuses that happen to have no stock right now.
    const byStatus = { available: 0, quarantine: 0, blocked: 0, rejected: 0 };
    db.prepare(`SELECT status, COALESCE(SUM(qty),0) qty FROM stock_lots
      WHERE item_id = ? AND qty > 0 GROUP BY status`).all(row.id)
      .forEach(r => { if (byStatus[r.status] !== undefined) byStatus[r.status] = r.qty; });
    out.stockByStatus = byStatus;
    out.onOrder = db.prepare(`SELECT COALESCE(SUM(pi.qty - pi.received_qty),0) q FROM po_items pi
      JOIN purchase_orders po ON po.id = pi.po_id
      WHERE pi.item_id = ? AND po.status IN ('approved','partially_received')`).get(row.id).q;
  }
  return out;
}

const listQuery = pageQuery.extend({
  category: z.string().max(1000).optional(),
  origin: z.string().max(1000).optional(),
  warehouseId: z.coerce.number().optional(),
  itemType: z.string().max(1000).optional(),
  lowStock: z.coerce.boolean().optional(),
  includeInactive: z.coerce.boolean().optional()
});

router.get('/', validateQuery(listQuery), (req, res) => {
  const q = req.validatedQuery;
  const where = ['i.deleted_at IS NULL'];
  const params = [];
  if (!q.includeInactive) where.push('i.is_active = 1');
  if (q.category) { where.push('i.category = ?'); params.push(q.category); }
  if (q.origin) { where.push('i.origin = ?'); params.push(q.origin); }
  if (q.itemType) { where.push('i.item_type = ?'); params.push(q.itemType); }
  if (q.warehouseId) { where.push('i.default_warehouse_id = ?'); params.push(q.warehouseId); }
  if (q.lowStock) where.push('i.min_stock > 0 AND i.qty_cache <= i.min_stock');
  if (q.q) {
    where.push('(i.name LIKE ? OR i.code LIKE ? OR i.barcode LIKE ?)');
    const like = `%${q.q}%`; params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM items i WHERE ${whereSql}`).get(...params).c;
  const offset = (q.page - 1) * q.pageSize;
  const rows = db.prepare(`SELECT i.*, w.name AS warehouse_name,
      COALESCE((SELECT SUM(sl.qty) FROM stock_lots sl
                WHERE sl.item_id = i.id AND sl.status = 'quarantine'),0) AS quarantine_qty,
      COALESCE((SELECT SUM(sl.qty) FROM stock_lots sl
                WHERE sl.item_id = i.id AND sl.status IN ('blocked','rejected')),0) AS blocked_qty
    FROM items i
    LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
    WHERE ${whereSql} ORDER BY i.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, q.pageSize, offset);

  res.json({
    data: rows.map(r => ({
      ...serializeItem(r, { withBom: true }),
      quarantineQty: r.quarantine_qty,
      blockedQty: r.blocked_qty
    })),
    page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize)
  });
});

router.get('/:id', (req, res, next) => {
  try {
    // Silinmiş ürün getirilememeli: liste onu gizlerken tekil sorgunun göstermesi
    // tutarsızlıktır ve birleştirme sonrası kaynak kayıt hâlâ varmış gibi görünür.
    const row = db.prepare(`SELECT i.*, w.name AS warehouse_name FROM items i
      LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
      WHERE i.id = ? AND i.deleted_at IS NULL`).get(req.params.id);
    if (!row) throw new AppError('Ürün bulunamadı / Item not found', 404);
    res.json(serializeItem(row, { withBom: true, withLots: true }));
  } catch (e) { next(e); }
});

router.get('/barcode/:code', (req, res, next) => {
  try {
    const row = db.prepare(`SELECT i.*, w.name AS warehouse_name FROM items i
      LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
      WHERE i.barcode = ? AND i.deleted_at IS NULL`).get(req.params.code);
    if (!row) throw new AppError('Barkod bulunamadı / Barcode not found', 404);
    res.json(serializeItem(row, { withBom: true, withLots: true }));
  } catch (e) { next(e); }
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  category: z.string().trim().optional(),
  itemType: z.enum(['raw','semi','finished','consumable']).default('raw'),
  origin: z.string().default('Yurt İçi'),
  warehouse: z.string().max(1000).optional(),
  warehouseId: z.coerce.number().optional(),
  location: z.string().max(1000).optional(),
  unit: z.string().default('adet'),
  minStock: z.coerce.number().min(0).default(0),
  reorderQty: z.coerce.number().min(0).default(0),
  costingMethod: z.enum(['moving_average','fifo']).default('moving_average'),
  standardCost: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0),
  saleCurrency: currency.default('TRY'),
  isLotTracked: z.coerce.boolean().default(true),
  isSerialTracked: z.coerce.boolean().default(false),
  shelfLifeDays: z.coerce.number().int().min(0).nullable().optional(),
  requiresIncomingInspection: z.coerce.boolean().default(false),
  hsCode: z.string().max(1000).optional(),
  defaultSupplierId: z.coerce.number().nullable().optional(),
  supplier: z.string().max(1000).optional(),
  description: z.string().max(5000).optional(),
  openingQty: z.coerce.number().min(0).default(0),
  openingUnitCost: z.coerce.number().min(0).default(0),
  bom: z.array(z.object({
    componentItemId: z.string(),
    qtyPerUnit: z.coerce.number().min(0),
    scrapPct: z.coerce.number().min(0).max(100).default(0)
  })).default([]),
  rawMaterials: z.array(z.object({
    name: z.string(), qty: z.coerce.number().min(0), unit: z.string().max(1000).optional(),
    price: z.coerce.number().min(0), currency: currency.default('TRY')
  })).default([])
});

function resolveWarehouseId(body) {
  if (body.warehouseId) return body.warehouseId;
  if (body.warehouse) {
    const w = db.prepare('SELECT id FROM warehouses WHERE name = ?').get(body.warehouse);
    if (w) return w.id;
  }
  const first = db.prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  return first ? first.id : null;
}

function writeBom(itemId, bom) {
  db.prepare('DELETE FROM item_bom WHERE item_id = ?').run(itemId);
  const ins = db.prepare('INSERT INTO item_bom (item_id,component_item_id,qty_per_unit,scrap_pct,unit) VALUES (?,?,?,?,?)');
  bom.forEach(c => {
    if (c.componentItemId === itemId) throw new AppError('Ürün kendi reçetesinde yer alamaz / Item cannot be its own component');
    const comp = db.prepare('SELECT unit FROM items WHERE id = ?').get(c.componentItemId);
    if (!comp) return;
    ins.run(itemId, c.componentItemId, c.qtyPerUnit, c.scrapPct || 0, comp.unit);
  });
}

function writeRawMaterials(itemId, mats) {
  db.prepare('DELETE FROM raw_materials WHERE item_id = ?').run(itemId);
  const ins = db.prepare('INSERT INTO raw_materials (item_id,name,qty,unit,price,currency) VALUES (?,?,?,?,?,?)');
  mats.forEach(m => { if (m.name && m.name.trim()) ins.run(itemId, m.name.trim(), m.qty, m.unit || 'adet', m.price, m.currency); });
}

router.post('/', requirePermission('stock.write'), validate(itemSchema), (req, res, next) => {
  try {
    const b = req.body;
    const result = db.txImmediate(() => {
      const id = uuid();
      const warehouseId = resolveWarehouseId(b);
      db.prepare(`INSERT INTO items (id,name,code,barcode,category,item_type,origin,default_warehouse_id,location,unit,
        min_stock,reorder_qty,costing_method,standard_cost,sale_price,sale_currency,is_lot_tracked,is_serial_tracked,
        shelf_life_days,requires_incoming_inspection,hs_code,default_supplier_id,supplier,description,created_at)
        VALUES (@id,@name,@code,@barcode,@category,@item_type,@origin,@wh,@location,@unit,
        @min_stock,@reorder_qty,@costing_method,@standard_cost,@sale_price,@sale_currency,@lot,@serial,
        @shelf,@insp,@hs,@sup_id,@supplier,@description,@created)`).run({
        id, name: b.name, code: b.code || '', barcode: b.barcode || '', category: b.category || 'Genel',
        item_type: b.itemType, origin: b.origin, wh: warehouseId, location: b.location || '', unit: b.unit,
        min_stock: b.minStock, reorder_qty: b.reorderQty, costing_method: b.costingMethod,
        standard_cost: b.standardCost, sale_price: b.salePrice, sale_currency: b.saleCurrency,
        lot: b.isLotTracked ? 1 : 0, serial: b.isSerialTracked ? 1 : 0,
        shelf: b.shelfLifeDays ?? null, insp: b.requiresIncomingInspection ? 1 : 0,
        hs: b.hsCode || null, sup_id: b.defaultSupplierId ?? null, supplier: b.supplier || '',
        description: b.description || '', created: Date.now()
      });

      writeBom(id, b.bom);
      writeRawMaterials(id, b.rawMaterials);

      if (b.openingQty > 0) {
        stock.receiveLot({
          itemId: id, warehouseId, qty: b.openingQty, lotNo: 'AÇILIŞ',
          unitCostBase: b.openingUnitCost, sourceType: 'opening',
          note: 'Açılış stoğu / Opening balance', userId: req.user.id
        });
      }

      logAudit(req, 'auditItemAdd', { entityType: 'item', entityId: id, newValue: { name: b.name, code: b.code }, detail: b.name });
      return id;
    });

    const row = db.prepare(`SELECT i.*, w.name AS warehouse_name FROM items i
      LEFT JOIN warehouses w ON w.id = i.default_warehouse_id WHERE i.id = ?`).get(result);
    res.status(201).json(serializeItem(row, { withBom: true, withLots: true }));
  } catch (e) { next(e); }
});

router.put('/:id', requirePermission('stock.write'), validate(itemSchema.partial()), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!existing) throw new AppError('Ürün bulunamadı / Item not found', 404);
    const b = req.body;

    db.txImmediate(() => {
      const warehouseId = (b.warehouseId || b.warehouse) ? resolveWarehouseId(b) : existing.default_warehouse_id;
      db.prepare(`UPDATE items SET name=@name, code=@code, barcode=@barcode, category=@category, item_type=@item_type,
        origin=@origin, default_warehouse_id=@wh, location=@location, unit=@unit, min_stock=@min_stock,
        reorder_qty=@reorder_qty, costing_method=@costing_method, standard_cost=@standard_cost, sale_price=@sale_price,
        sale_currency=@sale_currency, is_lot_tracked=@lot, is_serial_tracked=@serial, shelf_life_days=@shelf,
        requires_incoming_inspection=@insp, hs_code=@hs, default_supplier_id=@sup_id, supplier=@supplier,
        description=@description WHERE id=@id`).run({
        id: existing.id,
        name: b.name ?? existing.name, code: b.code ?? existing.code, barcode: b.barcode ?? existing.barcode,
        category: b.category ?? existing.category, item_type: b.itemType ?? existing.item_type,
        origin: b.origin ?? existing.origin, wh: warehouseId, location: b.location ?? existing.location,
        unit: b.unit ?? existing.unit, min_stock: b.minStock ?? existing.min_stock,
        reorder_qty: b.reorderQty ?? existing.reorder_qty, costing_method: b.costingMethod ?? existing.costing_method,
        standard_cost: b.standardCost ?? existing.standard_cost, sale_price: b.salePrice ?? existing.sale_price,
        sale_currency: b.saleCurrency ?? existing.sale_currency,
        lot: b.isLotTracked != null ? (b.isLotTracked ? 1 : 0) : existing.is_lot_tracked,
        serial: b.isSerialTracked != null ? (b.isSerialTracked ? 1 : 0) : existing.is_serial_tracked,
        shelf: b.shelfLifeDays !== undefined ? b.shelfLifeDays : existing.shelf_life_days,
        insp: b.requiresIncomingInspection != null ? (b.requiresIncomingInspection ? 1 : 0) : existing.requires_incoming_inspection,
        hs: b.hsCode ?? existing.hs_code, sup_id: b.defaultSupplierId !== undefined ? b.defaultSupplierId : existing.default_supplier_id,
        supplier: b.supplier ?? existing.supplier, description: b.description ?? existing.description
      });

      if (b.bom) writeBom(existing.id, b.bom);
      if (b.rawMaterials) writeRawMaterials(existing.id, b.rawMaterials);

      const after = db.prepare('SELECT * FROM items WHERE id = ?').get(existing.id);
      const d = diff(existing, after, AUDIT_FIELDS);
      logAudit(req, 'auditItemEdit', { entityType: 'item', entityId: existing.id, ...(d || {}), detail: after.name });
    });

    const row = db.prepare(`SELECT i.*, w.name AS warehouse_name FROM items i
      LEFT JOIN warehouses w ON w.id = i.default_warehouse_id WHERE i.id = ?`).get(existing.id);
    res.json(serializeItem(row, { withBom: true, withLots: true }));
  } catch (e) { next(e); }
});

/**
 * Soft delete: history rows (movements, lots, shipments) keep pointing at a real item,
 * so past records never become orphaned or unreadable.
 */
router.delete('/:id', requirePermission('stock.delete'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!existing) throw new AppError('Ürün bulunamadı / Item not found', 404);
    const onHand = db.prepare(
      `SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id = ? AND status IN ('available','quarantine','blocked')`
    ).get(existing.id).q;
    if (onHand > 0) {
      throw new AppError(`Stokta ${onHand} ${existing.unit} var, önce stoğu sıfırlayın / Item still has stock`, 400);
    }
    db.prepare('UPDATE items SET deleted_at = ?, is_active = 0 WHERE id = ?').run(Date.now(), existing.id);
    logAudit(req, 'auditItemDelete', { entityType: 'item', entityId: existing.id, oldValue: { name: existing.name }, detail: existing.name });
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
