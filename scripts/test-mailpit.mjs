// Email tests against a real SMTP server: `node scripts/test-mailpit.mjs`.
// Starts only Mailpit from docker/docker-compose.test.yml (an overlay on the production file), runs apps/api/test/mailpit.test.ts against
// it and always removes the container. Cross-platform, no dependencies.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smtpPort = process.env.TEST_MAILPIT_SMTP_PORT ?? '11025';
const uiPort = process.env.TEST_MAILPIT_UI_PORT ?? '18025';
const composeArgs = [
  'compose',
  '-p',
  'easysend-test',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker/docker-compose.test.yml',
];
// The production file requires APP_VERSION even though only Mailpit is started.
const composeEnv = { ...process.env, APP_VERSION: 'e2e' };

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

/**
 * pnpm is a .cmd shim on Windows, which needs a shell. The command is a constant string: Node
 * deprecates passing an argument array together with `shell: true` (DEP0190).
 */
function runPnpm(commandLine, options = {}) {
  return spawnSync(`pnpm ${commandLine}`, { cwd: root, stdio: 'inherit', shell: true, ...options });
}

const info = run('docker', ['info'], { stdio: 'ignore' });
if (info.error || info.status !== 0) {
  console.error('Docker is not reachable. Start Docker Desktop and retry.');
  process.exit(1);
}

function runAll() {
  const up = run('docker', [...composeArgs, 'up', '-d', '--wait', 'mailpit'], {
    env: composeEnv,
  });
  if (up.status !== 0) return up.status ?? 1;
  const tests = runPnpm('--filter @easysend/api exec vitest run test/mailpit.test.ts', {
    env: {
      ...process.env,
      MAILPIT_URL: `http://127.0.0.1:${uiPort}`,
      MAILPIT_SMTP_PORT: smtpPort,
    },
  });
  return tests.status ?? 1;
}

try {
  process.exitCode = runAll();
} finally {
  run('docker', [...composeArgs, 'down', '-v', '--remove-orphans'], { env: composeEnv });
}
