// @ts-nocheck
/** Playwright testleri için ortak giriş yardımcıları. */

async function login(page, username = 'admin', password = 'Admin123!') {
  await page.goto('/');
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#appShell[style*="grid"]', { timeout: 10000 });
}

async function goToView(page, view) {
  await page.click(`.nav-tab[data-view="${view}"]`);
  await page.waitForSelector(`#view-${view}.active .topbar`, { timeout: 10000 });
}

module.exports = { login, goToView };
