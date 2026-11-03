// Screenshots and accessibility run: `node scripts/screenshots.mjs [--keep]`.
// Starts an isolated stack (compose project `easysend-shots`, web on :18080), drives the UI with
// Playwright (e2e/screenshots/screenshots.spec.ts), writes docs/screenshots/*.png and always removes the stack
// (unless --keep). Exit code = Playwright's. Cross-platform, no dependencies.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDocker, localComposeArgs, root, run, runPnpm } from './lib/node.mjs';

const keep = process.argv.includes('--keep');
const project = 'easysend-shots';
const webPort = process.env.SHOTS_WEB_PORT ?? '18080';
const baseUrl = `http://localhost:${webPort}`;

// Own TOTP bookkeeping file, so a screenshots run never mixes with an E2E run.
const stateFile = join(root, 'e2e', '.output', 'state-screenshots.json');

const stackEnv = {
  ...process.env,
  LOCAL_WEB_PORT: webPort,
  MAILPIT_UI_PORT: process.env.SHOTS_MAILPIT_UI_PORT ?? '18126',
  MAILPIT_SMTP_PORT: process.env.SHOTS_MAILPIT_SMTP_PORT ?? '11126',
};

const composeArgs = localComposeArgs('.env.local.example', project);

const compose = (args) => run('docker', [...composeArgs, ...args], { env: stackEnv });

ensureDocker();

function runAll() {
  compose(['down', '-v', '--remove-orphans']);
  mkdirSync(dirname(stateFile), { recursive: true });
  rmSync(stateFile, { force: true });
  const up = compose(['up', '-d', '--build', '--wait']);
  if (up.status !== 0) return up.status ?? 1;
  const tests = runPnpm('--filter @easysend/e2e exec playwright test --project=screenshots', {
    env: {
      ...stackEnv,
      E2E_BASE_URL: baseUrl,
      E2E_COMPOSE_PROJECT: project,
      E2E_COMPOSE_ARGS: JSON.stringify(composeArgs),
      E2E_REPO_ROOT: root,
      E2E_STATE_FILE: stateFile,
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
