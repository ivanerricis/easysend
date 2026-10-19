import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { endpoints, renderApiDocs } from '../src/contract/index.js';

const OUTPUT = fileURLToPath(new URL('../../../docs/api.md', import.meta.url));
const check = process.argv.includes('--check');

const generated = renderApiDocs(endpoints);

if (check) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== generated) {
    console.error('docs/api.md is out of date: run pnpm api:docs');
    process.exit(1);
  }
  console.log('docs/api.md is up to date');
} else {
  writeFileSync(OUTPUT, generated, { encoding: 'utf8' });
  console.log(`docs/api.md written (${endpoints.length} endpoints)`);
}
