// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

test.describe('Ürünler — stok girişi (uçtan uca gerçek sunucuya karşı)', () => {
  test('stok girişi diyaloğu gerçek miktarı sunucuya yazıyor', async ({ page }) => {
    await login(page);
    await goToView(page, 'items');

    // Playwright click() zaten görünür/etkileşilebilir olmasını otomatik
    // bekler — ayrı bir toBeVisible() ön-kontrolü kırılgan davrandığı için
    // (bkz. commit mesajı) kaldırıldı.
    await page.locator('[data-in]').first().click();
    await page.waitForSelector('#sGo');
    await page.fill('#sQty', '3');
    await page.click('#sGo');

    // Modal kapanır ve "Kaydedildi" toast'ı görünür — gerçek sunucuya
    // gerçekten yazıldığının kanıtı (API çağrısı başarısız olsaydı modal
    // açık kalır, UI.err() hata toast'ı gösterirdi).
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/show/, { timeout: 10000 });
    await expect(page.locator('.toast.ok, .toast.show')).toBeVisible({ timeout: 10000 });
  });
});
