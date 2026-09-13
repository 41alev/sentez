// @ts-nocheck
/**
 * Özel rapor / pivot motoru — server/migrations/011_saved_reports.js'teki
 * kapsam notuna bakın: serbest SQL yok, yalnızca aşağıdaki whitelist'ten
 * seçilen boyut/ölçü kombinasyonları çalıştırılır. Kullanıcı girdisi
 * (dimension/metric/filtre değerleri) HİÇBİR ZAMAN ham SQL string'ine
 * karışmaz — yalnızca bu sabit anahtar kelimelerle eşleştirilir ya da
 * parametreli sorguya (?) bağlanır.
 */
const db = require('../db');
const { AppError } = require('../lib/core');

const DIMENSIONS = {
  day: { sql: "date(m.ts/1000, 'unixepoch')", label: 'Gün' },
  month: { sql: "strftime('%Y-%m', m.ts/1000, 'unixepoch')", label: 'Ay' },
  item: { sql: "COALESCE(m.item_name, '—')", label: 'Ürün' },
  warehouse: { sql: "COALESCE((SELECT w.name FROM warehouses w WHERE w.id = m.warehouse_id), '—')", label: 'Depo' },
  type: { sql: 'm.type', label: 'Hareket Tipi' },
  refType: { sql: "COALESCE(m.ref_type, 'manual')", label: 'Referans Tipi' }
};

const METRICS = {
  qty: { sql: 'SUM(m.qty)', label: 'Toplam Miktar' },
  value: { sql: 'SUM(m.qty * COALESCE(m.unit_cost,0))', label: 'Toplam Değer' },
  count: { sql: 'COUNT(*)', label: 'İşlem Sayısı' }
};

const MOVEMENT_TYPES = ['in', 'out', 'transfer', 'adjust', 'status_change'];

function meta() {
  return {
    dimensions: Object.entries(DIMENSIONS).map(([k, v]) => ({ key: k, label: v.label })),
    metrics: Object.entries(METRICS).map(([k, v]) => ({ key: k, label: v.label })),
    movementTypes: MOVEMENT_TYPES
  };
}

/**
 * @param {{dimension:string, metric:string, filters?:{from?:string,to?:string,type?:string,warehouseId?:number,itemId?:string}}} input
 */
function runMovementPivot(input) {
  const dim = DIMENSIONS[input.dimension];
  const met = METRICS[input.metric];
  if (!dim) throw new AppError('Geçersiz boyut / Invalid dimension', 400, { allowed: Object.keys(DIMENSIONS) });
  if (!met) throw new AppError('Geçersiz ölçü / Invalid metric', 400, { allowed: Object.keys(METRICS) });

  const f = input.filters || {};
  let sql = `SELECT ${dim.sql} AS dim, ${met.sql} AS val FROM movements m WHERE 1=1`;
  const params = [];
  if (f.from) { sql += ' AND m.ts >= ?'; params.push(new Date(f.from + 'T00:00:00').getTime()); }
  if (f.to) { sql += ' AND m.ts <= ?'; params.push(new Date(f.to + 'T23:59:59').getTime()); }
  if (f.type) {
    if (!MOVEMENT_TYPES.includes(f.type)) throw new AppError('Geçersiz hareket tipi / Invalid movement type', 400);
    sql += ' AND m.type = ?'; params.push(f.type);
  }
  if (f.warehouseId) { sql += ' AND m.warehouse_id = ?'; params.push(f.warehouseId); }
  if (f.itemId) { sql += ' AND m.item_id = ?'; params.push(f.itemId); }
  sql += ' GROUP BY dim ORDER BY dim';

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({ dim: r.dim, val: Math.round(r.val * 100) / 100 }));
}

module.exports = { meta, runMovementPivot, DIMENSIONS, METRICS, MOVEMENT_TYPES };
