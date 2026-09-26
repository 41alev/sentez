const { test, expect } = require('@playwright/test');

// Desktop replaces the removed mobile terminal (26 Sep 2026): a user created
// with a temporary password must change it, the old password must be refused
// as the new one, and signing out revokes the server session.
test('geçici şifre masaüstünde değiştirilir ve çıkış sunucu oturumunu iptal eder', async ({ page, request }) => {
  const login = await request.post('/api/auth/login', { data: { username: 'admin', password: 'Admin123!' } });
  const admin = (await login.json()).token;
  const username = 'pw-desktop-' + Date.now();
  const created = await request.post('/api/users', { headers: { Authorization: 'Bearer ' + admin },
    data: { username, password: 'Temp123!x', role: 'operator', mustChangePassword: true } });
  expect(created.status()).toBe(201);

  await page.goto('/');
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', 'Temp123!x');
  await page.click('#loginForm button[type="submit"]');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Şifre');
  await page.fill('#cpCur', 'Temp123!x');
  await page.fill('#cpNew2', 'Temp123!x');
  await page.click('#cpGo2');
  await expect(page.locator('#toast')).toContainText('aynı');
  await page.fill('#cpNew2', 'Final123!x');
  await page.click('#cpGo2');
  await expect(dialog).toBeHidden();

  const token = await page.evaluate(() => localStorage.getItem('dt_token'));
  const revoked = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
  await page.click('#btnLogout');
  expect((await revoked).status()).toBe(200);
  expect((await request.get('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status()).toBe(401);
});
