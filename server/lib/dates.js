/**
 * Yerel takvim tarihi yardımcıları — tek, paylaşılan kaynak.
 *
 * BİLİNÇLİ TASARIM KARARI: Bu sistemde "bugün" ve gün aralıkları hep YEREL
 * saat dilimine göre hesaplanır, UTC'ye göre değil. Sunucunun UTC'nin
 * doğusunda bir saat diliminde (ör. Türkiye, UTC+3) çalıştığı varsayılır.
 *
 * `server/services/capacity.js`'de gerçek bir üretim hatası buradan çıktı:
 * bir tarih string'i `toISOString().slice(0,10)` ile ÜRETİLİP, başka bir
 * yerde `new Date(dateStr + 'T00:00:00')` ile YEREL saat olarak GERİ
 * OKUNUYORDU. UTC+3 gibi pozitif saat dilimlerinde bu iki işlem birbirinin
 * tersini yapmadığından, gün ilerletme döngüsü (`findSlot`) aynı takvim
 * gününde sonsuza kadar takılıp kalıyor, hiçbir üretim emri asla
 * çizelgelenemiyordu.
 *
 * Kural: bir tarihi YALNIZCA bu modül üzerinden üret ve geri oku. Her
 * dosyanın kendi `toISOString().slice(0,10)` kopyasını yazması, aynı hatayı
 * başka bir yerde yeniden üretme riskini taşır (nitekim `mrp.js`'de birebir
 * aynı hata bağımsız olarak bulunmuştu).
 */
const DAY_MS = 86400000;

/**
 * Bir zaman damgasını (ms veya Date) YEREL takvim gününe (YYYY-MM-DD) çevirir.
 * @param {number|Date} [ms]
 */
function toLocalDateStr(ms = Date.now()) {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Bugünün yerel takvim tarihi (YYYY-MM-DD). */
function today() {
  return toLocalDateStr(Date.now());
}

/** Strict calendar-date check; Date parsing alone normalizes impossible days. */
function isValidLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && toLocalDateStr(date) === value;
}

/**
 * Bir YYYY-MM-DD tarihine N gün ekler (negatif de olabilir), sonucu yine
 * YYYY-MM-DD olarak döner. Girdi ve çıktı her zaman yerel takvim günüdür.
 * @param {string} dateStr
 * @param {number} n
 */
function addDays(dateStr, n) {
  return toLocalDateStr(new Date(dateStr + 'T00:00:00').getTime() + n * DAY_MS);
}

/** ISO hafta günü: Pazartesi=1 … Pazar=7 (JS'te Pazar 0'dır). */
function isoWeekday(dateStr) {
  const w = new Date(dateStr + 'T12:00:00').getDay();
  return w === 0 ? 7 : w;
}

/**
 * İki YYYY-MM-DD tarihi arasındaki tam gün farkı (toStr - fromStr).
 * Her ikisi de yerel takvim günü olarak yorumlanır, saat dilimi karışmaz.
 * @param {string} fromStr
 * @param {string} toStr
 */
function daysBetween(fromStr, toStr) {
  return Math.round(
    (new Date(toStr + 'T00:00:00').getTime() - new Date(fromStr + 'T00:00:00').getTime()) / DAY_MS
  );
}

module.exports = { DAY_MS, toLocalDateStr, today, isValidLocalDate, addDays, isoWeekday, daysBetween };
