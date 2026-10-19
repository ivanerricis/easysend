import express from 'express';
import { describe, expect, it } from 'vitest';
import { AUTH_POLICY } from '../src/auth/policy.js';
import { sha256Hex } from '../src/crypto/hash.js';
import { SESSION_COOKIE, cookieParser } from '../src/http/cookies.js';
import { createTestApp, TestClient, type TestApp } from './helpers.js';

const { session: policy } = AUTH_POLICY;
const DAY = 86_400;

interface SessionRowSql {
  id: string;
  user_id: string;
  expires_at: number;
  absolute_expires_at: number;
  last_seen_at: number;
  created_at: number;
  ip_hash: string | null;
  user_agent: string | null;
  mfa_verified: number;
}

/** Tiny app around the real session service: `/start`, `/me`, `/end`. */
function sessionClient(t: TestApp) {
  const { sessions } = t.ctx;
  const app = express();
  app.use(express.json(), cookieParser, sessions.loadSession);
  app.post('/start', (req, res) => {
    const body = req.body as { userId: string; mfaVerified: boolean };
    const auth = sessions.start(req, res, body);
    res.json({ level: auth.level, id: auth.session.id });
  });
  app.get('/me', (req, res) => {
    res.json(req.auth ? { level: req.auth.level, userId: req.auth.user.id } : { level: null });
  });
  app.post('/end', (req, res) => {
    sessions.end(req, res);
    res.status(204).end();
  });
  return new TestClient(app);
}

const rows = (t: TestApp) =>
  t.db.sqlite.prepare('SELECT * FROM sessions ORDER BY created_at').all() as SessionRowSql[];
const nowS = (t: TestApp) => Math.floor(t.clock() / 1000);

async function login(t: TestApp, client: TestClient, userId: string, mfaVerified = true) {
  const res = await client.post('/start', { body: { userId, mfaVerified }, csrf: false });
  expect(res.status).toBe(200);
  return res;
}

describe('session creation', () => {
  it('stores a hashed id, expiries, last seen and a hashed IP', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    const res = await client.post('/start', {
      body: { userId: user.id, mfaVerified: true },
      csrf: false,
      headers: { 'User-Agent': 'x'.repeat(400) },
    });

    const token = client.cookie(SESSION_COOKIE) as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.id).toBe(sha256Hex(token));
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);

    const [row] = rows(t) as [SessionRowSql];
    expect(row.id).toBe(sha256Hex(token));
    expect(row.id).not.toContain(token);
    expect(row.user_id).toBe(user.id);
    expect(row.mfa_verified).toBe(1);
    expect(row.expires_at).toBe(nowS(t) + policy.idleSeconds);
    expect(row.absolute_expires_at).toBe(nowS(t) + policy.absoluteSeconds);
    expect(row.last_seen_at).toBe(nowS(t));
    expect(row.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.ip_hash).not.toContain('127.0.0.1');
    expect(row.user_agent).toHaveLength(policy.userAgentMaxLength);
  });

  it('loads the user and level from the cookie', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    expect((await client.get('/me')).body).toEqual({ level: null });
    await login(t, client, user.id);
    expect((await client.get('/me')).body).toEqual({ level: 'session', userId: user.id });
  });

  it('regenerates the session when one already exists (rotation)', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id, false);
    const oldToken = client.cookie(SESSION_COOKIE) as string;
    expect((await client.get('/me')).body.level).toBe('mfa-pending');

    await login(t, client, user.id, true);
    expect(client.cookie(SESSION_COOKIE)).not.toBe(oldToken);
    expect(rows(t)).toHaveLength(1);

    const stale = sessionClient(t);
    stale.setCookie(SESSION_COOKIE, oldToken);
    expect((await stale.get('/me')).body).toEqual({ level: null });
  });

  it('end() deletes the row and clears the cookie', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id);
    await client.post('/end', { csrf: false });
    expect(rows(t)).toHaveLength(0);
    expect(client.cookie(SESSION_COOKIE)).toBeUndefined();
  });
});

describe('expiry', () => {
  it('expires after 7 days without activity and deletes the row', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id);

    t.clock.advance(policy.idleSeconds - 1);
    expect((await client.get('/me')).body.level).toBe('session');
    // The request above refreshed the idle expiry: stay idle for a full period again.
    t.clock.advance(policy.idleSeconds);
    const res = await client.get('/me');
    expect(res.body).toEqual({ level: null });
    expect(rows(t)).toHaveLength(0);
    expect(client.cookie(SESSION_COOKIE)).toBeUndefined();
  });

  it('expires 30 days after creation even when the session is used every day', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id);
    const absolute = (rows(t)[0] as SessionRowSql).absolute_expires_at;

    for (let day = 1; day < 30; day++) {
      t.clock.advance(DAY);
      expect((await client.get('/me')).body.level).toBe('session');
    }
    // The sliding expiry never goes past the absolute one.
    expect((rows(t)[0] as SessionRowSql).expires_at).toBeLessThanOrEqual(absolute);

    t.clock.advance(DAY);
    expect((await client.get('/me')).body).toEqual({ level: null });
    expect(rows(t)).toHaveLength(0);
  });

  it('pending sessions last 10 minutes and do not slide', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id, false);
    const expiresAt = (rows(t)[0] as SessionRowSql).expires_at;
    expect(expiresAt).toBe(nowS(t) + policy.mfaPendingSeconds);

    t.clock.advance(policy.mfaPendingSeconds - 60);
    expect((await client.get('/me')).body.level).toBe('mfa-pending');
    expect((rows(t)[0] as SessionRowSql).expires_at).toBe(expiresAt);

    t.clock.advance(60);
    expect((await client.get('/me')).body).toEqual({ level: null });
  });

  it('refreshes last_seen_at and expires_at at most every 5 minutes', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id);
    const created = rows(t)[0] as SessionRowSql;

    t.clock.advance(policy.lastSeenRefreshSeconds - 1);
    const early = await client.get('/me');
    expect(early.headers['set-cookie']).toBeUndefined();
    expect((rows(t)[0] as SessionRowSql).last_seen_at).toBe(created.last_seen_at);

    t.clock.advance(1);
    const refreshed = await client.get('/me');
    expect(String(refreshed.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
    const row = rows(t)[0] as SessionRowSql;
    expect(row.last_seen_at).toBe(nowS(t));
    expect(row.expires_at).toBe(nowS(t) + policy.idleSeconds);
  });

  it('purgeExpired removes idle and absolute expired rows only', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const a = sessionClient(t);
    await login(t, a, user.id);
    t.clock.advance(policy.idleSeconds + 1);
    const b = sessionClient(t);
    await login(t, b, user.id);
    expect(t.ctx.sessions.purgeExpired()).toBe(1);
    expect(rows(t)).toHaveLength(1);
  });
});

describe('revocation and disabled users', () => {
  it('revokeAllForUser removes every session, optionally keeping one', async () => {
    const t = await createTestApp();
    const [alice, bob] = [await t.createUser(), await t.createUser()];
    const clients = [sessionClient(t), sessionClient(t), sessionClient(t)];
    const other = sessionClient(t);
    for (const c of clients) await login(t, c, alice.id);
    await login(t, other, bob.id);

    const keep = sha256Hex(clients[0]?.cookie(SESSION_COOKIE) as string);
    expect(t.ctx.sessions.revokeAllForUser(alice.id, keep)).toBe(2);
    expect(
      rows(t)
        .map((r) => r.user_id)
        .sort(),
    ).toEqual([alice.id, bob.id].sort());
    expect((await clients[0]?.get('/me'))?.body.level).toBe('session');
    expect((await clients[1]?.get('/me'))?.body.level).toBeNull();

    expect(t.ctx.sessions.revokeAllForUser(alice.id)).toBe(1);
    expect((await other.get('/me')).body.userId).toBe(bob.id);
  });

  it('rejects the session of a disabled user', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = sessionClient(t);
    await login(t, client, user.id);
    t.db.sqlite.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
    expect((await client.get('/me')).body).toEqual({ level: null });
    expect(rows(t)).toHaveLength(0);
  });

  it('ignores a malformed cookie and clears it', async () => {
    const t = await createTestApp();
    const client = sessionClient(t);
    client.setCookie(SESSION_COOKIE, 'garbage');
    const res = await client.get('/me');
    expect(res.body).toEqual({ level: null });
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});
