// @ts-nocheck
const { test, expect } = require('@playwright/test');
const { login, goToView } = require('./helpers');

/**
 * T06 / K-05 / T08 in a real browser: supplier invoice approval + partial
 * payment dialogs, customer partial collection, a list page beyond the first
 * page, and the server-side searchable select for customers.
 * Test data is created through the API with the logged-in admin's token.
 */
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('dt_token') }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, { method, url, body });
}

test.describe('Fatura mutabakatı, kısmi ödeme ve sayfalama', () => {
  test('tedarikçi faturası arayüzden onaylanıp kısmi ödeniyor; çift tıklama tek kayıt', async ({ page }) => {
    await login(page);
    const supplier = (await api(page, 'POST', '/purchasing/suppliers', { name: 'E2E Ödeme Tedarikçi' })).data;
    const item = (await api(page, 'POST', '/items', { name: 'E2E Ödeme Ürün' })).data;
    const warehouse = (await api(page, 'GET', '/warehouses')).data[0].id;
    const po = (await api(page, 'POST', '/purchasing/orders', { supplierId: supplier.id, warehouseId: warehouse, items: [{ itemId: item.id, qty: 10, price: 10 }] })).data;
    if (po.approvalStatus === 'pending' || po.status !== 'approved') await api(page, 'POST', `/purchasing/orders/${po.id}/approve`);
    const detail = (await api(page, 'GET', '/purchasing/orders/' + po.id)).data;
    const receipt = await api(page, 'POST', `/purchasing/orders/${po.id}/receipts`, { lines: [{ poItemId: detail.items[0].id, qty: 10 }] });
    expect(receipt.status).toBe(201);
    const inv = (await api(page, 'POST', '/purchasing/invoices', { invoiceNo: 'E2E-PAY-1', poId: po.id, amount: 100, vatAmount: 20 })).data;
    expect(inv.matchStatus).toBe('matched');

    await goToView(page, 'purchasing');
    await page.getByRole('button', { name: 'Faturalar', exact: true }).click();
    const row = page.locator('tr', { hasText: 'E2E-PAY-1' });
    await row.getByRole('button', { name: 'Onayla' }).click();
    await page.locator('#apGo').click();
    await expect(row).toContainText('Ödemeye onaylı');

    await row.getByRole('button', { name: 'Ödeme' }).click();
    await page.fill('#pyAmt', '50');
    await page.locator('#pyGo').dblclick();
    await expect(row).toContainText('Kalan: 70');
    const payments = (await api(page, 'GET', '/purchasing/invoices/' + inv.id)).data.payments;
    expect(payments.length).toBe(1);
  });

  test('müşteri faturasında kısmi tahsilat kalan tutarı günceller', async ({ page }) => {
    await login(page);
    const customer = (await api(page, 'POST', '/sales/customers', { name: 'E2E Tahsilat Müşteri' })).data;
    const inv = (await api(page, 'POST', '/sales/invoices', { customerId: customer.id, amount: 200 })).data;
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Faturalar', exact: true }).click();
    const row = page.locator('tr', { hasText: inv.invoice_no });
    await row.getByRole('button', { name: 'Tahsilat' }).click();
    await page.fill('#coAmt', '80');
    await page.locator('#coGo').click();
    await expect(row).toContainText('₺120');
    await expect(row).toContainText('Kesildi');
  });

  test('müşteri listesinin ikinci sayfası açılıyor (eskiden hep ilk sayfa)', async ({ page }) => {
    await login(page);
    for (let i = 0; i < 55; i++) await api(page, 'POST', '/sales/customers', { name: `ZZ Sayfa Müşteri ${String(i).padStart(2, '0')}` });
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Müşteriler', exact: true }).click();
    const pager = page.locator('#salesBody .pager, .pager').first();
    await expect(pager).toBeVisible();
    await pager.getByRole('button', { name: 'Sonraki' }).click();
    await expect(page.locator('.pager').first()).toContainText('51–');
  });

  test('sipariş formunda müşteri sunucu tarafında aranıp seçiliyor', async ({ page }) => {
    await login(page);
    await api(page, 'POST', '/sales/customers', { name: 'Aranabilir Özel Müşteri XYZ' });
    await goToView(page, 'sales');
    await page.getByRole('button', { name: 'Yeni Satış Siparişi' }).click();
    const search = page.locator('#soCus').locator('xpath=preceding-sibling::input[@type="search"]');
    await search.fill('Özel Müşteri XYZ');
    await expect(page.locator('#soCus option', { hasText: 'Aranabilir Özel Müşteri XYZ' })).toHaveCount(1);
    // The search is debounced; wait until the first match becomes the choice.
    await expect.poll(() => page.locator('#soCus').evaluate(el => el.selectedOptions[0].textContent))
      .toContain('Aranabilir Özel Müşteri XYZ');
  });
});
