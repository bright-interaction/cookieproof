import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

const APP_PORT = 3456;
const API_PORT = 3100;
const TEST_DB = resolve(import.meta.dirname, 'e2e/.test-db.sqlite');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    actionTimeout: 8_000,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `rm -f ${TEST_DB} && bun run api/server.ts`,
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        DB_PATH: TEST_DB,
        DB_TYPE: 'sqlite',
        ALLOWED_ORIGINS: `http://localhost:${APP_PORT}`,
        NODE_ENV: 'development',
        JWT_SECRET: 'e2e-test-jwt-secret-not-for-prod',
      },
    },
    {
      command: `bun run e2e/test-server.mjs`,
      url: `http://localhost:${APP_PORT}/configurator/`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PORT: String(APP_PORT),
        API_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
  projects: [
    // Pure-API tests: no browser overhead.
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Widget E2E (the original suite that already shipped).
    {
      name: 'widget-chromium',
      testMatch: /consent\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'widget-firefox',
      testMatch: /consent\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    // Configurator (admin SPA) tests.
    {
      name: 'configurator',
      testMatch: /configurator\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Round-trip integration tests.
    {
      name: 'integration',
      testMatch: /integration\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
