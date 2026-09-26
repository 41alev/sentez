// @ts-nocheck
/**
 * Invoice settlement (K-05: partial payments allowed).
 *
 * Amounts are stored in the invoice currency and rounded to 2 decimals.
 * The database triggers in migration 025 enforce the hard limits (no payment
 * above the open amount, supplier invoice must be approved, legacy invoices
 * cannot be approved); this module owns status transitions and idempotency.
 *
 * Customer invoice open amount = amount − payments − issued credit notes.
 * Invoices paid before the ledger existed carry paid_legacy = 1 and are
 * treated as fully paid (no fabricated payment rows).
 */
const db = require('../db');
const { AppError, uuid, logAudit } = require('../lib/core');
const { toLocalDateStr } = require('../lib/dates');
const { toMinor, fromMinor } = require('../lib/money');

const round2 = value => fromMinor(toMinor(value));

function customerPaid(invoiceId) {
  return db.prepare(`SELECT COALESCE(SUM(p.amount_minor),0) s FROM customer_invoice_payments p
    WHERE p.invoice_id=? AND NOT EXISTS
      (SELECT 1 FROM customer_invoice_payment_reversals r WHERE r.payment_id=p.id)`).get(invoiceId).s;
}
function customerCredits(invoiceId) {
  return db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM customer_invoices
    WHERE original_invoice_id=? AND invoice_type='iade' AND status!='cancelled'`).get(invoiceId).s;
}

/** Settlement summary for one customer invoice (invoice currency). */
function customerSettlement(inv) {
  if (inv.invoice_type === 'iade') {
    return { paidAmount: 0, creditAmount: 0, openAmount: 0 };
  }
  const paymentsMinor = customerPaid(inv.id);
  const creditsMinor = customerCredits(inv.id);
  const paidMinor = inv.paid_legacy ? Math.max(0, inv.amount_minor - creditsMinor) : paymentsMinor;
  const openMinor = inv.status === 'cancelled' ? 0 : Math.max(0, inv.amount_minor - paidMinor - creditsMinor);
  return { paidAmount: fromMinor(paidMinor), creditAmount: fromMinor(creditsMinor), openAmount: fromMinor(openMinor) };
}

/** Marks an issued customer invoice paid once payments + credits cover it. */
function refreshCustomerInvoiceStatus(invoiceId) {
  const inv = db.prepare('SELECT * FROM customer_invoices WHERE id=?').get(invoiceId);
  if (!inv || inv.status !== 'issued' || inv.invoice_type === 'iade') return inv?.status;
  if (customerPaid(inv.id) + customerCredits(inv.id) >= inv.amount_minor) {
    db.prepare("UPDATE customer_invoices SET status='paid' WHERE id=? AND status='issued'").run(inv.id);
    return 'paid';
  }
  return inv.status;
}

function validatePaymentInput(input) {
  const paidOn = input.paidOn || toLocalDateStr();
  const amountMinor = input.amount == null ? null : toMinor(input.amount);
  const amount = amountMinor == null ? null : fromMinor(amountMinor);
  if (amountMinor != null && !(amountMinor > 0)) throw new AppError('Ödeme tutarı pozitif olmalı / Payment amount must be positive', 422);
  return { paidOn, amount, amountMinor };
}

function existingByKey(table, invoiceId, requestKey) {
  if (!requestKey) return null;
  return db.prepare(`SELECT id, amount, amount_minor FROM ${table} WHERE invoice_id=? AND request_key=?`).get(invoiceId, requestKey);
}

/**
 * Records a customer payment. Omitting `amount` pays the full open amount,
 * which keeps the older one-click "mark paid" contract working.
 */
function recordCustomerPayment(req, invoiceId, input = {}) {
  return db.txImmediate(() => {
    const inv = db.prepare('SELECT * FROM customer_invoices WHERE id=?').get(invoiceId);
    if (!inv) throw new AppError('Fatura bulunamadı / Invoice not found', 404);
    if (inv.invoice_type === 'iade') throw new AppError('İade faturası tahsil edilemez / A credit note cannot be paid', 409);
    const replay = existingByKey('customer_invoice_payments', inv.id, input.requestKey);
    if (replay) return { ok: true, paymentId: replay.id, duplicate: true, ...customerSettlement(inv), status: inv.status };
    if (inv.status === 'paid') return { ok: true, alreadyPaid: true, ...customerSettlement(inv), status: 'paid' };
    if (inv.status !== 'issued') throw new AppError('Bu fatura tahsil edilemez / Invoice is not issued', 409);
    const { paidOn, amountMinor } = validatePaymentInput(input);
    const before = customerSettlement(inv);
    const openMinor = toMinor(before.openAmount);
    const payMinor = amountMinor ?? openMinor;
    const payAmount = fromMinor(payMinor);
    if (!(payMinor > 0)) {
      refreshCustomerInvoiceStatus(inv.id);
      return { ok: true, alreadyPaid: true, ...customerSettlement(inv), status: 'paid' };
    }
    if (payMinor > openMinor) {
      throw new AppError('Ödeme açık tutarı aşıyor / Payment exceeds open amount', 409, { outstanding: before.openAmount });
    }
    const id = uuid();
    db.prepare(`INSERT INTO customer_invoice_payments
      (id,invoice_id,amount,amount_minor,paid_on,method,reference,note,request_key,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, inv.id, payAmount, payMinor, paidOn, input.method || null,
      input.reference || null, input.note || null, input.requestKey || null, Date.now(), req.user?.id || null);
    const status = refreshCustomerInvoiceStatus(inv.id);
    logAudit(req, 'auditCustomerInvoicePaid', { entityType: 'customer_invoice', entityId: inv.id,
      newValue: { paymentId: id, amount: payAmount, currency: inv.currency, paidOn, status }, detail: inv.invoice_no });
    const fresh = db.prepare('SELECT * FROM customer_invoices WHERE id=?').get(inv.id);
    return { ok: true, paymentId: id, status, ...customerSettlement(fresh) };
  });
}

function listCustomerPayments(invoiceId) {
  return db.prepare(`SELECT p.id, p.amount, p.amount_minor, p.paid_on, p.method, p.reference, p.note, p.created_at, p.created_by,
      r.id reversal_id, r.reversed_on, r.reason reversal_reason, r.created_at reversal_created_at, r.created_by reversal_created_by
    FROM customer_invoice_payments p LEFT JOIN customer_invoice_payment_reversals r ON r.payment_id=p.id
    WHERE p.invoice_id=? ORDER BY p.created_at, p.id`).all(invoiceId)
    .map(p => ({ id: p.id, amount: fromMinor(p.amount_minor), paidOn: p.paid_on, method: p.method, reference: p.reference,
      note: p.note, createdAt: p.created_at, createdBy: p.created_by, reversed: !!p.reversal_id,
      reversal: p.reversal_id ? { id: p.reversal_id, reversedOn: p.reversed_on, reason: p.reversal_reason,
        createdAt: p.reversal_created_at, createdBy: p.reversal_created_by } : null }));
}

function reverseCustomerPayment(req, invoiceId, paymentId, input) {
  return db.txImmediate(() => {
    const payment = db.prepare(`SELECT p.*, ci.invoice_no FROM customer_invoice_payments p
      JOIN customer_invoices ci ON ci.id=p.invoice_id WHERE p.id=? AND p.invoice_id=?`).get(paymentId, invoiceId);
    if (!payment) throw new AppError('Tahsilat bulunamadı / Payment not found', 404);
    const existing = db.prepare('SELECT * FROM customer_invoice_payment_reversals WHERE payment_id=? OR request_key=?')
      .get(payment.id, input.requestKey || null);
    if (existing) return { ok: true, reversalId: existing.id, duplicate: true };
    const id = uuid();
    db.prepare(`INSERT INTO customer_invoice_payment_reversals
      (id,payment_id,reversed_on,reason,request_key,created_at,created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(id, payment.id, input.reversedOn || toLocalDateStr(), input.reason, input.requestKey || null, Date.now(), req.user?.id || null);
    db.prepare("UPDATE customer_invoices SET status='issued' WHERE id=? AND status='paid'").run(invoiceId);
    const status = refreshCustomerInvoiceStatus(invoiceId);
    logAudit(req, 'auditCustomerInvoicePaymentReversed', { entityType: 'customer_invoice', entityId: invoiceId,
      oldValue: { paymentId: payment.id, amount: payment.amount }, newValue: { reversalId: id, status },
      detail: `${payment.invoice_no}: ${input.reason}` });
    return { ok: true, reversalId: id, status, ...customerSettlement(db.prepare('SELECT * FROM customer_invoices WHERE id=?').get(invoiceId)) };
  });
}

/* ------------------------------ supplier ------------------------------ */

function supplierPaid(invoiceId) {
  return db.prepare(`SELECT COALESCE(SUM(p.amount_minor),0) s FROM supplier_invoice_payments p
    WHERE p.invoice_id=? AND NOT EXISTS
      (SELECT 1 FROM supplier_invoice_payment_reversals r WHERE r.payment_id=p.id)`).get(invoiceId).s;
}

function supplierSettlement(inv) {
  const grossMinor = inv.vat_amount_minor == null ? null : inv.amount_minor + inv.vat_amount_minor;
  const paymentsMinor = supplierPaid(inv.id);
  const paidMinor = inv.paid_legacy && grossMinor != null ? grossMinor : paymentsMinor;
  return { grossAmount: grossMinor == null ? null : fromMinor(grossMinor), paidAmount: fromMinor(paidMinor),
    openAmount: grossMinor == null ? null : fromMinor(Math.max(0, grossMinor - paidMinor)) };
}

/** Weighted VAT from the invoice's receipt-line snapshots, in invoice currency. */
function snapshotVatAmount(invoiceId, netAmount) {
  const row = db.prepare(`SELECT SUM(qty*unit_price*fx_rate) base, SUM(qty*unit_price*fx_rate*vat_rate) weighted
    FROM supplier_invoice_allocations WHERE invoice_id=?`).get(invoiceId);
  if (!row || !(row.base > 0)) return null;
  return round2(netAmount * (row.weighted / row.base) / 100);
}

function recordSupplierPayment(req, invoiceId, input = {}) {
  return db.txImmediate(() => {
    const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(invoiceId);
    if (!inv) throw new AppError('Fatura bulunamadı / Invoice not found', 404);
    const replay = existingByKey('supplier_invoice_payments', inv.id, input.requestKey);
    if (replay) return { ok: true, paymentId: replay.id, duplicate: true, status: inv.match_status, ...supplierSettlement(inv) };
    if (inv.match_status === 'paid') return { ok: true, alreadyPaid: true, status: 'paid', ...supplierSettlement(inv) };
    if (inv.allocation_state === 'legacy') {
      throw new AppError('Eski fatura önce mutabakat gerektirir / Legacy invoice requires reconciliation', 409);
    }
    if (inv.match_status !== 'approved') {
      throw new AppError('Fatura ödeme için onaylanmamış / Invoice is not approved for payment', 409);
    }
    const { paidOn, amountMinor } = validatePaymentInput(input);
    const before = supplierSettlement(inv);
    const openMinor = toMinor(before.openAmount);
    const payMinor = amountMinor ?? openMinor;
    const payAmount = fromMinor(payMinor);
    if (payMinor > openMinor) {
      throw new AppError('Ödeme açık tutarı aşıyor / Payment exceeds open amount', 409, { outstanding: before.openAmount });
    }
    const id = uuid();
    db.prepare(`INSERT INTO supplier_invoice_payments
      (id,invoice_id,amount,amount_minor,paid_on,method,reference,note,request_key,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, inv.id, payAmount, payMinor, paidOn, input.method || null,
      input.reference || null, input.note || null, input.requestKey || null, Date.now(), req.user?.id || null);
    let status = inv.match_status;
    if (supplierPaid(inv.id) >= inv.amount_minor + inv.vat_amount_minor) {
      db.prepare("UPDATE supplier_invoices SET match_status='paid' WHERE id=? AND match_status='approved'").run(inv.id);
      status = 'paid';
    }
    logAudit(req, 'auditSupplierInvoicePaid', { entityType: 'supplier_invoice', entityId: inv.id,
      newValue: { paymentId: id, amount: payAmount, currency: inv.currency, paidOn, status }, detail: inv.invoice_no });
    const fresh = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(inv.id);
    return { ok: true, paymentId: id, status, ...supplierSettlement(fresh) };
  });
}

function listSupplierPayments(invoiceId) {
  return db.prepare(`SELECT p.id, p.amount, p.amount_minor, p.paid_on, p.method, p.reference, p.note, p.created_at, p.created_by,
      r.id reversal_id, r.reversed_on, r.reason reversal_reason, r.created_at reversal_created_at, r.created_by reversal_created_by
    FROM supplier_invoice_payments p LEFT JOIN supplier_invoice_payment_reversals r ON r.payment_id=p.id
    WHERE p.invoice_id=? ORDER BY p.created_at, p.id`).all(invoiceId)
    .map(p => ({ id: p.id, amount: fromMinor(p.amount_minor), paidOn: p.paid_on, method: p.method, reference: p.reference,
      note: p.note, createdAt: p.created_at, createdBy: p.created_by, reversed: !!p.reversal_id,
      reversal: p.reversal_id ? { id: p.reversal_id, reversedOn: p.reversed_on, reason: p.reversal_reason,
        createdAt: p.reversal_created_at, createdBy: p.reversal_created_by } : null }));
}

function reverseSupplierPayment(req, invoiceId, paymentId, input) {
  return db.txImmediate(() => {
    const payment = db.prepare(`SELECT p.*, si.invoice_no FROM supplier_invoice_payments p
      JOIN supplier_invoices si ON si.id=p.invoice_id WHERE p.id=? AND p.invoice_id=?`).get(paymentId, invoiceId);
    if (!payment) throw new AppError('Ödeme bulunamadı / Payment not found', 404);
    const existing = db.prepare('SELECT * FROM supplier_invoice_payment_reversals WHERE payment_id=? OR request_key=?')
      .get(payment.id, input.requestKey || null);
    if (existing) return { ok: true, reversalId: existing.id, duplicate: true };
    const id = uuid();
    db.prepare(`INSERT INTO supplier_invoice_payment_reversals
      (id,payment_id,reversed_on,reason,request_key,created_at,created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(id, payment.id, input.reversedOn || toLocalDateStr(), input.reason, input.requestKey || null, Date.now(), req.user?.id || null);
    db.prepare("UPDATE supplier_invoices SET match_status='approved' WHERE id=? AND match_status='paid'").run(invoiceId);
    const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(invoiceId);
    logAudit(req, 'auditSupplierInvoicePaymentReversed', { entityType: 'supplier_invoice', entityId: invoiceId,
      oldValue: { paymentId: payment.id, amount: payment.amount }, newValue: { reversalId: id, status: inv.match_status },
      detail: `${payment.invoice_no}: ${input.reason}` });
    return { ok: true, reversalId: id, status: inv.match_status, ...supplierSettlement(inv) };
  });
}

module.exports = {
  round2, customerSettlement, refreshCustomerInvoiceStatus, recordCustomerPayment, listCustomerPayments, reverseCustomerPayment,
  supplierSettlement, snapshotVatAmount, recordSupplierPayment, listSupplierPayments, reverseSupplierPayment
};
