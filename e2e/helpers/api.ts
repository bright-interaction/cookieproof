import type { APIRequestContext } from '@playwright/test';

export const TEST_PASSWORD = 'TestPass123!';

export type RegisteredUser = {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  csrfToken: string;
};

let counter = 0;
export function uniqueEmail(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Register a fresh org+owner. Returns credentials and the CSRF token. */
export async function registerUser(api: APIRequestContext, opts: { email?: string; password?: string; workspaceName?: string } = {}): Promise<RegisteredUser> {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? TEST_PASSWORD;
  const res = await api.post('/api/auth/register', {
    data: {
      email,
      password,
      display_name: 'E2E Tester',
      workspace_name: opts.workspaceName ?? 'E2E Workspace',
    },
  });
  if (res.status() !== 201) {
    throw new Error(`register failed ${res.status()}: ${await res.text()}`);
  }
  const body = await res.json();
  return {
    email,
    password,
    userId: body.user.id,
    orgId: body.user.org_id,
    csrfToken: body.csrf_token,
  };
}

/** Log in an existing user. */
export async function loginUser(api: APIRequestContext, email: string, password: string): Promise<{ csrfToken: string }> {
  const res = await api.post('/api/auth/login', { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed ${res.status()}: ${await res.text()}`);
  const body = await res.json();
  return { csrfToken: body.csrf_token };
}

/** Create or update a domain config. */
export async function putConfig(api: APIRequestContext, csrfToken: string, domain: string, config: any, cssVars: any = {}) {
  const res = await api.put('/api/config', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { domain, config, css_vars: cssVars },
  });
  if (!res.ok()) throw new Error(`putConfig failed ${res.status()}: ${await res.text()}`);
  return res.json();
}

/** Add an allowed origin for this org. */
export async function addAllowedOrigin(api: APIRequestContext, csrfToken: string, origin: string) {
  const res = await api.post('/api/settings/domains', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { origin },
  });
  if (!res.ok()) throw new Error(`addAllowedOrigin failed ${res.status()}: ${await res.text()}`);
  return res.json();
}

/** Default banner config for tests: three categories, a known title. */
export function defaultConfig(overrides: Record<string, any> = {}) {
  return {
    categories: [
      { id: 'necessary', required: true, label: 'Necessary' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'marketing', label: 'Marketing' },
    ],
    translations: {
      en: {
        banner: {
          title: 'E2E test banner',
          description: 'Round-trip from configurator to widget.',
          acceptAll: 'Accept all',
          rejectAll: 'Reject all',
          settings: 'Preferences',
        },
      },
    },
    ...overrides,
  };
}
