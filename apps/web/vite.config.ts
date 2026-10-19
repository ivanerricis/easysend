import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env['DEV_API_PORT'] ?? '3000';
const webPort = Number(process.env['DEV_WEB_PORT'] ?? '5173');

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
