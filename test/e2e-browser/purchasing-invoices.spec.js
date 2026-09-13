// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Regresyon testi: GET /api/purchasing/invoices (server/routes/purchasing.js)
 * yalnızca camelCase alanlar döner: { invoiceNo, supplier, poNo, invoiceDate,
 * amount, currency, matchStatus, discrepancyNote } — snake_case bir karşılığı
 * hiç yok. Ama frontend-react/PurchasingView.jsx'teki renderInvoices()
 * "tedarikçi adı" sütununu `r.supplier_name || r.supplierName` ile, fark
 * notunu `r.discrepancy_note` ile okumaya çalışıyordu — ikisi de gerçek API
 * alanıyla (supplier / discrepancyNote) eşleşmediği için tedarikçi adı HER
 * ZAMAN "—", fark açıklaması HER ZAMAN boş gösteriyordu (3'lü eşleştirme
 * durum rozeti doğruydu çünkü match_status/matchStatus ikisini de okuyordu —
 * bu yüzden hata gözden kaçmıştı). Bu, aynı oturumda bulunan Partiler
 * izlenebilirlik ve Teklif Karşılaştırma hatalarıyla AYNI SINIF (veri var,
 * alan adı uyuşmazlığı yüzünden render edilmiyor).
 */
test.describe('Satın Alma — fatura 3\'lü eşleştirme gerçek verilerle doluyor', () => {
  test('yeni fatura girildiğinde tedarikçi adı ve fark notu doğru gösteriliyor', async ({ page }) => {
    await login(page);
    await goToView(page, 'purchasing');
    await page.getByRole('button', { name: 'Faturalar', exact: true }).click();

    await page.getByRole('button', { name: 'Fatura Gir' }).click();
    await page.waitForSelector('#ivPo');
    await page.selectOption('#ivPo', { label: 'SA-2026-002 — SafeGuard GmbH' });
    await page.fill('#ivNo', 'SGF-TEST-001');
    await page.fill('#ivAmt', '999999');
    await page.getByRole('button', { name: 'Kaydet' }).click();

    const row = page.locator('tr', { hasText: 'SGF-TEST-001' });
    await expect(row).toBeVisible({ timeout: 10000 });
    // Eskiden hep "—" gösteriyordu.
    await expect(row).toContainText('SafeGuard GmbH');
    await expect(row).toContainText('Fark var');
    // Eskiden hep boştu.
    await expect(row).toContainText('teslim alınan');
  });
});
