import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // argon2, sharp and the encryption tests are CPU-bound: keep slow CI runners from timing out.
    testTimeout: 15_000,
  },
});
