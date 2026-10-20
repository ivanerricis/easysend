import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiPort = process.env['DEV_API_PORT'] ?? '3000';
const webPort = Number(process.env['DEV_WEB_PORT'] ?? '5173');

/**
 * sonner injects its stylesheet through an inline <style> element at import time, which the CSP
 * (`style-src 'self'`) blocks. The same CSS is imported from `src/index.css` instead, so the
 * injector is turned into a no-op.
 */
function sonnerWithoutStyleInjection(): Plugin {
  return {
    name: 'sonner-no-style-injection',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes('/sonner/dist/index.mjs')) return null;
      return code.replace('function __insertCSS(code) {', 'function __insertCSS(code) { return;');
    },
  };
}

export default defineConfig({
  plugins: [sonnerWithoutStyleInjection(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        xfwd: true,
      },
    },
  },
});
