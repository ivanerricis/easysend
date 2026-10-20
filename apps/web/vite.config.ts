import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiPort = process.env['DEV_API_PORT'] ?? '3000';
const webPort = Number(process.env['DEV_WEB_PORT'] ?? '5173');

/**
 * Turns an inline <style> injector of a dependency into a no-op: the CSP (`style-src 'self'`)
 * blocks those elements, and the same CSS ships in our stylesheet instead. The build fails if the
 * dependency is bundled but the injector was not found (e.g. after an update changed its code),
 * so a silent CSP regression cannot slip through.
 */
function withoutStyleInjection(name: string, pathPart: string, signature: string): Plugin {
  let seen = false;
  let patched = false;
  return {
    name,
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes(pathPart)) return null;
      seen = true;
      if (!code.includes(signature)) return null;
      patched = true;
      return code.replace(signature, `${signature} return;`);
    },
    buildEnd() {
      if (seen && !patched) this.error(`${name}: "${signature}" not found in ${pathPart}`);
    },
  };
}

/**
 * Empties the CSS text a dependency puts in an inline <style> (the empty element is allowed by the
 * CSP hash; the rules themselves live in `src/index.css`). Same build-failure guard as above.
 */
function withoutInlineCss(name: string, pathPart: string, css: string): Plugin {
  let seen = false;
  let patched = false;
  return {
    name,
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes(pathPart)) return null;
      seen = true;
      if (!code.includes(css)) return null;
      patched = true;
      return code.replace(css, '');
    },
    buildEnd() {
      if (seen && !patched) this.error(`${name}: inline CSS not found in ${pathPart}`);
    },
  };
}

export default defineConfig({
  plugins: [
    // Radix Select hides the scrollbar of its viewport with an inline <style>: rules in index.css.
    withoutInlineCss(
      'select-viewport-no-inline-css',
      '/@radix-ui/react-select/dist/',
      '[data-radix-select-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-select-viewport]::-webkit-scrollbar{display:none}',
    ),
    // sonner: CSS imported from `src/index.css`.
    withoutStyleInjection(
      'sonner-no-style-injection',
      '/sonner/dist/index.mjs',
      'function __insertCSS(code) {',
    ),
    // react-remove-scroll (Radix dialogs and sheets): static `body[data-scroll-locked]` rules
    // live in `src/index.css`.
    withoutStyleInjection(
      'scroll-lock-no-style-injection',
      '/react-style-singleton/dist/',
      'function insertStyleTag(tag) {',
    ),
    react(),
    tailwindcss(),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Zod and `lib/zod-jitless.ts` share a chunk, so the setting runs before any schema is
        // created by the chunks that depend on it.
        advancedChunks: {
          groups: [{ name: 'zod', test: /node_modules\/zod\/|zod-jitless/ }],
        },
      },
    },
  },
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
