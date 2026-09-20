/**
 * Aktarımın yazma tarafı.
 *
 * Okuma/doğrulama (`import.js`) ile yazma bilinçli olarak ayrıldı: doğrulama
 * hiçbir şeye dokunmaz, yazma yalnızca doğrulanmış satırlarla çalışır.
 *
 * Parti tek transaction içindedir; satır hatası kendi savepoint'ine geri alınır.
 * Başarılı ve başarısız satırlar import_rows üzerinde ayrı ayrı izlenir.
 */
const ExcelJS = require('exceljs');
const db = require('../db');
const { AppError, uuid, logAudit } = require('../lib/core');
const { SCHEMAS, HEADERS } = require('./import');

/* ============================ YAZMA ============================ */

const lower = (s) => String(s || '').toLocaleLowerCase('tr');

/** Kod veya barkoda göre ürün bulur — aktarımlarda referans hep kodla verilir. */
function findItem(code) {
  return db.prepare('SELECT * FROM items WHERE (code = ? OR barcode = ?) AND deleted_at IS NULL').get(code, code);
}

function resolveWarehouse(name) {
  if (name) {
    const w = db.prepare('SELECT id FROM warehouses WHERE (name = ? OR code = ?) AND is_active = 1').get(name, name);
    if (w) return w.id;
  }
  const first = db.prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!first) throw new AppError('Sistemde aktif depo yok / No active warehouse', 400);
  return first.id;
}

const WRITERS = {
  items(d, batchId, mode) {
    const existing = d.code
      ? db.prepare('SELECT * FROM items WHERE code = ? AND deleted_at IS NULL').get(d.code)
      : (d.barcode ? db.prepare('SELECT * FROM items WHERE barcode = ? AND deleted_at IS NULL').get(d.barcode) : null);

    if (existing) {
      if (mode === 'skip') return { action: 'skipped', table: 'items', id: existing.id };
      if (mode === 'fail') throw new AppError(`Ürün zaten var: ${d.code || d.barcode}`);
      db.prepare(`UPDATE items SET name=?, category=COALESCE(?,category), unit=?, min_stock=?, reorder_qty=?,
        sale_price=?, vat_rate=?, location=COALESCE(?,location), description=COALESCE(?,description),
        item_type=?, origin=?, procurement_type=?, safety_stock=?, shelf_life_days=COALESCE(?,shelf_life_days)
        WHERE id=?`)
        .run(d.name, d.category || null, d.unit, d.minStock || 0, d.reorderQty || 0,
             d.salePrice || 0, d.vatRate ?? 20, d.location || null, d.description || null,
             d.itemType || 'raw', d.origin || 'Yurt İçi', d.procurementType || 'buy',
             d.safetyStock || 0, d.shelfLife || null, existing.id);
      return { action: 'updated', table: 'items', id: existing.id };
    }

    const supplier = d.supplierCode
      ? db.prepare('SELECT id, name FROM suppliers WHERE code = ? OR name = ?').get(d.supplierCode, d.supplierCode)
      : null;

    const id = uuid();
    db.prepare(`INSERT INTO items (company_id,id,name,code,barcode,category,item_type,origin,default_warehouse_id,
        location,unit,min_stock,reorder_qty,costing_method,avg_cost,sale_price,sale_currency,vat_rate,
        is_lot_tracked,shelf_life_days,default_supplier_id,supplier,description,procurement_type,safety_stock,
        qty_cache,import_batch_id,created_at)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?, 'moving_average',0,?, 'TRY',?,1,?,?,?,?,?,?,0,?,?)`)
      .run(id, d.name, d.code || null, d.barcode || null, d.category || null,
           d.itemType || 'raw', d.origin || 'Yurt İçi', resolveWarehouse(null),
           d.location || null, d.unit, d.minStock || 0, d.reorderQty || 0,
           d.salePrice || 0, d.vatRate ?? 20, d.shelfLife || null,
           supplier ? supplier.id : null, supplier ? supplier.name : null,
           d.description || null, d.procurementType || 'buy', d.safetyStock || 0,
           batchId, Date.now());
    return { action: 'created', table: 'items', id };
  },

  suppliers(d, batchId, mode) {
    const existing = d.code
      ? db.prepare('SELECT * FROM suppliers WHERE code = ?').get(d.code)
      : db.prepare('SELECT * FROM suppliers WHERE name = ?').get(d.name);
    if (existing) {
      if (mode === 'skip') return { action: 'skipped', table: 'suppliers', id: existing.id };
      if (mode === 'fail') throw new AppError(`Tedarikçi zaten var: ${d.code || d.name}`);
      db.prepare(`UPDATE suppliers SET name=?, contact_person=COALESCE(?,contact_person), phone=COALESCE(?,phone),
        email=COALESCE(?,email), address=COALESCE(?,address), country=COALESCE(?,country),
        tax_no=COALESCE(?,tax_no), currency=?, payment_terms_days=?, lead_time_days=?,
        incoterm=COALESCE(?,incoterm) WHERE id=?`)
        .run(d.name, d.contactPerson || null, d.phone || null, d.email || null, d.address || null,
             d.country || null, d.taxNo || null, d.currency || 'TRY',
             d.paymentTermsDays ?? 30, d.leadTimeDays ?? 7, d.incoterm || null, existing.id);
      return { action: 'updated', table: 'suppliers', id: existing.id };
    }
    const info = db.prepare(`INSERT INTO suppliers (company_id,code,name,contact_person,phone,email,address,country,
        tax_no,currency,payment_terms_days,lead_time_days,incoterm,is_approved,import_batch_id,created_at)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
      .run(d.code || null, d.name, d.contactPerson || null, d.phone || null, d.email || null,
           d.address || null, d.country || 'TR', d.taxNo || null, d.currency || 'TRY',
           d.paymentTermsDays ?? 30, d.leadTimeDays ?? 7, d.incoterm || null, batchId, Date.now());
    return { action: 'created', table: 'suppliers', id: info.lastInsertRowid };
  },

  customers(d, batchId, mode) {
    const existing = d.code
      ? db.prepare('SELECT * FROM customers WHERE code = ?').get(d.code)
      : db.prepare('SELECT * FROM customers WHERE name = ?').get(d.name);
    if (existing) {
      if (mode === 'skip') return { action: 'skipped', table: 'customers', id: existing.id };
      if (mode === 'fail') throw new AppError(`Müşteri zaten var: ${d.code || d.name}`);
      db.prepare(`UPDATE customers SET name=?, contact_person=COALESCE(?,contact_person), phone=COALESCE(?,phone),
        email=COALESCE(?,email), address=COALESCE(?,address), country=COALESCE(?,country),
        tax_no=COALESCE(?,tax_no), currency=?, payment_terms_days=?, credit_limit=? WHERE id=?`)
        .run(d.name, d.contactPerson || null, d.phone || null, d.email || null, d.address || null,
             d.country || null, d.taxNo || null, d.currency || 'TRY',
             d.paymentTermsDays ?? 30, d.creditLimit ?? 0, existing.id);
      return { action: 'updated', table: 'customers', id: existing.id };
    }
    const info = db.prepare(`INSERT INTO customers (company_id,code,name,contact_person,phone,email,address,country,
        tax_no,currency,payment_terms_days,credit_limit,import_batch_id,created_at)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(d.code || null, d.name, d.contactPerson || null, d.phone || null, d.email || null,
           d.address || null, d.country || 'TR', d.taxNo || null, d.currency || 'TRY',
           d.paymentTermsDays ?? 30, d.creditLimit ?? 0, batchId, Date.now());
    return { action: 'created', table: 'customers', id: info.lastInsertRowid };
  },

  opening_stock(d, batchId) {
    const item = findItem(d.itemCode);
    if (!item) throw new AppError(`Ürün bulunamadı: ${d.itemCode}`);
    if (!(d.qty > 0)) return { action: 'skipped', table: 'stock_lots', id: null };

    const whId = resolveWarehouse(d.warehouse);
    const lotId = uuid();
    // Açılış stoğu doğrudan parti olarak yazılır; hareket kaydı da bırakılır ki
    // miktarın nereden geldiği izlenebilsin.
    db.prepare(`INSERT INTO stock_lots (id,item_id,warehouse_id,lot_no,qty,status,expiry_date,unit_cost,
        received_at,source_type,import_batch_id,notes)
      VALUES (?,?,?,?,?, 'available',?,?,?, 'opening',?,?)`)
      .run(lotId, item.id, whId, d.lotNo || null, d.qty, d.expiryDate || null,
           d.unitCost || 0, Date.now(), batchId, 'Excel ile açılış stoğu');

    db.prepare(`INSERT INTO movements (id,item_id,item_name,lot_id,lot_no,warehouse_id,type,qty,unit_cost,
        to_status,note,ref_type,ref_id,ts,user_id)
      VALUES (?,?,?,?,?,?, 'in',?,?, 'available',?, 'import',?,?,NULL)`)
      .run(uuid(), item.id, item.name, lotId, d.lotNo || null, whId, d.qty, d.unitCost || 0,
           'Excel ile açılış stoğu', batchId, Date.now());
    return { action: 'created', table: 'stock_lots', id: lotId };
  },

  boms(d) {
    const item = findItem(d.itemCode);
    const comp = findItem(d.componentCode);
    if (!item || !comp) throw new AppError(`Ürün bulunamadı: ${!item ? d.itemCode : d.componentCode}`);
    const existing = db.prepare('SELECT id FROM item_bom WHERE item_id = ? AND component_item_id = ?')
      .get(item.id, comp.id);
    if (existing) {
      db.prepare('UPDATE item_bom SET qty_per_unit = ?, scrap_pct = ?, unit = ? WHERE id = ?')
        .run(d.qtyPerUnit, d.scrapPct || 0, comp.unit, existing.id);
      return { action: 'updated', table: 'item_bom', id: existing.id };
    }
    const info = db.prepare('INSERT INTO item_bom (item_id,component_item_id,qty_per_unit,scrap_pct,unit) VALUES (?,?,?,?,?)')
      .run(item.id, comp.id, d.qtyPerUnit, d.scrapPct || 0, comp.unit);
    return { action: 'created', table: 'item_bom', id: info.lastInsertRowid };
  },

  work_centers(d, batchId, mode) {
    // company_id = 1: bu servisin istek (req) bağlamı yok, tıpkı bu dosyadaki
    // items/suppliers/customers commit fonksiyonlarının company_id'yi sabit
    // yazması gibi — çok şirketlilik henüz devreye alınmadı.
    const existing = db.prepare('SELECT * FROM work_centers WHERE code = ? AND company_id = 1').get(d.code);
    if (existing) {
      if (mode === 'skip') return { action: 'skipped', table: 'work_centers', id: existing.id };
      db.prepare(`UPDATE work_centers SET name=?, description=COALESCE(?,description), capacity_units=?,
        hourly_rate=?, efficiency_pct=?, downtime_pct=? WHERE id=?`)
        .run(d.name, d.description || null, d.capacityUnits || 1, d.hourlyRate || 0,
             d.efficiencyPct ?? 100, d.downtimePct || 0, existing.id);
      return { action: 'updated', table: 'work_centers', id: existing.id };
    }
    const info = db.prepare(`INSERT INTO work_centers (code,name,description,capacity_units,hourly_rate,
        efficiency_pct,downtime_pct,import_batch_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(d.code, d.name, d.description || null, d.capacityUnits || 1, d.hourlyRate || 0,
           d.efficiencyPct ?? 100, d.downtimePct || 0, batchId, Date.now());
    return { action: 'created', table: 'work_centers', id: info.lastInsertRowid };
  },

  routings(d) {
    const item = findItem(d.itemCode);
    const wc = db.prepare('SELECT id FROM work_centers WHERE code = ? AND is_active = 1').get(d.workCenterCode);
    if (!item) throw new AppError(`Mamul bulunamadı: ${d.itemCode}`);
    if (!wc) throw new AppError(`İş merkezi bulunamadı: ${d.workCenterCode}`);
    const existing = db.prepare('SELECT id FROM routings WHERE item_id = ? AND operation_no = ?')
      .get(item.id, d.operationNo);
    if (existing) {
      db.prepare(`UPDATE routings SET operation_name=?, work_center_id=?, setup_minutes=?,
        run_minutes_per_unit=?, queue_minutes=?, scrap_pct=? WHERE id=?`)
        .run(d.operationName, wc.id, d.setupMinutes || 0, d.runMinutesPerUnit || 0,
             d.queueMinutes || 0, d.scrapPct || 0, existing.id);
      return { action: 'updated', table: 'routings', id: existing.id };
    }
    const info = db.prepare(`INSERT INTO routings (item_id,operation_no,operation_name,work_center_id,
        setup_minutes,run_minutes_per_unit,queue_minutes,scrap_pct) VALUES (?,?,?,?,?,?,?,?)`)
      .run(item.id, d.operationNo, d.operationName, wc.id, d.setupMinutes || 0,
           d.runMinutesPerUnit || 0, d.queueMinutes || 0, d.scrapPct || 0);
    return { action: 'created', table: 'routings', id: info.lastInsertRowid };
  }
};

/**
 * Önizlemesi alınmış partiyi yazar.
 * Yalnızca geçerli satırlar yazılır; hatalılar atlanır ve sebebiyle kayıtta kalır.
 */
function commit(batchId, { userId }) {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  if (!batch) throw new AppError('Aktarım bulunamadı / Import batch not found', 404);
  if (batch.status !== 'preview') {
    throw new AppError(`Bu aktarım zaten işlenmiş (${batch.status}) / Already processed`, 409);
  }

  const writer = WRITERS[batch.import_type];
  if (!writer) throw new AppError('Bu tip için yazıcı tanımlı değil / No writer for this type', 500);

  const rows = db.prepare('SELECT * FROM import_rows WHERE batch_id = ? AND is_valid = 1 ORDER BY row_no').all(batchId);
  let created = 0, updated = 0, skipped = 0, failed = 0;

  // Tek transaction: yarım aktarım, hiç aktarım yapmamaktan kötüdür.
  db.txImmediate(() => {
    const upd = db.prepare('UPDATE import_rows SET target_table=?, target_id=?, action=?, errors=COALESCE(?,errors) WHERE id=?');
    // better-sqlite3 iç içe transaction için SAVEPOINT kullanır. Bir satırın
    // ikinci yazması başarısız olursa ilk yazması dış transaction'da kalmaz.
    const writeRow = db.transaction(data => writer(data, batchId, batch.duplicate_mode));
    for (const r of rows) {
      try {
        const res = writeRow(JSON.parse(r.parsed_data || '{}'));
        upd.run(res.table, res.id != null ? String(res.id) : null, res.action, null, r.id);
        if (res.action === 'created') created++;
        else if (res.action === 'updated') updated++;
        else skipped++;
      } catch (e) {
        // Tek satırın hatası tüm partiyi düşürmez; sebebi satıra yazılır.
        upd.run(null, null, 'failed', JSON.stringify([e.message]), r.id);
        failed++;
      }
    }

    // Ürün aktarımı stok önbelleğini etkilemez ama açılış stoğu etkiler
    if (batch.import_type === 'opening_stock') {
      db.prepare(`UPDATE items SET qty_cache = COALESCE(
        (SELECT SUM(qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)`).run();
      db.prepare(`UPDATE items SET avg_cost = COALESCE(
        (SELECT SUM(sl.qty*sl.unit_cost)/NULLIF(SUM(sl.qty),0) FROM stock_lots sl
         WHERE sl.item_id = items.id AND sl.status='available'), avg_cost)`).run();
    }

    db.prepare(`UPDATE import_batches SET status='committed', imported_rows=?, skipped_rows=?,
      committed_at=? WHERE id=?`).run(created + updated, skipped + failed, Date.now(), batchId);
  });

  return {
    batchId, batchNo: batch.batch_no, importType: batch.import_type,
    created, updated, skipped, failed,
    errorRows: batch.error_rows
  };
}

/**
 * Aktarımı geri alır.
 *
 * Yalnızca bu aktarımın OLUŞTURDUĞU kayıtlar silinir. Güncellenen kayıtlar geri
 * alınmaz — eski değerleri saklanmadığı için geri yüklenemez; kullanıcı bu konuda
 * uyarılır. Hareket görmüş stok da silinmez: silinirse stok tutarsız kalır.
 */
function revert(batchId, { userId }) {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  if (!batch) throw new AppError('Aktarım bulunamadı / Import batch not found', 404);
  if (batch.status !== 'committed') {
    throw new AppError('Yalnızca kaydedilmiş aktarımlar geri alınabilir / Only committed imports can be reverted', 409);
  }

  const result = { deleted: 0, kept: 0, reasons: [] };

  db.txImmediate(() => {
    const createdRows = db.prepare(
      "SELECT * FROM import_rows WHERE batch_id = ? AND action = 'created' AND target_id IS NOT NULL").all(batchId);

    const revertRow = db.transaction(r => {
      const id = r.target_id;
        if (r.target_table === 'stock_lots') {
          const lot = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(id);
          if (!lot) { result.kept++; return; }
          // Partiden mal çıkmışsa silmek stoğu tutarsız bırakır
          const used = db.prepare(
            "SELECT COUNT(*) c FROM movements WHERE lot_id = ? AND type != 'in'").get(id).c;
          if (used > 0) {
            result.kept++;
            result.reasons.push(`Parti ${lot.lot_no || id.slice(0, 8)}: hareket görmüş, silinmedi`);
            return;
          }
          db.prepare('DELETE FROM movements WHERE lot_id = ?').run(id);
          db.prepare('DELETE FROM stock_lots WHERE id = ?').run(id);
          result.deleted++;

        } else if (r.target_table === 'items') {
          const hasStock = db.prepare('SELECT COUNT(*) c FROM stock_lots WHERE item_id = ?').get(id).c;
          const hasMove = db.prepare('SELECT COUNT(*) c FROM movements WHERE item_id = ?').get(id).c;
          if (hasStock || hasMove) {
            result.kept++;
            result.reasons.push(`Ürün ${id.slice(0, 8)}: stok/hareket var, silinmedi`);
            return;
          }
          db.prepare('DELETE FROM item_bom WHERE item_id = ? OR component_item_id = ?').run(id, id);
          db.prepare('DELETE FROM items WHERE id = ?').run(id);
          result.deleted++;

        } else if (r.target_table === 'suppliers' || r.target_table === 'customers') {
          const table = r.target_table;
          const refCol = table === 'suppliers' ? 'supplier_id' : 'customer_id';
          const refTable = table === 'suppliers' ? 'purchase_orders' : 'sales_orders';
          const used = db.prepare(`SELECT COUNT(*) c FROM ${refTable} WHERE ${refCol} = ?`).get(id).c;
          if (used > 0) {
            result.kept++;
            result.reasons.push(`${table === 'suppliers' ? 'Tedarikçi' : 'Müşteri'} ${id}: siparişi var, silinmedi`);
            return;
          }
          db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
          result.deleted++;

        } else if (r.target_table === 'work_centers') {
          const used = db.prepare('SELECT COUNT(*) c FROM routings WHERE work_center_id = ?').get(id).c;
          if (used > 0) { result.kept++; result.reasons.push(`İş merkezi ${id}: rotada kullanılıyor`); return; }
          db.prepare('DELETE FROM work_center_shifts WHERE work_center_id = ?').run(id);
          db.prepare('DELETE FROM work_centers WHERE id = ?').run(id);
          result.deleted++;

        } else if (r.target_table === 'item_bom' || r.target_table === 'routings') {
          db.prepare(`DELETE FROM ${r.target_table} WHERE id = ?`).run(id);
          result.deleted++;
        }
    });
    for (const r of createdRows) {
      try {
        revertRow(r);
      } catch (e) {
        result.kept++;
        result.reasons.push(`${r.target_table} ${r.target_id}: ${e.message}`);
      }
    }

    const updatedCount = db.prepare(
      "SELECT COUNT(*) c FROM import_rows WHERE batch_id = ? AND action = 'updated'").get(batchId).c;
    if (updatedCount > 0) {
      result.reasons.push(`${updatedCount} kayıt güncellenmişti; eski değerleri saklanmadığı için geri alınamadı`);
    }

    if (batch.import_type === 'opening_stock') {
      db.prepare(`UPDATE items SET qty_cache = COALESCE(
        (SELECT SUM(qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)`).run();
    }

    db.prepare("UPDATE import_batches SET status='reverted', reverted_at=?, reverted_by=? WHERE id=?")
      .run(Date.now(), userId || null, batchId);
  });

  return result;
}

/* ============================ ŞABLON ============================ */

/**
 * Doğru sütunlara sahip boş Excel üretir.
 * Kullanıcının sütun adlarını tahmin etmesini beklemek, aktarımın en sık
 * başarısızlık sebebidir.
 */
async function template(importType) {
  const schema = SCHEMAS[importType];
  if (!schema) throw new AppError('Bilinmeyen aktarım tipi / Unknown import type', 400);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dream Plus';
  const ws = wb.addWorksheet(schema.label);

  const fields = Object.entries(schema.fields);
  ws.columns = fields.map(([name, def]) => ({
    header: HEADERS[name] || name,
    key: name,
    width: Math.max(14, (HEADERS[name] || name).length + 4)
  }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FF211804' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2A900' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 24;

  // İkinci satır açıklama: zorunlu mu, hangi değerler kabul ediliyor
  const hint = ws.addRow(fields.map(([name, def]) => {
    const parts = [];
    if (def.required) parts.push('ZORUNLU');
    if (def.enum) parts.push(def.enum.join(' / '));
    else if (def.type === 'number') parts.push('sayı');
    else if (def.type === 'date') parts.push('GG.AA.YYYY');
    if (def.default !== undefined && !def.required) parts.push(`varsayılan: ${def.default}`);
    return parts.join(' · ') || 'isteğe bağlı';
  }));
  hint.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  hint.alignment = { wrapText: true, vertical: 'top' };

  // Örnek satır: biçimi göstermek, anlatmaktan iyidir
  const sample = SAMPLES[importType];
  if (sample) {
    const row = ws.addRow(fields.map(([name]) => sample[name] ?? ''));
    row.font = { color: { argb: 'FF999999' } };
  }

  ws.views = [{ state: 'frozen', ySplit: 2 }];
  return wb.xlsx.writeBuffer();
}

// HEADERS import.js'te tanımlıdır: sütun eşleştirmesi de aynı listeyi kullanmak
// zorunda, aksi halde üretilen şablon geri yüklenemez.

const SAMPLES = {
  items: { name: 'Altıgen Somun M8', code: 'SM-108', barcode: '8690123456781', category: 'Bağlantı Elemanı',
    unit: 'adet', itemType: 'Hammadde', origin: 'Yurt İçi', minStock: 100, reorderQty: 1000,
    salePrice: 0, vatRate: 20, location: 'A-12', procurementType: 'Satın alınır', safetyStock: 200 },
  suppliers: { name: 'Örnek Tedarik Ltd.', code: 'TED-001', contactPerson: 'Ahmet Yılmaz',
    phone: '+90 216 555 1010', email: 'satis@ornek.com', country: 'TR', taxNo: '1112223334',
    currency: 'TRY', paymentTermsDays: 45, leadTimeDays: 7 },
  customers: { name: 'Örnek Müşteri A.Ş.', code: 'MUS-001', contactPerson: 'Ayşe Demir',
    phone: '+90 312 555 2020', country: 'TR', currency: 'TRY', paymentTermsDays: 60, creditLimit: 500000 },
  opening_stock: { itemCode: 'SM-108', warehouse: 'Merkez Depo', qty: 250, unitCost: 2.05,
    lotNo: 'LOT-2401', expiryDate: '' },
  boms: { itemCode: 'SET-001', componentCode: 'SM-108', qtyPerUnit: 2, scrapPct: 1 },
  work_centers: { code: 'IM-01', name: 'Sac Kesim', capacityUnits: 1, hourlyRate: 420,
    efficiencyPct: 92, downtimePct: 8 },
  routings: { itemCode: 'MP-500', operationNo: 10, operationName: 'Sac Kesim', workCenterCode: 'IM-01',
    setupMinutes: 30, runMinutesPerUnit: 8, queueMinutes: 60, scrapPct: 3 }
};

module.exports = { commit, revert, template, WRITERS, HEADERS };
