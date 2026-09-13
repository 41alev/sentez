// @ts-nocheck
/**
 * KVKK saklama süresi politikası — "ilişkisi sona eren müşteri/tedarikçi
 * verisi N yıl sonra anonimleştirilir" (docs/KVKK-DEGERLENDIRME.md §4.5).
 *
 * Varsayılan olarak KAPALI (`kvkkAutoAnonymizeEnabled` ayarı) — otomatik,
 * geri döndürülemez bir veri silme işlemini hiç kimsenin açıkça onaylamadan
 * devreye sokmak riskli bir varsayılan olurdu (CLAUDE.md §26 "secure
 * defaults"). Yönetici Ayarlar'dan açıkça etkinleştirip saklama süresini
 * (varsayılan 10 yıl — VUK'un asgari belge saklama süresiyle aynı, daha
 * kısası mali kayıtların dayandığı ticari belgeleri anlamsızlaştırabilir)
 * seçmelidir.
 *
 * Yalnızca müşteri/tedarikçi (iş ortağı) verisi kapsar — kullanıcı (çalışan)
 * kayıtları burada YOKTUR: bir çalışanın ne zaman anonimleştirileceği İK
 * politikası gerektirir ve bu proje kasıtlı olarak İK/bordro alanına hiç
 * girmiyor (bkz. PROJECT_STATUS.md standing constraint).
 */
const db = require('../db');
const { getSetting } = require('../lib/core');
const kvkk = require('../lib/kvkk');

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

function systemReq() { return { user: null, ip: null }; }

/** Saklama süresi dolmuş, henüz anonimleştirilmemiş pasif kayıtları anonimleştirir. */
function runRetentionSweep() {
  if (getSetting('kvkkAutoAnonymizeEnabled') !== '1') return { enabled: false, anonymized: 0 };
  const rawYears = Number(getSetting('kvkkRetentionYears', 10));
  const years = Number.isFinite(rawYears) && rawYears >= 0 ? rawYears : 10;
  const cutoff = Date.now() - years * YEAR_MS;
  const req = systemReq();
  let count = 0;

  const dueCustomers = db.prepare(`SELECT id FROM customers
    WHERE is_active = 0 AND anonymized_at IS NULL AND deactivated_at IS NOT NULL AND deactivated_at <= ?`).all(cutoff);
  for (const c of dueCustomers) { try { kvkk.anonymizeCustomer(req, c.id); count++; } catch (e) { /* zaten anonimleştirilmiş vb. — atla */ } }

  const dueSuppliers = db.prepare(`SELECT id FROM suppliers
    WHERE is_active = 0 AND anonymized_at IS NULL AND deactivated_at IS NOT NULL AND deactivated_at <= ?`).all(cutoff);
  for (const s of dueSuppliers) { try { kvkk.anonymizeSupplier(req, s.id); count++; } catch (e) { /* atla */ } }

  return { enabled: true, anonymized: count };
}

let timer = null;
function startRetentionScheduler() {
  if (timer) return; // testler arka arkaya server başlatıp durdurabiliyor — çift zamanlayıcı kurulmasın
  const tick = () => {
    // Zamanlayıcı sunucuyu asla çökertmemeli (bkz. services/notifications.js / lib/webhooks.js — aynı desen).
    try { runRetentionSweep(); } catch (e) { console.error('[data-retention] tarama başarısız / scan failed:', e.message); }
  };
  timer = setInterval(tick, 24 * 3600 * 1000); // günde bir kez yeterli — saklama süresi yıllık ölçekte
  timer.unref?.();
}

module.exports = { runRetentionSweep, startRetentionScheduler };
