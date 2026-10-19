import { describe, expect, it, vi } from 'vitest';
import { createLimiter } from '../src/http/rate-limit.js';
import {
  auditActions,
  csrfClient,
  loginAs,
  postLogin,
  sessionCookie,
  sessionRows,
  errorCode,
  userOf,
} from './auth-flow.js';
import { createTestApp } from './helpers.js';

describe('GET /api/auth/csrf', () => {
  it('issues a pre-login token with its cookie and keeps it stable', async () => {
    const t = await createTestApp();
    const client = t.client();
    const first = await client.get('/api/auth/csrf');
    expect(first.status).toBe(200);
    expect(first.body.csrfToken).toEqual(expect.any(String));
    expect(String(first.headers['set-cookie'])).toMatch(/es_csrf=.*HttpOnly/);
    expect(client.cookie('es_csrf')).toBe(first.body.csrfToken);

    const second = await client.get('/api/auth/csrf');
    expect(second.body.csrfToken).toBe(first.body.csrfToken);
  });
});

describe('POST /api/auth/login', () => {
  it('opens a full session for a user without 2FA', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ locale: null });
    const { client, res } = await loginAs(t, user, 'ok');

    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'user',
      locale: 'it',
      totpEnabled: false,
    });
    expect(userOf(res).lastLoginAt).toBe(Math.floor(t.clock() / 1000));
    expect(JSON.stringify(res.body)).not.toMatch(/password|totpSecret/i);
    expect(sessionCookie(client)).toBeDefined();
    expect(String(res.headers['set-cookie'])).toMatch(
      /es_session=.*HttpOnly.*Secure.*SameSite=Lax/,
    );

    const session = await client.get('/api/auth/session');
    expect(session.body.authenticated).toBe(true);
    expect(userOf(session).id).toBe(user.id);
    expect(session.body.csrfToken).toBe(res.body.csrfToken);
    expect(auditActions(t)).toContain('auth.login');
  });

  it('rotates the session cookie on every login', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client } = await loginAs(t, user);
    const first = sessionCookie(client) as string;

    await loginAs(t, user, 'ok', client);
    const second = sessionCookie(client) as string;
    expect(second).not.toBe(first);
    expect(sessionRows(t)).toHaveLength(1);

    const stale = t.client();
    stale.setCookie('es_session', first);
    expect((await stale.get('/api/auth/session')).body).toEqual({ authenticated: false });
  });

  it('matches the email case-insensitively', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ email: 'mixed.case@example.com' });
    const client = await csrfClient(t);
    const res = await client.post('/api/auth/login', {
      body: { email: 'Mixed.Case@EXAMPLE.com', password: user.password },
    });
    expect(res.status).toBe(200);
  });

  it('answers the same way for a wrong password and for an unknown email', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const dummy = vi.spyOn(t.ctx.passwordHasher, 'verifyDummy');
    const client = await csrfClient(t);

    const wrong = await postLogin(client, user, 'not-the-password');
    const unknown = await postLogin(client, {
      email: 'nobody@example.com',
      password: 'whatever-123',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    expect({ ...unknown.body.error, requestId: 0 }).toEqual({ ...wrong.body.error, requestId: 0 });
    expect(dummy).toHaveBeenCalledTimes(1);
    expect(sessionCookie(client)).toBeUndefined();
  });

  it('audits failures without storing the typed email', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    await postLogin(client, { email: 'secret-guess@example.com', password: 'whatever-123' });
    expect(auditActions(t)).toEqual(['auth.login_failed']);
    const rows = JSON.stringify(t.db.sqlite.prepare('SELECT * FROM audit_log').all());
    expect(rows).not.toContain('secret-guess');
    expect(rows).not.toContain('whatever-123');
  });

  it('rejects a malformed body', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    const res = await client.post('/api/auth/login', { body: { email: 'not-an-email' } });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });

  describe('disabled users', () => {
    it('reveals the disabled state only after the correct password', async () => {
      const t = await createTestApp();
      const user = await t.createUser({ disabled: true });
      const client = await csrfClient(t);

      const wrong = await postLogin(client, user, 'not-the-password');
      expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');

      const right = await postLogin(client, user);
      expect(right.status).toBe(403);
      expect(errorCode(right)).toBe('ACCOUNT_DISABLED');
      expect(sessionCookie(client)).toBeUndefined();
      expect(sessionRows(t)).toHaveLength(0);
    });
  });

  describe('lockout and rate limit', () => {
    it('locks the account after 5 failures, with Retry-After', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const other = await t.createUser();
      const client = await csrfClient(t);

      for (let i = 0; i < 4; i++) {
        const res = await postLogin(client, user, 'wrong-password-1');
        expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
      }
      const fifth = await postLogin(client, user, 'wrong-password-1');
      expect(fifth.status).toBe(429);
      expect(errorCode(fifth)).toBe('ACCOUNT_LOCKED');
      expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0);

      // Even the right password is refused while locked.
      const locked = await postLogin(client, user);
      expect(locked.status).toBe(429);
      expect(errorCode(locked)).toBe('ACCOUNT_LOCKED');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      expect(auditActions(t)).toContain('auth.lockout');

      // Other accounts are not affected.
      expect((await postLogin(client, other)).status).toBe(200);
    });

    it('unlocks once the window has passed', async () => {
      const t = await createTestApp();
      // The limiter runs on the real clock: a one second window keeps the test fast.
      t.ctx.limiters.loginAccount = createLimiter({
        points: 5,
        durationSeconds: 1,
        blockSeconds: 1,
      });
      const user = await t.createUser();
      const client = await csrfClient(t);
      for (let i = 0; i < 5; i++) await postLogin(client, user, 'wrong-password-1');
      expect(errorCode(await postLogin(client, user))).toBe('ACCOUNT_LOCKED');

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect((await postLogin(client, user)).status).toBe(200);
    });

    it('a successful login clears the failure counter', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const client = await csrfClient(t);
      for (let i = 0; i < 4; i++) await postLogin(client, user, 'wrong-password-1');
      expect((await postLogin(client, user)).status).toBe(200);
      const again = await csrfClient(t);
      for (let i = 0; i < 4; i++) {
        expect(errorCode(await postLogin(again, user, 'wrong-password-1'))).toBe(
          'INVALID_CREDENTIALS',
        );
      }
    });

    it('also locks an unknown email, so the lockout does not reveal accounts', async () => {
      const t = await createTestApp();
      const client = await csrfClient(t);
      const ghost = { email: 'ghost@example.com', password: 'whatever-123' };
      for (let i = 0; i < 4; i++) await postLogin(client, ghost);
      const fifth = await postLogin(client, ghost);
      expect(errorCode(fifth)).toBe('ACCOUNT_LOCKED');
    });

    it('limits failures per IP with RATE_LIMITED', async () => {
      const t = await createTestApp();
      const client = await csrfClient(t);
      let last = await postLogin(client, { email: 'a0@example.com', password: 'whatever-123' });
      for (let i = 1; i < 20; i++) {
        last = await postLogin(client, { email: `a${i}@example.com`, password: 'whatever-123' });
      }
      expect(last.status).toBe(429);
      expect(errorCode(last)).toBe('RATE_LIMITED');
      expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);

      const user = await t.createUser();
      const blocked = await postLogin(client, user);
      expect(errorCode(blocked)).toBe('RATE_LIMITED');
    });
  });

  describe('CSRF', () => {
    it('rejects a missing token', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const client = await csrfClient(t);
      const res = await client.post('/api/auth/login', {
        body: { email: user.email, password: user.password },
        csrf: false,
      });
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('CSRF_INVALID');
    });

    it('rejects a wrong token and a token without its cookie', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const client = await csrfClient(t);
      const body = { email: user.email, password: user.password };
      const wrong = await client.post('/api/auth/login', { body, csrf: 'forged-token' });
      expect(errorCode(wrong)).toBe('CSRF_INVALID');

      const stranger = t.client(); // no es_csrf cookie
      const noCookie = await stranger.post('/api/auth/login', {
        body,
        csrf: client.csrfToken as string,
      });
      expect(errorCode(noCookie)).toBe('CSRF_INVALID');
    });

    it('rejects a cross-site Origin and Sec-Fetch-Site', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const client = await csrfClient(t);
      const body = { email: user.email, password: user.password };

      const origin = await client.post('/api/auth/login', {
        body,
        headers: { Origin: 'https://evil.example' },
      });
      expect(origin.status).toBe(403);
      expect(errorCode(origin)).toBe('CSRF_INVALID');

      const fetchSite = await client.post('/api/auth/login', {
        body,
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      expect(errorCode(fetchSite)).toBe('CSRF_INVALID');
    });

    it('accepts the configured origin', async () => {
      const t = await createTestApp();
      const user = await t.createUser();
      const client = await csrfClient(t);
      const res = await client.post('/api/auth/login', {
        body: { email: user.email, password: user.password },
        headers: { Origin: new URL(t.config.publicUrl as string).origin },
      });
      expect(res.status).toBe(200);
    });
  });
});
