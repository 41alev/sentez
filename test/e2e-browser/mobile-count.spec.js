// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login: desktopLogin, goToView } = require('./helpers');

/**
 * Regresyon testi: server/routes/mobile.js'teki POST /mobile/sync 'count_line'
 * işleyicisi `UPDATE stock_count_lines SET counted_qty = ?, counted_at = ? ...`
 * çalıştırıyordu — ama stock_count_lines tablosunda (001_initial_schema.js)
 * counted_at diye bir sütun HİÇ YOK. Bu yüzden Depo Terminali'nde bir sayım
 * satırı okutulup miktar onaylandığında istek HER ZAMAN "no such column:
 * counted_at" hatasıyla sessizce başarısız oluyordu (mobil arayüz genel bir
 * hata toast'ı gösteriyordu ama kullanıcı bunu geçici bir ağ sorunu sanabilirdi
 * — asıl neden hiçbir zaman düzelmeyecek bir sunucu hatasıydı). Düzeltme,
 * masaüstünün PUT /counts/:id/lines (server/routes/stock.js:248) ile aynı
 * deseni kullanıyor: counted_qty VE difference (= counted_qty - system_qty)
 * güncelleniyor, counted_at hiç yazılmıyor.
 */
test.describe('Depo Terminali — Sayım gerçekten sunucuya kaydediyor', () => {
  test('mobilde sayılan bir kalem sunucuya yazılıyor (no such column hatası değil)', async ({ page }) => {
    // Test verisine bağımlı olmamak için önce masaüstünden taze bir sayım açılır.
    await desktopLogin(page);
    await goToView(page, 'counts');
    await page.click('#view-counts button:has-text("Yeni Sayım")');
    await page.waitForSelector('#nGo');
    await page.click('#nGo');
    await expect(page.locator('.toast.ok, .toast.show')).toBeVisible({ timeout: 10000 });

    await page.goto('/mobile.html');
    await page.fill('#mUser', 'operator');
    await page.fill('#mPass', 'Operator123!');
    await page.click('#mLoginBtn');
    await expect(page.locator('#mApp')).toBeVisible({ timeout: 10000 });

    await page.click('[data-go="countList"]');
    // En son açılan (dolayısıyla 0/N olan, henüz sayılmamış) sayımı seç.
    await page.locator('[data-count]').first().click();
    await expect(page.locator('#mMain')).toBeVisible({ timeout: 10000 });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/mobile/sync') && r.request().method() === 'POST'),
      (async () => {
        await page.locator('[data-cl]').first().click();
        await page.click('[data-act="0"]');
      })()
    ]);

    const body = await response.json();
    // Eskiden HER ZAMAN failed:1, error "no such column: counted_at" dönüyordu.
    expect(body.failed).toBe(0);
    expect(body.succeeded).toBe(1);
  });
});
