import { test, expect } from '../helpers/fixtures';

// Must point at the test origin so the SPA's getApiBase() call resolves to
// /api on the proxy and shares the page's session cookie. Picking up the
// page origin at runtime keeps this resilient to baseURL changes.
async function makeProofEndpoint(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => `${location.origin}/api/proof`);
}

/**
 * The editor page renders every settings group inside a <div class="panel collapsed">.
 * Collapsed panels animate max-height to 0, so all of their inputs are technically
 * "hidden" to Playwright. Open them all in one shot before interacting.
 */
async function expandAllPanels(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.querySelectorAll('.panel.collapsed').forEach((p) => p.classList.remove('collapsed'));
    document.querySelectorAll('details.settings-collapse').forEach((d) => d.setAttribute('open', ''));
  });
}

/** Navigate to the Script/Settings page (Allowed Domains, Publish, Proof Endpoint). */
async function gotoSettings(page: import('@playwright/test').Page) {
  await page.evaluate(() => { window.location.hash = '#settings'; });
  await expect(page.locator('#page-settings')).toHaveClass(/page-active/);
  await expandAllPanels(page);
}

/**
 * The Allowed Domains list is gated on a non-empty Proof Endpoint:
 * loadDomains() bails early otherwise. Set the field, kick the loader.
 */
async function primeDomainsList(page: import('@playwright/test').Page) {
  await gotoSettings(page);
  const proofEndpoint = await makeProofEndpoint(page);
  await page.locator('#proof-endpoint').fill(proofEndpoint);
  await page.evaluate(() => (window as any).loadDomains());
  await expect(page.locator('#domains-list')).not.toContainText('Loading...', { timeout: 5_000 });
}

test.describe('configurator editor', () => {
  test('editor page is active by default after login', async ({ loggedInPage }) => {
    await expect(loggedInPage.locator('#page-editor')).toHaveClass(/page-active/);
    await expect(loggedInPage.locator('#page-history')).not.toHaveClass(/page-active/);
  });

  test('add an allowed-origin domain through the UI', async ({ loggedInPage }) => {
    await primeDomainsList(loggedInPage);

    const origin = `https://e2e-${Date.now()}.example.com`;
    await loggedInPage.locator('#new-domain-input').fill(origin);
    await loggedInPage.locator('button[onclick="addDomain()"]').click();

    await expect(loggedInPage.locator('#domains-list')).toContainText(origin, { timeout: 5_000 });
    // The input is cleared on success.
    await expect(loggedInPage.locator('#new-domain-input')).toHaveValue('');
  });

  test('adding a duplicate domain does not create a second row', async ({ loggedInPage }) => {
    await primeDomainsList(loggedInPage);

    const origin = `https://dup-${Date.now()}.example.com`;
    const input = loggedInPage.locator('#new-domain-input');
    const addBtn = loggedInPage.locator('button[onclick="addDomain()"]');

    await input.fill(origin);
    await addBtn.click();
    await expect(loggedInPage.locator('#domains-list')).toContainText(origin, { timeout: 5_000 });

    const countAfterFirst = await loggedInPage.evaluate((o) => {
      return Array.from(document.querySelectorAll('#domains-list span'))
        .filter((el) => el.textContent === o).length;
    }, origin);
    expect(countAfterFirst).toBe(1);

    await input.fill(origin);
    await addBtn.click();
    // Give the add request a moment to come back; loadDomains() re-renders the list.
    await loggedInPage.waitForTimeout(500);

    const countAfterSecond = await loggedInPage.evaluate((o) => {
      return Array.from(document.querySelectorAll('#domains-list span'))
        .filter((el) => el.textContent === o).length;
    }, origin);
    expect(countAfterSecond).toBe(1);
  });

  test('edit banner title, publish, and verify the saved value round-trips', async ({ loggedInPage }) => {
    const domain = `e2e-${Date.now()}.example.com`;
    const newTitle = `E2E banner ${Date.now()}`;

    // Banner title is on the editor page (collapsed panel).
    await expandAllPanels(loggedInPage);
    await loggedInPage.locator('#txt-banner-title').fill(newTitle);
    // Flush scheduleUpdate's 150ms debounce so the in-memory config is current
    // before we head to the Settings page.
    await loggedInPage.waitForTimeout(250);

    // Publish lives on the settings page.
    await gotoSettings(loggedInPage);
    await loggedInPage.locator('#publish-domain').fill(domain);
    await loggedInPage.locator('button[onclick="publishConfig()"]').click();
    await expect(loggedInPage.locator('#publish-status')).toContainText(/Published at|just now/, { timeout: 8_000 });

    // Verify the public CDN endpoint returns the title we just saved.
    const apiTitle = await loggedInPage.evaluate(async (d) => {
      const r = await fetch(`/api/config/${encodeURIComponent(d)}`);
      const j = await r.json();
      return j?.config?.translations?.en?.banner?.title ?? null;
    }, domain);
    expect(apiTitle).toBe(newTitle);

    // Reload and confirm the SPA rehydrates the title from the server.
    await loggedInPage.reload();
    await expect(loggedInPage.locator('#login-gate')).toHaveClass(/hidden/, { timeout: 5_000 });
    await expandAllPanels(loggedInPage);
    await expect(loggedInPage.locator('#txt-banner-title')).toHaveValue(newTitle, { timeout: 8_000 });
  });

  test('toggle live preview shows the cc-banner inside the embedded widget', async ({ loggedInPage }) => {
    await loggedInPage.locator('button[onclick="previewBanner()"]').click();

    await expect.poll(async () => {
      return loggedInPage.locator('#cc-preview').evaluate((el: any) => {
        const banner = el.shadowRoot?.querySelector('.cc-banner');
        return !!banner && banner.classList.contains('visible');
      });
    }, { timeout: 5_000, message: 'banner became visible' }).toBe(true);
  });
});
