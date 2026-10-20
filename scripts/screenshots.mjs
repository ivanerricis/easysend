// Screenshots and accessibility run: `node scripts/screenshots.mjs [--keep]`.
// Starts an isolated stack (compose project `easysend-shots`, web on :18080), drives the UI with
// Playwright (e2e/screenshots.spec.ts), writes docs/screenshots/*.png and always removes the stack
// (unless --keep). Exit code = Playwright's. Cross-platform, no dependencies.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const project = 'easysend-shots';
const webPort = process.env.SHOTS_WEB_PORT ?? '18080';
const baseUrl = `http://localhost:${webPort}`;

const stackEnv = {
  ...process.env,
  LOCAL_WEB_PORT: webPort,
  MAILPIT_UI_PORT: process.env.SHOTS_MAILPIT_UI_PORT ?? '18126',
  MAILPIT_SMTP_PORT: process.env.SHOTS_MAILPIT_SMTP_PORT ?? '11126',
};

const composeArgs = [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.override.yml',
  '-f',
  'docker-compose.local.yml',
  '--env-file',
  '.env.local.example',
  '-p',
  project,
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

/** pnpm is a .cmd shim on Windows, which needs a shell; the command line is a constant string. */
function runPnpm(commandLine, options = {}) {
  return spawnSync(`pnpm ${commandLine}`, { cwd: root, stdio: 'inherit', shell: true, ...options });
}

const compose = (args) => run('docker', [...composeArgs, ...args], { env: stackEnv });

const info = run('docker', ['info'], { stdio: 'ignore' });
if (info.error || info.status !== 0) {
  console.error('Docker is not reachable. Start Docker Desktop and retry.');
  process.exit(1);
}

function runAll() {
  compose(['down', '-v', '--remove-orphans']);
  const up = compose(['up', '-d', '--build', '--wait']);
  if (up.status !== 0) return up.status ?? 1;
  const tests = runPnpm('--filter @easysend/e2e exec playwright test screenshots.spec.ts', {
    env: {
      ...stackEnv,
      E2E_BASE_URL: baseUrl,
      E2E_COMPOSE_PROJECT: project,
      E2E_COMPOSE_ARGS: JSON.stringify(composeArgs),
      E2E_REPO_ROOT: root,
      E2E_MAILPIT_URL: `http://localhost:${stackEnv.MAILPIT_UI_PORT}`,
    },
  });
  return tests.status ?? 1;
}

try {
  process.exitCode = runAll();
} finally {
  if (keep) {
    console.log(
      `\nStack left running (${baseUrl}). Remove it with: docker compose -p ${project} down -v`,
    );
  } else {
    compose(['down', '-v', '--remove-orphans']);
  }
}
