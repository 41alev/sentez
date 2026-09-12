const path = require('path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

/**
 * React'e kademeli (strangler-fig) geçiş — Faz 1.
 *
 * Bu, tam bir SPA build'i DEĞİL: mevcut `public/index.html` (elle bakımı
 * yapılan gerçek giriş noktası) hiç değişmiyor. Vite yalnızca
 * `frontend-react/` içindeki React bileşenlerini TEK bir dosyaya
 * (`public/dist/react-views.js`) derliyor; bu dosya index.html'e AYNI
 * KONUMDA, eski `views/dashboard.js`'nin yerine, DÜZ (classic) bir
 * `<script src="...">` olarak eklenir — `type="module"` KULLANILMAZ.
 * Neden: modül script'leri tarayıcıda otomatik ertelenir (defer) ve TÜM
 * düz script'lerden (app.js dahil) SONRA çalışır; `app.js` VIEWS nesnesini
 * `window.ViewDashboard`'ı modül-değerlendirme anında okuyarak kurduğu
 * için, ertelenmiş bir modül henüz o global'i tanımlamadan app.js
 * çalışırdı ve `VIEWS.dashboard` `undefined` kalırdı. IIFE (düz script)
 * çıktısı, eski dashboard.js ile BİREBİR AYNI yükleme sırası
 * garantisini korur — app.js'ye hiç dokunmaya gerek kalmaz.
 *
 * Geliştirme: Vite'ın HMR dev sunucusu (ayrı bir origin + proxy) bu ilk
 * fazda kasıtlı olarak kurulmadı — `npm run build:watch` (vite build
 * --watch) dosya değişikliğinde yeniden derler, Express üzerinden servis
 * edilen sayfa elle yenilenir. Tam geçişe karar verilirse bu adım
 * eklenir.
 */
module.exports = defineConfig({
  plugins: [react()],
  // Vite'ın statik dosya kopyalama özelliği kapatıldı: tek çıktımız
  // (react-views.js) zaten build.outDir'e yazılıyor, kopyalanacak ayrı bir
  // "public assets" klasörü yok. Kapatılmazsa Vite `outDir` (public/dist)
  // ile örtüşen `public/`u kopyalamaya çalışıp uyarı veriyordu.
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'frontend-react/main.jsx'),
      output: {
        entryFileNames: 'react-views.js',
        format: 'iife'
      }
    }
  }
});
