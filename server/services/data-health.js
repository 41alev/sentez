/**
 * Veri sağlığı denetimi.
 *
 * Yabancı anahtarlar ve doğrulama kuralları, verinin *şeklini* korur.
 * Korumadığı şey anlamıdır: reçetesi olmayan bir "üretilir" ürünü, stoğu olup
 * maliyeti sıfır kalan bir kalem, aynı ürünü iki kez temsil eden iki kayıt.
 * Bunlar veritabanı açısından kusursuzdur ama işletme açısından bozuktur.
 *
 * Gerçek veri her zaman böyledir. Sistem bunları bulup göstermezse, yanlış
 * sayılar sessizce raporlara ve kararlara akar.
 *
 * Her kontrol şunu döndürür:
 *   id, severity ('critical'|'warning'|'info'), title, explanation,
 *   count, sample[], fixable (otomatik düzeltilebilir mi), fixAction
 */
const db = require('../db');
const { AppError, uuid } = require('../lib/core');
const { today, addDays } = require('../lib/dates');
const stock = require('./stock');

const CHECKS = [];
const check = (def) => CHECKS.push(def);

/* ============================ STOK TUTARLILIĞI ============================ */

check({
  id: 'qty_cache_mismatch',
  severity: 'critical',
  title: 'Ürün stok özeti partilerle uyuşmuyor',
  explanation: 'Ürün kartındaki stok miktarı, o ürünün partilerinin toplamından farklı. ' +
    'Raporlar ürün kartını okur; bu fark tüm stok değerlemesini yanlış gösterir.',
  fixable: true,
  fixAction: 'qty_cache alanı partilerden yeniden hesaplanır.',
  run() {
    // HAVING yalnızca gruplanmış sorgularda çalışır; fark bir alt sorguda hesaplanıp
    // dış sorguda süzülüyor.
    return db.prepare(`
      SELECT * FROM (
        SELECT i.id, i.name, i.code, i.qty_cache AS cached,
          COALESCE((SELECT SUM(sl.qty) FROM stock_lots sl
            WHERE sl.item_id = i.id AND sl.status = 'available'), 0) AS actual
        FROM items i WHERE i.deleted_at IS NULL
      ) WHERE ABS(cached - actual) > 0.0001`).all()
      .map(r => ({
        key: r.id,
        label: `${r.name} (${r.code || '—'})`,
        detail: `kartta ${r.cached}, partilerde ${r.actual}`
      }));
  },
  fix() {
    const info = db.prepare(`UPDATE items SET qty_cache = COALESCE(
      (SELECT SUM(sl.qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status = 'available'), 0)
      WHERE deleted_at IS NULL`).run();
    return { updated: info.changes };
  }
});

check({
  id: 'negative_lot_qty',
  severity: 'critical',
  title: 'Eksi miktarlı parti',
  explanation: 'Bir partinin miktarı sıfırın altında. Fiziksel olarak imkânsızdır; ' +
    'çoğunlukla elle düzeltme veya yarım kalmış bir işlemden kaynaklanır. ' +
    'Otomatik düzeltilmez çünkü doğru miktarın ne olduğunu yalnızca sayım söyler.',
  fixable: false,
  run() {
    return db.prepare(`SELECT sl.id, sl.lot_no, sl.qty, i.name AS item_name
      FROM stock_lots sl JOIN items i ON i.id = sl.item_id WHERE sl.qty < 0`).all()
      .map(r => ({ key: r.id, label: `${r.item_name} · ${r.lot_no || '—'}`, detail: `miktar ${r.qty}` }));
  }
});

check({
  id: 'stock_without_cost',
  severity: 'warning',
  title: 'Maliyeti sıfır olan stok',
  explanation: 'Stokta miktarı var ama birim maliyeti sıfır olan partiler. ' +
    'Stok değerleme raporu bu kalemleri bedava sayar; kârlılık olduğundan yüksek görünür.',
  fixable: true,
  fixAction: 'Ürünün ortalama maliyeti varsa partilere uygulanır. Ortalama maliyet de sıfırsa dokunulmaz.',
  run() {
    return db.prepare(`SELECT sl.id, sl.lot_no, sl.qty, i.name AS item_name, i.avg_cost
      FROM stock_lots sl JOIN items i ON i.id = sl.item_id
      WHERE sl.qty > 0 AND sl.status = 'available' AND COALESCE(sl.unit_cost,0) = 0`).all()
      .map(r => ({
        key: r.id,
        label: `${r.item_name} · ${r.lot_no || '—'}`,
        detail: r.avg_cost > 0 ? `ürün ort. maliyeti ${r.avg_cost}` : 'ürün maliyeti de tanımsız'
      }));
  },
  fix() {
    const info = db.prepare(`UPDATE stock_lots SET unit_cost = (
        SELECT i.avg_cost FROM items i WHERE i.id = stock_lots.item_id)
      WHERE COALESCE(unit_cost,0) = 0 AND qty > 0
        AND (SELECT i.avg_cost FROM items i WHERE i.id = stock_lots.item_id) > 0`).run();
    return { updated: info.changes };
  }
});

check({
  id: 'expired_available',
  severity: 'critical',
  title: 'Süresi geçmiş ama kullanılabilir parti',
  explanation: 'Son kullanma tarihi geçtiği halde hâlâ kullanılabilir durumda olan partiler. ' +
    'FEFO bunları sevk edebilir veya üretimde tüketebilir.',
  fixable: true,
  fixAction: 'Bu partiler bloke durumuna alınır ve hareket kaydı bırakılır.',
  run() {
    return db.prepare(`SELECT sl.id, sl.lot_no, sl.qty, sl.expiry_date, i.name AS item_name
      FROM stock_lots sl JOIN items i ON i.id = sl.item_id
      WHERE sl.status = 'available' AND sl.qty > 0
        AND sl.expiry_date IS NOT NULL AND sl.expiry_date < ?`).all(today())
      .map(r => ({
        key: r.id, label: `${r.item_name} · ${r.lot_no || '—'}`,
        detail: `SKT ${r.expiry_date}, miktar ${r.qty}`
      }));
  },
  fix() {
    const cutoffToday = today();
    const lots = db.prepare(`SELECT sl.*, i.name AS item_name FROM stock_lots sl
      JOIN items i ON i.id = sl.item_id
      WHERE sl.status = 'available' AND sl.qty > 0
        AND sl.expiry_date IS NOT NULL AND sl.expiry_date < ?`).all(cutoffToday);
    lots.forEach(l => {
      stock.changeLotStatus({ lotId: l.id, toStatus: 'blocked', qty: l.qty,
        note: `Süresi geçmiş (SKT ${l.expiry_date}) — veri denetimi ile bloke edildi`,
        refType: 'data_health', refId: null, userId: null });
    });
    return { updated: lots.length };
  }
});

check({
  id: 'orphan_lots',
  severity: 'critical',
  title: 'Ürünü silinmiş parti',
  explanation: 'Bağlı olduğu ürün silinmiş ama stokta duran partiler. Bu stok hiçbir raporda görünmez ' +
    'ama depoda fiziksel olarak durur.',
  fixable: false,
  run() {
    return db.prepare(`SELECT sl.id, sl.lot_no, sl.qty, sl.item_id
      FROM stock_lots sl LEFT JOIN items i ON i.id = sl.item_id
      WHERE sl.qty > 0 AND (i.id IS NULL OR i.deleted_at IS NOT NULL)`).all()
      .map(r => ({ key: r.id, label: `Parti ${r.lot_no || r.id.slice(0, 8)}`, detail: `miktar ${r.qty}` }));
  }
});

/* ============================ REÇETE VE ÜRETİM ============================ */

check({
  id: 'make_without_bom',
  severity: 'warning',
  title: 'Reçetesi olmayan "üretilir" ürün',
  explanation: 'Tedarik şekli "üretilir" olarak işaretli ama reçetesi tanımlı değil. ' +
    'MRP bu ürün için üretim emri önerir, emir açılır ama hangi malzemenin tüketileceği belli olmaz.',
  fixable: false,
  run() {
    return db.prepare(`SELECT i.id, i.name, i.code FROM items i
      WHERE i.procurement_type = 'make' AND i.deleted_at IS NULL AND i.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM item_bom b WHERE b.item_id = i.id)`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: 'reçete yok' }));
  }
});

check({
  id: 'bom_without_make',
  severity: 'info',
  title: 'Reçetesi olan ama "satın alınır" işaretli ürün',
  explanation: 'Reçetesi tanımlı ama tedarik şekli "satın alınır". ' +
    'MRP bunun için satın alma önerir, reçete hiç kullanılmaz. Biri yanlıştır.',
  fixable: false,
  run() {
    return db.prepare(`SELECT i.id, i.name, i.code,
        (SELECT COUNT(*) FROM item_bom b WHERE b.item_id = i.id) AS comps
      FROM items i WHERE i.procurement_type = 'buy' AND i.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM item_bom b WHERE b.item_id = i.id)`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: `${r.comps} bileşen tanımlı` }));
  }
});

check({
  id: 'bom_self_reference',
  severity: 'critical',
  title: 'Kendi kendinin bileşeni olan ürün',
  explanation: 'Bir ürün kendi reçetesinde bileşen olarak geçiyor. MRP bu dalı sonsuza kadar açmaya çalışır.',
  fixable: true,
  fixAction: 'Bu reçete satırları silinir.',
  run() {
    return db.prepare(`SELECT b.id, i.name, i.code FROM item_bom b
      JOIN items i ON i.id = b.item_id WHERE b.item_id = b.component_item_id`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: 'kendi bileşeni' }));
  },
  fix() {
    const info = db.prepare('DELETE FROM item_bom WHERE item_id = component_item_id').run();
    return { deleted: info.changes };
  }
});

check({
  id: 'bom_circular',
  severity: 'critical',
  title: 'Döngüsel reçete',
  explanation: 'A ürünü B\'yi, B de A\'yı bileşen olarak kullanıyor. MRP bu dalları atlar ' +
    've o ürünlerin ihtiyacı hiç hesaplanmaz. Otomatik düzeltilmez: hangi bağın yanlış olduğunu ' +
    'yalnızca ürünü tanıyan biri bilir.',
  fixable: false,
  run() {
    const boms = db.prepare('SELECT item_id, component_item_id FROM item_bom').all();
    const children = {};
    boms.forEach(b => { (children[b.item_id] = children[b.item_id] || []).push(b.component_item_id); });
    const names = {};
    db.prepare('SELECT id, name FROM items').all().forEach(i => { names[i.id] = i.name; });

    const cycles = [];
    const seen = new Set();
    const visit = (id, path) => {
      if (path.includes(id)) {
        const cycle = [...path.slice(path.indexOf(id)), id];
        const sig = [...cycle].sort().join('|');
        if (!seen.has(sig)) { seen.add(sig); cycles.push(cycle); }
        return;
      }
      if (path.length > 12) return;          // derin ağaçlarda durmalı
      (children[id] || []).forEach(c => visit(c, [...path, id]));
    };
    Object.keys(children).forEach(id => visit(id, []));
    return cycles.map((c, i) => ({
      key: 'cycle-' + i,
      label: c.map(x => names[x] || x.slice(0, 8)).join(' → '),
      detail: `${c.length - 1} adımlık döngü`
    }));
  }
});

check({
  id: 'bom_unit_mismatch',
  severity: 'warning',
  title: 'Reçetedeki birim ürünün birimiyle farklı',
  explanation: 'Reçete satırındaki birim, bileşenin kendi biriminden farklı. ' +
    '"1 kutu" yazıp 100 adet kastetmek en sık görülen veri hatasıdır ve tüketimi 100 kat yanlış hesaplar.',
  fixable: true,
  fixAction: 'Reçete satırındaki birim, bileşenin birimiyle eşitlenir. Miktar DEĞİŞTİRİLMEZ — ' +
    'doğru miktarı yalnızca reçeteyi hazırlayan bilir; bu yüzden sonrasında gözden geçirilmelidir.',
  run() {
    return db.prepare(`SELECT b.id, b.unit AS bom_unit, i.name AS parent, c.name AS comp, c.unit AS comp_unit
      FROM item_bom b JOIN items i ON i.id = b.item_id JOIN items c ON c.id = b.component_item_id
      WHERE b.unit IS NOT NULL AND b.unit != c.unit`).all()
      .map(r => ({
        key: r.id, label: `${r.parent} → ${r.comp}`,
        detail: `reçetede "${r.bom_unit}", üründe "${r.comp_unit}"`
      }));
  },
  fix() {
    const info = db.prepare(`UPDATE item_bom SET unit = (
      SELECT c.unit FROM items c WHERE c.id = item_bom.component_item_id)
      WHERE unit IS NOT NULL AND unit != (
        SELECT c.unit FROM items c WHERE c.id = item_bom.component_item_id)`).run();
    return { updated: info.changes };
  }
});

/* ============================ TEKRARLAYAN KAYITLAR ============================ */

check({
  id: 'duplicate_item_code',
  severity: 'critical',
  title: 'Aynı kodla birden fazla ürün',
  explanation: 'Aynı ürün kodu birden fazla kayıtta kullanılmış. Excel aktarımı ve barkod okuma ' +
    'hangisini bulacağını bilemez; stok iki kayda bölünür.',
  fixable: false,
  run() {
    return db.prepare(`SELECT code, COUNT(*) c, GROUP_CONCAT(name, ' | ') AS names
      FROM items WHERE code IS NOT NULL AND code != '' AND deleted_at IS NULL
      GROUP BY LOWER(code) HAVING c > 1`).all()
      .map(r => ({ key: r.code, label: r.code, detail: `${r.c} kayıt: ${r.names}` }));
  }
});

check({
  id: 'duplicate_barcode',
  severity: 'critical',
  title: 'Aynı barkodla birden fazla ürün',
  explanation: 'Aynı barkod birden fazla üründe tanımlı. Terminalde okutulduğunda yanlış ürün açılır.',
  fixable: false,
  run() {
    return db.prepare(`SELECT barcode, COUNT(*) c, GROUP_CONCAT(name, ' | ') AS names
      FROM items WHERE barcode IS NOT NULL AND barcode != '' AND deleted_at IS NULL
      GROUP BY barcode HAVING c > 1`).all()
      .map(r => ({ key: r.barcode, label: r.barcode, detail: `${r.c} ürün: ${r.names}` }));
  }
});

check({
  id: 'duplicate_party',
  severity: 'warning',
  title: 'Aynı vergi numarasıyla birden fazla cari',
  explanation: 'Aynı vergi numarası birden fazla tedarikçi veya müşteride kayıtlı. ' +
    'Bakiye ve performans raporları iki kayda bölünür, hiçbiri gerçeği göstermez.',
  fixable: false,
  run() {
    const sup = db.prepare(`SELECT tax_no, COUNT(*) c, GROUP_CONCAT(name, ' | ') names
      FROM suppliers WHERE tax_no IS NOT NULL AND tax_no != ''
      GROUP BY tax_no HAVING c > 1`).all()
      .map(r => ({ key: 'sup-' + r.tax_no, label: `Tedarikçi · VKN ${r.tax_no}`, detail: r.names }));
    const cus = db.prepare(`SELECT tax_no, COUNT(*) c, GROUP_CONCAT(name, ' | ') names
      FROM customers WHERE tax_no IS NOT NULL AND tax_no != ''
      GROUP BY tax_no HAVING c > 1`).all()
      .map(r => ({ key: 'cus-' + r.tax_no, label: `Müşteri · VKN ${r.tax_no}`, detail: r.names }));
    return [...sup, ...cus];
  }
});

check({
  id: 'similar_item_names',
  severity: 'info',
  title: 'Birbirine çok benzeyen ürün adları',
  explanation: 'Adları yalnızca boşluk, noktalama veya büyük/küçük harfle ayrılan ürünler. ' +
    'Genellikle aynı ürünün iki kez girilmiş halidir.',
  fixable: false,
  run() {
    const items = db.prepare('SELECT id, name, code FROM items WHERE deleted_at IS NULL').all();
    const norm = (s) => String(s).toLocaleLowerCase('tr').replace(/[^a-z0-9ğüşiöç]/gi, '');
    const groups = {};
    items.forEach(i => { (groups[norm(i.name)] = groups[norm(i.name)] || []).push(i); });
    return Object.values(groups).filter(g => g.length > 1).map(g => ({
      key: g[0].id,
      label: g.map(x => x.name).join(' | '),
      detail: `${g.length} kayıt: ${g.map(x => x.code || '—').join(', ')}`
    }));
  }
});

/* ============================ BELGE TUTARLILIĞI ============================ */

check({
  id: 'over_received',
  severity: 'warning',
  title: 'Sipariş miktarından fazla teslim alınmış',
  explanation: 'Teslim alınan miktar sipariş miktarını aşıyor. Fazla mal gelmiş olabilir ' +
    'ya da teslim alma iki kez kaydedilmiştir.',
  fixable: false,
  run() {
    return db.prepare(`SELECT pi.id, pi.item_name, pi.qty, pi.received_qty, po.po_no
      FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
      WHERE pi.received_qty > pi.qty + 0.0001`).all()
      .map(r => ({
        key: r.id, label: `${r.po_no} · ${r.item_name}`,
        detail: `sipariş ${r.qty}, teslim ${r.received_qty}`
      }));
  }
});

check({
  id: 'over_shipped',
  severity: 'warning',
  title: 'Sipariş miktarından fazla sevk edilmiş',
  explanation: 'Sevk edilen miktar sipariş miktarını aşıyor. Müşteriye fazla mal gitmiş olabilir.',
  fixable: false,
  run() {
    return db.prepare(`SELECT sol.id, sol.item_name, sol.qty, sol.shipped_qty, so.so_no
      FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.so_id
      WHERE sol.shipped_qty > sol.qty + 0.0001`).all()
      .map(r => ({
        key: r.id, label: `${r.so_no} · ${r.item_name}`,
        detail: `sipariş ${r.qty}, sevk ${r.shipped_qty}`
      }));
  }
});

check({
  id: 'stale_documents',
  severity: 'info',
  title: 'Uzun süredir açık kalmış belgeler',
  explanation: '90 günden uzun süredir açık duran sipariş, üretim emri veya sayım. ' +
    'Çoğu unutulmuştur ve açık kaldıkça MRP hesabını ve raporları bozar.',
  fixable: false,
  run() {
    const cutoff = addDays(today(), -90);
    const pos = db.prepare(`SELECT po_no AS no, date FROM purchase_orders
      WHERE status IN ('draft','approved','partially_received') AND date < ?`).all(cutoff)
      .map(r => ({ key: 'po-' + r.no, label: `Satın alma ${r.no}`, detail: r.date }));
    const sos = db.prepare(`SELECT so_no AS no, date FROM sales_orders
      WHERE status IN ('open','partially_shipped') AND date < ?`).all(cutoff)
      .map(r => ({ key: 'so-' + r.no, label: `Satış ${r.no}`, detail: r.date }));
    const prods = db.prepare(`SELECT order_no AS no, date FROM production_orders
      WHERE status IN ('Planlandı','Devam Ediyor') AND date < ?`).all(cutoff)
      .map(r => ({ key: 'pr-' + r.no, label: `Üretim ${r.no}`, detail: r.date }));
    return [...pos, ...sos, ...prods];
  }
});

/* ============================ TANIMSIZ ALANLAR ============================ */

check({
  id: 'missing_unit',
  severity: 'critical',
  title: 'Birimi tanımsız ürün',
  explanation: 'Ölçü birimi boş olan ürünler. Miktarlar anlamsız hale gelir; ' +
    '"5" neyin beşi olduğu belli olmaz.',
  fixable: true,
  fixAction: 'Birimi boş olan ürünlere "adet" atanır.',
  run() {
    return db.prepare(`SELECT id, name, code FROM items
      WHERE (unit IS NULL OR TRIM(unit) = '') AND deleted_at IS NULL`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: 'birim boş' }));
  },
  fix() {
    const info = db.prepare(`UPDATE items SET unit = 'adet'
      WHERE (unit IS NULL OR TRIM(unit) = '') AND deleted_at IS NULL`).run();
    return { updated: info.changes };
  }
});

check({
  id: 'reorder_without_supplier',
  severity: 'warning',
  title: 'Kritik stok tanımlı ama tedarikçisi yok',
  explanation: 'Kritik seviye tanımlı olduğu için sipariş önerisi üretilir, ' +
    'ama tedarikçi seçilmediği için öneri siparişe dönüştürülemez.',
  fixable: false,
  run() {
    return db.prepare(`SELECT id, name, code, min_stock FROM items
      WHERE min_stock > 0 AND default_supplier_id IS NULL
        AND procurement_type = 'buy' AND deleted_at IS NULL AND is_active = 1`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: `kritik seviye ${r.min_stock}` }));
  }
});

check({
  id: 'workcenter_without_shift',
  severity: 'warning',
  title: 'Vardiyası atanmamış iş merkezi',
  explanation: 'Vardiya atanmayan iş merkezinin kapasitesi sıfırdır. ' +
    'Çizelgeleme bu merkeze hiç iş koyamaz ve "kapasite bulunamadı" hatası verir.',
  fixable: false,
  run() {
    return db.prepare(`SELECT wc.id, wc.code, wc.name FROM work_centers wc
      WHERE wc.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM work_center_shifts s WHERE s.work_center_id = wc.id)`).all()
      .map(r => ({ key: r.id, label: `${r.code} · ${r.name}`, detail: 'vardiya yok' }));
  }
});

check({
  id: 'routing_inactive_wc',
  severity: 'warning',
  title: 'Pasif iş merkezine bağlı rota',
  explanation: 'Rota adımı, artık aktif olmayan bir iş merkezini kullanıyor. ' +
    'O mamulün üretim emri çizelgelenemez.',
  fixable: false,
  run() {
    return db.prepare(`SELECT r.id, r.operation_name, i.name AS item_name, wc.code
      FROM routings r JOIN items i ON i.id = r.item_id
      JOIN work_centers wc ON wc.id = r.work_center_id
      WHERE wc.is_active = 0`).all()
      .map(r => ({ key: r.id, label: `${r.item_name} · ${r.operation_name}`, detail: `iş merkezi ${r.code} pasif` }));
  }
});

check({
  id: 'expiry_without_shelf_life',
  severity: 'info',
  title: 'Raf ömrü tanımsız ama SKT\'li partiler var',
  explanation: 'Partilerinde son kullanma tarihi var ama ürün kartında raf ömrü tanımlı değil. ' +
    'Yeni girişlerde tarih otomatik hesaplanmaz, elle girilmesi gerekir ve sık unutulur.',
  fixable: false,
  run() {
    return db.prepare(`SELECT DISTINCT i.id, i.name, i.code FROM items i
      JOIN stock_lots sl ON sl.item_id = i.id
      WHERE sl.expiry_date IS NOT NULL AND i.shelf_life_days IS NULL AND i.deleted_at IS NULL`).all()
      .map(r => ({ key: r.id, label: `${r.name} (${r.code || '—'})`, detail: 'raf ömrü tanımsız' }));
  }
});

/* ============================ ÇALIŞTIRMA ============================ */

/** Tüm kontrolleri çalıştırır. Sample sayısı sınırlıdır; binlerce satır arayüzü boğar. */
function runAll({ sampleLimit = 25 } = {}) {
  const results = [];
  for (const c of CHECKS) {
    let rows = [];
    let error = null;
    try { rows = c.run() || []; }
    catch (e) { error = e.message; }
    results.push({
      id: c.id, severity: c.severity, title: c.title, explanation: c.explanation,
      fixable: !!c.fixable, fixAction: c.fixAction || null,
      count: rows.length,
      sample: rows.slice(0, sampleLimit),
      truncated: rows.length > sampleLimit,
      error
    });
  }

  const counts = { critical: 0, warning: 0, info: 0 };
  results.forEach(r => { if (r.count > 0) counts[r.severity] += 1; });

  return {
    generatedAt: Date.now(),
    // Puan, "her şey yolunda mı" sorusuna tek bakışta cevap verir.
    // Kritik bulgular ağır tartılır çünkü yanlış sayı üretirler.
    score: Math.max(0, 100 - counts.critical * 15 - counts.warning * 5 - counts.info * 1),
    totals: {
      checks: CHECKS.length,
      withFindings: results.filter(r => r.count > 0).length,
      criticalTypes: counts.critical, warningTypes: counts.warning, infoTypes: counts.info,
      totalFindings: results.reduce((s, r) => s + r.count, 0)
    },
    checks: results
  };
}

/** Tek bir kontrolü çalıştırır (sayfalı liste için). */
function runOne(id, { limit = 200, offset = 0 } = {}) {
  const c = CHECKS.find(x => x.id === id);
  if (!c) throw new AppError('Kontrol bulunamadı / Check not found', 404);
  const rows = c.run() || [];
  return {
    id: c.id, severity: c.severity, title: c.title, explanation: c.explanation,
    fixable: !!c.fixable, fixAction: c.fixAction || null,
    total: rows.length, rows: rows.slice(offset, offset + limit)
  };
}

/** Otomatik düzeltmeyi uygular. Düzeltilemeyen kontroller açıkça reddedilir. */
function applyFix(id) {
  const c = CHECKS.find(x => x.id === id);
  if (!c) throw new AppError('Kontrol bulunamadı / Check not found', 404);
  if (!c.fixable || !c.fix) {
    throw new AppError(
      'Bu bulgu otomatik düzeltilemez — doğru değeri yalnızca işi bilen biri belirleyebilir / Not auto-fixable', 400);
  }
  const before = (c.run() || []).length;
  const result = db.txImmediate(() => c.fix());
  const after = (c.run() || []).length;
  return { id: c.id, title: c.title, before, after, resolved: before - after, ...result };
}

module.exports = { runAll, runOne, applyFix, CHECKS };
