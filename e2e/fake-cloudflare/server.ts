// Fake Cloudflare API for the E2E stack: a plain node:http server around the in-memory fake used by
// the API tests. Run by Node 26 directly (native type stripping, so only erasable syntax here):
//
//   node e2e/fake-cloudflare/server.ts
//
// /client/v4/*  -> FakeCloudflare.fetch (what the API calls through CLOUDFLARE_API_BASE)
// /__fake/*     -> control routes used by the tests (health, state, reset, fail, releases)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FakeCloudflare } from '../../apps/api/test/fake-cloudflare.ts';

const port = Number(process.env.PORT ?? '8787');
let fake = new FakeCloudflare();
// Release list served to the API update check (GitHub "list releases" format). Empty by default.
let releases: unknown[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** What the tests assert on. Authorization header values are never exposed. */
function snapshot() {
  return {
    zones: [...fake.zones].map(([name, zone]) => ({ name, ...zone })),
    records: fake.records,
    tunnels: [...fake.tunnels.values()],
    requests: fake.requests.map((r) => ({
      method: r.method,
      path: r.path,
      hasAuthorization: r.authorization !== null,
      body: r.body,
    })),
    switches: {
      invalidToken: fake.invalidToken,
      forbid: fake.forbid,
      fail: fake.fail,
      failWithCode: fake.failWithCode,
      networkError: fake.networkError,
    },
  };
}

async function control(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? 'GET';
  if (method === 'GET' && path === '/__fake/health') return sendJson(res, 200, { ok: true });
  if (method === 'GET' && path === '/__fake/state') return sendJson(res, 200, snapshot());
  // The update check reads this list; POST replaces it (a JSON array of GitHub-style releases).
  if (method === 'GET' && path === '/__fake/releases') return sendJson(res, 200, releases);
  if (method === 'POST' && path === '/__fake/releases') {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    if (!Array.isArray(body)) return sendJson(res, 400, { error: 'expected an array' });
    releases = body;
    return sendJson(res, 200, releases);
  }
  if (method === 'POST' && path === '/__fake/reset') {
    fake = new FakeCloudflare();
    releases = [];
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && path === '/__fake/fail') {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    if (typeof body.invalidToken === 'boolean') fake.invalidToken = body.invalidToken;
    if (typeof body.networkError === 'boolean') fake.networkError = body.networkError;
    if (body.forbid !== undefined) fake.forbid = strings(body.forbid);
    if (body.fail !== undefined) fake.fail = strings(body.fail);
    if (Array.isArray(body.failWithCode)) {
      fake.failWithCode = body.failWithCode.filter(
        (v): v is { match: string; code: number } =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as { match?: unknown }).match === 'string' &&
          typeof (v as { code?: unknown }).code === 'number',
      );
    }
    return sendJson(res, 200, snapshot().switches);
  }
  sendJson(res, 404, { error: 'unknown control route' });
}

async function proxyToFake(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readBody(req) : undefined;
  try {
    const response = await fake.fetch(url.href, {
      method: req.method ?? 'GET',
      headers,
      ...(body ? { body } : {}),
    });
    const text = await response.text();
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  } catch {
    // networkError switch: drop the connection like a real network failure.
    req.socket.destroy();
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake-cloudflare');
  const done = url.pathname.startsWith('/__fake/')
    ? control(req, res, url.pathname)
    : url.pathname.startsWith('/client/v4/')
      ? proxyToFake(req, res, url)
      : Promise.resolve(sendJson(res, 404, { error: 'not found' }));
  done.catch((error: unknown) => {
    console.error('fake-cloudflare error', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.end();
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`fake Cloudflare listening on :${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
