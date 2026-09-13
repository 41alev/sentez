// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

test.describe('Giriş ve temel gezinme', () => {
  test('giriş yapılabiliyor ve panel gerçek veriyle render oluyor', async ({ page }) => {
    await login(page);
    await expect(page.locator('#userName')).not.toHaveText('—');
    // Dashboard, gerçek stok değeri KPI'sını render eder (seed verisi > 0 üretir).
    await expect(page.locator('.stat-row').first()).toBeVisible();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    expect(errors).toEqual([]);
  });

  test('yanlış şifre reddediliyor', async ({ page }) => {
    await page.goto('/');
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'yanlis-sifre');
    await page.click('#loginForm button[type="submit"]');
    await expect(page.locator('#loginError')).not.toBeEmpty();
    await expect(page.locator('#appShell')).not.toHaveCSS('display', 'grid');
  });

  test('görüntüleyici rolünde Yönetim sekmesi gizli', async ({ page }) => {
    await login(page, 'viewer', 'Viewer123!');
    await expect(page.locator('.nav-tab[data-view="admin"]')).toBeHidden();
  });

  for (const view of ['items', 'lots', 'crm', 'sales', 'reports']) {
    test(`${view} ekranı hatasız render oluyor`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await login(page);
      await goToView(page, view);
      await expect(page.locator(`#view-${view} .topbar`)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});
