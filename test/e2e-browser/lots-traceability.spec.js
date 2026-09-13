// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Regresyon testi: server/services/traceability.js DÜZ (flat) nesneler
 * döner (itemName/lotNo/usedIn/shippedTo hep KÖKTE), ama
 * frontend-react/LotsView.jsx bunları `.lot` altında ve
 * usedInProduction/shipments/shippedIn/customerName gibi HİÇ VAR OLMAYAN
 * alan adlarıyla okumaya çalışıyordu. Sonuç: İzlenebilirlik diyaloğunun
 * başlığı HER ZAMAN boş ("—"), ileri izleme/geri çağırma raporu HER ZAMAN
 * "kayıt yok" gösteriyordu — gerçek veri olsa bile. Bu, gerçek bir
 * tarayıcıda manuel test sırasında bulundu (jsdom/API testleri bunu hiç
 * yakalamamıştı çünkü hiçbiri gerçek DOM içeriğini "boş değil, doğru
 * değer" diye kontrol etmiyordu).
 *
 * Seed verisindeki PARTI-SET-0901 (Elektrik Bağlantı Seti) hem geriye
 * (Kablo Rulosu/Somun/Vida bileşenlerinden üretildi) hem ileriye
 * (Anadolu Makine A.Ş.'ye SVK-2026-001 ile sevk edildi) gerçek izlenebilirlik
 * verisi taşıyan tek parti — bu senaryoyu tam olarak sınıyor.
 */
test.describe('Partiler — izlenebilirlik raporu gerçek verilerle doluyor', () => {
  test('geriye/ileriye izleme ve geri çağırma raporu doğru bilgiyi gösteriyor', async ({ page }) => {
    await login(page);
    await goToView(page, 'lots');

    const row = page.locator('tr', { hasText: 'PARTI-SET-0901' });
    await row.locator('[data-trace]').click();
    await page.waitForSelector('.modal-body .kv-grid');

    const body = page.locator('.modal-body');
    // Başlık — eskiden hep "—" gösteriyordu (bkz. yorum).
    await expect(body).toContainText('Elektrik Bağlantı Seti');
    await expect(body).toContainText('PARTI-SET-0901');
    await expect(body).toContainText('12');

    // Geriye izleme — bileşenler ve onların kendi kaynak partisi (child).
    await expect(body).toContainText('Kablo Rulosu 2.5mm');
    await expect(body).toContainText('LOT-KB-2405');

    // İleriye izleme — eskiden HER ZAMAN "kayıt yok" gösteriyordu.
    await expect(body).toContainText('SVK-2026-001');

    // Geri çağırma raporu — gerçek müşteri adı ve varış noktası.
    await expect(body).toContainText('Anadolu Makine A.Ş.');
    await expect(body).toContainText('OSTİM');
    await expect(body).not.toContainText('kayıt yok');
  });
});
