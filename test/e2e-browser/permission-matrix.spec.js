// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * Bu dosya, "sadece admin ile mi test ettin?" sorusu üzerine yapılan rol
 * bazlı taramada bulunan, frontend-react/*.jsx'teki genel can('write'/'delete')
 * bayraklarının server/middleware/auth.js'teki granüler PERMISSIONS matrisiyle
 * BİREBİR eşleşmediği iki noktayı kapatıyor.
 */
test.describe('Yetki matrisi — frontend can() backend PERMISSIONS ile eşleşiyor', () => {
  test('Müdür sevkiyat silme butonunu görmüyor (DELETE /shipments yalnızca gerçek admin)', async ({ page }) => {
    // Regresyon: SalesView.jsx'teki sevkiyat silme ikonu can('delete') ile
    // kapılıydı (frontend can() matrisinde admin+manager) — ama
    // server/routes/sales.js:279'daki DELETE /shipments/:id requireRole('admin')
    // ile GERÇEK admin dışında herkesi (manager dahil) reddediyordu. Aynı
    // dosyada müşteri silme butonu zaten doğru şekilde can('admin') kullanıyordu;
    // sevkiyat silme bu deseni takip etmemişti. Müdür bu butonu tıklayınca
    // her zaman 403 alıyordu. Düzeltme: buton da can('admin')'e geçirildi.
    await login(page, 'mudur', 'Mudur123!');
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Sevkiyatlar', exact: true }).click();
    const row = page.locator('#view-sales table tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('[data-del]')).toHaveCount(0);
  });

  test('Kalite kullanıcısı bir ürüne doküman yükleme butonunu görüyor', async ({ page }) => {
    // Regresyon: server/routes/documents.js:15'teki WRITE
    // requireRole('admin','manager','operator','quality') içeriyor — yani
    // kalite bir ürüne sertifika/test raporu ekleyebilmeli. Ama
    // ItemsView.jsx'teki "Doküman Yükle" butonu genel can('write') ile
    // kapılıydı (frontend can() matrisinde quality hiç yoktu). Düzeltme:
    // can()'e backend'in bu spesifik WRITE listesini yansıtan ayrı bir
    // 'docs' yetkisi eklendi.
    await login(page, 'kalite', 'Kalite123!');
    await goToView(page, 'items');
    await page.locator('[data-open]').first().click();
    await expect(page.getByRole('button', { name: 'Doküman Yükle' })).toBeVisible({ timeout: 10000 });
    // Ürün düzenleme ayrı bir yetki (stock.write) gerektirir, quality'de yok.
    await expect(page.getByRole('button', { name: 'Düzenle', exact: true })).toHaveCount(0);
  });
});
