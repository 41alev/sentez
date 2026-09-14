// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Kullanıcının "test etmediğim, garanti veremeyeceğim" olarak işaretlediği bir
 * kalem: yazdırma çıktılarının GERÇEK İÇERİĞİ hiç doğrulanmamıştı. public/js/
 * ui.js'teki printDoc() bir window.open('') açıp document.write() ile tam bir
 * HTML belgesi yazıyor, sonra w.print() çağırıyor (public/js/ui.js:277-374).
 * Şimdiye kadarki testler (varsa) yalnızca "popup engellenmedi" diye
 * doğrulamış olabilirdi — asıl risk, şablonun (marka/logo/imza alanları)
 * doğru render olup GERÇEK belge verisinin (sevkiyat no, kalem adları,
 * miktarlar) içine doğru enjekte edilip edilmediğidir; bir alan yanlışlıkla
 * boş/placeholder kalırsa depo sevkiyatla birlikte yanlış bir irsaliye gider.
 *
 * Playwright, gerçek bir tarayıcıda window.open() ile açılan popup'ı
 * `context.waitForEvent('page')` ile doğrudan yakalayabilir — bu, mcp
 * tarayıcı aracındaki popup-engelleme sandbox kısıtından FARKLIDIR ve
 * document.write ile yazılan içeriği gerçekten okuyabilir.
 */
test.describe('Yazdırma çıktıları — gerçek belge içeriği', () => {
  test('sevkiyat irsaliyesi çıktısı GERÇEK sevkiyat verisini içeriyor (şablon değil)', async ({ page, context }) => {
    await login(page);
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Sevkiyatlar', exact: true }).click();

    const row = page.locator('#view-sales table tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    const shipmentId = await row.locator('[data-open]').getAttribute('data-open');
    const shipmentNo = (await row.locator('[data-open]').innerText()).trim();

    // Tek doğruluk kaynağı: sunucudan bu sevkiyatın GERÇEK verisi — popup'ın
    // içeriğini UI'ın kendi render ettiğiyle değil, ham API yanıtıyla
    // karşılaştırıyoruz.
    const shipment = await page.evaluate(async (id) => {
      const token = localStorage.getItem('dt_token');
      const r = await fetch(`/api/sales/shipments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      return r.json();
    }, shipmentId);
    expect(shipment.items && shipment.items.length, 'test sevkiyatının en az bir kalemi olmalı').toBeGreaterThan(0);
    const firstItem = shipment.items[0];

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      row.locator('[data-print]').click()
    ]);
    // document.write senkron yazılır; popup'ın body'sinin dolmasını bekle.
    // (String olarak veriliyor: bu dosya test/**/*.js için tarayıcı global'leri
    // olmadan lint ediliyor — fonksiyon gövdesi popup içinde çalışır, burada değil.)
    await popup.waitForFunction('document.body && document.body.textContent.trim().length > 0', { timeout: 10000 });
    const printedText = await popup.locator('body').innerText();

    expect(printedText, 'sevkiyat numarası çıktıda görünmüyor').toContain(shipmentNo);
    expect(printedText, 'kalem adı çıktıda görünmüyor — placeholder/boş şablon olabilir').toContain(firstItem.itemName);
    if (shipment.destination) {
      expect(printedText, 'varış yeri çıktıda görünmüyor').toContain(shipment.destination);
    }
    // Marka/başlık şablonu da gerçekten render olmuş mu (boş sayfa değil).
    expect(printedText).toMatch(/SEVKİYAT İRSALİYESİ|PACKING LIST/);

    await popup.close();
  });
});
