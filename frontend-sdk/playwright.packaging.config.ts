import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'packaging.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
});
