// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Regresyon testi: server/middleware/auth.js'teki PERMISSIONS.quality
 * ['quality.write', 'stock.status', 'count.write', 'reports.view'] içeriyor —
 * yani Kalite rolü sayım (stock count) oluşturup kaydedebilmeli. Ama
 * public/js/ui.js'teki frontend can() matrisi quality'ye yalnızca ['quality']
 * veriyordu; CountsView.jsx'teki "Yeni Sayım" ve "Sayımı Kaydet" butonları
 * genel can('write') ile kapılıydı (quality'de hiç yok). Sonuç: Kalite
 * kullanıcısı backend'in açıkça izin verdiği bir işlemi (sayım) masaüstü
 * arayüzünden HİÇBİR ZAMAN yapamıyordu — ne yeni sayım açabiliyor ne de
 * saydığı miktarları kaydedebiliyordu (girdiği rakamlar kaybolurdu, kaydetme
 * butonu hiç yoktu). Düzeltme: can()'e backend'in count.write/approve
 * ayrımını yansıtan ayrı bir 'count' yetkisi eklendi (operator/manager/admin/
 * quality'de var, yalnızca "Onayla" hâlâ can('approve') ile admin/manager'a
 * kısıtlı — count.approve backend'de de yalnızca onlarda).
 */
test.describe('Sayım — Kalite rolü gerçekten sayım oluşturup kaydedebiliyor', () => {
  test('kalite kullanıcısı yeni sayım açıp bir satırı kaydedebiliyor', async ({ page }) => {
    await login(page, 'kalite', 'Kalite123!');
    await goToView(page, 'counts');

    await expect(page.getByRole('button', { name: 'Yeni Sayım' })).toBeVisible();
    await page.click('#view-counts button:has-text("Yeni Sayım")');
    await page.waitForSelector('#nGo');
    await page.click('#nGo');

    // Yeni sayım kaydedilince otomatik açılır.
    await page.waitForSelector('.cnt-q');
    // "Onayla" (count.approve) kalite'de olmamalı; "Sayımı Kaydet" (count.write) olmalı.
    await expect(page.locator('.modal button:has-text("Sayımı Kaydet")')).toBeVisible();
    await expect(page.locator('.modal button:has-text("Onayla")')).toHaveCount(0);

    await page.locator('.cnt-q').first().fill('210');
    await page.click('.modal button:has-text("Sayımı Kaydet")');
    await expect(page.locator('.toast.ok, .toast.show')).toBeVisible({ timeout: 10000 });
  });
});
