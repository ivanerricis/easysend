// Local try-out of the full stack in Docker: `node scripts/local.mjs up|down|reset [--yes]`.
// Cross-platform, no dependencies.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.local');
/** Minimal KEY=VALUE parser for .env.local (comments and blank lines ignored, quotes stripped). */
function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const composeArgs = [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.override.yml',
  '-f',
  'docker-compose.local.yml',
  '--env-file',
  '.env.local',
  '-p',
  'easysend-local',
];

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

function ensureDocker() {
  const result = docker(['info'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.error('Docker is not reachable. Start Docker Desktop and retry.');
    process.exit(1);
  }
}

function ensureEnvFile() {
  if (!existsSync(envFile)) {
    copyFileSync(join(root, '.env.local.example'), envFile);
    console.log('Created .env.local from .env.local.example');
  }
}

function compose(args) {
  const result = docker([...composeArgs, ...args]);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function confirmReset() {
  if (process.argv.includes('--yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'This deletes the local database, files and secrets (Docker volumes). Continue? [y/N] ',
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const command = process.argv[2];

switch (command) {
  case 'up': {
    ensureDocker();
    ensureEnvFile();
    compose(['up', '-d', '--build', '--wait']);
    console.log('\nEasySend is running:');
    const env = readEnvFile(envFile);
    const web = `http://localhost:${env.LOCAL_WEB_PORT || 8080}`;
    console.log(`  App:      ${web}`);
    console.log(`  Health:   ${web}/api/health`);
    console.log(`  Mailpit:  http://localhost:${env.MAILPIT_UI_PORT || 8025}`);
    console.log('\nStop with `pnpm local:down`, wipe all data with `pnpm local:reset`.');
    break;
  }
  case 'down':
    ensureDocker();
    ensureEnvFile();
    compose(['down']);
    break;
  case 'reset':
    ensureDocker();
    ensureEnvFile();
    if (!(await confirmReset())) {
      console.log('Aborted.');
      process.exit(1);
    }
    compose(['down', '-v', '--remove-orphans']);
    break;
  default:
    console.error('Usage: node scripts/local.mjs <up|down|reset [--yes]>');
    process.exit(1);
}
