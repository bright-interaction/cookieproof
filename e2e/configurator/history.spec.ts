import { test, expect } from '../helpers/fixtures';
import { putConfig, defaultConfig } from '../helpers/api';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

const SEED_DOMAIN = `e2e-history-${Date.now()}.example.com`;
const SEED_ORIGIN = `https://${SEED_DOMAIN}`;

async function seedProofs(
  page: import('@playwright/test').Page,
  domain: string,
  count: number,
  method: 'accept-all' | 'reject-all' | 'custom' | 'gpc' = 'accept-all',
) {
  const results = await page.evaluate(async ({ domain, count, method }) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const r = await fetch('/api/proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          consent: { method, categories: { necessary: true, analytics: method === 'accept-all', marketing: method === 'accept-all' } },
          url: `https://${domain}/page${i}`,
        }),
      });
      out.push(r.status);
    }
    return out;
  }, { domain, count, method });
  for (const s of results) {
    if (s !== 201) throw new Error(`seedProofs got status ${s}`);
  }
}

async function gotoHistory(page: import('@playwright/test').Page) {
  await page.evaluate(() => { window.location.hash = '#history'; });
  await expect(page.locator('#page-history')).toHaveClass(/page-active/);
  await expect(page.locator('.history-table')).toBeVisible();
}

test.describe('configurator history', () => {
  test('history page renders the table', async ({ loggedInPage }) => {
    await gotoHistory(loggedInPage);
    await expect(loggedInPage.locator('.history-table')).toBeVisible();
    await expect(loggedInPage.locator('#history-tbody')).toBeVisible();
  });

  test('table shows the rows we seeded', async ({ loggedInPage, user, api }) => {
    // Configure the domain so allowed_origins auto-derives https://<domain>.
    await putConfig(api, user.csrfToken, SEED_DOMAIN, defaultConfig());
    await seedProofs(loggedInPage, SEED_DOMAIN, 3, 'accept-all');

    await gotoHistory(loggedInPage);
    // The router calls loadHistory on entry, but it's async, so wait for rows.
    await expect.poll(async () => {
      return loggedInPage.locator('#history-tbody tr').count();
    }, { timeout: 8_000, message: 'history rows seeded' }).toBeGreaterThanOrEqual(3);

    await expect(loggedInPage.locator('#history-tbody')).toContainText(SEED_DOMAIN);
  });

  test('filter by method narrows the result set', async ({ loggedInPage, user, api }) => {
    const filterDomain = `e2e-filter-${Date.now()}.example.com`;
    await putConfig(api, user.csrfToken, filterDomain, defaultConfig());
    await seedProofs(loggedInPage, filterDomain, 2, 'accept-all');
    await seedProofs(loggedInPage, filterDomain, 2, 'reject-all');

    await gotoHistory(loggedInPage);
    await loggedInPage.locator('#history-domain').fill(filterDomain);
    // history-domain has no onchange wired into our flow; trigger reload.
    await loggedInPage.evaluate(() => (window as any).loadHistory());
    await expect.poll(() => loggedInPage.locator('#history-tbody tr').count(), { timeout: 8_000 }).toBeGreaterThanOrEqual(4);

    await loggedInPage.locator('#history-method').selectOption('accept-all');
    // selectOption fires change which calls loadHistory.
    await expect.poll(async () => {
      const badges = await loggedInPage.locator('#history-tbody .method-badge').allInnerTexts();
      return badges.length > 0 && badges.every((b) => b === 'accept-all');
    }, { timeout: 8_000, message: 'all visible rows are accept-all' }).toBe(true);

    const visibleRows = await loggedInPage.locator('#history-tbody tr').count();
    expect(visibleRows).toBeGreaterThanOrEqual(2);
    expect(visibleRows).toBeLessThanOrEqual(2);
  });

  test('export CSV downloads a CSV file with a header row', async ({ loggedInPage, user, api }) => {
    const exportDomain = `e2e-export-${Date.now()}.example.com`;
    await putConfig(api, user.csrfToken, exportDomain, defaultConfig());
    await seedProofs(loggedInPage, exportDomain, 2, 'accept-all');

    await gotoHistory(loggedInPage);
    await expect.poll(() => loggedInPage.locator('#history-tbody tr').count(), { timeout: 8_000 }).toBeGreaterThanOrEqual(2);

    const downloadPromise = loggedInPage.waitForEvent('download', { timeout: 8_000 });
    await loggedInPage.locator('button[onclick="exportCSV()"]').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const dir = mkdtempSync(join(tmpdir(), 'cp-csv-'));
    const dest = join(dir, download.suggestedFilename());
    await download.saveAs(dest);

    const contents = readFileSync(dest, 'utf8');
    const firstLine = contents.split('\n')[0] ?? '';
    // Header row must contain at least the canonical fields.
    expect(firstLine).toContain('id');
    expect(firstLine).toContain('domain');
    expect(firstLine).toContain('method');
    expect(firstLine).toContain('created_at');
  });
});
