/**
 * MRP (Malzeme İhtiyaç Planlaması).
 *
 * Mantık her seviyede aynıdır:
 *
 *   Brüt ihtiyaç  = açık satış siparişleri + üst seviye üretim ihtiyaçları
 *   Net ihtiyaç   = zaman fazlı: her ihtiyaç tarihinde, o tarihe kadar
 *                   gelecek arz (eldeki + o tarihe kadar teslim olacak
 *                   sipariş/üretim) ile o tarihe kadarki ihtiyaç + emniyet
 *                   stoğu karşılaştırılır. Geç gelecek bir sipariş, daha
 *                   erken bir ihtiyacı karşılıyor sayılmaz (T09).
 *   Önerilen      = net ihtiyaç, parti büyüklüğüne yuvarlanmış
 *   Bırakma tarihi = ihtiyaç tarihi − tedarik süresi
 *
 * Açık üretim emirlerinin bileşen talebi emrin açıldığı andaki reçete
 * snapshot'ından (production_order_components) gelir; ürün reçetesi sonradan
 * değişse de eski emrin ihtiyacı değişmez.
 *
 * Reçete seviye seviye açılır: mamulün ihtiyacı bileşenlerin brüt ihtiyacı olur.
 * Bu yüzden seviye sırası önemlidir — bir bileşen, kendisini kullanan tüm üst
 * seviyeler hesaplanmadan planlanamaz.
 */
const db = require('../db');
const { AppError, uuid, nextNumber, getSetting } = require('../lib/core');
const { toLocalDateStr: dstr, addDays } = require('../lib/dates');

const DAY = 86400000;

/**
 * Reçeteyi açarak her ürünün seviyesini bulur.
 * Seviye 0 = kimsenin bileşeni olmayan (satılan) ürün.
 * Döngüsel reçete varsa sonsuza gitmemek için ziyaret takibi yapılır.
 */
function computeLevels() {
  const boms = db.prepare('SELECT item_id, component_item_id FROM item_bom').all();
  const children = {};
  boms.forEach(b => { (children[b.item_id] = children[b.item_id] || []).push(b.component_item_id); });

  const levels = {};
  const visit = (itemId, level, path) => {
    if (path.has(itemId)) return;               // döngüsel reçete: bu dalı bırak
    levels[itemId] = Math.max(levels[itemId] || 0, level);
    const next = new Set(path); next.add(itemId);
    (children[itemId] || []).forEach(c => visit(c, level + 1, next));
  };

  const allItems = db.prepare('SELECT id FROM items WHERE is_active = 1 AND deleted_at IS NULL').all();
  allItems.forEach(i => { if (levels[i.id] === undefined) levels[i.id] = 0; });
  allItems.forEach(i => visit(i.id, levels[i.id] || 0, new Set()));
  return levels;
}

/** Döngüsel reçeteleri tespit eder: MRP'yi çalıştırmadan önce uyarmak için. */
function detectCycles() {
  const boms = db.prepare('SELECT item_id, component_item_id FROM item_bom').all();
  const children = {};
  boms.forEach(b => { (children[b.item_id] = children[b.item_id] || []).push(b.component_item_id); });
  const cycles = [];
  const visit = (id, path) => {
    if (path.includes(id)) { cycles.push([...path.slice(path.indexOf(id)), id]); return; }
    (children[id] || []).forEach(c => visit(c, [...path, id]));
  };
  Object.keys(children).forEach(id => visit(id, []));
  return cycles;
}

/** Parti büyüklüğü kuralı: sabit kat veya asgari miktar. */
function applyLotSizing(qty, item) {
  let q = qty;
  if (item.min_lot_size > 0 && q < item.min_lot_size) q = item.min_lot_size;
  if (item.lot_size > 0) q = Math.ceil(q / item.lot_size) * item.lot_size;
  return Number(q.toFixed(4));
}

/**
 * MRP çalıştırır ve önerileri kaydeder.
 * Sadece hesaplar; hiçbir sipariş veya emir otomatik açılmaz — öneriler
 * kullanıcı onayıyla belgeye dönüşür.
 * @param {{ horizonDays?: number, userId?: number|string, notes?: string }} [options]
 */
function runMrp({ horizonDays, userId, notes } = {}) {
  const horizon = Number(horizonDays || getSetting('mrpHorizonDays') || 90);
  const today = dstr(Date.now());
  const horizonEnd = addDays(today, horizon);

  const levels = computeLevels();
  const items = db.prepare(`SELECT * FROM items WHERE is_active = 1 AND deleted_at IS NULL`).all();
  const itemById = {};
  items.forEach(i => { itemById[i.id] = i; });

  // ---- Bağımsız talep: müşteri siparişlerinin sevk edilmemiş kısmı ----
  const demand = {};   // itemId -> [{ qty, date, source }]
  const addDemand = (itemId, qty, date, source) => {
    if (!itemById[itemId] || qty <= 0) return;
    (demand[itemId] = demand[itemId] || []).push({ qty, date, source });
  };

  db.prepare(`SELECT sol.item_id, sol.item_name, (sol.qty - sol.shipped_qty) AS need,
      COALESCE(so.promised_date, so.date) AS need_date, so.so_no
    FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.so_id
    WHERE so.status IN ('open','partially_shipped') AND (sol.qty - sol.shipped_qty) > 0`)
    .all().forEach(r => addDemand(r.item_id, r.need, r.need_date || today, `Satış ${r.so_no}`));

  // Açık üretim emirleri de bileşen talebi yaratır — emrin kendi reçete
  // snapshot'ından. Bileşenler üretim başında tüketileceği için emir tarihi.
  db.prepare(`SELECT po.id, po.order_no, po.date, po.due_date, poc.component_item_id, poc.qty_used
    FROM production_orders po JOIN production_order_components poc ON poc.production_order_id = po.id
    WHERE po.status IN ('Planlandı','Devam Ediyor')`)
    .all().forEach(r => addDemand(r.component_item_id, r.qty_used, r.date || r.due_date || today, `Üretim ${r.order_no}`));

  // ---- Seviye seviye netleme ----
  const maxLevel = Math.max(0, ...Object.values(levels));
  const suggestions = [];
  let shortages = 0;

  for (let level = 0; level <= maxLevel; level++) {
    const levelItems = items.filter(i => (levels[i.id] || 0) === level && demand[i.id]);

    for (const item of levelItems) {
      const rows = demand[item.id];
      // Ufkun ötesindeki ihtiyaç bu çalıştırmada planlanmaz
      const inHorizon = rows.filter(r => r.date <= horizonEnd);
      if (!inHorizon.length) continue;

      // Eldeki: kullanılabilir ve son kullanma tarihi geçmemiş partiler (K-01).
      const onHand = db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM stock_lots
        WHERE item_id = ? AND status='available' AND (expiry_date IS NULL OR expiry_date >= ?)`).get(item.id, today).q;

      // Zaman fazlı arz: onaylı/taslak satın alma kalanları beklenen tarihte,
      // açık üretim emirlerinin kalan çıktısı termin tarihinde gelir.
      const supply = [
        ...db.prepare(`SELECT pi.qty - pi.received_qty AS qty, COALESCE(po.expected, po.date) AS date
          FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
          WHERE pi.item_id = ? AND pi.qty > pi.received_qty
            AND po.status IN ('draft','pending_approval','approved','partially_received')
            AND po.approval_status != 'rejected'`).all(item.id),
        ...db.prepare(`SELECT qty - COALESCE(produced_qty,0) AS qty, COALESCE(due_date, date) AS date
          FROM production_orders WHERE item_id = ? AND status IN ('Planlandı','Devam Ediyor')
            AND qty > COALESCE(produced_qty,0)`).all(item.id)
      ].map(r => ({ qty: r.qty, date: r.date || today }));

      const byDate = [...new Set(inHorizon.map(r => r.date))].sort();
      const safety = item.safety_stock || 0;
      const leadDays = item.procurement_type === 'make'
        ? (item.manufacturing_lead_days || 1)
        : (db.prepare('SELECT lead_time_days FROM suppliers WHERE id = ?').get(item.default_supplier_id)?.lead_time_days || 7);

      let planned = 0;
      for (const needDate of byDate) {
        const demandToDate = inHorizon.filter(r => r.date <= needDate).reduce((s, r) => s + r.qty, 0);
        const supplyToDate = onHand + supply.filter(r => r.date <= needDate).reduce((s, r) => s + r.qty, 0);
        const shortfall = demandToDate + safety - supplyToDate - planned;
        if (shortfall <= 0.0001) continue;

        const suggestedQty = applyLotSizing(shortfall, item);
        planned += suggestedQty;
        const releaseDate = addDays(needDate, -leadDays);
        const isLate = releaseDate < today;
        if (isLate) shortages++;
        const lateSupply = supply.some(r => r.date > needDate);

        // Her öneri kendi tarihine kadarki durumu taşır: brüt = o tarihe kadarki
        // ihtiyaç, yoldaki = o tarihe kadar gelecek arz. Aynı ürünün sonraki
        // önerisinde net, önceki önerilerle planlanan miktar düşülerek bulunur.
        suggestions.push({
          itemId: item.id, itemName: item.name, level,
          type: item.procurement_type === 'make' ? 'make' : 'buy',
          gross: demandToDate, onHand, onOrder: supplyToDate - onHand,
          safetyStock: safety, net: shortfall,
          suggestedQty, needDate, releaseDate, isLate,
          supplierId: item.default_supplier_id,
          estimatedCost: Number((suggestedQty * (item.avg_cost || 0)).toFixed(2)),
          // İhtiyacın nereden geldiği: öneriyi değerlendiren kişi bunu görmeli
          sourceDemand: [
            ...new Set(inHorizon.filter(r => r.date <= needDate).map(r => r.source))
          ].slice(0, 5).join(', ') + (lateSupply ? ' · geç teslim arz var / late supply exists' : '')
        });

        // Üretilecekse bileşenleri bir alt seviyenin talebine eklenir
        if (item.procurement_type === 'make') {
          db.prepare('SELECT * FROM item_bom WHERE item_id = ?').all(item.id).forEach(b => {
            const need = suggestedQty * b.qty_per_unit * (1 + (b.scrap_pct || 0) / 100);
            addDemand(b.component_item_id, need, releaseDate, `MRP: ${item.name}`);
          });
        }
      }
    }
  }

  // ---- Kaydet ----
  const runId = uuid();
  const runNo = nextNumber('mrp_run', 'MRP');
  db.prepare(`INSERT INTO mrp_runs (id,run_no,horizon_days,status,item_count,suggestion_count,shortage_count,notes,created_by,created_at)
    VALUES (?,?,?, 'completed',?,?,?,?,?,?)`)
    .run(runId, runNo, horizon, items.length, suggestions.length, shortages, notes || null, userId || null, Date.now());

  const ins = db.prepare(`INSERT INTO mrp_suggestions
    (run_id,item_id,item_name,bom_level,suggestion_type,gross_requirement,on_hand,on_order,allocated,
     safety_stock,net_requirement,suggested_qty,need_date,release_date,is_late,supplier_id,estimated_cost,source_demand)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)`);
  suggestions.forEach(s => ins.run(runId, s.itemId, s.itemName, s.level, s.type,
    s.gross, s.onHand, s.onOrder, s.safetyStock, s.net, s.suggestedQty,
    s.needDate, s.releaseDate, s.isLate ? 1 : 0, s.supplierId || null, s.estimatedCost, s.sourceDemand));

  return {
    runId, runNo, horizonDays: horizon,
    itemCount: items.length, suggestionCount: suggestions.length, shortageCount: shortages,
    cycles: detectCycles(),
    suggestions
  };
}

/**
 * Öneriyi belgeye dönüştürür: 'make' ise üretim emri, 'buy' ise satın alma siparişi.
 * Öneri kendiliğinden belge olmaz — bu kasıtlı, çünkü MRP çıktısı bir tavsiyedir.
 */
function convertSuggestion(suggestionId, { userId, warehouseId }) {
  const s = db.prepare('SELECT * FROM mrp_suggestions WHERE id = ?').get(suggestionId);
  if (!s) throw new AppError('Öneri bulunamadı / Suggestion not found', 404);
  if (s.status !== 'open') throw new AppError('Bu öneri zaten işlenmiş / Suggestion already processed', 409);

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(s.item_id);
  if (!item) throw new AppError('Önerinin ürünü artık yok / Suggested item no longer exists', 409);
  if (warehouseId && !db.prepare('SELECT id FROM warehouses WHERE id = ? AND is_active = 1').get(warehouseId)) {
    throw new AppError('Depo bulunamadı / Warehouse not found', 404);
  }
  const fallback = db.prepare('SELECT id FROM warehouses WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const wh = warehouseId || item.default_warehouse_id || (fallback && fallback.id);
  if (!wh) throw new AppError('Aktif depo yok / No active warehouse', 409);
  if (s.suggestion_type !== 'make') {
    if (!s.supplier_id) throw new AppError('Ürünün varsayılan tedarikçisi yok / Item has no default supplier', 422);
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(s.supplier_id)) {
      throw new AppError('Önerinin tedarikçisi bulunamadı / Suggested supplier not found', 422);
    }
  }

  let createdId, createdNo, kind;

  if (s.suggestion_type === 'make') {
    createdId = uuid();
    createdNo = nextNumber('production_order', 'URT');
    db.prepare(`INSERT INTO production_orders (id,order_no,item_id,item_name,warehouse_id,qty,status,date,due_date,
        note,mrp_run_id,created_by)
      VALUES (?,?,?,?,?,?, 'Planlandı',?,?,?,?,?)`)
      .run(createdId, createdNo, item.id, item.name, wh, s.suggested_qty,
           s.release_date, s.need_date, `MRP önerisi: ${s.source_demand || ''}`.trim(), s.run_id, userId || null);

    // Reçete varsa bileşen ihtiyaçları emre yazılır
    db.prepare('SELECT * FROM item_bom WHERE item_id = ?').all(item.id).forEach(b => {
      const comp = db.prepare('SELECT name FROM items WHERE id = ?').get(b.component_item_id);
      db.prepare(`INSERT INTO production_order_components (production_order_id,component_item_id,component_name,qty_used)
        VALUES (?,?,?,?)`).run(createdId, b.component_item_id, comp ? comp.name : '—',
          s.suggested_qty * b.qty_per_unit * (1 + (b.scrap_pct || 0) / 100));
    });
    kind = 'production_order';
  } else {
    const sup = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(s.supplier_id);
    createdId = uuid();
    createdNo = nextNumber('purchase_order', 'SA');
    const price = item.avg_cost || 0;
    const total = s.suggested_qty * price;
    db.prepare(`INSERT INTO purchase_orders (id,po_no,supplier_id,supplier_name,date,expected,warehouse_id,
        currency,fx_rate,status,approval_status,total_base,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?,?, 'TRY',1,'draft','pending',?,?,?,?)`)
      .run(createdId, createdNo, sup.id, sup.name, s.release_date, s.need_date, wh,
           total, `MRP önerisi: ${s.source_demand || ''}`.trim(), userId || null, Date.now());
    db.prepare('INSERT INTO po_items (po_id,item_id,item_name,qty,received_qty,price,currency) VALUES (?,?,?,?,0,?,?)')
      .run(createdId, item.id, item.name, s.suggested_qty, price, 'TRY');
    kind = 'purchase_order';
  }

  const changed = db.prepare("UPDATE mrp_suggestions SET status='converted', converted_to=? WHERE id=? AND status='open'")
    .run(createdId, suggestionId).changes;
  if (changed !== 1) throw new AppError('Bu öneri zaten işlenmiş / Suggestion already processed', 409);
  return { kind, id: createdId, number: createdNo };
}

module.exports = { runMrp, convertSuggestion, computeLevels, detectCycles, applyLotSizing };
