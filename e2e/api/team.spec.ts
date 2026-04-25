import { test, expect } from '../helpers/fixtures';
import { addAllowedOrigin, putConfig, defaultConfig, registerUser, loginUser, uniqueEmail, TEST_PASSWORD } from '../helpers/api';

function uniqueDomain(prefix = 'iso') {
  // Server lowercases all domains on PUT /api/config, so build lowercase to begin with.
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.example.com`.toLowerCase();
}

// /api/team/* lives behind the Enterprise Edition gate. With no
// COOKIEPROOF_LICENSE_KEY set in the test env (see api/server.ts L12, L3992),
// every team route returns 403 with a license error. These tests pin that
// contract so a future EE-on test environment can flip them deliberately.
test.describe('Team routes (EE-gated in OSS test env)', () => {
  test('GET /api/team/members returns 403 EE license error', async ({ api, user }) => {
    const res = await api.get('/api/team/members');
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Enterprise/i);
  });

  test('POST /api/team/invite returns 403 EE license error', async ({ api, user }) => {
    const res = await api.post('/api/team/invite', {
      headers: { 'X-CSRF-Token': user.csrfToken },
      data: { email: uniqueEmail('invitee'), account_type: 'member' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Enterprise/i);
  });

  test('DELETE /api/team/members/:self returns 403 EE license error', async ({ api, user }) => {
    const res = await api.delete(`/api/team/members/${user.userId}`, {
      headers: { 'X-CSRF-Token': user.csrfToken },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Enterprise/i);
  });
});

// Cross-org isolation is enforced by /api/config and /api/settings/domains
// (NOT EE-gated), so this still exercises the multi-tenant guarantee.
test('domain configs do NOT leak across orgs', async ({ playwright, appBase }) => {
  const ctxA = await playwright.request.newContext({ baseURL: appBase });
  const ctxB = await playwright.request.newContext({ baseURL: appBase });
  try {
    const a = await registerUser(ctxA, { workspaceName: 'Org A' });
    const b = await registerUser(ctxB, { workspaceName: 'Org B' });
    expect(a.orgId).not.toBe(b.orgId);

    const aDomain = uniqueDomain('orgA');
    await addAllowedOrigin(ctxA, a.csrfToken, `https://${aDomain}`);
    await putConfig(ctxA, a.csrfToken, aDomain, defaultConfig(), {});

    // Org B should NOT see Org A's domains in its allowed-domains listing.
    const bDomains = await ctxB.get('/api/settings/domains');
    expect(bDomains.status()).toBe(200);
    const bBody = await bDomains.json();
    const bOrigins: string[] = (bBody.domains || []).map((d: any) => d.origin);
    for (const o of bOrigins) {
      expect(o).not.toContain(aDomain);
    }

    // Org B should NOT see Org A's domain configs in its /api/config list.
    const bConfigs = await ctxB.get('/api/config');
    expect(bConfigs.status()).toBe(200);
    const bConfigsBody = await bConfigs.json();
    const bConfigDomains: string[] = (bConfigsBody.configs || []).map((c: any) => c.domain);
    expect(bConfigDomains).not.toContain(aDomain);

    // Org A obviously should see its own domain in /api/config.
    const aConfigs = await ctxA.get('/api/config');
    expect(aConfigs.status()).toBe(200);
    const aConfigsBody = await aConfigs.json();
    const aConfigDomains: string[] = (aConfigsBody.configs || []).map((c: any) => c.domain);
    expect(aConfigDomains).toContain(aDomain);
  } finally {
    await ctxA.dispose();
    await ctxB.dispose();
  }
});
