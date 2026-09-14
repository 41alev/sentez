// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Regresyon testi: public/js/ui.js'teki roleLabel(r) `{...}[r] || r` deseniyle
 * yazılmıştı — r null/undefined olduğunda (ör. başarısız bir giriş denemesini
 * loglayan "system" aktörünün rolü yok) `undefined || r` ifadesi r'yi (null)
 * olduğu gibi döndürüyor, bu da şablon string'inde JS'in null'u "null" metnine
 * çevirmesiyle Denetim Kaydı ekranında KULLANICI sütununda literal "null"
 * yazısı gösteriyordu. Gerçek bir tarayıcıda başarısız bir giriş denemesi
 * yapılıp Denetim Kaydı'nda bu satırın "null" İÇERMEDİĞİ doğrulanıyor.
 */
test.describe('Yönetim — Denetim Kaydı null rol sızdırmıyor', () => {
  test('başarısız giriş denemesi satırında literal "null" görünmüyor', async ({ page }) => {
    // Denetim kaydına gerçek bir "system" aktörlü satır düşürmek için önce
    // kasıtlı olarak yanlış şifreyle giriş denenir.
    await page.goto('/');
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'yanlis-sifre-qa-test');
    await page.click('#loginForm button[type="submit"]');
    await expect(page.locator('#loginError')).not.toBeEmpty();

    await login(page);
    await goToView(page, 'admin');
    await page.getByRole('button', { name: 'Denetim Kaydı', exact: true }).click();

    const row = page.locator('tr', { hasText: 'başarısız giriş denemesi' }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).not.toContainText('null');
  });
});
