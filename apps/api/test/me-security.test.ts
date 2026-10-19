/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- response bodies are loosely typed (see TestResponse) */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { generateTotpCode } from '../src/auth/totp.js';
import { auditLog, recoveryCodes, sessions, users } from '../src/db/schema/index.js';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';
import { loginAs } from './session-helpers.js';

const row = (t: TestApp, id: string) => t.db.db.select().from(users).where(eq(users.id, id)).get()!;
const actions = (t: TestApp) =>
  t.db.db
    .select()
    .from(auditLog)
    .all()
    .map((r) => r.action);
const codesOf = (t: TestApp, id: string) =>
  t.db.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id)).all();
const code = (t: TestApp, user: TestUser) => generateTotpCode(user.totpSecret!, t.clock());
const nextPeriod = (t: TestApp) => t.clock.advance(30);

describe('POST /api/me/password', () => {
  it('changes the password, revokes the other sessions and rotates the current one', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);
    const other = loginAs(t, user);
    const before = client.cookie('es_session');

    const res = await client.post('/api/me/password', {
      body: { currentPassword: user.password, newPassword: 'a-brand-new-password' },
    });
    expect(res.status).toBe(204);
    expect(client.cookie('es_session')).not.toBe(before);
    expect(
      await t.ctx.passwordHasher.verify(row(t, user.id).passwordHash, 'a-brand-new-password'),
    ).toBe(true);
    expect(t.db.db.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toHaveLength(
      1,
    );
    expect((await other.get('/api/me')).status).toBe(401);
    expect((await client.get('/api/me')).status).toBe(200);
    expect(actions(t)).toContain('auth.password_changed');
  });

  it('refuses a wrong current password and locks after 5 failures with Retry-After', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);
    const attempt = (currentPassword: string) =>
      client.post('/api/me/password', {
        body: { currentPassword, newPassword: 'a-brand-new-password' },
      });

    for (let i = 0; i < 4; i++) {
      const res = await attempt('wrong-password-123');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_INCORRECT');
    }
    const locked = await attempt('wrong-password-123');
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // Even the right password is refused while locked, and nothing changed.
    expect((await attempt(user.password)).status).toBe(429);
    expect(await t.ctx.passwordHasher.verify(row(t, user.id).passwordHash, user.password)).toBe(
      true,
    );
  });

  it('validates the new password length and requires a session', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);
    const short = await client.post('/api/me/password', {
      body: { currentPassword: user.password, newPassword: 'short' },
    });
    expect(short.status).toBe(400);
    const anon = await t.client().post('/api/me/password', {
      body: { currentPassword: 'x', newPassword: 'a-brand-new-password' },
    });
    expect(anon.status).toBe(401);
  });
});

describe('2FA enrolment', () => {
  it('sets up, enables with a valid code and returns 10 recovery codes', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);

    const setup = await client.post('/api/me/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.otpauthUri).toContain(encodeURIComponent(user.email));
    expect(row(t, user.id).totpEnabled).toBe(false);
    expect(row(t, user.id).totpSecretEnc).not.toContain(setup.body.secret);

    const bad = await client.post('/api/me/2fa/enable', { body: { code: '000000' } });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_TOTP_CODE');
    expect(row(t, user.id).totpEnabled).toBe(false);

    const enable = await client.post('/api/me/2fa/enable', {
      body: { code: generateTotpCode(setup.body.secret, t.clock()) },
    });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);
    expect(new Set(enable.body.recoveryCodes).size).toBe(10);
    expect(row(t, user.id).totpEnabled).toBe(true);
    expect(row(t, user.id).totpLastCounter).not.toBeNull();
    expect(codesOf(t, user.id)).toHaveLength(10);
    expect((await client.get('/api/me')).body.user.totpEnabled).toBe(true);
    expect(actions(t)).toContain('auth.2fa_enabled');
  });

  it('answers CONFLICT for enable without setup, setup when enabled, and enable when enabled', async () => {
    const t = await createTestApp();
    const fresh = loginAs(t, await t.createUser());
    const noPending = await fresh.post('/api/me/2fa/enable', { body: { code: '123456' } });
    expect(noPending.status).toBe(409);
    expect(noPending.body.error.code).toBe('CONFLICT');

    const enabled = await t.createUser({ totp: true });
    const client = loginAs(t, enabled);
    expect((await client.post('/api/me/2fa/setup')).body.error.code).toBe('CONFLICT');
    const again = await client.post('/api/me/2fa/enable', { body: { code: code(t, enabled) } });
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('rejects a replayed code at enable time', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);
    const { secret } = (await client.post('/api/me/2fa/setup')).body;
    const otp = generateTotpCode(secret, t.clock());
    expect((await client.post('/api/me/2fa/enable', { body: { code: otp } })).status).toBe(200);
    // Back to the pending state with the counter already consumed.
    t.db.db.update(users).set({ totpEnabled: false }).where(eq(users.id, user.id)).run();
    const replay = await client.post('/api/me/2fa/enable', { body: { code: otp } });
    expect(replay.body.error.code).toBe('INVALID_TOTP_CODE');
  });
});

describe('POST /api/me/2fa/disable', () => {
  it('disables 2FA for a regular user and clears secret, counter and recovery codes', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const client = loginAs(t, user);
    const regenerated = await client.post('/api/me/2fa/recovery-codes', {
      body: { password: user.password, code: code(t, user) },
    });
    expect(regenerated.status).toBe(200);
    expect(codesOf(t, user.id)).toHaveLength(10);
    nextPeriod(t);

    const res = await client.post('/api/me/2fa/disable', {
      body: { password: user.password, code: code(t, user) },
    });
    expect(res.status).toBe(204);
    expect(row(t, user.id)).toMatchObject({
      totpEnabled: false,
      totpSecretEnc: null,
      totpLastCounter: null,
    });
    expect(codesOf(t, user.id)).toHaveLength(0);
    expect(actions(t)).toContain('auth.2fa_disabled');
  });

  it('is refused for admins with TWO_FACTOR_REQUIRED', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin', totp: true });
    const res = await loginAs(t, admin).post('/api/me/2fa/disable', {
      body: { password: admin.password, code: code(t, admin) },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TWO_FACTOR_REQUIRED');
    expect(row(t, admin.id).totpEnabled).toBe(true);
  });

  it('distinguishes a wrong password from a wrong code and keeps 2FA on', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const client = loginAs(t, user);
    const wrongPassword = await client.post('/api/me/2fa/disable', {
      body: { password: 'not-the-password', code: code(t, user) },
    });
    expect(wrongPassword.body.error.code).toBe('PASSWORD_INCORRECT');
    const wrongCode = await client.post('/api/me/2fa/disable', {
      body: { password: user.password, code: '000000' },
    });
    expect(wrongCode.body.error.code).toBe('INVALID_TOTP_CODE');
    expect(row(t, user.id).totpEnabled).toBe(true);
  });

  it('does not accept the same code twice (replay) and locks after repeated failures', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const client = loginAs(t, user);
    const body = { password: user.password, code: code(t, user) };
    expect((await client.post('/api/me/2fa/recovery-codes', { body })).status).toBe(200);
    const replay = await client.post('/api/me/2fa/disable', { body });
    expect(replay.body.error.code).toBe('INVALID_TOTP_CODE');

    let last;
    for (let i = 0; i < 4; i++) {
      last = await client.post('/api/me/2fa/disable', {
        body: { password: 'wrong-password-1', code: body.code },
      });
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('answers CONFLICT when 2FA is not enabled', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const res = await loginAs(t, user).post('/api/me/2fa/disable', {
      body: { password: user.password, code: '123456' },
    });
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/me/2fa/recovery-codes', () => {
  it('replaces the old codes with 10 new ones', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const client = loginAs(t, user);

    const first = await client.post('/api/me/2fa/recovery-codes', {
      body: { password: user.password, code: code(t, user) },
    });
    expect(first.status).toBe(200);
    expect(first.body.recoveryCodes).toHaveLength(10);
    const oldHashes = codesOf(t, user.id).map((r) => r.codeHash);

    nextPeriod(t);
    const second = await client.post('/api/me/2fa/recovery-codes', {
      body: { password: user.password, code: code(t, user) },
    });
    expect(second.body.recoveryCodes).toHaveLength(10);
    const rows = codesOf(t, user.id);
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => oldHashes.includes(r.codeHash))).toBe(false);
    expect(actions(t).filter((a) => a === 'auth.recovery_regenerated')).toHaveLength(2);
  });

  it('answers CONFLICT without 2FA and rejects wrong credentials', async () => {
    const t = await createTestApp();
    const plain = await t.createUser();
    const none = await loginAs(t, plain).post('/api/me/2fa/recovery-codes', {
      body: { password: plain.password, code: '123456' },
    });
    expect(none.body.error.code).toBe('CONFLICT');

    const user = await t.createUser({ totp: true });
    const client = loginAs(t, user);
    const badPassword = await client.post('/api/me/2fa/recovery-codes', {
      body: { password: 'wrong-password-1', code: code(t, user) },
    });
    expect(badPassword.body.error.code).toBe('PASSWORD_INCORRECT');
    const badCode = await client.post('/api/me/2fa/recovery-codes', {
      body: { password: user.password, code: '000000' },
    });
    expect(badCode.body.error.code).toBe('INVALID_TOTP_CODE');
  });
});
