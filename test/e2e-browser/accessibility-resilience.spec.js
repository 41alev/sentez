// @ts-nocheck
/* global document */
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * T18 in a real browser: dialog semantics and keyboard focus, labels tied to
 * their controls, one record per double-clicked Save, and a retry path when
 * a list fails to load.
 */
test.describe('Erişilebilirlik ve hata dayanıklılığı', () => {
  test('diyalog: rol, ilk alana odak, Tab tuzağı, Escape ile açan düğmeye dönüş, etiket bağlantısı', async ({ page }) => {
    await login(page);
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Müşteriler', exact: true }).click();
    const opener = page.getByRole('button', { name: 'Yeni Müşteri' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The first form field has focus and is reachable by its label.
    const focusedTag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(focusedTag);
    const labelled = await page.evaluate(() => [...document.querySelectorAll('#modalBox label[for]')]
      .every(l => document.getElementById(l.htmlFor)));
    expect(labelled).toBe(true);
    // Tab never leaves the dialog.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => document.getElementById('modalBox').contains(document.activeElement));
      expect(inside).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('kaydet düğmesine çift tıklama tek kayıt oluşturur', async ({ page }) => {
    await login(page);
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Müşteriler', exact: true }).click();
    await page.getByRole('button', { name: 'Yeni Müşteri' }).click();
    const name = 'Çift Tık Müşteri ' + Date.now();
    await page.getByRole('dialog').locator('input').first().fill(name);
    // Slow the create call so the second click lands while the first is in flight.
    await page.route('**/api/sales/customers', async route => {
      if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 600));
      await route.continue();
    });
    await page.getByRole('dialog').locator('.modal-foot .btn-primary').dblclick();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    const count = await page.evaluate(async n => {
      const r = await fetch('/api/sales/customers?q=' + encodeURIComponent(n), { headers: { Authorization: 'Bearer ' + localStorage.getItem('dt_token') } });
      return (await r.json()).data.length;
    }, name);
    expect(count).toBe(1);
  });

  test('liste yüklenemezse hata ve "Yeniden Dene" görünür; tekrar deneme yükler', async ({ page }) => {
    await login(page);
    let fail = true;
    await page.route('**/api/sales/orders?*', async route => {
      if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Geçici arıza / Temporary failure' }) });
      return route.continue();
    });
    await goToView(page, 'sales');
    const alert = page.locator('#salesBody [role="alert"]');
    await expect(alert).toContainText('Geçici arıza');
    fail = false;
    await alert.getByRole('button', { name: 'Yeniden Dene' }).click();
    await expect(page.locator('#salesBody table')).toBeVisible();
  });
});
