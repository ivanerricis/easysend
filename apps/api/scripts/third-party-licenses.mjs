// Writes dist/THIRD-PARTY-LICENSES.txt: the license files of every npm package that tsdown inlined
// into dist/*.js. Bundled packages are found from the `//#region` markers rolldown leaves in the
// output, so the notice always matches what really ships.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const apiDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(apiDir, 'dist');
const marker = /^\/\/#region (\S*\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+)\//gm;

const packages = new Set();
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(distDir);
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(marker)) packages.add(match[1]);
}

const sections = [];
for (const rel of [...packages].sort()) {
  const dir = path.resolve(apiDir, rel);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFiles = readdirSync(dir).filter((name) =>
    /^(licen[sc]e|copying|notice)/i.test(name),
  );
  const body = licenseFiles.map((name) => readFileSync(path.join(dir, name), 'utf8').trim());
  sections.push(
    [
      `${pkg.name}@${pkg.version} (${typeof pkg.license === 'string' ? pkg.license : 'see package'})`,
      body.length > 0 ? body.join('\n\n') : '(no license file in the package)',
    ].join('\n\n'),
  );
}

const out = path.join(distDir, 'THIRD-PARTY-LICENSES.txt');
writeFileSync(
  out,
  `Third-party packages bundled into the EasySend API (generated at build time).\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
);
console.log(`${out}: ${sections.length} packages`);
