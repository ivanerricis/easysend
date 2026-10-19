import express from 'express';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth/session.js';
import { deriveKeys } from '../src/crypto/keys.js';
import { CSRF_COOKIE, cookieParser } from '../src/http/cookies.js';
import { createCsrf } from '../src/http/csrf.js';
import { createErrorHandler } from '../src/http/error-handler.js';
import { requestId } from '../src/http/request-id.js';
import { TEST_SECRETS, TestClient, silentLogger } from './helpers.js';

/** Minimal app: `x-test-session` fakes a logged-in session with that id. */
function makeApp() {
  const csrf = createCsrf({
    publicUrl: () => 'http://localhost:8080',
    csrfKey: deriveKeys(TEST_SECRETS).csrf,
  });
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(cookieParser);
  app.use((req, _res, next) => {
    const id = req.get('x-test-session');
    if (id) req.auth = { session: { id }, user: {}, level: 'session' } as unknown as AuthContext;
    next();
  });
  app.get('/token', (req, res) => {
    res.json({ token: csrf.tokenFor(req, res) });
  });
  app.post('/protected', csrf.requireCsrf, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(createErrorHandler(silentLogger));
  return { csrf, client: new TestClient(app) };
}

const errorCode = (body: unknown) => (body as { error: { code: string } }).error.code;

describe('pre-login CSRF (signed double-submit)', () => {
  it('issues a cookie and a token, and reuses a valid cookie', async () => {
    const { client } = makeApp();
    const first = await client.get('/token');
    const token = first.body.token as string;
    const setCookie = String(first.headers['set-cookie']);
    expect(setCookie).toContain(`${CSRF_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(client.cookie(CSRF_COOKIE)).toBe(token);

    const second = await client.get('/token');
    expect(second.body.token).toBe(token);
    expect(second.headers['set-cookie']).toBeUndefined();
  });

  it('accepts the matching header', async () => {
    const { client } = makeApp();
    client.csrfToken = (await client.get('/token')).body.token as string;
    const res = await client.post('/protected');
    expect(res.status).toBe(200);
  });

  it('rejects a missing header', async () => {
    const { client } = makeApp();
    await client.get('/token');
    const res = await client.post('/protected', { csrf: false });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });

  it('rejects a missing cookie', async () => {
    const { client } = makeApp();
    const token = (await client.get('/token')).body.token as string;
    client.clearCookies();
    const res = await client.post('/protected', { csrf: token });
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });

  it('rejects a header that differs from the cookie', async () => {
    const { client } = makeApp();
    await client.get('/token');
    const other = makeApp();
    const foreign = (await other.client.get('/token')).body.token as string;
    // Same key, valid signature, but not the token of this cookie.
    const res = await client.post('/protected', { csrf: foreign });
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });

  it('rejects an unsigned cookie even when header and cookie are equal', async () => {
    const { client } = makeApp();
    client.setCookie(CSRF_COOKIE, 'attacker.chosen');
    const res = await client.post('/protected', { csrf: 'attacker.chosen' });
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });
});

describe('session-bound CSRF', () => {
  it('derives the token from the session id', async () => {
    const { csrf, client } = makeApp();
    const res = await client.get('/token', { headers: { 'x-test-session': 's1' } });
    expect(res.body.token).toBe(csrf.sessionToken('s1'));
    expect(csrf.sessionToken('s1')).not.toBe(csrf.sessionToken('s2'));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts its own token only', async () => {
    const { csrf, client } = makeApp();
    const headers = { 'x-test-session': 's1' };
    const ok = await client.post('/protected', { headers, csrf: csrf.sessionToken('s1') });
    expect(ok.status).toBe(200);

    const otherSession = await client.post('/protected', {
      headers,
      csrf: csrf.sessionToken('s2'),
    });
    expect(errorCode(otherSession.body)).toBe('CSRF_INVALID');

    // A pre-login double-submit pair is not enough once a session exists.
    const pre = (await client.get('/token')).body.token as string;
    const preLogin = await client.post('/protected', { headers, csrf: pre });
    expect(errorCode(preLogin.body)).toBe('CSRF_INVALID');
  });
});

describe('cross-site protection', () => {
  const validPair = async () => {
    const ctx = makeApp();
    ctx.client.csrfToken = (await ctx.client.get('/token')).body.token as string;
    return ctx.client;
  };

  it('rejects a foreign Origin even with a valid token', async () => {
    const client = await validPair();
    const res = await client.post('/protected', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });

  it('rejects Origin null and Sec-Fetch-Site cross-site', async () => {
    const client = await validPair();
    expect(errorCode((await client.post('/protected', { headers: { Origin: 'null' } })).body)).toBe(
      'CSRF_INVALID',
    );
    const res = await client.post('/protected', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(errorCode(res.body)).toBe('CSRF_INVALID');
  });

  it('accepts PUBLIC_URL, the request origin and same-origin fetch metadata', async () => {
    const client = await validPair();
    const variants: Record<string, string>[] = [
      { Origin: 'http://localhost:8080' },
      { Host: 'app.test', Origin: 'http://app.test' },
      { 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of variants) {
      expect((await client.post('/protected', { headers })).status).toBe(200);
    }
  });

  it('does not block safe methods', async () => {
    const { client } = makeApp();
    const res = await client.get('/token', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
  });
});
