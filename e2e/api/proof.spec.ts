import { test, expect } from '../helpers/fixtures';
import { addAllowedOrigin, putConfig, defaultConfig } from '../helpers/api';

function uniqueDomain(prefix = 'proof') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.example.com`.toLowerCase();
}

async function setupAllowedDomain(api: any, csrfToken: string, domain: string) {
  await addAllowedOrigin(api, csrfToken, `https://${domain}`);
  await putConfig(api, csrfToken, domain, defaultConfig(), {});
}

test('POST /api/proof records consent for an allowed domain', async ({ api, user }) => {
  const domain = uniqueDomain('record');
  await setupAllowedDomain(api, user.csrfToken, domain);

  const res = await api.post('/api/proof', {
    data: {
      url: `https://${domain}/page`,
      consent: { method: 'custom', categories: { necessary: true, analytics: true, marketing: false } },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
});

test('POST /api/proof rejects domain not in allowed origins with 403', async ({ api, user }) => {
  // Set up one allowed domain, then post against a different one.
  const allowed = uniqueDomain('allowed');
  await setupAllowedDomain(api, user.csrfToken, allowed);

  const other = uniqueDomain('blocked');
  const res = await api.post('/api/proof', {
    data: {
      url: `https://${other}/page`,
      consent: { method: 'custom', categories: { necessary: true } },
    },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('Domain not in allowed origins');
});

test('POST /api/proof rejects non-http URL schemes with 400', async ({ api, user }) => {
  const domain = uniqueDomain('ftp');
  await setupAllowedDomain(api, user.csrfToken, domain);

  const res = await api.post('/api/proof', {
    data: {
      url: `ftp://${domain}/file`,
      consent: { method: 'custom', categories: { necessary: true } },
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBeTruthy();
});

test('GET /api/proof lists proofs recorded for the org', async ({ api, user }) => {
  const domain = uniqueDomain('list');
  await setupAllowedDomain(api, user.csrfToken, domain);

  const post = await api.post('/api/proof', {
    data: {
      url: `https://${domain}/page`,
      consent: { method: 'accept-all', categories: { necessary: true, analytics: true } },
    },
  });
  expect(post.status()).toBe(201);
  const { id } = await post.json();

  const list = await api.get('/api/proof');
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(Array.isArray(body.data)).toBe(true);
  const found = body.data.find((p: any) => p.id === id);
  expect(found).toBeTruthy();
  expect(found.domain).toBe(domain);
  expect(found.method).toBe('accept-all');
});

test('GET /api/proof requires auth', async ({ playwright, appBase }) => {
  const fresh = await playwright.request.newContext({ baseURL: appBase });
  const res = await fresh.get('/api/proof');
  expect(res.status()).toBe(401);
  await fresh.dispose();
});

test('GET /api/proof/stats returns totals and method breakdown', async ({ api, user }) => {
  const domain = uniqueDomain('stats');
  await setupAllowedDomain(api, user.csrfToken, domain);

  await api.post('/api/proof', {
    data: { url: `https://${domain}/p1`, consent: { method: 'accept-all', categories: { necessary: true, analytics: true } } },
  });
  await api.post('/api/proof', {
    data: { url: `https://${domain}/p2`, consent: { method: 'reject-all', categories: { necessary: true } } },
  });

  const res = await api.get('/api/proof/stats');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.summary).toBeTruthy();
  expect(typeof body.summary.total).toBe('number');
  expect(body.summary.total).toBeGreaterThanOrEqual(2);
  expect(typeof body.summary.accept_all).toBe('number');
  expect(typeof body.summary.reject_all).toBe('number');
  expect(typeof body.summary.custom).toBe('number');
  expect(Array.isArray(body.daily)).toBe(true);
});

test('GET /api/proof/export returns CSV with at least one row', async ({ api, user }) => {
  const domain = uniqueDomain('export');
  await setupAllowedDomain(api, user.csrfToken, domain);

  const post = await api.post('/api/proof', {
    data: { url: `https://${domain}/p`, consent: { method: 'custom', categories: { necessary: true, analytics: false } } },
  });
  expect(post.status()).toBe(201);

  const res = await api.get('/api/proof/export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const text = await res.text();
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  // header + at least one row
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines[0]).toContain('id');
  expect(lines[0]).toContain('domain');
});
