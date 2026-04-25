import { test, expect } from '../helpers/fixtures';
import { putConfig, defaultConfig } from '../helpers/api';

function uniqueDomain(prefix = 'cfg') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.example.com`.toLowerCase();
}

test.describe('PUT /api/config', () => {
  test('returns 401 without auth', async ({ playwright, appBase }) => {
    const fresh = await playwright.request.newContext({ baseURL: appBase });
    const res = await fresh.put('/api/config', {
      data: { domain: uniqueDomain('noauth'), config: defaultConfig(), css_vars: {} },
    });
    expect(res.status()).toBe(401);
    await fresh.dispose();
  });

  test('returns 401 with cookie but no CSRF header', async ({ api, user }) => {
    // user fixture set ce_session + ce_csrf cookies on `api`. Omit X-CSRF-Token.
    const res = await api.put('/api/config', {
      data: { domain: uniqueDomain('nocsrf'), config: defaultConfig(), css_vars: {} },
    });
    // Server collapses both auth-fail and csrf-fail into 401 Unauthorized.
    expect(res.status()).toBe(401);
  });

  test('saves config with cookie + CSRF', async ({ api, user }) => {
    const domain = uniqueDomain('save');
    const result = await putConfig(api, user.csrfToken, domain, defaultConfig(), {});
    expect(result.domain).toBe(domain);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  test('updates existing domain config', async ({ api, user }) => {
    const domain = uniqueDomain('update');
    await putConfig(api, user.csrfToken, domain, defaultConfig(), {});

    const updated = defaultConfig({
      translations: {
        en: { banner: { title: 'Updated banner', description: 'v2', acceptAll: 'OK', rejectAll: 'No', settings: 'Prefs' } },
      },
    });
    await putConfig(api, user.csrfToken, domain, updated, {});

    const res = await api.get(`/api/config/${domain}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.config.translations.en.banner.title).toBe('Updated banner');
  });
});

test.describe('GET /api/config/:domain (public)', () => {
  test('returns saved config without auth', async ({ api, user, playwright, appBase }) => {
    const domain = uniqueDomain('pub');
    await putConfig(api, user.csrfToken, domain, defaultConfig(), {});

    // Fetch with no cookies at all to confirm it's public.
    const fresh = await playwright.request.newContext({ baseURL: appBase });
    const res = await fresh.get(`/api/config/${domain}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.config.translations.en.banner.title).toBe('E2E test banner');
    await fresh.dispose();
  });

  test('returns 404 for unknown domain', async ({ api }) => {
    const res = await api.get(`/api/config/${uniqueDomain('missing')}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

test.describe('ETag / If-None-Match', () => {
  test('returns ETag header and honors If-None-Match with 304', async ({ api, user }) => {
    const domain = uniqueDomain('etag');
    await putConfig(api, user.csrfToken, domain, defaultConfig(), {});

    const first = await api.get(`/api/config/${domain}`);
    expect(first.status()).toBe(200);
    const etag = first.headers()['etag'];
    expect(etag).toBeTruthy();

    const second = await api.get(`/api/config/${domain}`, { headers: { 'If-None-Match': etag } });
    expect(second.status()).toBe(304);
  });
});
