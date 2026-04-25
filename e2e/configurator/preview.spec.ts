import { test, expect } from '../helpers/fixtures';

async function expandAllPanels(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.querySelectorAll('.panel.collapsed').forEach((p) => p.classList.remove('collapsed'));
  });
}

async function bannerVisible(page: import('@playwright/test').Page): Promise<boolean> {
  return page.locator('#cc-preview').evaluate((el: any) => {
    const banner = el.shadowRoot?.querySelector('.cc-banner');
    return !!banner && banner.classList.contains('visible');
  });
}

async function prefsVisible(page: import('@playwright/test').Page): Promise<boolean> {
  return page.locator('#cc-preview').evaluate((el: any) => {
    const prefs = el.shadowRoot?.querySelector('.cc-preferences');
    return !!prefs && prefs.classList.contains('visible');
  });
}

async function bannerTitle(page: import('@playwright/test').Page): Promise<string | null> {
  return page.locator('#cc-preview').evaluate((el: any) => {
    const t = el.shadowRoot?.querySelector('.cc-banner-title');
    return t ? t.textContent : null;
  });
}

test.describe('configurator preview', () => {
  test('previewPrefs() opens the preferences modal in the embedded widget', async ({ loggedInPage }) => {
    await loggedInPage.locator('button[onclick="previewPrefs()"]').click();

    await expect.poll(() => prefsVisible(loggedInPage), {
      timeout: 5_000,
      message: 'preferences modal became visible',
    }).toBe(true);
  });

  test('editing #txt-banner-title updates the preview banner text live', async ({ loggedInPage }) => {
    await expandAllPanels(loggedInPage);
    // Make sure the banner is showing so we can read its title text.
    await loggedInPage.locator('button[onclick="previewBanner()"]').click();
    await expect.poll(() => bannerVisible(loggedInPage), { timeout: 5_000 }).toBe(true);

    const newTitle = `Live preview ${Date.now()}`;
    await loggedInPage.locator('#txt-banner-title').fill(newTitle);
    // scheduleUpdate() debounces 150ms; wait a tick longer than that.
    await expect.poll(async () => bannerTitle(loggedInPage), {
      timeout: 5_000,
      message: 'shadow DOM banner title updated',
    }).toBe(newTitle);
  });

  test('preview reflects banner button text changes', async ({ loggedInPage }) => {
    await expandAllPanels(loggedInPage);
    await loggedInPage.locator('button[onclick="previewBanner()"]').click();
    await expect.poll(() => bannerVisible(loggedInPage), { timeout: 5_000 }).toBe(true);

    const acceptText = `Yes ${Date.now()}`;
    await loggedInPage.locator('#txt-banner-accept').fill(acceptText);

    await expect.poll(async () => {
      return loggedInPage.locator('#cc-preview').evaluate((el: any) => {
        const root = el.shadowRoot;
        const btns = root ? Array.from(root.querySelectorAll('.cc-banner-actions button, .cc-banner button, button')) : [];
        return btns.map((b: any) => (b.textContent || '').trim());
      });
    }, { timeout: 5_000, message: 'accept button text updated' }).toContain(acceptText);
  });

  // The configurator's preview component renders into shadow DOM and the
  // dedicated preview-pane theme switch (`data-theme` flip on #cc-preview)
  // is not exposed in the current build; the global theme radios under
  // Design only re-emit CSS variables. Skip rather than chase a moving target.
  test.skip('theme toggle flips data-theme on #cc-preview', async () => {
    // Intentionally skipped, see comment above.
  });
});
