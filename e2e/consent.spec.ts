import { test, expect, type Page } from '@playwright/test';

/** Clear consent storage so each test starts fresh */
async function clearConsent(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
    document.cookie.split(';').forEach((c) => {
      document.cookie = c.trim().split('=')[0] + '=;expires=Thu,01 Jan 1970 00:00:00 GMT;path=/';
    });
  });
}

/** Reinitialize the component with custom config */
async function reinit(page: Page, config: Record<string, unknown>) {
  await page.evaluate((cfg) => {
    const el = document.querySelector('cookie-consent') as any;
    el.destroy();
    // Clear shadow DOM from previous init
    while (el.shadowRoot.firstChild) el.shadowRoot.firstChild.remove();
    localStorage.clear();
    el.init(cfg);
  }, config);
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/test-page.html');
  await clearConsent(page);
  await page.reload();
  await page.waitForTimeout(300);
});

test.describe('Banner', () => {
  test('renders on first visit', async ({ page }) => {
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cc-banner-title')).toHaveText('We respect your privacy');
  });

  test('Accept All hides banner and shows trigger', async ({ page }) => {
    await page.locator('.cc-btn-accept').click();

    // Banner should be hidden (no .visible class)
    await expect(page.locator('.cc-banner.visible')).toHaveCount(0, { timeout: 3000 });

    // Trigger should appear
    await expect(page.locator('.cc-trigger')).toBeVisible();

    // Analytics script should have executed
    await expect(page.locator('#status')).toHaveText('analytics-active');
  });

  test('Reject All hides banner, scripts stay blocked', async ({ page }) => {
    await page.locator('.cc-btn-reject').click();
    await expect(page.locator('.cc-banner.visible')).toHaveCount(0, { timeout: 3000 });

    // Scripts should NOT have executed
    await expect(page.locator('#status')).toHaveText('no-consent');
  });
});

test.describe('Preferences', () => {
  test('open, toggle, save', async ({ page }) => {
    await page.locator('.cc-btn-settings').click();
    await expect(page.locator('.cc-preferences.visible')).toBeVisible();

    // Toggle analytics ON by clicking the toggle track (the visible part)
    await page.locator('.cc-category[data-category="analytics"] .cc-toggle-track').click();

    // Save
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('.cc-preferences.visible')).toHaveCount(0, { timeout: 3000 });

    // Analytics script executed
    await expect(page.locator('#status')).toHaveText('analytics-active');

    // Marketing should NOT be active
    const marketingAttr = await page.locator('#status').getAttribute('data-marketing');
    expect(marketingAttr).toBeNull();
  });
});

test.describe('Floating trigger', () => {
  test('reopens preferences after consent', async ({ page }) => {
    await page.locator('.cc-btn-accept').click();

    const trigger = page.locator('.cc-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.locator('.cc-preferences.visible')).toBeVisible();
  });
});

test.describe('Reset', () => {
  test('clears consent and re-shows banner', async ({ page }) => {
    await page.locator('.cc-btn-accept').click();
    await expect(page.locator('.cc-banner.visible')).toHaveCount(0, { timeout: 3000 });

    // Reset via JS
    await page.evaluate(() => {
      (document.querySelector('cookie-consent') as any).reset();
    });

    // Banner should reappear
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('GPC signal', () => {
  test('honored — consent auto-set to rejected', async ({ page }) => {
    // Inject GPC before any page load
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, writable: false });
    });

    await clearConsent(page);
    await page.reload();
    await page.waitForTimeout(300);

    // Re-init with GPC enabled (reinit clears shadow DOM)
    await reinit(page, {
      categories: [
        { id: 'necessary', required: true },
        { id: 'analytics' },
        { id: 'marketing' },
      ],
      respectGPC: true,
    });

    // GPC should have auto-set consent (method: 'gpc')
    const consent = await page.evaluate(() => {
      return (document.querySelector('cookie-consent') as any).getConsent();
    });

    expect(consent).not.toBeNull();
    expect(consent.method).toBe('gpc');
    expect(consent.categories.analytics).toBe(false);
    expect(consent.categories.marketing).toBe(false);
  });
});

test.describe('Keyboard navigation', () => {
  test('Tab reaches banner buttons', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    const focused = await page.evaluate(() => {
      const el = document.querySelector('cookie-consent');
      const active = el?.shadowRoot?.activeElement;
      return active?.className ?? '';
    });

    expect(focused).toMatch(/cc-btn/);
  });

  test('Escape closes preferences', async ({ page }) => {
    await page.locator('.cc-btn-settings').click();
    await expect(page.locator('.cc-preferences.visible')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.cc-preferences.visible')).toHaveCount(0, { timeout: 3000 });
  });
});

test.describe('Dark theme', () => {
  test('renders with data-theme attribute', async ({ page }) => {
    await reinit(page, {
      categories: [
        { id: 'necessary', required: true },
        { id: 'analytics' },
      ],
      theme: 'dark',
    });

    const theme = await page.evaluate(() => {
      return document.querySelector('cookie-consent')?.getAttribute('data-theme');
    });
    expect(theme).toBe('dark');
  });
});

test.describe('Mobile viewport', () => {
  test('buttons render properly at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await clearConsent(page);
    await page.reload();
    await page.waitForTimeout(300);

    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cc-btn-accept')).toBeVisible();
    await expect(page.locator('.cc-btn-accept')).toBeEnabled();
  });
});

test.describe('Keyboard shortcut', () => {
  test('Alt+C opens preferences', async ({ page }) => {
    await page.locator('.cc-btn-accept').click();
    await expect(page.locator('.cc-banner.visible')).toHaveCount(0, { timeout: 3000 });

    // Press Alt+C
    await page.keyboard.press('Alt+c');

    await expect(page.locator('.cc-preferences.visible')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Headless mode', () => {
  test('no UI rendered, acceptAll still works', async ({ page }) => {
    await reinit(page, {
      categories: [
        { id: 'necessary', required: true },
        { id: 'analytics' },
      ],
      headless: true,
    });

    // No banner or overlay should exist in shadow DOM
    const bannerCount = await page.evaluate(() => {
      const el = document.querySelector('cookie-consent');
      return el?.shadowRoot?.querySelectorAll('.cc-banner').length ?? 0;
    });
    expect(bannerCount).toBe(0);

    // Programmatic acceptAll should work
    await page.evaluate(() => {
      (document.querySelector('cookie-consent') as any).acceptAll();
    });

    const consent = await page.evaluate(() => {
      return (document.querySelector('cookie-consent') as any).getConsent();
    });

    expect(consent).not.toBeNull();
    expect(consent.categories.analytics).toBe(true);
    expect(consent.categories.necessary).toBe(true);
  });
});

test.describe('Cross-tab sync', () => {
  test('accept in one tab, trigger appears in other', async ({ page, context }) => {
    const page2 = await context.newPage();
    await page2.goto('/test-page.html');
    await page2.waitForTimeout(300);

    // Wait for banner in both
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 3000 });
    await expect(page2.locator('.cc-banner.visible')).toBeVisible({ timeout: 3000 });

    // Accept in page 1
    await page.locator('.cc-btn-accept').click();
    await expect(page.locator('.cc-banner.visible')).toHaveCount(0, { timeout: 3000 });

    // Page 2 should sync — trigger visible
    await expect(page2.locator('.cc-trigger')).toBeVisible({ timeout: 5000 });

    await page2.close();
  });
});
