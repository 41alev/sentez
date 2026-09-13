// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

test.describe('CRM — fırsat oluşturma ve satış siparişine dönüştürme', () => {
  test('fırsat oluşturulup kazanılıp gerçek bir siparişe dönüştürülüyor', async ({ page }) => {
    await login(page);
    await goToView(page, 'crm');

    await page.click('#oppNew');
    await page.waitForSelector('#oppCus');
    await page.selectOption('#oppCus', { index: 1 }); // ilk gerçek müşteri (index 0 = "yeni aday")
    await page.fill('#oppVal', '1000');
    await page.click('#oppAddLine');
    await page.click('#oppGo');

    await expect(page.locator('.toast.show')).toBeVisible({ timeout: 10000 });

    // Test veritabanı taze olduğu için DOM'da her zaman TEK bir fırsat kartı
    // var — hangi huni sütununda olduğu önemli değil, [data-open] her
    // seferinde onu bulur. Her "İlerlet" tıklaması sunucuya yazıp modalı
    // KAPATIYOR (closeModal() + reload()) — bu yüzden her aşama sonrası
    // kartı YENİDEN açmak gerekiyor, aynı modal açık kalmıyor.
    async function openTheOnlyCard() {
      await expect(page.locator('[data-open]').first()).toBeVisible({ timeout: 10000 });
      await page.locator('[data-open]').first().click();
      await page.waitForSelector('.modal-head', { timeout: 10000 });
    }

    await openTheOnlyCard();
    await page.click('#oppAdvance'); // new -> contacted
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/show/, { timeout: 10000 });

    await openTheOnlyCard();
    await page.click('#oppAdvance'); // contacted -> quoted
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/show/, { timeout: 10000 });

    await openTheOnlyCard();
    await page.click('#oppAdvance'); // quoted -> won
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/show/, { timeout: 10000 });

    await openTheOnlyCard();
    await page.click('#oppConvert');

    // customerId zaten seçiliyse doğrudan confirmDialog (#cfmYes) açılır.
    await page.waitForSelector('#cfmYes', { timeout: 10000 });
    await page.click('#cfmYes');
    await expect(page.locator('.toast.show')).toBeVisible({ timeout: 10000 });
  });
});
