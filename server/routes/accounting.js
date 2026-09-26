// @ts-nocheck
const express = require('express');
const db = require('../db');
const { logAudit } = require('../lib/core');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, validateQuery, z, localDate } = require('../middleware/validate');
const { companyIdOf } = require('../lib/tenant');
const accountingExport = require('../services/accounting-export');

const router = express.Router();
router.use(requireAuth);

const MANAGER = requireRole('admin', 'manager');

/* ============================ HESAP KODU EŞLEMESİ ============================ */

router.get('/mappings', MANAGER, (req, res) => {
  const rows = db.prepare('SELECT mapping_key, account_code, account_name FROM account_code_mappings WHERE company_id = ? ORDER BY mapping_key')
    .all(companyIdOf(req));
  res.json(rows.map(r => ({ key: r.mapping_key, accountCode: r.account_code, accountName: r.account_name })));
});

const mappingSchema = z.object({
  mappings: z.array(z.object({
    key: z.enum(['sales_revenue', 'sales_vat', 'accounts_receivable', 'purchase_vat', 'accounts_payable', 'inventory',
      'cost_of_goods_sold', 'cash', 'bank', 'card', 'check', 'payment_clearing']),
    accountCode: z.string().trim().min(1).max(50),
    accountName: z.string().trim().min(1).max(200)
  })).min(1)
});

router.put('/mappings', MANAGER, validate(mappingSchema), (req, res) => {
  const companyId = companyIdOf(req);
  const upsert = db.prepare(`
    INSERT INTO account_code_mappings (company_id, mapping_key, account_code, account_name)
    VALUES (?,?,?,?)
    ON CONFLICT(company_id, mapping_key) DO UPDATE SET account_code = excluded.account_code, account_name = excluded.account_name
  `);
  db.tx(() => {
    req.valid.mappings.forEach(m => upsert.run(companyId, m.key, m.accountCode, m.accountName));
  });
  logAudit(req, 'auditAccountMappingUpdate', { entityType: 'account_code_mapping', detail: `${req.valid.mappings.length} eşleme` });
  res.json({ ok: true });
});

/* ============================ DIŞA AKTARIM ============================ */

router.get('/export', MANAGER, validateQuery(z.object({
  from: localDate,
  to: localDate
})), (req, res, next) => {
  try {
    const result = accountingExport.generateJournalEntries({ from: req.query.from, to: req.query.to, companyId: companyIdOf(req) });
    logAudit(req, 'auditAccountingExport', { entityType: 'accounting_export',
      detail: `${result.from} — ${result.to}, ${result.count} satır` });
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
