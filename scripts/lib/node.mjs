// Helpers shared by the scripts in scripts/*.mjs. Cross-platform, no dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const isWindows = process.platform === 'win32';

export function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

/**
 * pnpm is a .cmd shim on Windows, which needs a shell. The command is a constant string: Node
 * deprecates passing an argument array together with `shell: true` (DEP0190).
 */
export function runPnpm(commandLine, options = {}) {
  return spawnSync(`pnpm ${commandLine}`, { cwd: root, stdio: 'inherit', shell: true, ...options });
}

/** Exits with a message when the Docker daemon is not reachable. */
export function ensureDocker() {
  const info = run('docker', ['info'], { stdio: 'ignore' });
  if (info.error || info.status !== 0) {
    console.error('Docker is not reachable. Start Docker Desktop and retry.');
    process.exit(1);
  }
}

/** Minimal KEY=VALUE parser for .env.local (comments and blank lines ignored, quotes stripped). */
export function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

/** `docker compose` arguments for the local stack (production file + build override + local file). */
export function localComposeArgs(envFile, project) {
  return [
    'compose',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.override.yml',
    '-f',
    'docker-compose.local.yml',
    '--env-file',
    envFile,
    '-p',
    project,
  ];
}
