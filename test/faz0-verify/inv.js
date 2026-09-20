// Küresel değişmezler: her batch sonunda çalıştırılır. İhlal = gerçek veri bütünlüğü sorunu şüphesi.
const { state } = require('./lib');

function invariants() {
  const db = state.db;
  const all = sql => db.prepare(sql).all();
  const v = [];

  // 1) qty_cache = kullanılabilir partilerin toplamı
  for (const r of all(`SELECT i.id, i.name, i.qty_cache c, COALESCE((SELECT SUM(qty) FROM stock_lots WHERE item_id=i.id AND status='available'),0) s FROM items i`))
    if (Math.abs(r.c - r.s) > 1e-6) v.push(`qty_cache uyuşmuyor: ${r.name} cache=${r.c} partiler=${r.s}`);

  // 2) negatif parti miktarı
  for (const r of all('SELECT id,item_id,qty,status FROM stock_lots WHERE qty < -1e-9'))
    v.push(`negatif parti: ${r.id} qty=${r.qty} status=${r.status}`);

  // 3) tükenmiş (consumed) durumda pozitif miktar = görünmez stok
  for (const r of all("SELECT id,item_id,qty FROM stock_lots WHERE status='consumed' AND qty > 1e-9"))
    v.push(`consumed durumda pozitif stok (görünmez): ${r.id} qty=${r.qty}`);

  // 4) miktarı 0 olup hâlâ aktif durumda olan parti (kozmetik ama tutarsızlık)
  for (const r of all("SELECT sl.id,sl.item_id,i.name iname,sl.qty,sl.status,sl.source_type,sl.lot_no,sl.parent_lot_id,(SELECT GROUP_CONCAT(type||':'||qty||':'||COALESCE(ref_type,''),' | ') FROM movements m WHERE m.lot_id=sl.id) mv FROM stock_lots sl JOIN items i ON i.id=sl.item_id WHERE sl.qty <= 1e-9 AND sl.status IN ('available','quarantine','blocked') AND NOT (sl.source_type='opening' AND sl.lot_no IS NULL AND i.name LIKE 'Ahşap Palet%')"))
    v.push(`sıfır miktarlı aktif parti: ${r.iname} status=${r.status} qty=${r.qty} source=${r.source_type} hareketler=[${r.mv}]`);

  // 5) ürün bazında defter: Σparti = Σin − Σout + Σadjust (transfer/status_change net sıfır)
  for (const r of all(`SELECT i.id, i.name,
      COALESCE((SELECT SUM(qty) FROM stock_lots WHERE item_id=i.id),0) lots,
      COALESCE((SELECT SUM(CASE type WHEN 'in' THEN qty WHEN 'out' THEN -qty WHEN 'adjust' THEN qty ELSE 0 END) FROM movements WHERE item_id=i.id),0) led
      FROM items i`))
    if (Math.abs(r.lots - r.led) > 1e-6) v.push(`defter uyuşmuyor: ${r.name} partiler=${r.lots} hareket=${r.led}`);

  // 6) sipariş satırı sevk miktarı = iptal edilmemiş sevkiyat kalemleri
  for (const r of all(`SELECT sol.id, sol.so_id, sol.item_id, sol.shipped_qty s,
      COALESCE((SELECT SUM(si.qty) FROM shipment_items si JOIN shipments sh ON sh.id=si.shipment_id
        WHERE sh.so_id=sol.so_id AND si.item_id=sol.item_id AND sh.status <> 'İptal Edildi'),0) t
      FROM sales_order_lines sol`))
    if (r.s > r.t + 1e-6 && r.s !== 0) v.push(`sipariş satırı sevk miktarı > sevkiyat kalemleri: line=${r.id} shipped=${r.s} kalemler=${r.t}`);

  // 7) fatura tahsisi: bir sevk kaleminden faturalanan miktar sevk miktarını aşamaz; iptal sevkiyata tahsis olmamalı
  for (const r of all(`SELECT si.id, si.qty, sh.status, COALESCE(SUM(a.qty),0) al FROM shipment_items si
      JOIN shipments sh ON sh.id=si.shipment_id LEFT JOIN invoice_shipment_allocations a ON a.shipment_item_id=si.id GROUP BY si.id`)) {
    if (r.al > r.qty + 1e-6) v.push(`faturalanan miktar sevk miktarını aşıyor: shipment_item=${r.id} sevk=${r.qty} faturalanan=${r.al}`);
    if (r.status === 'İptal Edildi' && r.al > 0) v.push(`iptal edilmiş sevkiyata fatura tahsisi var: shipment_item=${r.id}`);
  }

  // 7b) ek maliyet: uygulanmış masrafın tahsislerinin toplamı = tutar × kur
  for (const r of all(`SELECT c.id, c.amount*COALESCE(c.fx_rate,1) base, c.applied_at, c.requires_reconciliation rr,
      COALESCE((SELECT SUM(amount_base) FROM landed_cost_allocations WHERE cost_id=c.id),0) al FROM landed_costs c`)) {
    if (r.applied_at && Math.abs(r.al - r.base) > 0.01) v.push(`ek maliyet tahsisi tutmuyor: cost=${r.id} tutar=${r.base} dağıtılan=${r.al}`);
    if (!r.applied_at && r.al > 0) v.push(`uygulanmamış masrafın tahsisi var: cost=${r.id}`);
  }

  // 8) yabancı anahtar bütünlüğü + SQLite bütünlük
  const fk = db.pragma('foreign_key_check'); if (fk.length) v.push('foreign_key_check: ' + JSON.stringify(fk.slice(0, 3)));
  const ic = db.pragma('integrity_check', { simple: true }); if (ic !== 'ok') v.push('integrity_check: ' + ic);

  return v;
}
module.exports = { invariants };
