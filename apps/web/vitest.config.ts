import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Above the 5 s `asyncUtilTimeout`: under a parallel run the first render of a lazy route
    // can take longer, and the `findBy*` timeout (with its useful message) must fire first.
    testTimeout: 15_000,
  },
});
