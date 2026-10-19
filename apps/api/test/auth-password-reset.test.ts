import { describe, expect, it, vi } from 'vitest';
import { sha256Hex, randomToken } from '../src/crypto/hash.js';
import { AUTH_POLICY } from '../src/auth/policy.js';
import { createLimiter } from '../src/http/rate-limit.js';
import {
  auditActions,
  csrfClient,
  loginAs,
  loginWithTotp,
  postLogin,
  sessionRows,
  errorCode,
} from './auth-flow.js';
import { createTestApp, type TestApp } from './helpers.js';

const NEW_PASSWORD = 'a-brand-new-password';

async function requestReset(
  t: TestApp,
  email: string,
  client?: Awaited<ReturnType<typeof csrfClient>>,
) {
  const c = client ?? (await csrfClient(t));
  return c.post('/api/auth/password-reset/request', { body: { email } });
}

/** The reset email is sent without being awaited by the request: wait for it. */
async function tokenFor(t: TestApp, email: string): Promise<string> {
  await vi.waitFor(() => expect(t.mailbox.lastToken(email)).toBeDefined());
  return t.mailbox.lastToken(email) as string;
}

const confirm = async (
  t: TestApp,
  token: string,
  newPassword = NEW_PASSWORD,
  client?: Awaited<ReturnType<typeof csrfClient>>,
) =>
  (client ?? (await csrfClient(t))).post('/api/auth/password-reset/confirm', {
    body: { token, newPassword },
  });

describe('POST /api/auth/password-reset/request', () => {
  it('answers 202 {ok:true} alike for known and unknown emails, and mails only the known', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ locale: 'en' });
    const known = await requestReset(t, user.email);
    const unknown = await requestReset(t, 'nobody@example.com');

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual({ ok: true });
    expect(unknown.body).toEqual(known.body);

    const token = await tokenFor(t, user.email);
    expect(t.mailbox.sent).toHaveLength(1);
    const mail = t.mailbox.last(user.email);
    expect(mail?.to).toBe(user.email);
    expect(mail?.text).toContain('/reset-password?token=');
    expect(mail?.text).toMatch(/password/i);
    expect(token.length).toBeGreaterThanOrEqual(16);
  });

  it('writes the mail in the language of the user', async () => {
    const t = await createTestApp();
    const it = await t.createUser({ locale: 'it' });
    const en = await t.createUser({ locale: 'en' });
    await requestReset(t, it.email);
    await requestReset(t, en.email);
    await tokenFor(t, it.email);
    await tokenFor(t, en.email);
    expect(t.mailbox.last(it.email)?.subject).not.toBe(t.mailbox.last(en.email)?.subject);
  });

  it('stores only the hash of the token, with the configured lifetime', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);

    const rows = t.db.sqlite.prepare('SELECT * FROM password_reset_tokens').all() as Array<{
      user_id: string;
      token_hash: string;
      expires_at: number;
      used_at: number | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]?.expires_at).toBe(
      Math.floor(t.clock() / 1000) + t.config.passwordResetTtlMinutes * 60,
    );
    expect(auditActions(t)).toEqual(['auth.password_reset_requested']);
  });

  it('matches the email case-insensitively', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ email: 'case.test@example.com' });
    await requestReset(t, 'Case.Test@Example.com');
    await tokenFor(t, user.email);
  });

  it('sends nothing for a disabled user, still answering 202', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ disabled: true });
    const res = await requestReset(t, user.email);
    expect(res.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.mailbox.sent).toHaveLength(0);
    expect(t.db.sqlite.prepare('SELECT * FROM password_reset_tokens').all()).toHaveLength(0);
  });

  it('keeps answering 202 but stops sending when limited per email', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = await csrfClient(t);
    for (let i = 0; i < 4; i++) {
      expect((await requestReset(t, user.email, client)).status).toBe(202);
    }
    await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.mailbox.sent).toHaveLength(3);
  });

  it('keeps answering 202 but stops sending when limited per IP', async () => {
    const t = await createTestApp();
    const users = await Promise.all([1, 2, 3, 4, 5, 6].map(() => t.createUser()));
    const client = await csrfClient(t);
    for (const user of users) expect((await requestReset(t, user.email, client)).status).toBe(202);
    await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(5));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.mailbox.sent).toHaveLength(5);
  });

  it('survives a mail failure without changing the answer', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    t.mailbox.failWith = new Error('smtp down');
    const res = await requestReset(t, user.email);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it('requires a CSRF token and a valid email', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    const noToken = await client.post('/api/auth/password-reset/request', {
      body: { email: 'a@example.com' },
      csrf: false,
    });
    expect(errorCode(noToken)).toBe('CSRF_INVALID');
    const bad = await client.post('/api/auth/password-reset/request', { body: { email: 'nope' } });
    expect(errorCode(bad)).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/password-reset/confirm', () => {
  it('sets the new password and burns the token', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);

    const res = await confirm(t, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(auditActions(t)).toContain('auth.password_reset');

    const client = await csrfClient(t);
    expect(errorCode(await postLogin(client, user))).toBe('INVALID_CREDENTIALS');
    expect((await postLogin(client, user, NEW_PASSWORD)).status).toBe(200);

    const reuse = await confirm(t, token, 'another-new-password');
    expect(reuse.status).toBe(400);
    expect(errorCode(reuse)).toBe('RESET_TOKEN_INVALID');
  });

  it('rejects unknown tokens and expired tokens', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const unknown = await confirm(t, randomToken(32));
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown)).toBe('RESET_TOKEN_INVALID');

    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);
    t.clock.advance(t.config.passwordResetTtlMinutes * 60 + 1);
    const expired = await confirm(t, token);
    expect(errorCode(expired)).toBe('RESET_TOKEN_INVALID');
    expect((await postLogin(await csrfClient(t), user)).status).toBe(200);
  });

  it('is still valid just before the expiry', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);
    t.clock.advance(t.config.passwordResetTtlMinutes * 60 - 5);
    expect((await confirm(t, token)).status).toBe(200);
  });

  it('validates the new password and keeps the token usable after a rejection', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);

    const short = await confirm(t, token, 'short');
    expect(errorCode(short)).toBe('VALIDATION_ERROR');
    const tiny = await confirm(t, 'abc');
    expect(errorCode(tiny)).toBe('VALIDATION_ERROR');
    expect((await confirm(t, token)).status).toBe(200);
  });

  it('invalidates the other pending tokens of the user', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = await csrfClient(t);
    await requestReset(t, user.email, client);
    const first = await tokenFor(t, user.email);
    await requestReset(t, user.email, client);
    await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(2));
    const second = await tokenFor(t, user.email);
    expect(second).not.toBe(first);

    expect((await confirm(t, second)).status).toBe(200);
    expect(errorCode(await confirm(t, first))).toBe('RESET_TOKEN_INVALID');
  });

  it('revokes every session of the user but keeps 2FA enabled', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const a = await loginWithTotp(t, user);
    t.clock.advance(AUTH_POLICY.totp.periodSeconds);
    const b = await loginWithTotp(t, user);
    const bystander = await t.createUser();
    const other = await loginAs(t, bystander);
    expect(sessionRows(t)).toHaveLength(3);

    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);
    expect((await confirm(t, token)).status).toBe(200);

    expect((await a.client.get('/api/auth/session')).body.authenticated).toBe(false);
    expect((await b.client.get('/api/auth/session')).body.authenticated).toBe(false);
    expect((await other.client.get('/api/auth/session')).body.authenticated).toBe(true);
    expect(sessionRows(t).map((r) => r.user_id)).toEqual([bystander.id]);

    const row = t.db.sqlite
      .prepare('SELECT totp_enabled, totp_secret_enc FROM users WHERE id = ?')
      .get(user.id) as { totp_enabled: number; totp_secret_enc: string | null };
    expect(row.totp_enabled).toBe(1);
    expect(row.totp_secret_enc).not.toBeNull();

    // The next login still needs the second factor.
    const client = await csrfClient(t);
    const res = await client.post('/api/auth/login', {
      body: { email: user.email, password: NEW_PASSWORD },
    });
    expect(res.body).toEqual({ status: 'mfa_required' });
  });

  it('lifts a login lockout', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = await csrfClient(t);
    for (let i = 0; i < 5; i++) await postLogin(client, user, 'wrong-password-1');
    expect(errorCode(await postLogin(client, user, NEW_PASSWORD))).toBe('ACCOUNT_LOCKED');

    await requestReset(t, user.email);
    expect((await confirm(t, await tokenFor(t, user.email))).status).toBe(200);
    expect((await postLogin(client, user, NEW_PASSWORD)).status).toBe(200);
  });

  it('accepts a welcome token created by an admin (72 hours)', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const token = randomToken(32);
    const now = Math.floor(t.clock() / 1000);
    t.db.sqlite
      .prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(randomToken(8), user.id, sha256Hex(token), now + AUTH_POLICY.welcomeTokenSeconds, now);
    t.clock.advance(AUTH_POLICY.welcomeTokenSeconds - 60);
    expect((await confirm(t, token)).status).toBe(200);
  });

  it('refuses the reset of a disabled user', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    await requestReset(t, user.email);
    const token = await tokenFor(t, user.email);
    t.db.sqlite.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
    expect(errorCode(await confirm(t, token))).toBe('RESET_TOKEN_INVALID');
  });

  it('is rate limited per IP', async () => {
    const t = await createTestApp();
    t.ctx.limiters.resetConfirmIp = createLimiter({
      points: 3,
      durationSeconds: 60,
      blockSeconds: 60,
    });
    const client = await csrfClient(t);
    for (let i = 0; i < 3; i++) {
      expect((await confirm(t, randomToken(32), NEW_PASSWORD, client)).status).toBe(400);
    }
    const limited = await confirm(t, randomToken(32), NEW_PASSWORD, client);
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('requires a CSRF token', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    const res = await client.post('/api/auth/password-reset/confirm', {
      body: { token: randomToken(32), newPassword: NEW_PASSWORD },
      csrf: false,
    });
    expect(errorCode(res)).toBe('CSRF_INVALID');
  });
});
