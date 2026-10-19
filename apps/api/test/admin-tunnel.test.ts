import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { CloudflareResponse, TunnelStatusResponse } from '@easysend/shared';
import { createLogger } from '../src/logger.js';
import { FAKE_TUNNEL_TOKEN, FakeCloudflare } from './fake-cloudflare.js';
import { bodyAs, createTestApp, errorCode, makeTempDir, type TestApp } from './helpers.js';
import { loginAs } from './session-helpers.js';

const API_TOKEN = 'cf-api-token-SECRET-0123456789abcdef';
const request = (extra: Record<string, unknown> = {}) => ({
  domain: 'example.com',
  subdomain: 'files',
  apiToken: API_TOKEN,
  ...extra,
});

async function setup(options: { env?: Record<string, string>; logger?: never } = {}) {
  const fake = new FakeCloudflare();
  const sharedDir = makeTempDir();
  const t = await createTestApp({
    env: { APP_MODE: 'production', SHARED_DIR: sharedDir, ...options.env },
    deps: { cloudflareFetch: fake.fetch },
  });
  const admin = await t.createUser({ role: 'admin', totp: true });
  return { t, fake, sharedDir, client: loginAs(t, admin) };
}

const tokenFile = (dir: string) => path.join(dir, 'tunnel-token');
const tunnelPost = (client: ReturnType<typeof loginAs>, body: unknown = request()) =>
  client.post('/api/admin/tunnel', { body });

describe('POST /api/admin/tunnel', () => {
  it('creates the tunnel, ingress, CNAME and token file, and saves the settings', async () => {
    const { t, fake, sharedDir, client } = await setup();
    const before = bodyAs<TunnelStatusResponse>(await client.get('/api/admin/tunnel'));
    expect(before).toEqual({
      appMode: 'production',
      configured: false,
      hostname: null,
      publicUrl: null,
      tunnelId: null,
      configuredAt: null,
    });

    const res = await tunnelPost(client);
    expect(res.status).toBe(200);
    const body = bodyAs<CloudflareResponse>(res);
    const [tunnel] = fake.liveTunnels;
    expect(body).toEqual({
      hostname: 'files.example.com',
      publicUrl: 'https://files.example.com',
      tunnelId: tunnel!.id,
    });
    expect(tunnel!.config_src).toBe('cloudflare');
    expect(tunnel!.name).toMatch(/^easysend-[0-9a-f]{8}$/);
    expect(tunnel!.ingress).toEqual([
      { hostname: 'files.example.com', service: 'http://web:8080' },
      { service: 'http_status:404' },
    ]);
    expect(fake.records).toEqual([
      expect.objectContaining({
        type: 'CNAME',
        name: 'files.example.com',
        content: `${tunnel!.id}.cfargotunnel.com`,
        proxied: true,
        comment: 'EasySend tunnel',
      }),
    ]);

    expect(readFileSync(tokenFile(sharedDir), 'utf8')).toBe(FAKE_TUNNEL_TOKEN);
    if (process.platform !== 'win32') {
      expect(statSync(tokenFile(sharedDir)).mode & 0o777).toBe(0o600);
    }
    expect(t.ctx.settings.get('tunnel')).toMatchObject({
      hostname: 'files.example.com',
      tunnelId: tunnel!.id,
      accountId: 'acc-1',
      zoneId: 'zone-1',
    });
    expect(t.ctx.settings.get('public_url')).toBe('https://files.example.com');
    expect(t.ctx.publicUrl()).toBe('https://files.example.com');
    expect(fake.requests.every((r) => r.authorization === `Bearer ${API_TOKEN}`)).toBe(true);

    const after = bodyAs<TunnelStatusResponse>(await client.get('/api/admin/tunnel'));
    expect(after).toMatchObject({
      configured: true,
      hostname: 'files.example.com',
      publicUrl: 'https://files.example.com',
      tunnelId: tunnel!.id,
    });
    expect(after.configuredAt).toBeTypeOf('number');
  });

  it('uses the bare domain when there is no subdomain', async () => {
    const { fake, client } = await setup();
    const res = await tunnelPost(client, request({ subdomain: undefined, domain: 'Example.COM' }));
    expect(bodyAs<CloudflareResponse>(res).hostname).toBe('example.com');
    expect(fake.records[0]!.name).toBe('example.com');
  });

  it('keeps PUBLIC_URL from the environment over the saved setting', async () => {
    const { t, client } = await setup({ env: { PUBLIC_URL: 'https://env.example.org' } });
    await tunnelPost(client);
    expect(t.ctx.settings.get('public_url')).toBe('https://files.example.com');
    expect(t.ctx.publicUrl()).toBe('https://env.example.org');
  });

  it('retries after a DNS failure without creating a second tunnel', async () => {
    const { fake, client, sharedDir } = await setup();
    fake.fail = ['POST /zones/zone-1/dns_records'];
    const failed = await tunnelPost(client);
    expect(failed.status).toBe(502);
    expect(errorCode(failed)).toBe('CLOUDFLARE_API_ERROR');
    expect(fake.liveTunnels).toHaveLength(1);

    expect((await client.get('/api/admin/tunnel')).body).toMatchObject({ configured: false });

    fake.fail = [];
    const retry = await tunnelPost(client);
    expect(retry.status).toBe(200);
    expect(fake.liveTunnels).toHaveLength(1);
    expect(bodyAs<CloudflareResponse>(retry).tunnelId).toBe(fake.liveTunnels[0]!.id);
    expect(fake.records).toHaveLength(1);
    expect(readFileSync(tokenFile(sharedDir), 'utf8')).toBe(FAKE_TUNNEL_TOKEN);
  });

  it('reuses the tunnel and its token when the hostname changes', async () => {
    const { t, fake, client } = await setup();
    const first = bodyAs<CloudflareResponse>(await tunnelPost(client));
    const second = bodyAs<CloudflareResponse>(
      await tunnelPost(client, request({ subdomain: 'send' })),
    );
    expect(second.tunnelId).toBe(first.tunnelId);
    expect(second.hostname).toBe('send.example.com');
    expect(fake.liveTunnels).toHaveLength(1);
    expect(fake.liveTunnels[0]!.ingress).toEqual([
      { hostname: 'send.example.com', service: 'http://web:8080' },
      { service: 'http_status:404' },
    ]);
    expect(t.ctx.settings.get('public_url')).toBe('https://send.example.com');
  });

  it('creates a new tunnel when the stored one was deleted on Cloudflare', async () => {
    const { fake, client } = await setup();
    const first = bodyAs<CloudflareResponse>(await tunnelPost(client));
    fake.tunnels.get(first.tunnelId)!.deleted_at = '2026-01-01T00:00:00Z';
    fake.records.length = 0;
    const second = bodyAs<CloudflareResponse>(await tunnelPost(client));
    expect(second.tunnelId).not.toBe(first.tunnelId);
  });

  it('rejects a foreign DNS record before creating any tunnel', async () => {
    const { fake, client } = await setup();
    fake.records.push({
      id: 'r1',
      type: 'A',
      name: 'files.example.com',
      content: '203.0.113.7',
    });
    const res = await tunnelPost(client);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CLOUDFLARE_RECORD_EXISTS');
    expect(res.body.error).toMatchObject({ details: { hostname: 'files.example.com', type: 'A' } });
    expect(fake.tunnels.size).toBe(0);
  });

  it('maps a "record already exists" error from the create call', async () => {
    const { fake, client } = await setup();
    fake.failWithCode = [{ match: 'POST /zones/zone-1/dns_records', code: 81057 }];
    const res = await tunnelPost(client);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CLOUDFLARE_RECORD_EXISTS');
  });

  it('answers CLOUDFLARE_ZONE_NOT_FOUND for an unknown domain', async () => {
    const { client } = await setup();
    const res = await tunnelPost(client, request({ domain: 'other.org' }));
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CLOUDFLARE_ZONE_NOT_FOUND');
  });

  it('answers CLOUDFLARE_TOKEN_INVALID for an invalid token', async () => {
    const { fake, client } = await setup();
    fake.invalidToken = true;
    const res = await tunnelPost(client);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CLOUDFLARE_TOKEN_INVALID');
    expect(JSON.stringify(res.body)).not.toContain(API_TOKEN);
  });

  it.each([
    ['GET /zones', 'Zone:Read'],
    ['/dns_records', 'DNS:Edit'],
    ['POST /accounts/acc-1/cfd_tunnel', 'Cloudflare Tunnel:Edit'],
  ])('hints the missing permission when %s is forbidden', async (pattern, permission) => {
    const { fake, client } = await setup();
    fake.forbid = [pattern === '/dns_records' ? 'GET /zones/zone-1/dns_records' : pattern];
    const res = await tunnelPost(client);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CLOUDFLARE_TOKEN_INVALID');
    expect(res.body.error).toMatchObject({ details: { permission } });
  });

  it('answers CLOUDFLARE_API_ERROR on a Cloudflare 5xx and on a network error', async () => {
    const { fake, client } = await setup();
    fake.fail = ['GET /zones'];
    const res = await tunnelPost(client);
    expect(res.status).toBe(502);
    expect(errorCode(res)).toBe('CLOUDFLARE_API_ERROR');
    expect(res.body.error).toMatchObject({ details: { status: 500, codes: [7003] } });

    fake.fail = [];
    fake.networkError = true;
    const net = await tunnelPost(client);
    expect(net.status).toBe(502);
    expect(errorCode(net)).toBe('CLOUDFLARE_API_ERROR');
  });

  it('is not applicable in local mode', async () => {
    const fake = new FakeCloudflare();
    const t = await createTestApp({ deps: { cloudflareFetch: fake.fetch } });
    const client = loginAs(t, await t.createUser({ role: 'admin', totp: true }));
    const res = await tunnelPost(client);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('NOT_APPLICABLE_IN_LOCAL_MODE');
    expect(fake.requests).toHaveLength(0);
    const status = bodyAs<TunnelStatusResponse>(await client.get('/api/admin/tunnel'));
    expect(status.appMode).toBe('local');
    expect(status.configured).toBe(false);
  });

  it('refuses non-admins and unauthenticated clients', async () => {
    const { t, fake } = await setup();
    const user = loginAs(t, await t.createUser({ totp: true }));
    expect((await tunnelPost(user)).status).toBe(403);
    expect((await user.get('/api/admin/tunnel')).status).toBe(403);
    expect((await tunnelPost(t.client(), request())).status).toBe(401);
    expect(fake.requests).toHaveLength(0);
  });

  it('validates the body', async () => {
    const { client } = await setup();
    const res = await tunnelPost(client, { domain: 'not a domain', apiToken: 'short' });
    expect(res.status).toBe(400);
  });

  it('rate limits after 10 attempts', async () => {
    const { client, fake } = await setup();
    fake.invalidToken = true;
    for (let i = 0; i < 10; i += 1) expect((await tunnelPost(client)).status).toBe(422);
    const res = await tunnelPost(client);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('the Cloudflare API token never leaks', () => {
  it('stays out of logs, the database and error bodies', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger(
      { logLevel: 'trace', nodeEnv: 'test', logPretty: false },
      {},
      stream,
    );
    const fake = new FakeCloudflare();
    const t: TestApp = await createTestApp({
      env: { APP_MODE: 'production', SHARED_DIR: makeTempDir() },
      deps: { cloudflareFetch: fake.fetch },
      logger,
    });
    const client = loginAs(t, await t.createUser({ role: 'admin', totp: true }));
    const bodies: string[] = [];

    const ok = await tunnelPost(client);
    bodies.push(JSON.stringify(ok.body));
    fake.invalidToken = true;
    bodies.push(JSON.stringify((await tunnelPost(client)).body));
    fake.invalidToken = false;
    fake.fail = ['GET /zones'];
    bodies.push(JSON.stringify((await tunnelPost(client)).body));
    fake.fail = [];
    fake.networkError = true;
    bodies.push(JSON.stringify((await tunnelPost(client)).body));

    const db = t.db.sqlite;
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM settings').all(),
      db.prepare('SELECT * FROM audit_log').all(),
    ]);
    expect(dump).toContain('tunnel.configured');
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(lines.join('')).toContain('cloudflare');
    for (const text of [dump, lines.join(''), ...bodies]) expect(text).not.toContain(API_TOKEN);
    // The tunnel token is not stored in the database either.
    expect(dump).not.toContain(FAKE_TUNNEL_TOKEN);
    expect(lines.join('')).not.toContain(FAKE_TUNNEL_TOKEN);
  });
});
