import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The suite contains both a real Electron launch and a 5k-node browser
  // stress case. Running them concurrently makes their timing depend on CPU
  // contention instead of the SDK, so the release gate is deliberately
  // deterministic and sequential.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 1440, height: 900 },
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
