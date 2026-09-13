// @ts-nocheck
const { test, expect } = require('@playwright/test');

test.describe('Depo Terminali — gerçek tarayıcı CSS/layout regresyonu', () => {
  test('hidden öznitelikli elemanlar GERÇEKTEN görünmez (Aşama 6 regresyon testi)', async ({ page }) => {
    // Bu testin var oluş sebebi: public/css/mobile.css hiçbir yerde
    // [hidden]{display:none} tanımlamıyordu; .m-cam gibi sınıflar kendi
    // display'ini koşulsuz tanımladığı için (author stylesheet tarayıcının
    // varsayılan [hidden] kuralını HER ZAMAN ezer) kamera görünümü
    // hidden=true olsa bile GÖRÜNÜR kalıyor, giriş ekranını kapatıyordu.
    // jsdom bunu hiç yakalayamazdı çünkü gerçek CSS cascade hesaplamıyor —
    // yalnızca GERÇEK bir tarayıcıda ortaya çıkabilecek bir hata sınıfı.
    await page.goto('/mobile.html');
    await expect(page.locator('#mLogin')).toBeVisible();
    await expect(page.locator('#mCam')).toBeHidden();
    await expect(page.locator('#mApp')).toBeHidden();

    // Görsel olarak da: giriş formu gerçekten tıklanabilir konumda mı?
    await expect(page.locator('#mUser')).toBeInViewport();
  });

  test('giriş yapıp barkod okutarak ürün ekranına ulaşılıyor', async ({ page }) => {
    await page.goto('/mobile.html');
    await page.fill('#mUser', 'operator');
    await page.fill('#mPass', 'Operator123!');
    await page.click('#mLoginBtn');
    await expect(page.locator('#mApp')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#mLogin')).toBeHidden();

    await page.fill('#mScanInput', '8690123456811'); // seed: Ahşap Palet 120x80
    await page.press('#mScanInput', 'Enter');
    await expect(page.locator('#mMain')).toContainText('Ahşap Palet', { timeout: 10000 });

    // Kamera açılıp kapatıldığında giriş ekranına DÖNMEDİĞİNİ (üstte kalmadığını) doğrula.
    await page.click('#mCamBtn');
    await page.waitForTimeout(300);
    const camCloseVisible = await page.locator('#mCamClose').isVisible().catch(() => false);
    if (camCloseVisible) {
      await page.click('#mCamClose');
      await expect(page.locator('#mCam')).toBeHidden();
    }
    // Kapatıldıktan sonra alttaki ürün ekranı hâlâ görünür ve tıklanabilir olmalı.
    await expect(page.locator('#mMain')).toBeVisible();
  });
});
