// Development with hot reload: api and web run on the host, only Mailpit runs in Docker.
// Usage: `node scripts/dev.mjs`. Cross-platform, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const dataRoot = join(root, '.local-data');
const dataDir = join(dataRoot, 'data');
const sharedDir = join(dataRoot, 'shared');

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

const info = docker(['info'], { stdio: 'ignore' });
if (info.error || info.status !== 0) {
  console.error('Docker is not reachable. Start Docker Desktop and retry.');
  process.exit(1);
}

if (!existsSync(join(root, '.env.local'))) {
  copyFileSync(join(root, '.env.local.example'), join(root, '.env.local'));
}
const fileEnv = readEnvFile(join(root, '.env.local'));
const apiPort = fileEnv.DEV_API_PORT || '3000';
const webPort = fileEnv.DEV_WEB_PORT || '5173';
mkdirSync(dataDir, { recursive: true });
mkdirSync(sharedDir, { recursive: true });

const mailpit = docker([...composeArgs, 'up', '-d', 'mailpit']);
if (mailpit.status !== 0) {
  console.warn(
    'Mailpit could not start (are the Mailpit ports already in use? set MAILPIT_UI_PORT / MAILPIT_SMTP_PORT in .env.local). Continuing without it: outgoing emails will not be captured.',
  );
}

const apiEnv = {
  ...process.env,
  APP_MODE: 'local',
  PUBLIC_URL: `http://localhost:${webPort}`,
  TRUST_PROXY: '1',
  PORT: apiPort,
  DATA_DIR: dataDir,
  SHARED_DIR: sharedDir,
  LOG_LEVEL: 'debug',
  LOG_PRETTY: 'true',
  // Mailpit is published on the host at the effective SMTP port.
  SMTP_DEV_HOST: 'localhost',
  SMTP_DEV_PORT: fileEnv.MAILPIT_SMTP_PORT || '1025',
};

const children = [];
let stopping = false;

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  console.log('\nStopped api and web. If Mailpit was started, stop it with `pnpm local:down`.');
  process.exit(code);
}

function prefixLines(stream, label, target) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) target.write(`[${label}] ${line}\n`);
  });
  stream.on('end', () => {
    if (buffer) target.write(`[${label}] ${buffer}\n`);
  });
}

function run(label, filter, env) {
  // shell: true is needed on Windows to run pnpm.cmd; the arguments are constants.
  const child = spawn('pnpm', ['--filter', filter, 'dev'], {
    cwd: root,
    env,
    shell: isWindows,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  prefixLines(child.stdout, label, process.stdout);
  prefixLines(child.stderr, label, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${label}] exited with code ${code ?? 'unknown'}`);
      stopAll(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log(`Starting api (http://localhost:${apiPort}) and web (http://localhost:${webPort})`);
console.log(`Mailpit UI: http://localhost:${fileEnv.MAILPIT_UI_PORT || 8025}`);
run('api', '@easysend/api', apiEnv);
run('web', '@easysend/web', { ...process.env, DEV_API_PORT: apiPort, DEV_WEB_PORT: webPort });
