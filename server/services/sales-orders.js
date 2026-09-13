// @ts-nocheck
/**
 * Satış siparişi oluşturma — hem doğrudan (server/routes/sales.js) hem de
 * kazanılmış bir CRM fırsatının dönüştürülmesiyle (server/routes/crm.js)
 * ulaşılan TEK bir yer. Mantık iki route'a kopyalanmasın diye buraya
 * çıkarıldı; davranış öncekiyle birebir aynı (kredi limiti kontrolü, kur
 * kilitleme, denetim kaydı).
 */
const db = require('../db');
const { AppError, uuid, nextNumber, logAudit, fxRate } = require('../lib/core');

/**
 * @param {import('express').Request} req
 * @param {{customerId:number, date?:string, promisedDate?:string, currency:string,
 *   incoterm?:string, notes?:string, opportunityId?:string,
 *   lines:{itemId:string, qty:number, price:number}[]}} input
 */
function createSalesOrder(req, input) {
  return db.txImmediate(() => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(input.customerId);
    if (!customer) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
    const date = input.date || new Date().toISOString().slice(0, 10);
    const rate = fxRate(input.currency, date);

    // Credit limit check — a real business will not let an over-limit customer order freely
    if (customer.credit_limit > 0) {
      const outstanding = db.prepare(`SELECT COALESCE(SUM(amount * fx_rate),0) t FROM customer_invoices
        WHERE customer_id = ? AND status = 'issued'`).get(customer.id).t;
      const orderTotal = input.lines.reduce((s, l) => s + l.qty * l.price, 0) * rate;
      if (outstanding + orderTotal > customer.credit_limit) {
        throw new AppError('Müşteri kredi limiti aşılıyor / Customer credit limit exceeded', 400, {
          creditLimit: customer.credit_limit, outstanding, orderTotal
        });
      }
    }

    const id = uuid();
    const soNo = nextNumber('sales_order', 'SAT');
    const totalBase = input.lines.reduce((s, l) => s + l.qty * l.price, 0) * rate;
    db.prepare(`INSERT INTO sales_orders (id,so_no,customer_id,customer_name,date,promised_date,currency,fx_rate,incoterm,status,total_base,notes,created_by,created_at,opportunity_id)
      VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`)
      .run(id, soNo, customer.id, customer.name, date, input.promisedDate || null, input.currency, rate,
           input.incoterm || customer.incoterm || null, totalBase, input.notes || null, req.user.id, Date.now(),
           input.opportunityId || null);

    const ins = db.prepare('INSERT INTO sales_order_lines (so_id,item_id,item_name,qty,price,currency) VALUES (?,?,?,?,?,?)');
    input.lines.forEach(l => {
      const item = db.prepare('SELECT name FROM items WHERE id = ?').get(l.itemId);
      ins.run(id, l.itemId, item ? item.name : '—', l.qty, l.price, input.currency);
    });
    logAudit(req, 'auditSalesOrderAdd', { entityType: 'sales_order', entityId: id, newValue: { soNo, customer: customer.name, totalBase }, detail: soNo });
    return db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id);
  });
}

module.exports = { createSalesOrder };
