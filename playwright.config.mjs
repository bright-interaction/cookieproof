import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3456',
    actionTimeout: 5_000,
  },
  webServer: {
    command: 'cp dist/cookieproof.umd.js e2e/fixtures/ && npx http-server e2e/fixtures -p 3456 --silent',
    port: 3456,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
