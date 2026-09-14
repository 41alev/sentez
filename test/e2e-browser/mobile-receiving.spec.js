// @ts-nocheck
const { test, expect } = require('@playwright/test');

/**
 * Regresyon testi: public/js/mobile.js'teki receive() fonksiyonu, sunucunun
 * POST /purchasing/orders/:id/receipts için beklediği `poItemId` (sipariş
 * KALEMİNİN kendi satır id'si, server/routes/purchasing.js:478) yerine
 * `itemId` (ürünün kendi id'si — bir UUID string, sayıya çevrilemez) alanını
 * gönderiyordu. Sunucu tarafında zod şeması `poItemId: z.coerce.number()`
 * olduğu için bu UUID "NaN"a çevriliyor, istek HER ZAMAN 422 "Expected
 * number, received nan" ile reddediliyordu — depo terminalindeki "Mal Kabul"
 * (satın alma siparişi teslim alma) akışı GERÇEKTE HİÇBİR ZAMAN
 * ÇALIŞMIYORDU. test/mobile.js (jsdom) yalnızca görev listesinin
 * (GET /mobile/tasks) yüklendiğini kontrol ediyordu, gerçek "ONAYLA"
 * tıklamasını hiç denemiyordu — bu yüzden hata hiç yakalanmamıştı.
 *
 * Düzeltme: receive() artık `poItemId: i.id` gönderiyor (i.id, serializePO'nun
 * döndürdüğü po_items satır id'si).
 */
test.describe('Depo Terminali — Mal Kabul gerçekten sunucuya kaydediyor', () => {
  test('SA-2026-003 siparişindeki kalem teslim alınıp sunucuya yazılıyor (422 değil)', async ({ page }) => {
    await page.goto('/mobile.html');
    await page.fill('#mUser', 'operator');
    await page.fill('#mPass', 'Operator123!');
    await page.click('#mLoginBtn');
    await expect(page.locator('#mApp')).toBeVisible({ timeout: 10000 });

    await page.click('[data-go="receiveList"]');
    await page.click('[data-po]:has-text("SA-2026-003")');
    await expect(page.locator('#mMain')).toContainText('Hidrolik Yağ 15L', { timeout: 10000 });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/receipts') && r.request().method() === 'POST'),
      (async () => {
        await page.click('[data-line]:has-text("Hidrolik Yağ 15L")');
        await page.fill('#qsLot', 'LOT-QA-E2E');
        await page.click('[data-act="0"]');
      })()
    ]);

    // Eskiden HER ZAMAN 422 dönüyordu ("Expected number, received nan").
    expect(response.status()).toBe(201);
    await expect(page.locator('#mToast')).toContainText('teslim alındı', { timeout: 10000 });
  });
});
