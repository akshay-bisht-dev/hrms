// End-to-end tests (Playwright). Needs the local stack: docker compose up -d, API, worker and frontend running.
// Run: npm run test:e2e   (base URL defaults to the Vite dev server)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
