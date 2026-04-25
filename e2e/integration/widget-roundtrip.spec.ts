import { test, expect } from '../helpers/fixtures';
import { putConfig, defaultConfig } from '../helpers/api';

const FIXTURE_URL = '/e2e/fixtures/integration-page.html';
const PROOF_URL_RE = /\/api\/proof(\?|$)/;

/** Each test claims its own domain so they don't fight over org ownership of "localhost". */
function uniqueTestDomain(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.test`;
}

function fixtureUrlWithDomain(domain: string): string {
  const proofUrl = `https://${domain}/integration-test`;
  return `${FIXTURE_URL}?proofUrlOverride=${encodeURIComponent(proofUrl)}`;
}

test.describe('Widget round-trip', () => {
  test('Accept All: dashboard config -> widget banner -> proof recorded', async ({ api, user, page }) => {
    const domain = uniqueTestDomain('accept');

    // 1. Dashboard side: publish a banner config for this domain.
    //    putConfig auto-derives https://<domain> as an allowed origin for proofs.
    await putConfig(api, user.csrfToken, domain, defaultConfig());

    // 2. Widget side: load the simulated client website.
    await page.goto(fixtureUrlWithDomain(domain));

    // Banner appears with the configured title.
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cc-banner-title')).toHaveText('E2E test banner');

    // 3. User action + 4. Round-trip: clicking Accept All triggers a POST /api/proof.
    const proofResponsePromise = page.waitForResponse(
      (r) => PROOF_URL_RE.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10_000 }
    );
    await page.locator('.cc-btn-accept').click();
    const proofResponse = await proofResponsePromise;
    expect(proofResponse.status()).toBe(201);

    // 5. Dashboard side: the new consent record shows up scoped to this org.
    await expect.poll(async () => {
      const res = await api.get(`/api/proof?domain=${domain}`);
      if (!res.ok()) return null;
      const body = await res.json();
      return Array.isArray(body.data) ? body.data.length : 0;
    }, { timeout: 5_000, intervals: [100, 250, 500] }).toBeGreaterThan(0);

    const listRes = await api.get(`/api/proof?domain=${domain}`);
    const list = await listRes.json();
    const proof = list.data[0];
    expect(proof.method).toBe('accept-all');
    expect(proof.domain).toBe(domain);
    expect(proof.categories.necessary).toBe(true);
    expect(proof.categories.analytics).toBe(true);
    expect(proof.categories.marketing).toBe(true);
  });

  test('Reject All: proof recorded with non-essential categories false', async ({ api, user, page }) => {
    const domain = uniqueTestDomain('reject');
    await putConfig(api, user.csrfToken, domain, defaultConfig());

    await page.goto(fixtureUrlWithDomain(domain));
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 5_000 });

    const proofResponsePromise = page.waitForResponse(
      (r) => PROOF_URL_RE.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10_000 }
    );
    await page.locator('.cc-btn-reject').click();
    const proofResponse = await proofResponsePromise;
    expect(proofResponse.status()).toBe(201);

    await expect.poll(async () => {
      const res = await api.get(`/api/proof?domain=${domain}&method=reject-all`);
      if (!res.ok()) return null;
      const body = await res.json();
      return Array.isArray(body.data) ? body.data.length : 0;
    }, { timeout: 5_000, intervals: [100, 250, 500] }).toBeGreaterThan(0);

    const listRes = await api.get(`/api/proof?domain=${domain}&method=reject-all`);
    const list = await listRes.json();
    const proof = list.data[0];
    expect(proof.method).toBe('reject-all');
    expect(proof.domain).toBe(domain);
    expect(proof.categories.necessary).toBe(true);
    expect(proof.categories.analytics).toBe(false);
    expect(proof.categories.marketing).toBe(false);
  });

  test('Domain not in allowed origins -> API returns 403', async ({ user, page }) => {
    // user is registered but no domain config exists for this hostname,
    // and it isn't in ENV_ORIGINS, so the proof handler must reject.
    void user;

    const blockedDomain = uniqueTestDomain('blocked') + '.invalid';
    await page.goto(fixtureUrlWithDomain(blockedDomain));
    await expect(page.locator('.cc-banner.visible')).toBeVisible({ timeout: 5_000 });

    const proofResponsePromise = page.waitForResponse(
      (r) => PROOF_URL_RE.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10_000 }
    );
    await page.locator('.cc-btn-accept').click();
    const proofResponse = await proofResponsePromise;
    expect(proofResponse.status()).toBe(403);
  });

  test.skip('loader.js fetches /api/config/:domain and renders widget', async () => {
    // Loader-driven fetch path requires wiring loader.js to a fixture page that
    // points at a dynamically-resolved API host. The loader currently hard-codes
    // its config URL to consent.brightinteraction.com, so exercising it locally
    // would require either a build flag or a local-target loader variant.
    // Tracked as a follow-up. Tests 1-3 already prove the dashboard -> widget ->
    // API contract end-to-end via the inline init path.
  });
});
