/**
 * MRP (Malzeme İhtiyaç Planlaması).
 *
 * Mantık her seviyede aynıdır:
 *
 *   Brüt ihtiyaç  = açık satış siparişleri + üst seviye üretim ihtiyaçları
 *   Net ihtiyaç   = brüt ihtiyaç + emniyet stoğu − eldeki − yoldaki
 *   Önerilen      = net ihtiyaç, parti büyüklüğüne yuvarlanmış
 *   Bırakma tarihi = ihtiyaç tarihi − tedarik süresi
 *
 * Reçete seviye seviye açılır: mamulün ihtiyacı bileşenlerin brüt ihtiyacı olur.
 * Bu yüzden seviye sırası önemlidir — bir bileşen, kendisini kullanan tüm üst
 * seviyeler hesaplanmadan planlanamaz.
 */
const db = require('../db');
const { uuid, nextNumber, getSetting } = require('../lib/core');
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

  // Açık üretim emirleri de bileşen talebi yaratır
  db.prepare(`SELECT po.id, po.order_no, po.item_id, po.qty, po.date, po.due_date
    FROM production_orders po WHERE po.status IN ('Planlandı','Devam Ediyor')`)
    .all().forEach(po => {
      db.prepare('SELECT * FROM item_bom WHERE item_id = ?').all(po.item_id).forEach(b => {
        const need = po.qty * b.qty_per_unit * (1 + (b.scrap_pct || 0) / 100);
        addDemand(b.component_item_id, need, po.due_date || po.date || today, `Üretim ${po.order_no}`);
      });
    });

  // ---- Seviye seviye netleme ----
  const maxLevel = Math.max(0, ...Object.values(levels));
  const suggestions = [];
  let shortages = 0;

  for (let level = 0; level <= maxLevel; level++) {
    const levelItems = items.filter(i => (levels[i.id] || 0) === level && demand[i.id]);

    for (const item of levelItems) {
      const rows = demand[item.id];
      const gross = rows.reduce((s, r) => s + r.qty, 0);
      // Ufkun ötesindeki ihtiyaç bu çalıştırmada planlanmaz
      const inHorizon = rows.filter(r => r.date <= horizonEnd);
      if (!inHorizon.length) continue;

      const onHand = db.prepare(
        "SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE item_id = ? AND status='available'").get(item.id).q;

      // Yoldaki: onaylanmış satın alma siparişlerinin teslim alınmamış kısmı
      const onOrder = db.prepare(`SELECT COALESCE(SUM(pi.qty - pi.received_qty),0) q
        FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
        WHERE pi.item_id = ? AND po.status IN ('approved','partially_received')`).get(item.id).q;

      // Üretimde olan: açık üretim emirlerinin çıktısı
      const inProduction = db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM production_orders
        WHERE item_id = ? AND status IN ('Planlandı','Devam Ediyor')`).get(item.id).q;

      const available = onHand + onOrder + inProduction;
      const grossInHorizon = inHorizon.reduce((s, r) => s + r.qty, 0);
      const net = grossInHorizon + (item.safety_stock || 0) - available;

      if (net <= 0.0001) continue;               // ihtiyaç karşılanıyor

      const suggestedQty = applyLotSizing(net, item);
      // En erken ihtiyaç tarihi belirleyicidir: ona yetişmek gerekir
      const needDate = inHorizon.map(r => r.date).sort()[0];

      const leadDays = item.procurement_type === 'make'
        ? (item.manufacturing_lead_days || 1)
        : (db.prepare('SELECT lead_time_days FROM suppliers WHERE id = ?').get(item.default_supplier_id)?.lead_time_days || 7);
      const releaseDate = addDays(needDate, -leadDays);
      const isLate = releaseDate < today;
      if (isLate) shortages++;

      suggestions.push({
        itemId: item.id, itemName: item.name, level,
        type: item.procurement_type === 'make' ? 'make' : 'buy',
        gross: grossInHorizon, onHand, onOrder: onOrder + inProduction,
        safetyStock: item.safety_stock || 0, net,
        suggestedQty, needDate, releaseDate, isLate,
        supplierId: item.default_supplier_id,
        estimatedCost: Number((suggestedQty * (item.avg_cost || 0)).toFixed(2)),
        // İhtiyacın nereden geldiği: öneriyi değerlendiren kişi bunu görmeli
        sourceDemand: [...new Set(inHorizon.map(r => r.source))].slice(0, 5).join(', ')
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
  if (!s) throw new Error('Öneri bulunamadı / Suggestion not found');
  if (s.status !== 'open') throw new Error('Bu öneri zaten işlenmiş / Suggestion already processed');

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(s.item_id);
  const wh = warehouseId || item.default_warehouse_id ||
    db.prepare('SELECT id FROM warehouses WHERE is_active=1 ORDER BY id LIMIT 1').get().id;

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
    if (!s.supplier_id) throw new Error('Ürünün varsayılan tedarikçisi yok / Item has no default supplier');
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

  db.prepare("UPDATE mrp_suggestions SET status='converted', converted_to=? WHERE id=?").run(createdId, suggestionId);
  return { kind, id: createdId, number: createdNo };
}

module.exports = { runMrp, convertSuggestion, computeLevels, detectCycles, applyLotSizing };
