const { test, expect } = require('@playwright/test');

test('mobil kuyruk parçalanır; hatalı, yeni ve başka kullanıcı işlemleri korunur', async ({ page, request }) => {
  test.setTimeout(60000);
  const login = await request.post('/api/auth/login', { data: { username: 'operator', password: 'Operator123!' } });
  const session = await login.json();
  const items = await request.get('/api/items?pageSize=1', { headers: { Authorization: 'Bearer ' + session.token } });
  const item = (await items.json()).data[0];
  await page.goto('/mobile.html');
  await page.fill('#mUser', 'operator'); await page.fill('#mPass', 'Operator123!'); await page.click('#mLoginBtn');
  await expect(page.locator('#mApp')).toBeVisible();
  await page.evaluate(async ({ ownerId, itemId }) => {
    const queue = globalThis['MobileDB'];
    for (let i = 0; i < 202; i++) await queue.add({ ownerId, clientId: 'batch-' + i, type: 'move', itemId: i === 0 ? 'missing-item' : itemId, warehouseId: 1, qty: 1, queuedAt: Date.now() });
    await queue.add({ ownerId: 999999, clientId: 'other-user', type: 'move', itemId, warehouseId: 1, qty: 1, queuedAt: Date.now() });
  }, { ownerId: session.user.id, itemId: item.id });
  const batches = [];
  await page.route('**/api/mobile/sync', async route => {
    batches.push(route.request().postDataJSON().operations.length);
    if (batches.length === 1) {
      await page.evaluate(async ({ ownerId, itemId }) => {
        await globalThis['MobileDB'].add({ ownerId, clientId: 'added-while-sending', type: 'move', itemId, warehouseId: 1, qty: 1, queuedAt: Date.now() });
      }, { ownerId: session.user.id, itemId: item.id });
    }
    await route.continue();
  });
  await page.click('#mMenu'); await page.getByRole('button', { name: 'Bekleyen işlemler', exact: true }).click();
  await page.click('#qFlush');
  await expect(page.getByRole('button', { name: 'Anladım', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Anladım', exact: true }).click();
  expect(batches).toEqual([200, 2]);
  const remaining = await page.evaluate(() => globalThis['MobileDB'].getAll());
  expect(remaining.map(op => op.clientId).sort()).toEqual(['added-while-sending', 'batch-0', 'other-user']);
  expect(remaining.find(op => op.clientId === 'batch-0').lastError).toContain('bulunamadı');
  await expect(page.locator('#mMain')).toContainText('bulunamadı');

  // The second server request commits but its response is lost. The durable
  // operation ID must replay without creating a second lot on the next try.
  await page.unroute('**/api/mobile/sync');
  let aborted = false;
  await page.route('**/api/mobile/sync', async route => { await route.fetch(); await route.abort('failed'); aborted = true; });
  await page.click('#qFlush');
  await expect.poll(() => aborted).toBe(true);
  await expect(page.locator('#qFlush')).toBeEnabled();
  await expect.poll(async () => (await page.evaluate(() => globalThis['MobileDB'].getAll())).length).toBe(3);
  await page.unroute('**/api/mobile/sync');
  await page.click('#qFlush');
  await expect.poll(async () => (await page.evaluate(() => globalThis['MobileDB'].getAll())).length).toBe(2);
  await page.getByRole('button', { name: 'Anladım', exact: true }).click();
  await page.click('#mMenu'); await page.getByRole('button', { name: 'Çıkış', exact: true }).click();
  await page.fill('#mUser', 'kalite'); await page.fill('#mPass', 'Kalite123!'); await page.click('#mLoginBtn');
  await expect(page.locator('#mApp')).toBeVisible();
  await page.click('#mMenu'); await page.getByRole('button', { name: 'Bekleyen işlemler', exact: true }).click();
  await expect(page.locator('#mMain')).toContainText('Bekleyen işlem yok');
  expect((await page.evaluate(() => globalThis['MobileDB'].getAll())).length).toBe(2);
});
