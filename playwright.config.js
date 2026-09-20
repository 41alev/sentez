// @ts-nocheck
/**
 * Gerçek tarayıcı E2E testleri — jsdom'un YAKALAYAMADIĞI hata sınıfını
 * (gerçek CSS cascade, gerçek layout, gerçek tıklama) kapatmak için.
 * Aşama 6'da public/css/mobile.css'teki `[hidden]{display:none}`
 * eksikliği (kamera görünümünün giriş ekranını kapatması) YALNIZCA gerçek
 * bir tarayıcıda ortaya çıkmıştı — jsdom testleri bunu hiç göremezdi. Bu
 * paket, en kritik ekranlarda AYNI SINIF regresyonu otomatik yakalar.
 *
 * test/run-all.js'in "her paket taze veritabanı ister" disipliniyle
 * tutarlı: webServer.command veritabanını SUNUCUYU BAŞLATAN AYNI process
 * içinde, ondan hemen önce siler (bkz. reset-and-start.js) — ayrı bir
 * globalSetup ile webServer arasındaki başlatma sırası garanti değil.
 */
const { defineConfig, devices } = require('@playwright/test');
const baseURL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '3301'}`;

module.exports = defineConfig({
  testDir: './test/e2e-browser',
  timeout: 30000,
  fullyParallel: false,   // paylaşılan tek veritabanı — paralel testler birbirine karışır
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node test/e2e-browser/reset-and-start.js',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    // Bu paket büyüdükçe (33+ test, her biri login + birden çok API çağrısı
    // tetikliyor) tüm koşu genel `apiLimiter`ın dakikalık 300 istek
    // varsayılanını aşabiliyor — bkz. test/run-all.js'teki SUITE_ENV_OVERRIDES
    // `load` girişiyle AYNI sebep/desen. Üretimdeki gerçek sınırı DEĞİŞTİRMEZ,
    // yalnızca bu test sunucusu örneğini gevşetir.
    env: { ...process.env, DEMO_DATA: '1', API_RATE_LIMIT: '200000' },
    timeout: 30000,
    stdout: 'pipe'
  }
});
