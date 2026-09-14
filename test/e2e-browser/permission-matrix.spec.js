// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

const SHARED_REPORT_NAME = 'RolTaramasi-' + Date.now();

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

  test('Müdür parti durum değiştirme butonunu görmüyor (POST /lot-status yalnızca admin+kalite)', async ({ page }) => {
    // Regresyon (rol taraması bulgu 11): LotsView.jsx'teki durum değiştirme
    // (karantina/blokaj/serbest bırakma) ikonu `can('quality') || can('write')`
    // ile kapılıydı — frontend can() matrisinde 'quality' bayrağı manager'a da
    // verildiği (kalite dispozisyonu gibi işler için) ve 'write' operator'a da
    // verildiği için buton admin/manager/operator/kalite'ye GÖRÜNÜYORDU. Ama
    // server/routes/stock.js:131'deki POST /lot-status
    // requirePermission('stock.status') — ve server/middleware/auth.js'teki
    // PERMISSIONS tablosunda stock.status YALNIZCA admin (*) ve quality'de var,
    // manager'da YOK. Müdür bu butona tıklayınca her zaman 403 alıyordu.
    // Düzeltme: can()'e backend'in bu spesifik iznini yansıtan ayrı bir
    // 'lotStatus' bayrağı eklendi (yalnızca admin+quality).
    await login(page, 'mudur', 'Mudur123!');
    await goToView(page, 'lots');
    const row = page.locator('#view-lots table tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('[data-status]')).toHaveCount(0);
  });

  test('Kalite kullanıcısı parti durum değiştirme butonunu görüyor', async ({ page }) => {
    await login(page, 'kalite', 'Kalite123!');
    await goToView(page, 'lots');
    const row = page.locator('#view-lots table tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('[data-status]')).toHaveCount(1);
  });

  test('Müdür Webhook sekmesini açınca "yalnızca yöneticilere açık" görüyor, 403 hatası değil', async ({ page }) => {
    // Regresyon (rol taraması bulgu 13): AdminView.jsx'teki Webhooks sekmesi
    // hiçbir can() koşuluyla korunmuyordu — ama server/routes/webhooks.js'teki
    // HER route requireRole('admin'). Müdür Yönetim ekranına (admin+manager'a
    // açık) girip Webhooks sekmesine tıklayınca ilk Api.webhooks() çağrısı
    // her zaman 403'e düşüyordu. Düzeltme: usersTab'daki "yalnızca
    // yöneticilere açık" deseni webhooksTab'a da uygulandı.
    await login(page, 'mudur', 'Mudur123!');
    await goToView(page, 'admin');
    await page.getByRole('button', { name: "Webhook'lar", exact: true }).click();
    await expect(page.locator('#adBody')).toContainText('yalnızca yöneticilere açıktır', { timeout: 10000 });
  });

  test('Müdür kendi kaydettiği raporu silebiliyor (sahibi olduğu için)', async ({ page }) => {
    // Regresyon (rol taraması bulgu 14): server/routes/reports.js:450-456'daki
    // DELETE /saved/:id yalnızca sahibine veya admin/manager'a izin veriyor
    // — ama ReportsView.jsx'teki ✕ ikonu HERKESE, başkasının raporunda bile
    // koşulsuz gösteriliyordu. Bu iki test (ayrı `test()` blokları — aynı
    // testte iki kez login() login formunu bulamaz, oturum zaten açık kalır)
    // aynı paylaşılan raporu önce sahibiyle, sonra başkasıyla kontrol ediyor.
    await login(page, 'mudur', 'Mudur123!');
    await goToView(page, 'reports');
    await page.getByRole('button', { name: 'Özel Rapor', exact: true }).click();
    await page.click('#pvSave');
    await page.fill('#pvName', SHARED_REPORT_NAME);
    await page.click('#pvSaveGo');
    const mudurBadge = page.locator('.badge', { hasText: SHARED_REPORT_NAME });
    await expect(mudurBadge).toBeVisible({ timeout: 10000 });
    await expect(mudurBadge.locator('[data-del]')).toHaveCount(1);
  });

  test('Operatör #admin hash\'ine doğrudan gidince Yönetim ekranını GÖREMİYOR (gizli sekme = yetki değil)', async ({ page }) => {
    // Regresyon (rol taraması bulgu 15): public/js/app.js yalnızca Yönetim
    // NAV BUTONUNU viewer/operator/quality'den gizliyor — App.go(view)
    // kendisi hiçbir yetki kontrolü yapmıyordu (app.js:17-27,181-184'teki
    // hashchange dinleyicisi HERHANGİ bir hash değerine göre view render
    // ediyor). Yani bu roller location.hash'i elle '#admin' yaparsa (eski
    // bir yer imi, tarayıcı geçmişi, admin'den devralınan bir sekme) Yönetim
    // ekranı YİNE render oluyordu — ve Muhasebe/İçe Aktarım/Şablonlar gibi
    // bazı sekmelerin ilk yükleme çağrısı backend'de de tamamen açık
    // olduğundan (requirePermission yok) gerçek veri görünüyordu. "Gizli
    // buton = yetkilendirme" varsayımı burada YANLIŞTI. Düzeltme:
    // AdminView'in kendisine, usersTab/webhooksTab'ın kendi can('admin')
    // deseniyle aynı ruhta, tüm sekmeleri kapsayan bir can('approve')
    // girişi eklendi.
    await login(page, 'operator', 'Operator123!');
    // String olarak veriliyor: bu dosya test/**/*.js için tarayıcı global'leri
    // olmadan lint ediliyor — ifade sayfa içinde çalışır, burada değil.
    await page.evaluate("location.hash = 'admin'");
    await expect(page.locator('#view-admin')).toContainText('yalnızca yöneticilere açıktır', { timeout: 10000 });
  });

  test('Başkasının kayıtlı raporunu Operatör silemiyor', async ({ page }) => {
    await login(page, 'operator', 'Operator123!');
    await goToView(page, 'reports');
    await page.getByRole('button', { name: 'Özel Rapor', exact: true }).click();
    const opBadge = page.locator('.badge', { hasText: SHARED_REPORT_NAME });
    await expect(opBadge).toBeVisible({ timeout: 10000 });
    // Sahibi değil ve yönetici/müdür de değil — silme ikonu görünmemeli.
    await expect(opBadge.locator('[data-del]')).toHaveCount(0);
  });
});
