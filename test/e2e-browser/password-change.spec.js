const { test, expect } = require('@playwright/test');

test('mobil geçici şifreyi değiştirir ve çıkış sunucu oturumunu iptal eder', async ({ page, request }) => {
  const login = await request.post('/api/auth/login', { data: { username: 'admin', password: 'Admin123!' } });
  const admin = (await login.json()).token;
  const username = 'pw-mobile-' + Date.now();
  const created = await request.post('/api/users', { headers: { Authorization: 'Bearer ' + admin },
    data: { username, password: 'Temp123!', role: 'operator', mustChangePassword: true } });
  expect(created.status()).toBe(201);
  await page.goto('/mobile.html');
  await page.fill('#mUser', username);
  await page.fill('#mPass', 'Temp123!');
  await page.click('#mLoginBtn');
  await expect(page.locator('#mPasswordChange')).toBeVisible();
  await expect(page.locator('#mApp')).toBeHidden();
  await page.fill('#mCurrentPassword', 'Temp123!');
  await page.fill('#mNewPassword', 'Final123!');
  await page.fill('#mRepeatPassword', 'Different123!');
  await page.click('#mPasswordSave');
  await expect(page.locator('#mPasswordError')).toContainText('eşleşmiyor');
  await page.fill('#mRepeatPassword', 'Final123!');
  await page.click('#mPasswordSave');
  await expect(page.locator('#mApp')).toBeVisible();
  await expect(page.locator('#mPasswordChange')).toBeHidden();
  const token = await page.evaluate(() => localStorage.getItem('depoTerminalToken'));
  const revoked = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
  await page.click('#mMenu');
  await page.getByRole('button', { name: 'Çıkış', exact: true }).click();
  expect((await revoked).status()).toBe(200);
  await expect(page.locator('#mLogin')).toBeVisible();
  expect((await request.get('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status()).toBe(401);
});
