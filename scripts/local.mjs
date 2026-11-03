// Local try-out of the full stack in Docker: `node scripts/local.mjs up|down|reset [--yes]`.
// Cross-platform, no dependencies.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ensureDocker, localComposeArgs, readEnvFile, root, run as docker } from './lib/node.mjs';

const envFile = join(root, '.env.local');
const composeArgs = localComposeArgs('.env.local', 'easysend-local');

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
