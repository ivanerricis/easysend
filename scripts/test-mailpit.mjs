// Email tests against a real SMTP server: `node scripts/test-mailpit.mjs`.
// Starts only Mailpit from docker/docker-compose.test.yml (an overlay on the production file), runs apps/api/test/mailpit.test.ts against
// it and always removes the container. Cross-platform, no dependencies.
import { ensureDocker, run, runPnpm } from './lib/node.mjs';

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

ensureDocker();

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
