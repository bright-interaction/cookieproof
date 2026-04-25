import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { registerUser, type RegisteredUser, TEST_PASSWORD } from './api';

type Fixtures = {
  /** Origin where both static configurator and proxied API live. */
  appBase: string;
  /** APIRequestContext bound to appBase (so cookies work for proxied /api). */
  api: APIRequestContext;
  /** Fresh registered user; org owner. */
  user: RegisteredUser;
  /** A page already logged in as `user`, parked on the configurator editor. */
  loggedInPage: Page;
};

export const test = base.extend<Fixtures>({
  appBase: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL is required');
    await use(baseURL);
  },

  api: async ({ playwright, appBase }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: appBase });
    await use(ctx);
    await ctx.dispose();
  },

  user: async ({ api }, use) => {
    const user = await registerUser(api);
    await use(user);
  },

  loggedInPage: async ({ page, user, appBase }, use) => {
    // Hit the API from the browser so cookies (ce_session, ce_csrf) are bound to the page.
    await page.goto('/configurator/');
    const res = await page.evaluate(async ({ email, password }) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      return { status: r.status, body: await r.json() };
    }, { email: user.email, password: TEST_PASSWORD });
    if (res.status !== 200) throw new Error(`browser login failed ${res.status}: ${JSON.stringify(res.body)}`);
    await page.reload();
    await expect(page.locator('#login-gate')).toHaveClass(/hidden/, { timeout: 5_000 });
    await use(page);
  },
});

export { expect };
