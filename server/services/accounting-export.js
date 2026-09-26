/**
 * Muhasebe dışa aktarım köprüsü.
 *
 * Satış ve alış faturalarından çift taraflı (borç=alacak) yevmiye satırları
 * üretir. Hesap kodları `account_code_mappings` tablosundan gelir — hangi
 * muhasebe programına geçilirse geçilsin yalnızca o tablo güncellenir,
 * burada satır üretme mantığı değişmez.
 *
 * Satış tarafı: customer_invoices zaten subtotal/vat_total/amount alanlarını
 * tutuyor (bkz. 002_einvoice.js) — yeniden hesaplanmaz, sistemin kendi
 * otoriter değerleri kullanılır.
 *
 * Alış tarafı: supplier_invoices yalnızca KDV HARİÇ tek bir `amount` tutuyor
 * (bkz. routes/purchasing.js — 3'lü eşleştirme net tutar üzerinden yapılıyor).
 * Yeni faturalar teslim satırlarının fatura anındaki fiyat/kur/KDV oranı
 * snapshot'ını kullanır; faturada `vat_amount` varsa (yeni kayıt veya
 * mutabakat sonrası) o tutar kullanılır. Mutabakatı yapılmamış eski
 * faturalarda PO ürünlerinden ağırlıklı oran tahmini sürer; bu kesin vergi
 * kaydı değildir ve bu faturalar onaylanıp ödenemez.
 */
const db = require('../db');
const { AppError } = require('../lib/core');

function getMappings(companyId = 1) {
  const rows = db.prepare('SELECT mapping_key, account_code, account_name FROM account_code_mappings WHERE company_id = ?')
    .all(companyId);
  const byKey = {};
  rows.forEach(r => { byKey[r.mapping_key] = { code: r.account_code, name: r.account_name }; });
  const required = ['sales_revenue', 'sales_vat', 'accounts_receivable', 'purchase_vat', 'accounts_payable',
    'inventory', 'cost_of_goods_sold', 'cash', 'bank', 'card', 'check', 'payment_clearing'];
  const missing = required.filter(k => !byKey[k]);
  if (missing.length) {
    throw new AppError(`Hesap kodu eşlemesi eksik / Missing account code mapping: ${missing.join(', ')}`, 400);
  }
  return byKey;
}

/** Bir satın alma faturasının bağlı olduğu PO kalemlerinden ağırlıklı ortalama KDV oranı. */
function purchaseVatRate(poId) {
  const lines = db.prepare(`
    SELECT pi.qty * pi.price AS line_value, COALESCE(i.vat_rate, 20) AS vat_rate
    FROM po_items pi LEFT JOIN items i ON i.id = pi.item_id
    WHERE pi.po_id = ?
  `).all(poId);
  const totalValue = lines.reduce((s, l) => s + (l.line_value || 0), 0);
  if (totalValue <= 0) return 20; // varsayılan genel oran
  const weighted = lines.reduce((s, l) => s + (l.line_value || 0) * (l.vat_rate || 0), 0);
  return weighted / totalValue;
}

/**
 * Verilen tarih aralığındaki satış ve alış faturalarından yevmiye satırları üretir.
 * @param {{ from: string, to: string, companyId?: number }} params
 */
function generateJournalEntries({ from, to, companyId = 1 }) {
  if (!from || !to || from > to) throw new AppError('Geçersiz tarih aralığı / Invalid date range', 400);
  const map = getMappings(companyId);
  const rows = [];

  const sales = db.prepare(`
    SELECT ci.*, c.name AS customer_name FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.status != 'cancelled' AND ci.invoice_date BETWEEN ? AND ?
    ORDER BY ci.invoice_date, ci.invoice_no
  `).all(from, to);

  sales.forEach(inv => {
    const isReturn = inv.invoice_type === 'iade';
    const rate = inv.fx_rate || 1;
    const grossBase = Math.round(inv.amount * rate * 100) / 100;
    const vatBase = Math.round(inv.vat_total * rate * 100) / 100;
    const revenueBase = Math.round((grossBase - vatBase) * 100) / 100;
    const desc = `${isReturn ? 'Satış iade faturası' : 'Satış faturası'} ${inv.invoice_no} — ${inv.customer_name || ''}`;
    rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.accounts_receivable.code,
      accountName: map.accounts_receivable.name, description: desc, debit: isReturn ? 0 : grossBase, credit: isReturn ? grossBase : 0,
      sourceType: 'customer_invoice', sourceId: inv.id });
    rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.sales_revenue.code,
      accountName: map.sales_revenue.name, description: desc, debit: isReturn ? revenueBase : 0, credit: isReturn ? 0 : revenueBase,
      sourceType: 'customer_invoice', sourceId: inv.id });
    if (vatBase > 0) {
      rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.sales_vat.code,
        accountName: map.sales_vat.name, description: desc, debit: isReturn ? vatBase : 0, credit: isReturn ? 0 : vatBase,
        sourceType: 'customer_invoice', sourceId: inv.id });
    }
    // Inventory leaves the books when a real shipment exists. Stand-alone
    // service invoices have no stock cost and therefore no COGS entry.
    if (!isReturn && inv.shipment_id) {
      const costBase = Math.round((db.prepare(`SELECT COALESCE(SUM(qty*unit_cost),0) value
        FROM shipment_items WHERE shipment_id=?`).get(inv.shipment_id).value || 0) * 100) / 100;
      if (costBase > 0) {
        rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.cost_of_goods_sold.code,
          accountName: map.cost_of_goods_sold.name, description: desc, debit: costBase, credit: 0,
          sourceType: 'customer_invoice_cogs', sourceId: inv.id });
        rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.inventory.code,
          accountName: map.inventory.name, description: desc, debit: 0, credit: costBase,
          sourceType: 'customer_invoice_cogs', sourceId: inv.id });
      }
    }
  });

  const purchases = db.prepare(`
    SELECT si.*, s.name AS supplier_name FROM supplier_invoices si
    LEFT JOIN suppliers s ON s.id = si.supplier_id
    WHERE si.invoice_date BETWEEN ? AND ?
    ORDER BY si.invoice_date, si.invoice_no
  `).all(from, to);

  purchases.forEach(inv => {
    const rate = inv.fx_rate || 1;
    const netBase = Math.round(inv.amount * rate * 100) / 100;
    const snapshots = inv.allocation_state === 'recorded'
      ? db.prepare(`SELECT qty,unit_price,fx_rate,vat_rate FROM supplier_invoice_allocations
        WHERE invoice_id=?`).all(inv.id) : [];
    const snapshotBase = snapshots.reduce((sum, line) => sum + line.qty * line.unit_price * line.fx_rate, 0);
    const vatRate = snapshotBase > 0
      ? snapshots.reduce((sum, line) => sum + line.qty * line.unit_price * line.fx_rate * line.vat_rate, 0) / snapshotBase
      : purchaseVatRate(inv.po_id);
    // Mutabık/kayıtlı faturada tedarikçi belgesindeki KDV tutarı otoriterdir.
    const vatBase = inv.vat_amount != null
      ? Math.round(inv.vat_amount * rate * 100) / 100
      : Math.round(netBase * (vatRate / 100) * 100) / 100;
    const grossBase = Math.round((netBase + vatBase) * 100) / 100;
    const desc = `Alış faturası ${inv.invoice_no} — ${inv.supplier_name || ''}`;
    rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.inventory.code,
      accountName: map.inventory.name, description: desc, debit: netBase, credit: 0,
      sourceType: 'supplier_invoice', sourceId: inv.id });
    if (vatBase > 0) {
      rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.purchase_vat.code,
        accountName: map.purchase_vat.name, description: desc, debit: vatBase, credit: 0,
        sourceType: 'supplier_invoice', sourceId: inv.id });
    }
    rows.push({ date: inv.invoice_date, docNo: inv.invoice_no, accountCode: map.accounts_payable.code,
      accountName: map.accounts_payable.name, description: desc, debit: 0, credit: grossBase,
      sourceType: 'supplier_invoice', sourceId: inv.id });
  });

  const paymentAccount = method => map[(['cash', 'bank', 'card', 'check'].includes(method) ? method : 'payment_clearing')];
  const customerPayments = db.prepare(`SELECT p.*, ci.invoice_no, c.name customer_name
    FROM customer_invoice_payments p
    JOIN customer_invoices ci ON ci.id=p.invoice_id
    LEFT JOIN customers c ON c.id=ci.customer_id
    WHERE p.paid_on BETWEEN ? AND ?
    ORDER BY p.paid_on,p.created_at,p.id`).all(from, to);
  customerPayments.forEach(p => {
    const amount = Math.round(p.amount * 100) / 100;
    const account = paymentAccount(p.method);
    const desc = `Tahsilat ${p.invoice_no} — ${p.customer_name || ''}`;
    rows.push({ date: p.paid_on, docNo: p.reference || p.invoice_no, accountCode: account.code,
      accountName: account.name, description: desc, debit: amount, credit: 0,
      sourceType: 'customer_payment', sourceId: p.id });
    rows.push({ date: p.paid_on, docNo: p.reference || p.invoice_no, accountCode: map.accounts_receivable.code,
      accountName: map.accounts_receivable.name, description: desc, debit: 0, credit: amount,
      sourceType: 'customer_payment', sourceId: p.id });
  });

  const supplierPayments = db.prepare(`SELECT p.*, si.invoice_no, s.name supplier_name
    FROM supplier_invoice_payments p
    JOIN supplier_invoices si ON si.id=p.invoice_id
    LEFT JOIN suppliers s ON s.id=si.supplier_id
    WHERE p.paid_on BETWEEN ? AND ?
    ORDER BY p.paid_on,p.created_at,p.id`).all(from, to);
  supplierPayments.forEach(p => {
    const amount = Math.round(p.amount * 100) / 100;
    const account = paymentAccount(p.method);
    const desc = `Tedarikçi ödemesi ${p.invoice_no} — ${p.supplier_name || ''}`;
    rows.push({ date: p.paid_on, docNo: p.reference || p.invoice_no, accountCode: map.accounts_payable.code,
      accountName: map.accounts_payable.name, description: desc, debit: amount, credit: 0,
      sourceType: 'supplier_payment', sourceId: p.id });
    rows.push({ date: p.paid_on, docNo: p.reference || p.invoice_no, accountCode: account.code,
      accountName: account.name, description: desc, debit: 0, credit: amount,
      sourceType: 'supplier_payment', sourceId: p.id });
  });

  const customerReversals = db.prepare(`SELECT r.*,p.amount,p.method,p.reference,ci.invoice_no,c.name customer_name
    FROM customer_invoice_payment_reversals r JOIN customer_invoice_payments p ON p.id=r.payment_id
    JOIN customer_invoices ci ON ci.id=p.invoice_id LEFT JOIN customers c ON c.id=ci.customer_id
    WHERE r.reversed_on BETWEEN ? AND ? ORDER BY r.reversed_on,r.created_at,r.id`).all(from, to);
  customerReversals.forEach(r => {
    const amount = Math.round(r.amount * 100) / 100; const account = paymentAccount(r.method);
    const desc = `Tahsilat ters kaydı ${r.invoice_no} — ${r.customer_name || ''}: ${r.reason}`;
    rows.push({ date: r.reversed_on, docNo: r.reference || r.invoice_no, accountCode: map.accounts_receivable.code,
      accountName: map.accounts_receivable.name, description: desc, debit: amount, credit: 0,
      sourceType: 'customer_payment_reversal', sourceId: r.id });
    rows.push({ date: r.reversed_on, docNo: r.reference || r.invoice_no, accountCode: account.code,
      accountName: account.name, description: desc, debit: 0, credit: amount,
      sourceType: 'customer_payment_reversal', sourceId: r.id });
  });

  const supplierReversals = db.prepare(`SELECT r.*,p.amount,p.method,p.reference,si.invoice_no,s.name supplier_name
    FROM supplier_invoice_payment_reversals r JOIN supplier_invoice_payments p ON p.id=r.payment_id
    JOIN supplier_invoices si ON si.id=p.invoice_id LEFT JOIN suppliers s ON s.id=si.supplier_id
    WHERE r.reversed_on BETWEEN ? AND ? ORDER BY r.reversed_on,r.created_at,r.id`).all(from, to);
  supplierReversals.forEach(r => {
    const amount = Math.round(r.amount * 100) / 100; const account = paymentAccount(r.method);
    const desc = `Tedarikçi ödeme ters kaydı ${r.invoice_no} — ${r.supplier_name || ''}: ${r.reason}`;
    rows.push({ date: r.reversed_on, docNo: r.reference || r.invoice_no, accountCode: account.code,
      accountName: account.name, description: desc, debit: amount, credit: 0,
      sourceType: 'supplier_payment_reversal', sourceId: r.id });
    rows.push({ date: r.reversed_on, docNo: r.reference || r.invoice_no, accountCode: map.accounts_payable.code,
      accountName: map.accounts_payable.name, description: desc, debit: 0, credit: amount,
      sourceType: 'supplier_payment_reversal', sourceId: r.id });
  });

  // Dönem sonu kontrolü: toplam borç = toplam alacak. Aksi halde sessizce
  // yanlış bir dışa aktarım üretmek yerine açıkça hata verilir.
  const totalDebit = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
  const totalCredit = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new AppError(
      `Borç/alacak dengesi tutmuyor / Debit-credit imbalance: ${totalDebit} vs ${totalCredit}`, 500);
  }

  return { from, to, rows, totalDebit, totalCredit, count: rows.length };
}

module.exports = { generateJournalEntries, getMappings, purchaseVatRate };
