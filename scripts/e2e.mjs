// End-to-end run: `pnpm test:e2e [-- --no-build] [--keep] [extra playwright args]`.
//
// Starts the PRODUCTION stack (compose project `easysend-e2e`, web on :18090) plus Mailpit and a
// fake Cloudflare API from docker/docker-compose.test.yml, runs the Playwright projects `setup`
// and `e2e` against it, saves the container logs of a failed run to e2e/.output/logs/ and removes
// the stack (unless --keep). Exit code = Playwright's. Cross-platform, no dependencies.
//
//   --no-build  use the images already loaded locally (ghcr.io/ivanerricis/easysend-{api,web}:e2e)
//               instead of building them from this checkout (this is what CI does)
//   --keep      leave the stack running afterwards
// Every other argument goes to `playwright test` (e.g. `-g "password"`, `--headed`).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const noBuild = rawArgs.includes('--no-build');
const keep = rawArgs.includes('--keep');
const playwrightArgs = rawArgs.filter((arg) => arg !== '--no-build' && arg !== '--keep');

const project = 'easysend-e2e';
const webPort = process.env.E2E_WEB_PORT ?? '18090';
const mailpitUiPort = process.env.TEST_MAILPIT_UI_PORT ?? '18025';
const fakeCfPort = process.env.E2E_FAKE_CF_PORT ?? '18787';
const outputDir = join(root, 'e2e', '.output');

const stackEnv = {
  ...process.env,
  APP_VERSION: 'e2e',
  E2E_WEB_PORT: webPort,
  TEST_MAILPIT_UI_PORT: mailpitUiPort,
  E2E_FAKE_CF_PORT: fakeCfPort,
};

// The override file (local builds) is added only when the images are built here.
const composeArgs = [
  'compose',
  '-p',
  project,
  '-f',
  'docker-compose.yml',
  ...(noBuild ? [] : ['-f', 'docker-compose.override.yml']),
  '-f',
  'docker/docker-compose.test.yml',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

/** pnpm is a .cmd shim on Windows, which needs a shell; the command line is a constant string. */
function runPnpm(commandLine, options = {}) {
  return spawnSync(`pnpm ${commandLine}`, { cwd: root, stdio: 'inherit', shell: true, ...options });
}

const compose = (args, options = {}) =>
  run('docker', [...composeArgs, ...args], { env: stackEnv, ...options });

const info = run('docker', ['info'], { stdio: 'ignore' });
if (info.error || info.status !== 0) {
  console.error('Docker is not reachable. Start Docker Desktop and retry.');
  process.exit(1);
}

function saveLogs() {
  const logDir = join(outputDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  for (const service of ['api', 'web', 'fake-cloudflare', 'mailpit']) {
    const result = spawnSync('docker', [...composeArgs, 'logs', '--no-color', service], {
      cwd: root,
      env: stackEnv,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(join(logDir, `${service}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  console.log(`\nContainer logs saved to ${logDir}`);
}

function runAll() {
  compose(['down', '-v', '--remove-orphans']);
  // Fresh run: the shared state (admin secret, TOTP counters) belongs to the stack just removed.
  rmSync(join(outputDir, 'state.json'), { force: true });
  rmSync(join(outputDir, 'logs'), { recursive: true, force: true });

  const up = compose(['up', '-d', ...(noBuild ? [] : ['--build']), '--wait']);
  if (up.status !== 0) {
    saveLogs();
    return up.status ?? 1;
  }

  const tests = runPnpm(
    [
      '--filter @easysend/e2e exec playwright test --project=setup --project=e2e',
      ...playwrightArgs.map((arg) => JSON.stringify(arg)),
    ].join(' '),
    {
      env: {
        ...stackEnv,
        E2E_BASE_URL: `http://localhost:${webPort}`,
        E2E_MAILPIT_URL: `http://localhost:${mailpitUiPort}`,
        E2E_FAKE_CF_URL: `http://localhost:${fakeCfPort}`,
        E2E_COMPOSE_ARGS: JSON.stringify(composeArgs),
        E2E_REPO_ROOT: root,
      },
    },
  );
  const code = tests.status ?? 1;
  if (code !== 0) saveLogs();
  return code;
}

try {
  process.exitCode = runAll();
} finally {
  if (keep) {
    console.log(
      `\nStack left running (http://localhost:${webPort}). Remove it with:\n  docker ${composeArgs.join(' ')} down -v --remove-orphans`,
    );
  } else {
    compose(['down', '-v', '--remove-orphans']);
  }
}
