import { defineConfig } from 'tsdown';

// Packages with native addons (or platform-specific optional packages) cannot be inlined: they are
// the only runtime `dependencies` of the API and the only ones installed in the Docker image.
// Every other dependency lives in `devDependencies` and is bundled into dist/.
const NATIVE = ['better-sqlite3', 'sharp', '@node-rs/argon2'];
const isNative = (id: string) => NATIVE.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/migrate': 'src/cli/migrate.ts',
    'cli/create-admin': 'src/cli/create-admin.ts',
    'cli/rotate-key': 'src/cli/rotate-key.ts',
    'cli/backup-db': 'src/cli/backup-db.ts',
    'cli/restore-db': 'src/cli/restore-db.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node26',
  outDir: 'dist',
  clean: true,
  // Production never runs with --enable-source-maps; with everything bundled the maps would weigh
  // several MB for nothing.
  sourcemap: false,
  // Bundle @easysend/shared (TS source) and all npm packages except the native ones. Third-party
  // license texts are written to dist/THIRD-PARTY-LICENSES.txt by scripts/third-party-licenses.mjs.
  deps: {
    alwaysBundle: (id: string) =>
      /^@easysend\//.test(id) ||
      (!isNative(id) && !id.startsWith('node:') && !id.startsWith('.') && !id.startsWith('/')),
    onlyBundle: false,
  },
  // Emit .js (the package is type: module) so the Docker CMD is `node dist/index.js`.
  fixedExtension: false,
});
