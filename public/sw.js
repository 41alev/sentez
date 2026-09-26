/**
 * Kaldırılmış Depo Terminali (mobil PWA) için "kapatma" service worker'ı.
 *
 * 26 Eylül 2026'da mobil el terminali ürün kapsamından çıkarıldı (masaüstü
 * web kararı). Daha önce terminali açmış tarayıcılarda eski worker kayıtlı
 * kalabilir ve eski önbellekten dosya sunmaya devam edebilirdi. Tarayıcı bir
 * sonraki güncelleme denetiminde bu dosyayı alır: önbellekleri siler, kendi
 * kaydını kaldırır ve açık sekmeleri yeniden yükler. Hiçbir isteğe
 * `respondWith` ile karışmaz; tüm trafik normal ağdan gider.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
