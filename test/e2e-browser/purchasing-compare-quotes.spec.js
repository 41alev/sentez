// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Regresyon testi: Api.compareQuotes() (server/routes/purchasing.js
 * GET /rfqs/:id/compare) satır bazlı iç içe bir yapı döner —
 * { rfqNo, lines: [{ itemName, quotes: [{supplier, unitPrice, ...}], best }] }
 * — düz bir "comparison"/"quotes"/"data" alanı hiç yok. Ama
 * frontend-react/PurchasingView.jsx'teki compareDialog() tam olarak bu üç
 * hiç var olmayan alanı okumaya çalışıyordu (`cmp.comparison || cmp.quotes
 * || cmp.data || []`), bu yüzden satır sayısı her zaman 0'dı ve "Teklifleri
 * Karşılaştır" diyaloğu — seed verisinde 3 gerçek teklifi olan bir RFQ için
 * bile — HER ZAMAN "Kayıt bulunamadı" gösteriyordu. Bu, Partiler/Lotlar
 * izlenebilirlik raporuyla AYNI hata sınıfı (veri var, alan adı uyuşmazlığı
 * yüzünden render edilmiyor) — yalnızca gerçek DOM içeriğini kontrol eden
 * bir test yakalayabilir.
 */
test.describe('Satın Alma — teklif karşılaştırma gerçek verilerle doluyor', () => {
  test('3 teklifli RFQ karşılaştırma tablosu doğru fiyat/tedarikçi/en iyi fiyatı gösteriyor', async ({ page }) => {
    await login(page);
    await goToView(page, 'purchasing');
    await page.getByRole('button', { name: 'Teklifler', exact: true }).click();

    const row = page.locator('tr', { hasText: 'TEK-2026-001' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: 'Teklifleri Karşılaştır' }).click();

    const body = page.locator('.modal-body');
    await expect(body).toBeVisible({ timeout: 10000 });
    // Eskiden hep "Kayıt bulunamadı" gösteriyordu — gerçek 3 tedarikçi/fiyat.
    await expect(body).not.toContainText('Kayıt bulunamadı');
    await expect(body).toContainText('Akım Elektrik Ltd.');
    await expect(body).toContainText('Akım Bağlantı San. Ltd.');
    await expect(body).toContainText('SafeGuard GmbH');
    await expect(body).toContainText('149,5');
    await expect(body).toContainText('En iyi fiyat');
  });
});
