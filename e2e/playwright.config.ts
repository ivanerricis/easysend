import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = join(dirname(fileURLToPath(import.meta.url)), '.output');

// Locally the installed Edge is used on purpose: browsers are never downloaded. CI sets
// PW_CHANNEL=chromium (or empty) to use the bundled Chromium.
const channel =
  process.env.PW_CHANNEL === 'chromium' || process.env.PW_CHANNEL === ''
    ? undefined
    : (process.env.PW_CHANNEL ?? 'msedge');

export default defineConfig({
  // The specs depend on each other (the setup wizard first, then the same instance for the
  // rest), so everything runs in one worker, in file order. No retries: a retry would repeat
  // side effects on a stack that already changed.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: join(output, 'report'), open: 'never' }]],
  outputDir: join(output, 'test-results'),
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18090',
    ...(channel ? { channel } : {}),
    locale: 'it-IT',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testDir: './tests', testMatch: 'setup.spec.ts' },
    {
      name: 'e2e',
      testDir: './tests',
      testIgnore: 'setup.spec.ts',
      dependencies: ['setup'],
    },
    {
      // One long test: wizard, a transfer and every page in two themes.
      name: 'screenshots',
      testDir: './screenshots',
      testMatch: '*.spec.ts',
      timeout: 360_000,
    },
  ],
});
