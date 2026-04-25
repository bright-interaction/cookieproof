import { test, expect } from '../helpers/fixtures';
import { TEST_PASSWORD, registerUser, loginUser, uniqueEmail } from '../helpers/api';

test.describe('POST /api/auth/register', () => {
  test('returns 201 with body shape and sets both cookies', async ({ api }) => {
    const email = uniqueEmail('reg-ok');
    const res = await api.post('/api/auth/register', {
      data: { email, password: TEST_PASSWORD, display_name: 'E2E Tester', workspace_name: 'E2E WS' },
    });
    expect(res.status()).toBe(201);

    const setCookies = res.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value);
    const joined = setCookies.join('\n');
    expect(joined).toMatch(/ce_session=/);
    expect(joined).toMatch(/ce_csrf=/);

    const body = await res.json();
    expect(body.user).toBeTruthy();
    expect(body.user.id).toBeTruthy();
    expect(body.user.email).toBe(email);
    expect(body.user.org_id).toBeTruthy();
    expect(body.user.role).toBe('owner');
    expect(body.org).toBeTruthy();
    expect(body.org.plan).toBe('trial');
    expect(typeof body.csrf_token).toBe('string');
    expect(body.csrf_token.length).toBeGreaterThan(20);
    expect(body.account_type).toBe('user');
    expect(body.email_verified).toBe(false);
  });

  test('rejects invalid email', async ({ api }) => {
    const res = await api.post('/api/auth/register', {
      data: { email: 'not-an-email', password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('rejects weak password (under 10 chars)', async ({ api }) => {
    const res = await api.post('/api/auth/register', {
      data: { email: uniqueEmail('weak'), password: 'Short1!' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('rejects missing password', async ({ api }) => {
    const res = await api.post('/api/auth/register', {
      data: { email: uniqueEmail('nopw') },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('duplicate email returns 400 with generic error', async ({ api }) => {
    const email = uniqueEmail('dup');
    const first = await api.post('/api/auth/register', {
      data: { email, password: TEST_PASSWORD, display_name: 'X', workspace_name: 'X' },
    });
    expect(first.status()).toBe(201);

    const second = await api.post('/api/auth/register', {
      data: { email, password: TEST_PASSWORD, display_name: 'Y', workspace_name: 'Y' },
    });
    expect(second.status()).toBe(400);
    const body = await second.json();
    expect(body.error).toBeTruthy();
    // SECURITY: message must be generic, not reveal account exists
    expect(body.error.toLowerCase()).not.toContain('exist');
    expect(body.error.toLowerCase()).not.toContain('already');
  });
});

test.describe('POST /api/auth/login', () => {
  test('succeeds with right password', async ({ api, user }) => {
    const res = await api.post('/api/auth/login', {
      data: { email: user.email, password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(user.email);
    expect(typeof body.csrf_token).toBe('string');
  });

  test('wrong password returns 401', async ({ api, user }) => {
    const res = await api.post('/api/auth/login', {
      data: { email: user.email, password: 'WrongPass999!' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('unknown email returns 401 (no user enumeration)', async ({ api }) => {
    const res = await api.post('/api/auth/login', {
      data: { email: uniqueEmail('ghost'), password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    // SECURITY: error message identical to wrong-password to avoid revealing user existence
    expect(body.error.toLowerCase()).not.toContain('not found');
    expect(body.error.toLowerCase()).not.toContain('does not exist');
  });
});

test.describe('GET /api/auth/me', () => {
  test('returns 401 without auth', async ({ playwright, appBase }) => {
    const fresh = await playwright.request.newContext({ baseURL: appBase });
    const res = await fresh.get('/api/auth/me');
    expect(res.status()).toBe(401);
    await fresh.dispose();
  });

  test('returns 200 with user shape when authed', async ({ api, user }) => {
    const res = await api.get('/api/auth/me');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user.userId);
    expect(body.user.email).toBe(user.email);
    expect(body.user.org_id).toBe(user.orgId);
  });
});

test.describe('POST /api/auth/logout', () => {
  test('clears cookies; subsequent /api/auth/me returns 401', async ({ api, user }) => {
    const meBefore = await api.get('/api/auth/me');
    expect(meBefore.status()).toBe(200);

    const logoutRes = await api.post('/api/auth/logout', { headers: { 'X-CSRF-Token': user.csrfToken } });
    expect(logoutRes.status()).toBe(200);
    const setCookies = logoutRes.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value).join('\n');
    expect(setCookies).toMatch(/ce_session=;/);
    expect(setCookies).toMatch(/ce_csrf=;/);

    const meAfter = await api.get('/api/auth/me');
    expect(meAfter.status()).toBe(401);
  });
});

test.describe('POST /api/auth/forgot-password', () => {
  test('returns 200 for valid known email', async ({ api, user }) => {
    const res = await api.post('/api/auth/forgot-password', { data: { email: user.email } });
    // Server returns 200 for both cases to avoid enumeration
    expect([200, 202]).toContain(res.status());
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('returns 200 for unknown email (no user enumeration)', async ({ api }) => {
    const res = await api.post('/api/auth/forgot-password', { data: { email: uniqueEmail('ghost-forgot') } });
    expect([200, 202]).toContain(res.status());
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

test.describe('register + login round trip helper', () => {
  test('helpers register then login the same user', async ({ api }) => {
    const u = await registerUser(api);
    expect(u.userId).toBeTruthy();
    // Drop the cookies we just got, then login fresh.
    await api.post('/api/auth/logout', { headers: { 'X-CSRF-Token': u.csrfToken } });
    const { csrfToken } = await loginUser(api, u.email, u.password);
    expect(csrfToken).toBeTruthy();
  });
});
