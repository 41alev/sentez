/**
 * server/lib/dates.js için odaklı birim testleri.
 *
 * Bu modül, `capacity.js`'de bulunan gerçek üretim hatasının (UTC üretilip
 * yerel saat olarak geri okunan tarih string'i, UTC+3'te findSlot()'u sonsuz
 * döngüye sokuyordu) bir daha başka bir dosyada kopyalanmaması için
 * yazıldı. Buradaki testler gün sınırı, ay/yıl geçişi ve artık yıl gibi
 * durumları doğrudan doğrular — sunucu gerektirmez.
 *
 *   node test/dates.js
 */
const { toLocalDateStr, today, isValidLocalDate, addDays, isoWeekday, daysBetween, DAY_MS } = require('../server/lib/dates');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

console.log('\n=== toLocalDateStr / today ===');
ok('today() YYYY-MM-DD biçiminde', /^\d{4}-\d{2}-\d{2}$/.test(today()));
{
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  ok('today() yerel takvim gününü veriyor', today() === expected, `${today()} vs ${expected}`);
}
ok('toLocalDateStr belirli bir zaman damgasını doğru çeviriyor',
  toLocalDateStr(new Date(2026, 0, 15, 3, 0, 0).getTime()) === '2026-01-15');
ok('artık yıl günü geçerli', isValidLocalDate('2028-02-29'));
ok('olmayan takvim günü reddediliyor', !isValidLocalDate('2026-02-30'));
ok('yanlış biçim reddediliyor', !isValidLocalDate('20.09.2026'));

console.log('\n=== addDays — gün/ay/yıl sınırları ===');
ok('bir gün ekleme', addDays('2026-09-12', 1) === '2026-09-13');
ok('bir gün çıkarma', addDays('2026-09-12', -1) === '2026-09-11');
ok('ay sonu geçişi', addDays('2026-01-31', 1) === '2026-02-01');
ok('yıl sonu geçişi', addDays('2026-12-31', 1) === '2027-01-01');
ok('artık yıl — 29 Şubat', addDays('2028-02-28', 1) === '2028-02-29', '2028 artık yıl');
ok('artık olmayan yıl — Şubat 28 gün', addDays('2026-02-28', 1) === '2026-03-01', '2026 artık yıl değil');
ok('0 gün ekleme aynı tarihi veriyor', addDays('2026-09-12', 0) === '2026-09-12');
ok('180 gün ileri makul bir tarih veriyor', addDays('2026-09-12', 180) === '2027-03-11');

console.log('\n=== isoWeekday ===');
// 2026-09-14 Pazartesi, 2026-09-19/20 hafta sonu (bkz. PROJECT_STATUS doğrulama notları)
ok('Pazartesi → 1', isoWeekday('2026-09-14') === 1);
ok('Cuma → 5', isoWeekday('2026-09-18') === 5);
ok('Cumartesi → 6', isoWeekday('2026-09-19') === 6);
ok('Pazar → 7 (JS\'in 0\'ı değil)', isoWeekday('2026-09-20') === 7);

console.log('\n=== daysBetween ===');
ok('ardışık günler arasında 1 gün', daysBetween('2026-09-12', '2026-09-13') === 1);
ok('aynı gün için 0', daysBetween('2026-09-12', '2026-09-12') === 0);
ok('geriye doğru negatif', daysBetween('2026-09-13', '2026-09-12') === -1);
ok('ay sınırı üzerinden doğru fark', daysBetween('2026-01-31', '2026-02-01') === 1);

console.log('\n=== round-trip tutarlılığı (asıl bulunan hatanın regresyon testi) ===');
// findSlot()'taki hata: bir günün "capacity<=0" dalında `toDateStr(dateStr+'T00:00:00' + 1 gün)`
// hesaplanıp AYNI tarihi tekrar üretiyordu. addDays'in kendisi bunu bir daha
// asla yapmamalı: N kez +1 gün eklemek, N gün sonrasının tarihine eşit olmalı.
{
  let cursor = '2026-09-12';
  const seen = new Set([cursor]);
  let stuck = false;
  for (let i = 0; i < 10; i++) {
    const next = addDays(cursor, 1);
    if (next === cursor) { stuck = true; break; }
    if (seen.has(next)) { stuck = true; break; }
    seen.add(next);
    cursor = next;
  }
  ok('ardışık +1 gün ilerlemesi asla aynı günde takılmıyor', !stuck && cursor === '2026-09-22',
    `son ulaşılan: ${cursor}, takıldı mı: ${stuck}`);
}

console.log('\n====================================================');
console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
console.log('====================================================');
if (fail) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail > 0 ? 1 : 0);
