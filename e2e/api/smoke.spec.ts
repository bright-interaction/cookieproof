import { test, expect } from '../helpers/fixtures';

test('GET /api/health returns ok', async ({ api }) => {
  const res = await api.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('register + login round trip', async ({ api }) => {
  const { registerUser, loginUser } = await import('../helpers/api');
  const user = await registerUser(api);
  expect(user.userId).toBeTruthy();
  expect(user.csrfToken).toBeTruthy();
  // Login the same user with a fresh request context to verify password works.
  await api.post('/api/auth/logout', { headers: { 'X-CSRF-Token': user.csrfToken } });
  const { csrfToken } = await loginUser(api, user.email, user.password);
  expect(csrfToken).toBeTruthy();
});

test('configurator login gate renders for fresh page', async ({ page }) => {
  await page.goto('/configurator/');
  await expect(page.locator('#login-gate')).toBeVisible();
  await expect(page.locator('#auth-email')).toBeVisible();
  await expect(page.locator('#auth-password')).toBeVisible();
});
