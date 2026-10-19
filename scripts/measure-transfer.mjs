// Measures the API memory during a large transfer against the local Docker stack (`pnpm local:up`):
// tus upload, background encryption, single-file download and zip download of a generated file.
//
//   node scripts/measure-transfer.mjs [--size-gb 5] [--base-url http://localhost:8080]
//
// It creates a throw-away admin with the local-only CLI inside the api container, enrols 2FA,
// uploads pseudo-random data generated on the fly (nothing is read from or written to the PC's
// disk), verifies the SHA-256 of both downloads and samples the api container every second:
// RSS of the node process and the cgroup usage without the page cache (what `docker stats` shows).
// No dependencies; cross-platform.
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;
const CHUNK = 25 * MB;

function localWebPort() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return '8080';
  const match = /^\s*LOCAL_WEB_PORT\s*=\s*(\d+)/m.exec(readFileSync(file, 'utf8'));
  return match ? match[1] : '8080';
}

const { values: args } = parseArgs({
  options: {
    'size-gb': { type: 'string', default: '5' },
    'base-url': { type: 'string', default: `http://localhost:${localWebPort()}` },
  },
});
const SIZE = Math.round(Number(args['size-gb']) * 1024 * MB);
const BASE = args['base-url'].replace(/\/$/, '');
if (!Number.isSafeInteger(SIZE) || SIZE <= 0) throw new Error('Invalid --size-gb');

// ---- docker helpers ---------------------------------------------------------------------------
const PROJECT = ['compose', '-p', 'easysend-local'];

function dockerSync(argv) {
  const result = spawnSync('docker', argv, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`docker ${argv.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function dockerAsync(argv) {
  return new Promise((resolve) => {
    const child = spawn('docker', argv, { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

const container = dockerSync([...PROJECT, 'ps', '-q', 'api']);
if (!container)
  throw new Error('The api container is not running: start the stack with pnpm local:up');

// ---- memory sampler ---------------------------------------------------------------------------
const PROBE = [
  'pid=$(pidof node)',
  'grep VmRSS /proc/$pid/status',
  'echo current $(cat /sys/fs/cgroup/memory.current)',
  'grep -E "^inactive_file " /sys/fs/cgroup/memory.stat',
].join('; ');

let phase = 'idle';
const samples = [];
let sampling = true;

async function sampler() {
  while (sampling) {
    const started = Date.now();
    const out = await dockerAsync(['exec', container, 'sh', '-c', PROBE]);
    const rss = Number(/VmRSS:\s+(\d+)/.exec(out)?.[1] ?? NaN) * 1024;
    const current = Number(/current (\d+)/.exec(out)?.[1] ?? NaN);
    const inactive = Number(/inactive_file (\d+)/.exec(out)?.[1] ?? 0);
    if (Number.isFinite(rss)) samples.push({ phase, rss, cgroup: current - inactive });
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - started))));
  }
}

// ---- HTTP with a cookie jar -------------------------------------------------------------------
const jar = new Map();
let csrf = '';

async function http(method, path, { json, body, headers = {} } = {}) {
  const h = { ...headers };
  if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (csrf && !['GET', 'HEAD'].includes(method)) h['x-csrf-token'] = csrf;
  if (json !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: json !== undefined ? JSON.stringify(json) : body,
    duplex: body ? 'half' : undefined,
  });
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === '' || /max-age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
  return res;
}

async function expectJson(res, status) {
  if (res.status !== status) {
    throw new Error(`${res.url}: expected ${status}, got ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function refreshCsrf() {
  csrf = (await expectJson(await http('GET', '/api/auth/csrf'), 200)).csrfToken;
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---------------------------------------------------
function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// ---- data generator: deterministic pseudo-random bytes (AES-CTR over zeros) --------------------
function createGenerator() {
  const cipher = createCipheriv('aes-128-ctr', randomBytes(16), randomBytes(16));
  const zeros = Buffer.alloc(CHUNK);
  return (length) => cipher.update(zeros.subarray(0, length));
}

// ---- steps ------------------------------------------------------------------------------------
const timings = {};

async function timed(name, fn) {
  phase = name;
  const started = Date.now();
  const result = await fn();
  timings[name] = (Date.now() - started) / 1000;
  phase = 'idle';
  return result;
}

async function login() {
  const email = `bench-${Date.now()}@example.com`;
  const password = randomBytes(18).toString('base64url');
  dockerSync([
    ...PROJECT,
    'exec',
    '-T',
    'api',
    'node',
    'dist/cli/create-admin.js',
    '--email',
    email,
    '--password',
    password,
  ]);
  await refreshCsrf();
  const login = await expectJson(
    await http('POST', '/api/auth/login', { json: { email, password } }),
    200,
  );
  if (login.status !== 'mfa_setup_required')
    throw new Error(`unexpected login status ${login.status}`);
  await refreshCsrf();
  const { secret } = await expectJson(await http('POST', '/api/auth/login/2fa-setup'), 200);
  const verified = await expectJson(
    await http('POST', '/api/auth/login/2fa-setup/verify', { json: { code: totp(secret) } }),
    200,
  );
  csrf = verified.csrfToken;
}

async function upload(transferId) {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const created = await http('POST', '/api/uploads', {
    headers: {
      'tus-resumable': '1.0.0',
      'upload-length': String(SIZE),
      'upload-metadata': `transferId ${b64(transferId)},filename ${b64('bench.bin')}`,
    },
  });
  if (created.status !== 201)
    throw new Error(`tus create: ${created.status} ${await created.text()}`);
  const location = created.headers.get('location');
  const next = createGenerator();
  const hash = createHash('sha256');
  for (let offset = 0; offset < SIZE; offset += CHUNK) {
    const chunk = next(Math.min(CHUNK, SIZE - offset));
    hash.update(chunk);
    const res = await http('PATCH', location, {
      body: chunk,
      headers: {
        'tus-resumable': '1.0.0',
        'upload-offset': String(offset),
        'content-type': 'application/offset+octet-stream',
      },
    });
    if (res.status !== 204)
      throw new Error(`tus patch at ${offset}: ${res.status} ${await res.text()}`);
  }
  return hash.digest('hex');
}

async function waitProcessed(transferId) {
  for (;;) {
    const detail = await expectJson(await http('GET', `/api/transfers/${transferId}`), 200);
    if (detail.files.length === 1) return detail.files[0];
    if (detail.uploads.some((u) => u.status === 'aborted')) throw new Error('upload aborted');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Streams a response body into a hash, optionally skipping a prefix and hashing `length` bytes. */
async function consume(res, { skipZipHeader = false } = {}) {
  const hash = createHash('sha256');
  let total = 0;
  let header = skipZipHeader ? Buffer.alloc(0) : null;
  let remaining = SIZE;
  for await (const part of res.body) {
    let chunk = Buffer.from(part);
    total += chunk.length;
    if (header) {
      header = Buffer.concat([header, chunk]);
      if (header.length < 30) continue;
      const start = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (header.length < start) continue;
      chunk = header.subarray(start);
      header = null;
    }
    if (remaining > 0) {
      const used = chunk.subarray(0, remaining);
      hash.update(used);
      remaining -= used.length;
    }
  }
  return { total, sha256: hash.digest('hex') };
}

function stats(list) {
  if (list.length === 0) return { peak: NaN, avg: NaN };
  const peak = Math.max(...list);
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  return { peak, avg };
}

const fmt = (bytes) => (Number.isFinite(bytes) ? `${(bytes / MB).toFixed(0)} MB` : 'n/a');

async function main() {
  console.log(
    `Measuring ${(SIZE / 1024 / MB).toFixed(1)} GB against ${BASE} (container ${container})`,
  );
  const samplerDone = sampler();
  await new Promise((r) => setTimeout(r, 5000)); // idle baseline

  await login();
  const transfer = await expectJson(
    await http('POST', '/api/transfers', {
      json: { mode: 'link', expiresIn: '3d', title: 'bench' },
    }),
    201,
  );
  const sourceHash = await timed('upload', () => upload(transfer.id));
  const file = await timed('encryption', () => waitProcessed(transfer.id));
  if (file.sha256 !== sourceHash) throw new Error('server SHA-256 differs from the uploaded data');
  const finalized = await expectJson(
    await http('POST', `/api/transfers/${transfer.id}/finalize`),
    200,
  );
  const token = new URL(finalized.shareUrl).pathname.split('/').pop();

  jar.clear(); // downloads are anonymous
  csrf = '';
  const single = await timed('download', async () =>
    consume(await http('GET', `/api/downloads/${token}/files/${file.id}`)),
  );
  if (single.sha256 !== sourceHash || single.total !== SIZE) throw new Error('download mismatch');
  const zipRes = await http('GET', `/api/downloads/${token}/zip`);
  const zipLength = Number(zipRes.headers.get('content-length'));
  const zip = await timed('zip', () => consume(zipRes, { skipZipHeader: true }));
  if (zip.sha256 !== sourceHash) throw new Error('zip entry mismatch');
  if (zipLength !== zip.total) throw new Error('zip Content-Length differs from the body');

  await new Promise((r) => setTimeout(r, 3000));
  sampling = false;
  await samplerDone;

  const rows = ['idle', 'upload', 'encryption', 'download', 'zip'].map((name) => {
    const list = samples.filter((s) => s.phase === name);
    const rss = stats(list.map((s) => s.rss));
    const cg = stats(list.map((s) => s.cgroup));
    const secs = timings[name];
    const rate = secs ? `${(SIZE / MB / secs).toFixed(0)} MB/s` : '';
    return `| ${name} | ${secs ? `${secs.toFixed(0)} s` : ''} | ${rate} | ${fmt(rss.avg)} | ${fmt(rss.peak)} | ${fmt(cg.avg)} | ${fmt(cg.peak)} |`;
  });
  console.log('\nSHA-256 verified for upload, download and zip.\n');
  console.log(
    '| Phase | Time | Throughput | Node RSS avg | Node RSS peak | Container avg | Container peak |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) console.log(row);
  console.log(
    '\nContainer = cgroup memory without the inactive page cache (as in `docker stats`).',
  );
}

main().catch((error) => {
  sampling = false;
  console.error(error.message);
  process.exit(1);
});
