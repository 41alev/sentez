// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

/**
 * Genel arama (global search) — kenar çubuğundaki tek kutudan ürün, müşteri,
 * tedarikçi, satış/satın alma siparişi ve parti aranabiliyor (bkz.
 * server/routes/search.js, public/js/app.js initGlobalSearch). Sonuca
 * tıklamak yalnızca doğru EKRANA götürür (o ekranın kendi sekmesini/kaydını
 * otomatik açmaz) — kasıtlı olarak dar tutulan bir kapsam, bkz. app.js'teki
 * GS_GROUPS yorumu.
 */
test.describe('Genel arama — kenar çubuğundaki arama kutusu', () => {
  test('müşteri araması gerçek sonuç gösterip doğru ekrana götürüyor', async ({ page }) => {
    await login(page);
    await page.fill('#gsInput', 'Anadolu');
    const result = page.locator('.gs-item', { hasText: 'Anadolu Makine A.Ş.' });
    await expect(result).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.gs-group-title').first()).toHaveText('Müşteriler');
    await result.click();
    await expect(page.locator('#view-sales.active .topbar')).toBeVisible({ timeout: 10000 });
    // Arama kutusu sonrasında temizlenip kapanmalı.
    await expect(page.locator('#gsInput')).toHaveValue('');
    await expect(page.locator('#gsResults')).toBeHidden();
  });

  test('ürün araması ve parti araması gerçek verilerle sonuç veriyor', async ({ page }) => {
    await login(page);
    await page.fill('#gsInput', 'Somun');
    await expect(page.locator('.gs-item', { hasText: 'Altıgen Somun M8' })).toBeVisible({ timeout: 10000 });

    await page.fill('#gsInput', '');
    await page.fill('#gsInput', 'LOT-KB');
    await expect(page.locator('.gs-item', { hasText: 'LOT-KB-2405' })).toBeVisible({ timeout: 10000 });
  });

  test('sonuç yoksa "sonuç bulunamadı" gösteriliyor, Escape kapatıyor', async ({ page }) => {
    await login(page);
    await page.fill('#gsInput', 'zzz-boyle-bir-kayit-yok');
    await expect(page.locator('#gsResults')).toContainText('Sonuç bulunamadı', { timeout: 10000 });
    await page.locator('#gsInput').press('Escape');
    await expect(page.locator('#gsResults')).toBeHidden();
  });
});
