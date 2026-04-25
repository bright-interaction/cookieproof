import { test, expect } from '../helpers/fixtures';
import { TEST_PASSWORD, uniqueEmail, registerUser } from '../helpers/api';

test.describe('configurator login gate', () => {
  test('login gate is visible on a fresh load', async ({ page }) => {
    await page.goto('/configurator/');
    await expect(page.locator('#login-gate')).toBeVisible();
    await expect(page.locator('#login-gate')).not.toHaveClass(/hidden/);
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    // Editor page should NOT be active while gated
    // (the page-active class is reserved for the active page; fresh visit has editor active by default)
    // What matters here is the gate is on top.
  });

  test('switching to register mode reveals workspace and confirm fields', async ({ page }) => {
    await page.goto('/configurator/');
    await expect(page.locator('#login-gate')).toBeVisible();

    // In login mode the registration-only fields should be hidden.
    await expect(page.locator('#auth-confirm-password-field')).toBeHidden();
    await expect(page.locator('#auth-display-name-field')).toBeHidden();
    await expect(page.locator('#auth-workspace-name-field')).toBeHidden();

    await page.locator('#auth-toggle-link').click();

    await expect(page.locator('#auth-confirm-password-field')).toBeVisible();
    await expect(page.locator('#auth-display-name-field')).toBeVisible();
    await expect(page.locator('#auth-workspace-name-field')).toBeVisible();
    await expect(page.locator('#auth-password-confirm')).toBeVisible();
    await expect(page.locator('#auth-display-name')).toBeVisible();
    await expect(page.locator('#auth-workspace-name')).toBeVisible();
  });

  test('register from the UI hides the gate and activates the editor', async ({ page }) => {
    await page.goto('/configurator/');
    await page.locator('#auth-toggle-link').click();

    const email = uniqueEmail('e2e-ui-register');
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(TEST_PASSWORD);
    await page.locator('#auth-password-confirm').fill(TEST_PASSWORD);
    await page.locator('#auth-display-name').fill('UI Tester');
    await page.locator('#auth-workspace-name').fill('UI Workspace');
    await page.locator('#auth-submit-btn').click();

    await expect(page.locator('#login-gate')).toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(page.locator('#page-editor')).toHaveClass(/page-active/);
  });

  test('login with a wrong password shows an error and keeps the gate', async ({ page, user }) => {
    await page.goto('/configurator/');
    await expect(page.locator('#login-gate')).toBeVisible();

    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('definitely-wrong-password');
    await page.locator('#auth-submit-btn').click();

    await expect(page.locator('#auth-error')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#auth-error')).not.toHaveText('');
    await expect(page.locator('#login-gate')).not.toHaveClass(/hidden/);
  });

  test('login with the correct password hides the gate', async ({ page, user }) => {
    await page.goto('/configurator/');
    await expect(page.locator('#login-gate')).toBeVisible();

    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill(user.password);
    await page.locator('#auth-submit-btn').click();

    await expect(page.locator('#login-gate')).toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(page.locator('#page-editor')).toHaveClass(/page-active/);
  });

  test('logout reveals the login gate again', async ({ loggedInPage }) => {
    // The configurator hides the gate via the .hidden class once authed.
    await expect(loggedInPage.locator('#login-gate')).toHaveClass(/hidden/);

    // Trigger the configurator's own logout flow. The profile chip is the
    // visible trigger but only renders once the profile UI has finished
    // wiring up. Calling logout() directly is the same code path the menu
    // button runs (see configurator/index.html line 2128).
    await loggedInPage.evaluate(() => (window as any).logout());

    // The configurator clears the cookie and reloads via checkAuthState.
    // After the cookie is gone, a reload restores the gate.
    await loggedInPage.reload();
    await expect(loggedInPage.locator('#login-gate')).toBeVisible();
    await expect(loggedInPage.locator('#login-gate')).not.toHaveClass(/hidden/);
  });
});
