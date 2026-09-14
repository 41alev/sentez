// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login: desktopLogin, goToView } = require('./helpers');

/**
 * Kullanıcının "test etmediğim, dolayısıyla garanti veremeyeceğim" olarak
 * işaretlediği bir senaryo: mobil çevrimdışı kuyruk sadece bir eski sürümden
 * kalan kaydın IndexedDB'ye taşındığı yükseltme senaryosuyla test edilmişti
 * (test/mobile.js, jsdom) — CANLI bir çevrimdışı işlem asla test edilmemişti.
 *
 * Bu test, public/js/mobile.js'teki submit()/flushQueue() gerçek akışını
 * GERÇEK bir tarayıcıda, GERÇEK ağ kesintisiyle (context.setOffline) kanıtlar:
 * bağlantı kesilince yeni bir sayım işlemi sunucuya HİÇ gönderilmeden
 * doğrudan IndexedDB kuyruğuna yazılır (kuyruk rozeti artar), bağlantı geri
 * gelince window 'online' olayı flushQueue()'yu tetikler ve işlem GERÇEKTEN
 * sunucuya ulaşır (kuyruk boşalır).
 */
test.describe('Depo Terminali — çevrimdışı kuyruk gerçekten çalışıyor', () => {
  test('çevrimdışıyken sayım kuyruğa alınıyor, bağlantı gelince otomatik gönderiliyor', async ({ page, context }) => {
    // Test verisine bağımlı olmamak için önce masaüstünden taze bir sayım açılır.
    await desktopLogin(page);
    await goToView(page, 'counts');
    await page.click('#view-counts button:has-text("Yeni Sayım")');
    await page.waitForSelector('#nGo');
    await page.click('#nGo');
    await expect(page.locator('.toast.ok, .toast.show')).toBeVisible({ timeout: 10000 });

    await page.goto('/mobile.html');
    await page.fill('#mUser', 'operator');
    await page.fill('#mPass', 'Operator123!');
    await page.click('#mLoginBtn');
    await expect(page.locator('#mApp')).toBeVisible({ timeout: 10000 });

    await page.click('[data-go="countList"]');
    await page.locator('[data-count]').first().click();
    // Sayım satırları sunucudan asenkron çekiliyor — kartlar GERÇEKTEN
    // görünene kadar bekle, aksi halde offline moda geçiş bu ilk isteği
    // yarıda keser ("Failed to fetch") ve senaryo hiç kurulmamış olur.
    await expect(page.locator('[data-cl]').first()).toBeVisible({ timeout: 10000 });

    const syncRequests = [];
    page.on('request', (req) => { if (req.url().includes('/mobile/sync')) syncRequests.push(req.url()); });

    // Gerçek ağ bağlantısını kes (istek gövdesi düzeyinde, sadece navigator.onLine
    // taklidi değil) — submit()'in çevrimdışı dalını GERÇEKTEN tetikler.
    await context.setOffline(true);

    await page.locator('[data-cl]').first().click();
    await page.click('[data-act="0"]');

    // Kuyruk rozeti artmalı — işlem sunucuya gönderilmeye ÇALIŞILMAMALI bile.
    await expect(page.locator('#mQueue')).toHaveText('1', { timeout: 5000 });
    expect(syncRequests.length, 'çevrimdışıyken /mobile/sync\'e hiç istek gitmemeli').toBe(0);

    // Bağlantı geri gelince window 'online' olayı flushQueue()'yu tetiklemeli.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/mobile/sync') && r.request().method() === 'POST', { timeout: 10000 }),
      context.setOffline(false)
    ]);
    const body = await response.json();
    expect(body.failed).toBe(0);
    expect(body.succeeded).toBe(1);

    // Kuyruk gerçekten boşaldı — kullanıcıya "hâlâ bekliyor" yanılgısı verilmiyor.
    await expect(page.locator('#mQueue')).toBeHidden({ timeout: 5000 });
  });
});
