import { defineConfig } from 'tsdown';

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
  sourcemap: true,
  // @easysend/shared is consumed as TS source: inline it. Everything else stays external.
  deps: { alwaysBundle: [/^@easysend\//] },
  // Emit .js (the package is type: module) so the Docker CMD is `node dist/index.js`.
  fixedExtension: false,
});
