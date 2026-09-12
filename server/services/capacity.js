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

const MIN = 60000;
const DAY_MS = 86400000;

/**
 * Bir zaman damgasını YEREL takvim gününe çevirir.
 *
 * Kasıtlı olarak toISOString() KULLANILMAZ: bu fonksiyonun ürettiği string,
 * bu dosyada başka yerlerde `new Date(dateStr + 'T00:00:00')` ve
 * `new Date(dateStr + 'T12:00:00')` ile YEREL saat olarak geri parse ediliyor.
 * toISOString() UTC döndürdüğü için, UTC'nin doğusundaki saat dilimlerinde
 * (ör. Türkiye, UTC+3) bu ikisi arasında gün kayması oluşuyordu: findSlot()
 * bir sonraki güne geçtiğini sanıp aslında AYNI günü tekrar üretiyor ve
 * ufuk (180 gün) boyunca hiç ilerlemeden "kapasite bulunamadı" hatası
 * veriyordu — iş merkezi, vardiya, tatil fark etmeksizin HER ZAMAN.
 * Yerel tarih bileşenleriyle üretmek bu tutarsızlığı ortadan kaldırır.
 */
const toDateStr = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
/** JS'te Pazar 0'dır; ISO'da Pazartesi 1, Pazar 7. */
const isoWeekday = (d) => { const w = new Date(d).getDay(); return w === 0 ? 7 : w; };

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

  const weekday = isoWeekday(dateStr + 'T12:00:00');
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

/** Bir tarih aralığında iş merkezi bazında kapasite ve yük. */
function capacityLoad({ from, to, workCenterId = null }) {
  const start = new Date(from + 'T00:00:00').getTime();
  const end = new Date(to + 'T00:00:00').getTime();
  if (!(end >= start)) throw new AppError('Geçersiz tarih aralığı / Invalid date range', 400);

  const centers = workCenterId
    ? db.prepare('SELECT * FROM work_centers WHERE id = ? AND is_active = 1').all(workCenterId)
    : db.prepare('SELECT * FROM work_centers WHERE is_active = 1 ORDER BY code').all();

  const results = [];
  for (const wc of centers) {
    const days = [];
    for (let t = start; t <= end; t += DAY_MS) {
      const dateStr = toDateStr(t);
      const capacity = availableMinutes(wc.id, dateStr);

      // O güne planlanmış operasyonların yükü
      const dayStart = new Date(dateStr + 'T00:00:00').getTime();
      const dayEnd = dayStart + DAY_MS;
      const load = db.prepare(`SELECT COALESCE(SUM(planned_setup_minutes + planned_run_minutes),0) m
        FROM production_operations
        WHERE work_center_id = ? AND status NOT IN ('completed','cancelled')
          AND planned_start >= ? AND planned_start < ?`).get(wc.id, dayStart, dayEnd).m;

      days.push({
        date: dateStr,
        capacityMinutes: Math.round(capacity),
        loadMinutes: Math.round(load),
        utilizationPct: capacity > 0 ? Number(((load / capacity) * 100).toFixed(1)) : (load > 0 ? 999 : 0),
        // Kapasitenin üstündeki yük: bu iş o gün bitmez, kaymak zorundadır
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
 * Bir iş merkezinde, verilen andan itibaren istenen dakikayı sığdırabilecek
 * ilk zaman aralığını bulur. Kapasitesi dolu günleri atlar.
 * Sonsuz döngüye girmemek için ufuk sınırlıdır.
 */
function findSlot(workCenterId, earliestMs, neededMinutes, horizonDays = 180) {
  let cursor = earliestMs;
  let remaining = neededMinutes;
  let scheduledStart = null;

  for (let i = 0; i < horizonDays && remaining > 0.01; i++) {
    const dateStr = toDateStr(cursor);
    const capacity = availableMinutes(workCenterId, dateStr);
    if (capacity <= 0) { cursor = new Date(dateStr + 'T00:00:00').getTime() + DAY_MS; continue; }

    const dayStart = new Date(dateStr + 'T00:00:00').getTime();
    const dayEnd = dayStart + DAY_MS;
    const used = db.prepare(`SELECT COALESCE(SUM(planned_setup_minutes + planned_run_minutes),0) m
      FROM production_operations
      WHERE work_center_id = ? AND status NOT IN ('completed','cancelled')
        AND planned_start >= ? AND planned_start < ?`).get(workCenterId, dayStart, dayEnd).m;

    const free = capacity - used;
    if (free <= 0.01) { cursor = dayEnd; continue; }

    if (scheduledStart === null) scheduledStart = Math.max(cursor, dayStart);
    const take = Math.min(free, remaining);
    remaining -= take;
    if (remaining > 0.01) cursor = dayEnd;
    else cursor = Math.max(cursor, dayStart) + take * MIN;
  }

  if (remaining > 0.01) {
    throw new AppError(
      `İş merkezinde ${horizonDays} gün içinde yeterli kapasite bulunamadı / No capacity found within ${horizonDays} days`, 409);
  }
  return { start: scheduledStart, end: cursor };
}

/**
 * Üretim emrini rotasına göre çizelgeler.
 * Operasyonlar sıralıdır: bir sonraki, bir öncekinin bitişinden ve bekleme
 * süresinden sonra başlar. Her operasyon kendi iş merkezinin boş kapasitesine oturur.
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

  let cursor = startFrom ? new Date(startFrom).getTime() : Date.now();
  const scheduled = [];
  for (const op of ops) {
    const needed = (op.planned_setup_minutes || 0) + (op.planned_run_minutes || 0);
    const slot = findSlot(op.work_center_id, cursor, needed);
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

module.exports = { availableMinutes, capacityLoad, findSlot, scheduleOrder, oee, shiftMinutes };
