// @ts-nocheck
/**
 * PWA/çevrimdışı altyapısı testleri (Aşama 6).
 *
 * Kapsam: manifest + service worker + simgelerin gerçekten servis edildiği
 * ve doğru içerikte olduğu, service worker'ın önbellek listesinin API
 * çağrılarını HİÇ içermediği (aksi halde masaüstü/API verisi bayatlaşırdı —
 * bkz. sw.js'teki tasarım notu), ve CSP'nin service worker kaydını
 * engellemediği (Aşama 5'te Swagger UI'ı CSP'nin sessizce engellediği
 * gerçek bir hata bulunmuştu — aynı sınıftan bir regresyonu burada da
 * doğrudan test ediyoruz). IndexedDB tabanlı kuyruk/yükseltme mantığı
 * test/mobile.js'in ARAYÜZ bölümünde jsdom ile ayrıca test ediliyor.
 *
 * Sunucu ÇALIŞIYOR olmalı (test/run-all.js ile izole çalıştırılır).
 *
 *   node test/pwa.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

(async () => {
  console.log('\n=== MANIFEST ===');
  const mRes = await fetch(BASE + '/manifest.webmanifest');
  ok('manifest kimlik doğrulamasız erişilebiliyor (200)', mRes.status === 200);
  const manifest = await mRes.json();
  ok('start_url mobil terminale işaret ediyor', manifest.start_url === '/mobile.html');
  ok('display standalone (kurulabilir)', manifest.display === 'standalone');
  ok('en az iki simge boyutu tanımlı (192 ve 512)',
    Array.isArray(manifest.icons) && manifest.icons.some(i => i.sizes === '192x192')
    && manifest.icons.some(i => i.sizes === '512x512'));
  ok('simge yolları gerçekten /icons altında', manifest.icons.every(i => i.src.startsWith('/icons/')));
  ok('tema rengi tanımlı', typeof manifest.theme_color === 'string' && manifest.theme_color.length > 0);

  console.log('\n=== SERVICE WORKER ===');
  const swRes = await fetch(BASE + '/sw.js');
  ok('sw.js servis ediliyor (200)', swRes.status === 200);
  const swText = await swRes.text();
  ok('JS içerik tipi', (swRes.headers.get('content-type') || '').includes('javascript'));

  const shellMatch = /SHELL_URLS\s*=\s*\[([\s\S]*?)\]/.exec(swText);
  ok('önbellek listesi (SHELL_URLS) bulunabiliyor', !!shellMatch);
  const shellList = shellMatch ? shellMatch[1] : '';
  ok('terminal sayfası önbellek listesinde', shellList.includes('/mobile.html'));
  ok('terminal betiği ve IndexedDB modülü önbellek listesinde',
    shellList.includes('/js/mobile.js') && shellList.includes('/js/mobile-db.js'));
  ok('ÖNBELLEK LİSTESİ HİÇ /api YOLU İÇERMİYOR (en kritik kontrol — API verisi asla bayatlamamalı)',
    !shellList.includes('/api'));
  ok('fetch işleyicisi API isteklerine dokunmuyor (yalnızca ağa bırakıyor)',
    /!isMobileShell\s*&&\s*!isMobileNav\)\s*return;/.test(swText),
    'API/masaüstü istekleri respondWith olmadan ağa gitmeli');
  ok('eski önbellek sürümleri activate\'te temizleniyor', /caches\.delete/.test(swText));

  console.log('\n=== SİMGELER ===');
  for (const [path, minBytes] of [['/icons/icon-192.png', 500], ['/icons/icon-512.png', 500], ['/icons/apple-touch-icon.png', 500]]) {
    const r = await fetch(BASE + path);
    ok(`${path} servis ediliyor (200)`, r.status === 200);
    ok(`${path} PNG içerik tipi`, (r.headers.get('content-type') || '').includes('image/png'));
    const buf = Buffer.from(await r.arrayBuffer());
    ok(`${path} geçerli bir PNG (sihirli bayt eşleşiyor)`, buf.subarray(0, 8).equals(PNG_MAGIC));
    ok(`${path} boş/bozuk değil (>${minBytes} bayt)`, buf.length > minBytes, `${buf.length} bayt`);
  }

  console.log('\n=== TERMİNAL SAYFASI KABLOLAMASI / MOBILE.HTML WIRING ===');
  const htmlRes = await fetch(BASE + '/mobile.html');
  const html = await htmlRes.text();
  ok('manifest bağlantısı var', /<link rel="manifest" href="\/manifest\.webmanifest">/.test(html));
  ok('apple-touch-icon bağlantısı var (iOS ana ekrana ekleme)', /apple-touch-icon/.test(html));
  ok('mobile-db.js, mobile.js\'DEN ÖNCE yükleniyor (sıra önemli — MobileDB tanımlı olmalı)',
    html.indexOf('js/mobile-db.js') > -1 && html.indexOf('js/mobile-db.js') < html.indexOf('js/mobile.js'));

  console.log('\n=== CSP UYUMLULUĞU / CSP COMPATIBILITY ===');
  // Aşama 5'te Swagger UI'ın CSP tarafından sessizce engellendiği gerçek bir
  // hata bulunmuştu (bkz. PROJECT_STATUS.md) — service worker kaydı için
  // aynı sınıftan bir regresyonu burada doğrudan kontrol ediyoruz: worker-src
  // özel olarak tanımlıysa 'self' içermeli, tanımlı değilse default-src
  // zaten 'self' içerdiği için worker kaydı serbesttir.
  const csp = htmlRes.headers.get('content-security-policy') || '';
  const workerSrcMatch = /worker-src\s+([^;]+)/.exec(csp);
  ok('CSP service worker kaydını engellemiyor',
    !workerSrcMatch || workerSrcMatch[1].includes("'self'"),
    csp);
  ok('CSP manifest servisini engellemiyor (default-src veya manifest-src \'self\' içeriyor)',
    csp.includes("default-src 'self'") || /manifest-src\s+[^;]*'self'/.test(csp));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  console.log('\nNot: Gerçek bir tarayıcıda kurulum/çevrimdışı açılış denenmedi — bu paket');
  console.log('yalnızca sunucu tarafı servis edilen dosyaları ve statik sw.js/manifest');
  console.log('içeriğini doğrular. Gerçek "Add to Home Screen" ve çevrimdışı yeniden');
  console.log('açılış Browser panelinde ayrıca elle doğrulanmalı.');
  process.exitCode = fail ? 1 : 0; // process.exit() Windows'ta fetch handle'larıyla nadir bir libuv crash'ine yol açabiliyor
})();
