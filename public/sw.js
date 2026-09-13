/**
 * Depo Terminali için service worker.
 *
 * Kapsamı `/` olsa da (script kök dizinde servis edildiği için tarayıcı
 * varsayılan olarak böyle veriyor) bilinçli olarak YALNIZCA aşağıdaki
 * SHELL_URLS listesindeki dosyaları ve `/mobile.html` sayfasını önbellekler.
 * Masaüstü arayüzü (`/`, `/index.html`, `/api/...`) ve tüm API çağrıları bu
 * worker'a hiç uğramaz — fetch olayı bunlar için `respondWith` çağırmaz,
 * istek tarayıcının normal ağ davranışına bırakılır. Bu, terminalin
 * çevrimdışı çalışabilmesini sağlarken masaüstü uygulamasının her zaman
 * canlı veriyle çalışmasını garanti eder.
 *
 * Sürüm notu: SHELL_URLS'teki dosyalardan biri değiştiğinde CACHE_NAME'in
 * sürüm numarası artırılmalı — aksi halde kullanıcılar eski önbellekten
 * servis edilmeye devam eder (activate aşamasında eski sürümler silinir).
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `depo-terminal-${CACHE_VERSION}`;

const SHELL_URLS = [
  '/mobile.html',
  '/css/mobile.css',
  '/js/mobile.js',
  '/js/mobile-db.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

/** Sayfa gövdesi: mümkünse hep TAZE sürüm, yalnızca ağ yoksa önbellekten. */
async function networkFirst(request, cacheKey) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw new Error('çevrimdışı ve önbellekte kayıt yok');
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;      // dış kaynak — karışma
  if (event.request.method !== 'GET') return;            // yalnızca GET önbelleklenir

  const isMobileShell = SHELL_URLS.includes(url.pathname);
  const isMobileNav = event.request.mode === 'navigate' && url.pathname === '/mobile.html';
  if (!isMobileShell && !isMobileNav) return;             // API + masaüstü: dokunulmaz, ağa gider

  event.respondWith(
    isMobileNav ? networkFirst(event.request, '/mobile.html') : cacheFirst(event.request)
  );
});
