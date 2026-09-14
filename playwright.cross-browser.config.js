// @ts-nocheck
/**
 * Tarayıcı uyumluluğu doğrulaması — AYNI test/e2e-browser paketini gerçek
 * Firefox (Gecko) ve WebKit (Safari) motorlarına karşı çalıştırır.
 *
 * playwright.config.js'in varsayılan projesi bilerek yalnızca Chromium'dur
 * (hızlı, kararlı günlük CI). Bu dosya AYRI tutulur çünkü:
 *   - Firefox/WebKit motorlarının yerel makinede kurulu olması gerekir
 *     (npx playwright install firefox webkit) — her geliştirici ortamında
 *     bulunmayabilir.
 *   - WebKit'in bazı ağ emülasyonu (context.setOffline) davranışları
 *     Chromium'dan farklıdır — bu farkı burada AYRICA gözlemlemek istiyoruz,
 *     varsayılan koşuyu yavaşlatıp kırılganlaştırmadan.
 *
 * Çalıştırma:  npx playwright test --config=playwright.cross-browser.config.js
 */
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/e2e-browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: {
    command: 'node test/e2e-browser/reset-and-start.js',
    url: 'http://localhost:3000/health',
    reuseExistingServer: false,
    env: { ...process.env, DEMO_DATA: '1' },
    timeout: 30000,
    stdout: 'pipe'
  }
});
