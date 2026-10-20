// Access to the containers of the stack under test, through the compose arguments that
// scripts/e2e.mjs (or scripts/screenshots.mjs) passes in E2E_COMPOSE_ARGS.
import { spawnSync } from 'node:child_process';
import { repoRoot, sleep } from './paths.ts';

const DEFAULT_ARGS = [
  'compose',
  '-p',
  'easysend-e2e',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker/docker-compose.test.yml',
];

function composeArgs(): string[] {
  return process.env.E2E_COMPOSE_ARGS
    ? (JSON.parse(process.env.E2E_COMPOSE_ARGS) as string[])
    : DEFAULT_ARGS;
}

function docker(args: string[], input?: string) {
  return spawnSync('docker', [...composeArgs(), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { APP_VERSION: 'e2e', ...process.env },
    ...(input === undefined ? {} : { input }),
  });
}

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** `docker compose exec -T <service> <args...>` (from the image's working directory). */
export function composeExec(service: string, args: string[], input?: string): ExecResult {
  const result = docker(['exec', '-T', service, ...args], input);
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs `script` with `node -e` inside the api container (where better-sqlite3 lives). */
export function nodeInApi(script: string): ExecResult {
  return composeExec('api', ['node', '-e', script]);
}

/** Everything a service logged so far. */
export function readLogs(service: string): string {
  const result = docker(['logs', service, '--no-color']);
  return `${result.stdout}${result.stderr}`;
}

/** The setup code is printed by the API in its logs (warn line "Setup code: XXXX-XXXX-XXXX"). */
export async function readSetupCode(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const text = readLogs('api');
    const matches = [...text.matchAll(/Setup code: ([A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})/g)];
    const last = matches.at(-1);
    if (last?.[1]) return last[1];
    await sleep(1000);
  }
  throw new Error('Setup code not found in the api logs');
}
