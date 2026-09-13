// @ts-nocheck
/**
 * Özel rapor / pivot motoru — server/migrations/011_saved_reports.js'teki
 * kapsam notuna bakın: serbest SQL yok, yalnızca aşağıdaki whitelist'ten
 * seçilen veri kaynağı + boyut + ölçü kombinasyonları çalıştırılır.
 * Kullanıcı girdisi (dataSource/dimension/metric/filtre değerleri) HİÇBİR
 * ZAMAN ham SQL string'ine karışmaz — yalnızca bu sabit anahtar
 * kelimelerle eşleştirilir ya da parametreli sorguya (?) bağlanır.
 *
 * Aşama 8'in ilk sürümü YALNIZCA `movements` (stok hareketleri) tablosuna
 * bakıyordu. Bu, satış performansı × ürün kategorisi gibi soruları
 * cevaplayamıyordu — bu yüzden `sales`, `purchasing` ve `quality` veri
 * kaynakları eklendi. Her kaynağın tarih temsili farklı olduğu için
 * (movements/inspections epoch ms, sales/purchasing 'YYYY-MM-DD' string)
 * her kaynak kendi `dateWhere()` fonksiyonunu tanımlıyor — kod tekrarı
 * gibi görünse de, bu FARKLILIĞI whitelist dışına sızdırmadan güvenle
 * ele almanın en açık yolu.
 */
const db = require('../db');
const { AppError } = require('../lib/core');

const MOVEMENT_TYPES = ['in', 'out', 'transfer', 'adjust', 'status_change'];

function epochRange(from, to, params, col) {
  let sql = '';
  if (from) { sql += ` AND ${col} >= ?`; params.push(new Date(from + 'T00:00:00').getTime()); }
  if (to) { sql += ` AND ${col} <= ?`; params.push(new Date(to + 'T23:59:59').getTime()); }
  return sql;
}
function dateStrRange(from, to, params, col) {
  let sql = '';
  if (from) { sql += ` AND ${col} >= ?`; params.push(from); }
  if (to) { sql += ` AND ${col} <= ?`; params.push(to); }
  return sql;
}

const DATASOURCES = {
  movements: {
    label: 'Stok Hareketleri',
    from: 'movements m',
    dimensions: {
      day: { sql: "date(m.ts/1000, 'unixepoch')", label: 'Gün' },
      month: { sql: "strftime('%Y-%m', m.ts/1000, 'unixepoch')", label: 'Ay' },
      item: { sql: "COALESCE(m.item_name, '—')", label: 'Ürün' },
      warehouse: { sql: "COALESCE((SELECT w.name FROM warehouses w WHERE w.id = m.warehouse_id), '—')", label: 'Depo' },
      type: { sql: 'm.type', label: 'Hareket Tipi' },
      refType: { sql: "COALESCE(m.ref_type, 'manual')", label: 'Referans Tipi' }
    },
    metrics: {
      qty: { sql: 'SUM(m.qty)', label: 'Toplam Miktar' },
      value: { sql: 'SUM(m.qty * COALESCE(m.unit_cost,0))', label: 'Toplam Değer' },
      count: { sql: 'COUNT(*)', label: 'İşlem Sayısı' }
    },
    extraFilters: {
      type: (v, params) => { if (!MOVEMENT_TYPES.includes(v)) throw new AppError('Geçersiz hareket tipi / Invalid movement type', 400); params.push(v); return ' AND m.type = ?'; },
      warehouseId: (v, params) => { params.push(v); return ' AND m.warehouse_id = ?'; },
      itemId: (v, params) => { params.push(v); return ' AND m.item_id = ?'; }
    },
    dateWhere: (from, to, params) => epochRange(from, to, params, 'm.ts')
  },
  sales: {
    label: 'Satış Kalemleri',
    from: 'sales_order_lines sol JOIN sales_orders so ON so.id = sol.so_id',
    dimensions: {
      month: { sql: "strftime('%Y-%m', so.date)", label: 'Ay' },
      item: { sql: "COALESCE(sol.item_name, '—')", label: 'Ürün' },
      customer: { sql: "COALESCE(so.customer_name, '—')", label: 'Müşteri' },
      status: { sql: 'so.status', label: 'Sipariş Durumu' }
    },
    metrics: {
      qty: { sql: 'SUM(sol.qty)', label: 'Sipariş Edilen Miktar' },
      shippedQty: { sql: 'SUM(sol.shipped_qty)', label: 'Sevk Edilen Miktar' },
      revenueBase: { sql: 'SUM(sol.shipped_qty * sol.price * so.fx_rate)', label: 'Ciro (₺)' },
      costBase: { sql: 'SUM(sol.cogs_base)', label: 'Maliyet (₺)' }
    },
    extraFilters: {
      customerId: (v, params) => { params.push(v); return ' AND so.customer_id = ?'; }
    },
    dateWhere: (from, to, params) => dateStrRange(from, to, params, 'so.date')
  },
  purchasing: {
    label: 'Satın Alma Kalemleri',
    from: 'po_items pi JOIN purchase_orders po ON po.id = pi.po_id',
    dimensions: {
      month: { sql: "strftime('%Y-%m', po.date)", label: 'Ay' },
      item: { sql: "COALESCE(pi.item_name, '—')", label: 'Ürün' },
      supplier: { sql: "COALESCE(po.supplier_name, '—')", label: 'Tedarikçi' },
      status: { sql: 'po.status', label: 'Sipariş Durumu' }
    },
    metrics: {
      qty: { sql: 'SUM(pi.qty)', label: 'Sipariş Edilen Miktar' },
      receivedQty: { sql: 'SUM(pi.received_qty)', label: 'Teslim Alınan Miktar' },
      spendBase: { sql: 'SUM(pi.qty * pi.price * po.fx_rate)', label: 'Harcama (₺)' }
    },
    extraFilters: {
      supplierId: (v, params) => { params.push(v); return ' AND po.supplier_id = ?'; }
    },
    dateWhere: (from, to, params) => dateStrRange(from, to, params, 'po.date')
  },
  quality: {
    label: 'Kalite (Muayeneler)',
    from: 'inspections i',
    dimensions: {
      month: { sql: "strftime('%Y-%m', i.created_at/1000, 'unixepoch')", label: 'Ay' },
      item: { sql: "COALESCE(i.item_name, '—')", label: 'Ürün' },
      result: { sql: 'i.result', label: 'Sonuç' },
      type: { sql: 'i.type', label: 'Muayene Tipi' }
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: 'Muayene Sayısı' },
      acceptedQty: { sql: 'SUM(i.accepted_qty)', label: 'Kabul Edilen Miktar' },
      rejectedQty: { sql: 'SUM(i.rejected_qty)', label: 'Reddedilen Miktar' }
    },
    extraFilters: {
      supplierId: (v, params) => { params.push(v); return ' AND i.supplier_id = ?'; }
    },
    dateWhere: (from, to, params) => epochRange(from, to, params, 'i.created_at')
  }
};

function meta() {
  return {
    dataSources: Object.entries(DATASOURCES).map(([key, ds]) => ({
      key, label: ds.label,
      dimensions: Object.entries(ds.dimensions).map(([k, v]) => ({ key: k, label: v.label })),
      metrics: Object.entries(ds.metrics).map(([k, v]) => ({ key: k, label: v.label })),
      extraFilterKeys: Object.keys(ds.extraFilters || {})
    })),
    movementTypes: MOVEMENT_TYPES
  };
}

/**
 * @param {{dataSource?:string, dimension:string, metric:string, filters?:object}} input
 */
function runPivot(input) {
  const dsKey = input.dataSource || 'movements';
  const ds = DATASOURCES[dsKey];
  if (!ds) throw new AppError('Geçersiz veri kaynağı / Invalid data source', 400, { allowed: Object.keys(DATASOURCES) });
  const dim = ds.dimensions[input.dimension];
  const met = ds.metrics[input.metric];
  if (!dim) throw new AppError('Geçersiz boyut / Invalid dimension', 400, { allowed: Object.keys(ds.dimensions) });
  if (!met) throw new AppError('Geçersiz ölçü / Invalid metric', 400, { allowed: Object.keys(ds.metrics) });

  const f = input.filters || {};
  const params = [];
  let sql = `SELECT ${dim.sql} AS dim, ${met.sql} AS val FROM ${ds.from} WHERE 1=1`;
  sql += ds.dateWhere(f.from, f.to, params);
  for (const [key, apply] of Object.entries(ds.extraFilters || {})) {
    if (f[key] !== undefined && f[key] !== '') sql += apply(f[key], params);
  }
  sql += ' GROUP BY dim ORDER BY dim';

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({ dim: r.dim, val: Math.round((r.val || 0) * 100) / 100 }));
}

module.exports = { meta, runPivot, DATASOURCES, MOVEMENT_TYPES };
