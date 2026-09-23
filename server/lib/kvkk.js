// @ts-nocheck
/**
 * KVKK m.7/m.11 — ilgili kişinin talebi veya saklama süresi sonunda kişisel
 * veriyi geri döndürülemez şekilde anonimleştirme ve "hangi veri tutuluyor"
 * dışa aktarım raporu (bkz. docs/KVKK-DEGERLENDIRME.md §3.1, §3.2).
 *
 * Mali/ticari kayıtlar (sipariş, fatura tutarı) KORUNUR — yalnızca
 * kimliklendirici alanlar (ad, iletişim, VKN/TCKN, banka bilgisi) silinir.
 */
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError, uuid, logAudit } = require('./core');

// Keep operational amounts and identifiers, but remove direct identifiers copied
// into related records. The caller's transaction includes the audit redaction.
function redactText(value, replacements) {
  if (value == null) return value;
  return replacements.reduce((text, [from, to]) => from ? text.split(from).join(to) : text, value);
}

function redactJson(value, replacements) {
  if (value == null) return value;
  try {
    const walk = data => {
      if (typeof data === 'string') return redactText(data, replacements);
      if (Array.isArray(data)) return data.map(walk);
      if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, walk(entry)]));
      return data;
    };
    return JSON.stringify(walk(JSON.parse(value)));
  } catch {
    return redactText(value, replacements);
  }
}

function redactAudit(entityType, entityIds, replacements) {
  const select = db.prepare('SELECT id, old_value, new_value, detail FROM audit_log WHERE entity_type = ? AND entity_id = ?');
  const update = db.prepare('UPDATE audit_log SET old_value = ?, new_value = ?, detail = ? WHERE id = ?');
  for (const entityId of entityIds) {
    for (const row of select.all(entityType, String(entityId))) {
      update.run(redactJson(row.old_value, replacements), redactJson(row.new_value, replacements), redactText(row.detail, replacements), row.id);
    }
  }
}

function anonymizeCustomer(req, id) {
  return db.txImmediate(() => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  if (c.anonymized_at) throw new AppError('Müşteri zaten anonimleştirilmiş / Customer already anonymized', 409);
  const now = Date.now();
  db.prepare(`UPDATE customers SET name = ?, contact_person = NULL, phone = NULL, email = NULL,
    address = NULL, tax_no = NULL, notes = NULL, is_active = 0,
    deactivated_at = COALESCE(deactivated_at, ?), anonymized_at = ? WHERE id = ?`)
    .run(`Anonimleştirilmiş Müşteri #${c.id}`, now, now, id);
  const anonymousName = `Anonimleştirilmiş Müşteri #${c.id}`;
  const orders = db.prepare('SELECT id FROM sales_orders WHERE customer_id = ?').all(id).map(r => r.id);
  const shipments = db.prepare('SELECT id FROM shipments WHERE customer_id = ?').all(id).map(r => r.id);
  const opportunities = db.prepare('SELECT id FROM opportunities WHERE customer_id = ?').all(id).map(r => r.id);
  const tickets = db.prepare('SELECT id FROM support_tickets WHERE customer_id = ?').all(id).map(r => r.id);
  const visits = db.prepare('SELECT id FROM customer_visits WHERE customer_id = ?').all(id).map(r => r.id);
  db.prepare('UPDATE sales_orders SET customer_name = ? WHERE customer_id = ?').run(anonymousName, id);
  db.prepare('UPDATE shipments SET destination = NULL WHERE customer_id = ?').run(id);
  db.prepare('UPDATE opportunities SET customer_name = ?, contact_person = NULL, phone = NULL, email = NULL, notes = NULL WHERE customer_id = ?').run(anonymousName, id);
  db.prepare('UPDATE support_tickets SET customer_name = ?, subject = ?, description = NULL, resolution = NULL WHERE customer_id = ?').run(anonymousName, '[anonimleştirildi]', id);
  db.prepare('UPDATE customer_visits SET purpose = NULL, notes = NULL, latitude = NULL, longitude = NULL WHERE customer_id = ?').run(id);
  db.prepare('UPDATE support_ticket_comments SET comment = ? WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id = ?)').run('[anonimleştirildi]', id);
  const replacements = [[c.name, anonymousName], [c.contact_person, '[anonimleştirildi]'], [c.phone, '[anonimleştirildi]'], [c.email, '[anonimleştirildi]'], [c.address, '[anonimleştirildi]'], [c.tax_no, '[anonimleştirildi]']];
  for (const [type, ids] of [['customer', [id]], ['sales_order', orders], ['shipment', shipments], ['opportunity', opportunities], ['support_ticket', tickets], ['customer_visit', visits]]) {
    redactAudit(type, ids, replacements);
  }
  logAudit(req, 'auditCustomerAnonymize', { entityType: 'customer', entityId: id, detail: anonymousName });
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  });
}

function anonymizeSupplier(req, id) {
  return db.txImmediate(() => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
  if (s.anonymized_at) throw new AppError('Tedarikçi zaten anonimleştirilmiş / Supplier already anonymized', 409);
  const now = Date.now();
  db.prepare(`UPDATE suppliers SET name = ?, contact_person = NULL, phone = NULL, email = NULL,
    address = NULL, tax_no = NULL, bank_info = NULL, notes = NULL, is_active = 0,
    deactivated_at = COALESCE(deactivated_at, ?), anonymized_at = ? WHERE id = ?`)
    .run(`Anonimleştirilmiş Tedarikçi #${s.id}`, now, now, id);
  const anonymousName = `Anonimleştirilmiş Tedarikçi #${s.id}`;
  const orders = db.prepare('SELECT id FROM purchase_orders WHERE supplier_id = ?').all(id).map(r => r.id);
  db.prepare('UPDATE purchase_orders SET supplier_name = ? WHERE supplier_id = ?').run(anonymousName, id);
  const replacements = [[s.name, anonymousName], [s.contact_person, '[anonimleştirildi]'], [s.phone, '[anonimleştirildi]'], [s.email, '[anonimleştirildi]'], [s.address, '[anonimleştirildi]'], [s.tax_no, '[anonimleştirildi]'], [s.bank_info, '[anonimleştirildi]']];
  redactAudit('supplier', [id], replacements);
  redactAudit('purchase_order', orders, replacements);
  logAudit(req, 'auditSupplierAnonymize', { entityType: 'supplier', entityId: id, detail: anonymousName });
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  });
}

function anonymizeUser(req, id) {
  return db.txImmediate(() => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new AppError('Kullanıcı bulunamadı / User not found', 404);
  if (u.anonymized_at) throw new AppError('Kullanıcı zaten anonimleştirilmiş / User already anonymized', 409);
  if (req.user && Number(req.user.id) === Number(id)) {
    throw new AppError('Kendi hesabınızı anonimleştiremezsiniz / You cannot anonymize your own account', 400);
  }
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1 AND anonymized_at IS NULL").get().c;
    if (admins <= 1) throw new AppError('Son yönetici hesabı anonimleştirilemez / Cannot anonymize the last admin', 409);
  }
  const now = Date.now();
  db.prepare(`UPDATE users SET username = ?, full_name = NULL, email = NULL, password_hash = ?,
    is_active = 0, anonymized_at = ? WHERE id = ?`)
    .run(`anon_user_${u.id}`, bcrypt.hashSync(uuid(), 12), now, id);
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, id);
  const replacements = [[u.username, `anon_user_${u.id}`], [u.full_name, '[anonimleştirildi]'], [u.email, '[anonimleştirildi]']];
  const rows = db.prepare('SELECT id, old_value, new_value, detail FROM audit_log WHERE user_id = ?').all(id);
  const updateAudit = db.prepare('UPDATE audit_log SET username = ?, old_value = ?, new_value = ?, detail = ? WHERE id = ?');
  for (const row of rows) {
    updateAudit.run(`anon_user_${u.id}`, redactJson(row.old_value, replacements), redactJson(row.new_value, replacements), redactText(row.detail, replacements), row.id);
  }
  redactAudit('user', [id], replacements);
  logAudit(req, 'auditUserAnonymize', { entityType: 'user', entityId: id, detail: `anon_user_${u.id}` });
  return db.prepare('SELECT id, username, is_active, anonymized_at FROM users WHERE id = ?').get(id);
  });
}

/** KVKK m.11/b — "bu kişi hakkında hangi kişisel veriyi tutuyoruz" raporu. */
function exportCustomerData(id) {
  return db.tx(() => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) throw new AppError('Müşteri bulunamadı / Customer not found', 404);
  const salesOrders = db.prepare('SELECT id, so_no, date, status, total_base FROM sales_orders WHERE customer_id = ? ORDER BY date DESC').all(id);
  const invoices = db.prepare('SELECT id, invoice_no, invoice_date, amount, currency, status, original_invoice_id FROM customer_invoices WHERE customer_id = ? ORDER BY invoice_date DESC').all(id);
  const shipments = db.prepare('SELECT id, shipment_no, date, status, destination FROM shipments WHERE customer_id = ? ORDER BY date DESC').all(id);
  const supportTickets = db.prepare('SELECT id, ticket_no, subject, status, created_at FROM support_tickets WHERE customer_id = ? ORDER BY created_at DESC').all(id);
  const visits = db.prepare('SELECT id, visit_date, purpose, visited_by FROM customer_visits WHERE customer_id = ? ORDER BY visit_date DESC').all(id);
  const opportunities = db.prepare('SELECT id, opp_no, stage, estimated_value, created_at FROM opportunities WHERE customer_id = ? ORDER BY created_at DESC').all(id);
  const auditLog = db.prepare("SELECT ts, action_key, username, detail FROM audit_log WHERE entity_type = 'customer' AND entity_id = ? ORDER BY ts DESC").all(String(id));
  return {
    exportedAt: new Date().toISOString(),
    subjectType: 'customer',
    personalData: {
      id: customer.id, code: customer.code, name: customer.name, contactPerson: customer.contact_person,
      phone: customer.phone, email: customer.email, address: customer.address, country: customer.country,
      taxNo: customer.tax_no, isActive: !!customer.is_active, anonymizedAt: customer.anonymized_at
    },
    relatedRecords: { salesOrders, invoices, shipments, supportTickets, visits, opportunities, auditLog }
  };
  });
}

function exportSupplierData(id) {
  return db.tx(() => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!supplier) throw new AppError('Tedarikçi bulunamadı / Supplier not found', 404);
  const purchaseOrders = db.prepare('SELECT id, po_no, date, status FROM purchase_orders WHERE supplier_id = ? ORDER BY date DESC').all(id);
  const ncrs = db.prepare('SELECT id, ncr_no, status, opened_at FROM ncrs WHERE supplier_id = ? ORDER BY opened_at DESC').all(id);
  const auditLog = db.prepare("SELECT ts, action_key, username, detail FROM audit_log WHERE entity_type = 'supplier' AND entity_id = ? ORDER BY ts DESC").all(String(id));
  return {
    exportedAt: new Date().toISOString(),
    subjectType: 'supplier',
    personalData: {
      id: supplier.id, code: supplier.code, name: supplier.name, contactPerson: supplier.contact_person,
      phone: supplier.phone, email: supplier.email, address: supplier.address, country: supplier.country,
      taxNo: supplier.tax_no, bankInfo: supplier.bank_info, isActive: !!supplier.is_active, anonymizedAt: supplier.anonymized_at
    },
    relatedRecords: { purchaseOrders, ncrs, auditLog }
  };
  });
}

function exportUserData(id) {
  return db.tx(() => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError('Kullanıcı bulunamadı / User not found', 404);
  const sessions = db.prepare('SELECT jti, issued_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id = ? ORDER BY issued_at DESC').all(id);
  const auditLog = db.prepare('SELECT ts, action_key, entity_type, entity_id, detail FROM audit_log WHERE user_id = ? ORDER BY ts DESC LIMIT 500').all(id);
  return {
    exportedAt: new Date().toISOString(),
    subjectType: 'user',
    personalData: {
      id: user.id, username: user.username, fullName: user.full_name, email: user.email,
      role: user.role, isActive: !!user.is_active, anonymizedAt: user.anonymized_at, createdAt: user.created_at
    },
    relatedRecords: { sessions, auditLogEntryCount: auditLog.length, auditLog }
  };
  });
}

module.exports = {
  anonymizeCustomer, anonymizeSupplier, anonymizeUser,
  exportCustomerData, exportSupplierData, exportUserData
};
