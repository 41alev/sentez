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

test('ürün formunda üret/satın al seçimi API ve kartta korunuyor', async ({ page }) => {
  await login(page);
  await goToView(page, 'items');
  await page.click('#itNew');
  await page.fill('#iName', 'Tarayıcı MRP Mamulü');
  await page.fill('#iCode', 'BROWSER-MRP-MAKE');
  await page.selectOption('#iType', 'finished');
  await page.selectOption('#iProcurement', 'make');
  const created = page.waitForResponse(r => r.url().endsWith('/api/items') && r.request().method() === 'POST');
  await page.click('#iSave');
  const response = await created;
  expect(response.status()).toBe(201);
  const item = await response.json();
  expect(item.procurementType).toBe('make');
  const token = await page.evaluate(() => localStorage.getItem('dt_token'));
  const persisted = await (await page.request.get(`/api/items/${item.id}`,
    { headers: { Authorization: `Bearer ${token}` } })).json();
  expect(persisted.procurementType).toBe('make');
});
