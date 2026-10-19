import { describe, expect, it } from 'vitest';
import { AUTH_POLICY } from '../src/auth/policy.js';
import {
  auditActions,
  csrfClient,
  loginAs,
  loginWithTotp,
  sessionCookie,
  sessionRows,
  errorCode,
} from './auth-flow.js';
import { createTestApp } from './helpers.js';

const { session: policy } = AUTH_POLICY;
const DAY = 86_400;

describe('GET /api/auth/session', () => {
  it('is anonymous without a cookie, and with a garbage cookie', async () => {
    const t = await createTestApp();
    const client = t.client();
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });

    client.setCookie('es_session', 'x'.repeat(43));
    const res = await client.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('never treats a pending session as a login', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });
  });

  it('GET /auth/csrf returns the session-bound token when logged in', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client, res } = await loginAs(t, user);
    const csrf = await client.get('/api/auth/csrf');
    expect(csrf.body.csrfToken).toBe(res.body.csrfToken);
  });

  it('stops working when the user is disabled afterwards', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client } = await loginAs(t, user);
    t.db.sqlite.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });
  });
});

describe('session expiry', () => {
  it('expires after 7 days without activity', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client } = await loginAs(t, user);

    t.clock.advance(policy.idleSeconds - 60);
    expect((await client.get('/api/auth/session')).body.authenticated).toBe(true);

    t.clock.advance(policy.idleSeconds + 60);
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });
    expect(sessionRows(t)).toHaveLength(0);
  });

  it('expires 30 days after login even when used every day', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client } = await loginAs(t, user);

    for (let day = 1; day < 30; day++) {
      t.clock.advance(DAY);
      expect((await client.get('/api/auth/session')).body.authenticated).toBe(true);
    }
    t.clock.advance(DAY + 60);
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });
  });
});

describe('POST /api/auth/logout', () => {
  it('ends a full session and clears the cookie', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client } = await loginAs(t, user);
    const token = sessionCookie(client) as string;

    const res = await client.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/es_session=;.*Max-Age=0/);
    expect(sessionCookie(client)).toBeUndefined();
    expect(sessionRows(t)).toHaveLength(0);
    expect(auditActions(t)).toContain('auth.logout');

    // The old cookie is dead server-side, not just removed from the browser.
    const replay = t.client();
    replay.setCookie('es_session', token);
    expect((await replay.get('/api/auth/session')).body).toEqual({ authenticated: false });
  });

  it('cancels a half-done login (pending session)', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');
    const res = await client.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(sessionRows(t)).toHaveLength(0);
    expect(sessionCookie(client)).toBeUndefined();
  });

  it('works after a login completed with 2FA', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginWithTotp(t, user);
    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect(sessionRows(t)).toHaveLength(0);
  });

  it('answers 401 without a session', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    expect((await client.post('/api/auth/logout')).status).toBe(401);
  });
});

describe('CSRF with a session', () => {
  it('accepts the session token and rejects the old pre-login one', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const { client, res } = await loginAs(t, user);
    const preLogin = client.cookie('es_csrf') as string;
    const body = { email: 'someone@example.com' };

    const ok = await client.post('/api/auth/password-reset/request', {
      body,
      csrf: res.body.csrfToken as string,
    });
    expect(ok.status).toBe(202);

    const stale = await client.post('/api/auth/password-reset/request', { body, csrf: preLogin });
    expect(stale.status).toBe(403);
    expect(errorCode(stale)).toBe('CSRF_INVALID');
  });
});
