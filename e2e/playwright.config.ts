import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '.output',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18080',
    // The installed Edge is used on purpose: browsers are never downloaded.
    channel: process.env.PW_CHANNEL ?? 'msedge',
    locale: 'it-IT',
  },
  projects: [{ name: 'chromium' }],
});
