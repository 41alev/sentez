/**
 * Çok şirketlilik altyapı hazırlığı — tek, paylaşılan kaynak.
 *
 * Sistem bugün tek bir firma varsayımıyla çalışıyor. Bu modül, gelecekte
 * gerçek çoklu şirket desteği eklenmek istendiğinde tüm sorgu filtrelemesinin
 * TEK bir yerden geçmesini sağlamak için var — bugün HİÇBİR YERDE
 * çağrılmıyor/filtrelemiyor. `req.user.companyId` (bkz. middleware/auth.js)
 * dolduruluyor ama okunmuyor; bu, verinin hazır olduğu, davranışın
 * değişmediği anlamına gelir.
 */
const DEFAULT_COMPANY_ID = 1;

/** @param {{ user?: { companyId?: number|string } }} req */
function companyIdOf(req) {
  return req.user?.companyId || DEFAULT_COMPANY_ID;
}

module.exports = { DEFAULT_COMPANY_ID, companyIdOf };
