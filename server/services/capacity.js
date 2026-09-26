/**
 * Kapasite ve çizelgeleme.
 *
 * Kapasite vardiyadan gelir: bir iş merkezinin bir gün içindeki kullanılabilir
 * dakikası, o merkeze atanmış vardiyaların çalışma süresinden molalar, planlı
 * duruş payı ve tatiller düşülerek bulunur; ardından verimlilikle çarpılır.
 *
 * Çizelgeleme sonlu kapasitelidir: bir iş merkezi aynı anda kapasite birimi kadar
 * iş yürütür, fazlası sıraya girer. Sonsuz kapasite varsayan bir plan, "her şey
 * zamanında biter" der ve hiçbir işe yaramaz.
 */
const db = require('../db');
const { AppError } = require('../lib/core');
const { toLocalDateStr: toDateStr, isoWeekday } = require('../lib/dates');

const MIN = 60000;
const DAY_MS = 86400000;

function parseHM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Bir vardiyanın net çalışma dakikası (gece vardiyası ertesi güne sarkar). */
function shiftMinutes(shift) {
  let start = parseHM(shift.start_time);
  let end = parseHM(shift.end_time);
  if (end <= start) end += 24 * 60;              // 00:00 bitişi ertesi gün demektir
  return Math.max(0, end - start - (shift.break_minutes || 0));
}

/**
 * Bir iş merkezinin belirli bir gündeki kullanılabilir dakikası.
 * Tatil varsa sıfır, kısmi istisna varsa o saat kadar.
 */
function availableMinutes(workCenterId, dateStr) {
  const wc = db.prepare('SELECT * FROM work_centers WHERE id = ?').get(workCenterId);
  if (!wc || !wc.is_active) return 0;

  // Tatil ve planlı duruşlar önce bakılır: çalışılmayan güne kapasite yazılmaz.
  const exc = db.prepare(`SELECT * FROM calendar_exceptions
    WHERE date = ? AND (work_center_id = ? OR work_center_id IS NULL)
    ORDER BY work_center_id DESC LIMIT 1`).get(dateStr, workCenterId);
  if (exc) {
    if (exc.exception_type === 'holiday') return 0;
    if (exc.available_hours != null) return exc.available_hours * 60 * wc.capacity_units;
  }

  const weekday = isoWeekday(dateStr);
  const shifts = db.prepare(`SELECT s.* FROM shifts s
    JOIN work_center_shifts wcs ON wcs.shift_id = s.id
    WHERE wcs.work_center_id = ? AND s.is_active = 1`).all(workCenterId);

  const raw = shifts
    .filter(s => String(s.weekdays).split(',').map(x => Number(x.trim())).includes(weekday))
    .reduce((sum, s) => sum + shiftMinutes(s), 0);

  // Planlı duruş kapasiteden düşer, verimlilik gerçekleşen çıktıyı belirler.
  const afterDowntime = raw * (1 - (wc.downtime_pct || 0) / 100);
  return afterDowntime * ((wc.efficiency_pct || 100) / 100) * (wc.capacity_units || 1);
}

/** Etkin çalışma oranı: verimlilik × (1 − planlı duruş). */
function workFactor(wc) {
  return ((wc.efficiency_pct || 100) / 100) * (1 - (wc.downtime_pct || 0) / 100);
}

function dayStartMs(dateStr) { return new Date(dateStr + 'T00:00:00').getTime(); }
function nextDateStr(dateStr) { return toDateStr(dayStartMs(dateStr) + DAY_MS + 12 * 3600000); }

/**
 * T10: bir iş merkezinin, `dateStr` gününde BAŞLAYAN vardiyalarından gelen
 * gerçek saat aralıkları [başlangıç, bitiş) (ms). Gece vardiyası ertesi güne
 * sarkar ve başladığı güne yazılır. Molanın saati tanımlı olmadığı için
 * vardiyanın ortasına yerleştirilir (varsayım). Tatil günü aralık yoktur;
 * kısmi istisnada ilk `available_hours` saat kullanılabilir.
 */
function workingIntervals(wc, dateStr, cache) {
  const key = wc.id + '|' + dateStr;
  if (cache && cache.has(key)) return cache.get(key);
  let result = [];
  if (wc.is_active) {
    const exc = db.prepare(`SELECT * FROM calendar_exceptions
      WHERE date = ? AND (work_center_id = ? OR work_center_id IS NULL)
      ORDER BY work_center_id DESC LIMIT 1`).get(dateStr, wc.id);
    if (!exc || exc.exception_type !== 'holiday') {
      const weekday = isoWeekday(dateStr);
      const base = dayStartMs(dateStr);
      const shifts = db.prepare(`SELECT s.* FROM shifts s
        JOIN work_center_shifts wcs ON wcs.shift_id = s.id
        WHERE wcs.work_center_id = ? AND s.is_active = 1`).all(wc.id)
        .filter(sh => String(sh.weekdays).split(',').map(x => Number(x.trim())).includes(weekday));
      const raw = [];
      for (const sh of shifts) {
        const start = base + parseHM(sh.start_time) * MIN;
        let end = base + parseHM(sh.end_time) * MIN;
        if (end <= start) end += DAY_MS;
        const brk = Math.min((sh.break_minutes || 0) * MIN, end - start);
        if (brk > 0) {
          const firstEnd = start + (end - start - brk) / 2;
          raw.push([start, firstEnd], [firstEnd + brk, end]);
        } else {
          raw.push([start, end]);
        }
      }
      raw.sort((a, b) => a[0] - b[0]);
      for (const iv of raw) {
        if (iv[1] <= iv[0]) continue;
        const last = result[result.length - 1];
        if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
        else result.push([iv[0], iv[1]]);
      }
      if (exc && exc.exception_type === 'partial' && exc.available_hours != null) {
        let budget = exc.available_hours * 60 * MIN;
        if (!result.length && budget > 0) result = [[base + 8 * 60 * MIN, base + 8 * 60 * MIN + budget]];
        const truncated = [];
        for (const iv of result) {
          if (budget <= 0) break;
          const take = Math.min(budget, iv[1] - iv[0]);
          truncated.push([iv[0], iv[0] + take]);
          budget -= take;
        }
        result = truncated;
      }
    }
  }
  if (cache) cache.set(key, result);
  return result;
}

/** Aktif (tamamlanmamış) ve planlanmış operasyonların saat aralıkları. */
function bookings(workCenterId, excludeOrderId = null) {
  return db.prepare(`SELECT planned_start AS start, planned_end AS end FROM production_operations
    WHERE work_center_id = ? AND status NOT IN ('completed','cancelled')
      AND planned_start IS NOT NULL AND planned_end IS NOT NULL AND planned_end > planned_start
      AND (? IS NULL OR production_order_id != ?)`).all(workCenterId, excludeOrderId, excludeOrderId);
}

/** [s,e) içinde aynı anda süren en fazla rezervasyon sayısı. */
function maxOverlap(list, s, e) {
  const events = [];
  for (const b of list) {
    if (b.end <= s || b.start >= e) continue;
    events.push([Math.max(b.start, s), 1], [Math.min(b.end, e), -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, max = 0;
  for (const [, delta] of events) { current += delta; max = Math.max(max, current); }
  return max;
}

/**
 * `fromMs` anından itibaren `workMinutes` etkin iş dakikasını çalışma
 * aralıklarına yayar. Dönen [start, end) saat aralığıdır; aradaki çalışılmayan
 * süre (gece, hafta sonu, mola) işi durdurur ama başka iş de o hatta başlamaz.
 */
function spanFrom(wc, fromMs, workMinutes, horizonDays, cache) {
  const factor = workFactor(wc);
  if (!(factor > 0)) return null;
  let remaining = (workMinutes / factor) * MIN;
  let start = null;
  // Önceki günün gece vardiyası bu güne sarkabilir.
  let dateStr = toDateStr(dayStartMs(toDateStr(fromMs)) - DAY_MS + 12 * 3600000);
  for (let i = 0; i <= horizonDays + 1; i++) {
    for (const [a, b] of workingIntervals(wc, dateStr, cache)) {
      if (b <= fromMs) continue;
      const from = Math.max(a, fromMs);
      if (start === null) start = from;
      if (remaining <= 0) return { start, end: start };
      const take = Math.min(b - from, remaining);
      remaining -= take;
      if (remaining <= 0.5) return { start, end: from + take };
      fromMs = b;
    }
    dateStr = nextDateStr(dateStr);
  }
  return null;
}

/** Bir tarih aralığında iş merkezi bazında kapasite ve yük. */
function capacityLoad({ from, to, workCenterId = null }) {
  const start = dayStartMs(from);
  const end = dayStartMs(to);
  if (!(end >= start)) throw new AppError('Geçersiz tarih aralığı / Invalid date range', 400);

  const centers = workCenterId
    ? db.prepare('SELECT * FROM work_centers WHERE id = ? AND is_active = 1').all(workCenterId)
    : db.prepare('SELECT * FROM work_centers WHERE is_active = 1 ORDER BY code').all();

  const cache = new Map();
  const results = [];
  for (const wc of centers) {
    const factor = workFactor(wc);
    const booked = bookings(wc.id);
    const days = [];
    for (let dateStr = from; dateStr <= to; dateStr = nextDateStr(dateStr)) {
      const capacity = availableMinutes(wc.id, dateStr);
      // Yük: rezervasyonların o günün çalışma aralıklarıyla kesişen etkin dakikası.
      let load = 0;
      for (const [a, b] of workingIntervals(wc, dateStr, cache)) {
        for (const bk of booked) {
          const overlap = Math.min(b, bk.end) - Math.max(a, bk.start);
          if (overlap > 0) load += (overlap / MIN) * factor;
        }
      }
      days.push({
        date: dateStr,
        capacityMinutes: Math.round(capacity),
        loadMinutes: Math.round(load),
        utilizationPct: capacity > 0 ? Number(((load / capacity) * 100).toFixed(1)) : (load > 0 ? 999 : 0),
        overloadMinutes: Math.max(0, Math.round(load - capacity))
      });
    }
    const totalCap = days.reduce((s, d) => s + d.capacityMinutes, 0);
    const totalLoad = days.reduce((s, d) => s + d.loadMinutes, 0);
    results.push({
      workCenterId: wc.id, code: wc.code, name: wc.name,
      capacityUnits: wc.capacity_units, hourlyRate: wc.hourly_rate,
      totalCapacityMinutes: totalCap, totalLoadMinutes: totalLoad,
      utilizationPct: totalCap > 0 ? Number(((totalLoad / totalCap) * 100).toFixed(1)) : 0,
      overloadedDays: days.filter(d => d.overloadMinutes > 0).length,
      days
    });
  }
  return results;
}

/**
 * T10: sonlu kapasite. İş merkezinde `capacity_units` kadar paralel hat
 * vardır; yeni operasyon, mevcut rezervasyonlarla aynı anda en fazla
 * (hat − 1) çakışma olan ilk çalışma aralığına yerleşir. Aday başlangıçlar:
 * en erken an ve mevcut rezervasyonların bitişleri (bir hat ancak o anlarda
 * boşalır). Ufuk içinde yer yoksa 409.
 */
function findSlot(workCenterId, earliestMs, neededMinutes, horizonDays = 365, { excludeOrderId = null, cache = new Map() } = {}) {
  const wc = db.prepare('SELECT * FROM work_centers WHERE id = ?').get(workCenterId);
  if (!wc || !wc.is_active) throw new AppError('İş merkezi bulunamadı veya pasif / Work centre not found or inactive', 422);
  const units = Math.max(1, wc.capacity_units || 1);
  const booked = bookings(workCenterId, excludeOrderId);
  const candidates = [earliestMs, ...booked.map(b => b.end).filter(t => t > earliestMs)].sort((a, b) => a - b);
  for (const candidate of candidates) {
    const slot = spanFrom(wc, candidate, neededMinutes, horizonDays, cache);
    if (!slot) break;
    if (slot.end === slot.start || maxOverlap(booked, slot.start, slot.end) < units) return slot;
  }
  throw new AppError(
    `İş merkezinde ${horizonDays} gün içinde yeterli kapasite bulunamadı / No capacity found within ${horizonDays} days`, 409);
}

/**
 * Üretim emrini rotasına göre çizelgeler.
 * Operasyonlar sıralıdır: bir sonraki, bir öncekinin bitişinden ve bekleme
 * süresinden sonra başlar. Her operasyon kendi iş merkezinin boş kapasitesine oturur.
 * @param {number|string} orderId
 * @param {{ startFrom?: number|string }} [options]
 */
function scheduleOrder(orderId, { startFrom } = {}) {
  const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(orderId);
  if (!order) throw new AppError('Üretim emri bulunamadı / Production order not found', 404);
  if (order.status === 'Tamamlandı') throw new AppError('Tamamlanmış emir çizelgelenemez / Cannot schedule a completed order', 409);

  let ops = db.prepare('SELECT * FROM production_operations WHERE production_order_id = ? ORDER BY operation_no').all(orderId);

  // Emirde operasyon yoksa rotadan kopyalanır. Kopya alınır çünkü rota sonradan
  // değişse bile bu emrin planı sabit kalmalıdır.
  if (!ops.length) {
    const routing = db.prepare(`SELECT r.*, wc.name AS wc_name FROM routings r
      JOIN work_centers wc ON wc.id = r.work_center_id
      WHERE r.item_id = ? ORDER BY r.operation_no`).all(order.item_id);
    if (!routing.length) {
      throw new AppError('Bu mamul için rota tanımlı değil / No routing defined for this item', 400);
    }
    const ins = db.prepare(`INSERT INTO production_operations
      (production_order_id,operation_no,operation_name,work_center_id,work_center_name,
       planned_setup_minutes,planned_run_minutes,status)
      VALUES (?,?,?,?,?,?,?, 'planned')`);
    routing.forEach(r => {
      // Fire payı: bir sonraki operasyona sağlam parça gitmesi için fazladan üretilir
      const qty = order.qty * (1 + (r.scrap_pct || 0) / 100);
      ins.run(orderId, r.operation_no, r.operation_name, r.work_center_id, r.wc_name,
        r.setup_minutes, qty * r.run_minutes_per_unit);
    });
    ops = db.prepare('SELECT * FROM production_operations WHERE production_order_id = ? ORDER BY operation_no').all(orderId);
  }

  if (order.status === 'İptal Edildi') throw new AppError('İptal edilmiş emir çizelgelenemez / Cannot schedule a cancelled order', 409);
  // Yeniden çizelgelemede emrin kendi eski rezervasyonları kapasiteyi işgal etmez.
  db.prepare(`UPDATE production_operations SET planned_start = NULL, planned_end = NULL
    WHERE production_order_id = ? AND status NOT IN ('completed','in_progress')`).run(orderId);
  let cursor = startFrom ? new Date(`${startFrom}T00:00:00`).getTime() : Date.now();
  const cache = new Map();
  const scheduled = [];
  for (const op of ops) {
    if (op.status === 'completed' || op.status === 'in_progress') {
      scheduled.push(op);
      cursor = Math.max(cursor, op.planned_end || op.actual_end || cursor);
      continue;
    }
    const needed = (op.planned_setup_minutes || 0) + (op.planned_run_minutes || 0);
    const slot = findSlot(op.work_center_id, cursor, needed, 365, { excludeOrderId: orderId, cache });
    db.prepare('UPDATE production_operations SET planned_start = ?, planned_end = ? WHERE id = ?')
      .run(slot.start, slot.end, op.id);
    scheduled.push({ ...op, planned_start: slot.start, planned_end: slot.end });

    // Bekleme/taşıma süresi kapasite tüketmez ama sonraki operasyonu geciktirir
    const routing = db.prepare('SELECT queue_minutes FROM routings WHERE item_id = ? AND operation_no = ?')
      .get(order.item_id, op.operation_no);
    cursor = slot.end + ((routing && routing.queue_minutes) || 0) * MIN;
  }

  const plannedStart = scheduled[0].planned_start;
  const plannedEnd = scheduled[scheduled.length - 1].planned_end;
  db.prepare('UPDATE production_orders SET planned_start = ?, planned_end = ? WHERE id = ?')
    .run(plannedStart, plannedEnd, orderId);

  // Termin varsa gecikme burada görülür — plan yapmanın asıl amacı budur.
  const dueMs = order.due_date ? new Date(order.due_date + 'T23:59:59').getTime() : null;
  return {
    orderId, plannedStart, plannedEnd,
    dueDate: order.due_date || null,
    isLate: dueMs ? plannedEnd > dueMs : false,
    lateDays: dueMs && plannedEnd > dueMs ? Math.ceil((plannedEnd - dueMs) / DAY_MS) : 0,
    operations: scheduled.map(o => ({
      id: o.id, operationNo: o.operation_no, operationName: o.operation_name,
      workCenterId: o.work_center_id, workCenterName: o.work_center_name,
      plannedStart: o.planned_start, plannedEnd: o.planned_end,
      plannedMinutes: Math.round((o.planned_setup_minutes || 0) + (o.planned_run_minutes || 0))
    }))
  };
}

/**
 * OEE (Toplam Ekipman Etkinliği) = Kullanılabilirlik × Performans × Kalite.
 * Vardiya kayıtlarından hesaplanır; üç bileşen ayrı ayrı da gösterilir çünkü
 * tek bir yüzde nerede kaybedildiğini söylemez.
 */
function oee({ from, to, workCenterId = null }) {
  let sql = `SELECT sl.*, wc.name AS wc_name, wc.code AS wc_code, s.name AS shift_name
    FROM shift_logs sl
    JOIN work_centers wc ON wc.id = sl.work_center_id
    JOIN shifts s ON s.id = sl.shift_id
    WHERE sl.date BETWEEN ? AND ?`;
  const params = [from, to];
  if (workCenterId) { sql += ' AND sl.work_center_id = ?'; params.push(workCenterId); }
  const logs = db.prepare(sql + ' ORDER BY sl.date').all(...params);

  const byCenter = {};
  logs.forEach(l => {
    const k = l.work_center_id;
    byCenter[k] = byCenter[k] || {
      workCenterId: k, code: l.wc_code, name: l.wc_name,
      planned: 0, worked: 0, downtime: 0, produced: 0, scrap: 0, shifts: 0
    };
    const b = byCenter[k];
    b.planned += l.planned_minutes; b.worked += l.worked_minutes;
    b.downtime += l.downtime_minutes; b.produced += l.produced_qty;
    b.scrap += l.scrap_qty; b.shifts++;
  });

  const data = Object.values(byCenter).map(b => {
    // Kullanılabilirlik: planlanan sürenin ne kadarında gerçekten çalışıldı
    const availability = b.planned > 0 ? (b.worked / b.planned) * 100 : 0;
    // Kalite: üretilenin ne kadarı sağlam çıktı
    const total = b.produced + b.scrap;
    const quality = total > 0 ? (b.produced / total) * 100 : 100;
    // Performans burada duruş dışı sürenin verimli kullanımı olarak alınır;
    // ideal çevrim süresi verisi olmadığı için yaklaşık bir göstergedir.
    const performance = b.worked > 0 ? Math.min(100, ((b.worked - b.downtime) / b.worked) * 100) : 0;
    return {
      ...b,
      availabilityPct: Number(availability.toFixed(1)),
      performancePct: Number(performance.toFixed(1)),
      qualityPct: Number(quality.toFixed(1)),
      oeePct: Number(((availability / 100) * (performance / 100) * (quality / 100) * 100).toFixed(1))
    };
  });

  return { from, to, data };
}

module.exports = { availableMinutes, capacityLoad, findSlot, scheduleOrder, oee, shiftMinutes, workingIntervals, maxOverlap };
