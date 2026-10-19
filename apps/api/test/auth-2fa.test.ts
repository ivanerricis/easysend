import { describe, expect, it } from 'vitest';
import { generateTotpCode } from '../src/auth/totp.js';
import { AUTH_POLICY } from '../src/auth/policy.js';
import { decryptSecret } from '../src/crypto/aead.js';
import {
  auditActions,
  csrfClient,
  giveRecoveryCodes,
  loginAs,
  loginWithTotp,
  postLogin,
  sessionCookie,
  sessionRows,
  unusedRecoveryCodes,
  errorCode,
  userOf,
} from './auth-flow.js';
import { createTestApp, type TestApp } from './helpers.js';

const userRow = (t: TestApp, id: string) =>
  t.db.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
    totp_enabled: number;
    totp_secret_enc: string | null;
    totp_last_counter: number | null;
    last_login_at: number | null;
  };

const wrongCode = (secret: string, nowMs: number): string => {
  const good = generateTotpCode(secret, nowMs);
  return good === '000000' ? '000001' : '000000';
};

describe('login with TOTP', () => {
  it('asks for the second factor and does not authenticate yet', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client, res } = await loginAs(t, user, 'mfa_required');

    expect(res.body).toEqual({ status: 'mfa_required' });
    expect(sessionRows(t)).toMatchObject([{ user_id: user.id, mfa_verified: 0 }]);
    expect(userRow(t, user.id).last_login_at).toBeNull();
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });
    expect(auditActions(t)).not.toContain('auth.login');
  });

  it('completes the login with the right code and rotates the session', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');
    const pendingCookie = sessionCookie(client);

    const res = await client.post('/api/auth/login/2fa', {
      body: { code: generateTotpCode(user.totpSecret as string, t.clock()) },
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, totpEnabled: true });
    expect(res.body.recoveryCodesLeft).toBeUndefined();
    expect(sessionCookie(client)).not.toBe(pendingCookie);
    expect(sessionRows(t)).toMatchObject([{ user_id: user.id, mfa_verified: 1 }]);
    expect(userRow(t, user.id).last_login_at).toBe(Math.floor(t.clock() / 1000));

    const session = await client.get('/api/auth/session');
    expect(session.body.authenticated).toBe(true);
    expect(session.body.csrfToken).toBe(res.body.csrfToken);
    expect(auditActions(t)).toContain('auth.login');
  });

  it('rejects a wrong or malformed code', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');

    const wrong = await client.post('/api/auth/login/2fa', {
      body: { code: wrongCode(user.totpSecret as string, t.clock()) },
    });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('INVALID_TOTP_CODE');

    const malformed = await client.post('/api/auth/login/2fa', { body: { code: 'abc' } });
    expect(errorCode(malformed)).toBe('VALIDATION_ERROR');
    expect((await client.get('/api/auth/session')).body.authenticated).toBe(false);
  });

  it('refuses a replayed code and accepts the next one', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    await loginWithTotp(t, user);
    const used = generateTotpCode(user.totpSecret as string, t.clock());
    expect(userRow(t, user.id).totp_last_counter).toEqual(expect.any(Number));

    const { client } = await loginAs(t, user, 'mfa_required');
    const replay = await client.post('/api/auth/login/2fa', { body: { code: used } });
    expect(replay.status).toBe(401);
    expect(errorCode(replay)).toBe('INVALID_TOTP_CODE');

    t.clock.advance(AUTH_POLICY.totp.periodSeconds);
    const next = await client.post('/api/auth/login/2fa', {
      body: { code: generateTotpCode(user.totpSecret as string, t.clock()) },
    });
    expect(next.status).toBe(200);
  });

  it('needs a pending session', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const anonymous = await csrfClient(t);
    const none = await anonymous.post('/api/auth/login/2fa', { body: { code: '123456' } });
    expect(none.status).toBe(401);

    const { client } = await loginWithTotp(t, user);
    const full = await client.post('/api/auth/login/2fa', { body: { code: '123456' } });
    expect(full.status).toBe(401);
  });

  it('lets the pending session expire after 10 minutes', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');
    t.clock.advance(AUTH_POLICY.session.mfaPendingSeconds + 1);
    const res = await client.post('/api/auth/login/2fa', {
      body: { code: generateTotpCode(user.totpSecret as string, t.clock()) },
    });
    expect(res.status).toBe(401);
    expect(sessionRows(t)).toHaveLength(0);
  });

  it('counts wrong codes on the account lockout, shared with passwords', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const anonymous = await csrfClient(t);
    await postLogin(anonymous, user, 'wrong-password-1');
    await postLogin(anonymous, user, 'wrong-password-1');

    const { client } = await loginAs(t, user, 'mfa_required');
    const bad = { code: wrongCode(user.totpSecret as string, t.clock()) };
    expect((await client.post('/api/auth/login/2fa', { body: bad })).status).toBe(401);
    expect((await client.post('/api/auth/login/2fa', { body: bad })).status).toBe(401);
    const locked = await client.post('/api/auth/login/2fa', { body: bad });
    expect(locked.status).toBe(429);
    expect(errorCode(locked)).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // Even the right code is refused now.
    const right = await client.post('/api/auth/login/2fa', {
      body: { code: generateTotpCode(user.totpSecret as string, t.clock()) },
    });
    expect(errorCode(right)).toBe('ACCOUNT_LOCKED');
  });

  it('does not let a correct password reset the second-factor guess counter', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const bad = { code: wrongCode(user.totpSecret as string, t.clock()) };

    const { client } = await loginAs(t, user, 'mfa_required');
    for (let i = 0; i < 4; i++) await client.post('/api/auth/login/2fa', { body: bad });
    await loginAs(t, user, 'mfa_required', client); // password again: counter must survive
    const fifth = await client.post('/api/auth/login/2fa', { body: bad });
    expect(errorCode(fifth)).toBe('ACCOUNT_LOCKED');
  });
});

describe('recovery codes', () => {
  it('logs in once per code and reports how many are left', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const codes = giveRecoveryCodes(t, user.id);
    const { client } = await loginAs(t, user, 'mfa_required');

    // Case, dashes and spaces are ignored.
    const typed = (codes[0] as string).toLowerCase().replace(/-/g, ' ');
    const res = await client.post('/api/auth/login/recovery', { body: { recoveryCode: typed } });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodesLeft).toBe(9);
    expect(userOf(res).id).toBe(user.id);
    expect(unusedRecoveryCodes(t, user.id)).toBe(9);
    expect(auditActions(t)).toEqual(expect.arrayContaining(['auth.recovery_used', 'auth.login']));
    expect((await client.get('/api/auth/session')).body.authenticated).toBe(true);

    // The same code cannot be used a second time.
    const { client: again } = await loginAs(t, user, 'mfa_required');
    const reuse = await again.post('/api/auth/login/recovery', {
      body: { recoveryCode: codes[0] as string },
    });
    expect(reuse.status).toBe(401);
    expect(errorCode(reuse)).toBe('INVALID_RECOVERY_CODE');
    expect(unusedRecoveryCodes(t, user.id)).toBe(9);

    // A different one still works.
    const other = await again.post('/api/auth/login/recovery', {
      body: { recoveryCode: codes[1] as string },
    });
    expect(other.body.recoveryCodesLeft).toBe(8);
  });

  it('counts wrong codes on the lockout', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    giveRecoveryCodes(t, user.id);
    const { client } = await loginAs(t, user, 'mfa_required');
    const body = { recoveryCode: 'AAAA-AAAA-AAAA' };
    for (let i = 0; i < 4; i++) {
      const res = await client.post('/api/auth/login/recovery', { body });
      expect(errorCode(res)).toBe('INVALID_RECOVERY_CODE');
    }
    const fifth = await client.post('/api/auth/login/recovery', { body });
    expect(errorCode(fifth)).toBe('ACCOUNT_LOCKED');
  });

  it('needs a pending session', async () => {
    const t = await createTestApp();
    const client = await csrfClient(t);
    const res = await client.post('/api/auth/login/recovery', {
      body: { recoveryCode: 'AAAA-AAAA-AAAA' },
    });
    expect(res.status).toBe(401);
  });
});

describe('forced 2FA enrolment of an admin', () => {
  it('goes from login to a working session with recovery codes', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin' });
    const { client, res } = await loginAs(t, admin, 'mfa_setup_required');
    expect(res.body).toEqual({ status: 'mfa_setup_required' });
    expect((await client.get('/api/auth/session')).body.authenticated).toBe(false);

    const setup = await client.post('/api/auth/login/2fa-setup');
    expect(setup.status).toBe(200);
    expect(setup.body.secret as string).toMatch(/^[A-Z2-7]{16,}$/);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.otpauthUri).toContain(encodeURIComponent(admin.email));
    expect(setup.body.otpauthUri).toContain('issuer=EasySend');

    // Pending: stored encrypted, not enabled yet.
    const pending = userRow(t, admin.id);
    expect(pending.totp_enabled).toBe(0);
    expect(pending.totp_secret_enc).not.toContain(setup.body.secret as string);
    expect(decryptSecret(t.ctx.keys.totp, 'totp', pending.totp_secret_enc as string)).toBe(
      setup.body.secret as string,
    );

    const verify = await client.post('/api/auth/login/2fa-setup/verify', {
      body: { code: generateTotpCode(setup.body.secret as string, t.clock()) },
    });
    expect(verify.status).toBe(200);
    expect(verify.body.user).toMatchObject({ id: admin.id, role: 'admin', totpEnabled: true });
    expect(verify.body.recoveryCodes as string[]).toHaveLength(10);
    expect(new Set(verify.body.recoveryCodes as string[]).size).toBe(10);
    expect(unusedRecoveryCodes(t, admin.id)).toBe(10);
    expect(JSON.stringify(t.db.sqlite.prepare('SELECT * FROM recovery_codes').all())).not.toContain(
      (verify.body.recoveryCodes as string[])[0],
    );
    expect(userRow(t, admin.id).totp_enabled).toBe(1);
    expect(auditActions(t)).toEqual(expect.arrayContaining(['auth.2fa_enabled', 'auth.login']));

    client.csrfToken = verify.body.csrfToken as string;
    const session = await client.get('/api/auth/session');
    expect(session.body.authenticated).toBe(true);
    expect(userOf(session).role).toBe('admin');
    expect(sessionRows(t)).toMatchObject([{ mfa_verified: 1 }]);

    // The next login asks for the code and the recovery codes work.
    const next = await loginAs(
      t,
      { ...admin, totpSecret: setup.body.secret as string },
      'mfa_required',
    );
    const used = await next.client.post('/api/auth/login/recovery', {
      body: { recoveryCode: (verify.body.recoveryCodes as string[])[3] },
    });
    expect(used.body.recoveryCodesLeft).toBe(9);
  });

  it('rejects a wrong confirmation code and keeps 2FA disabled', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin' });
    const { client } = await loginAs(t, admin, 'mfa_setup_required');
    const setup = await client.post('/api/auth/login/2fa-setup');

    const res = await client.post('/api/auth/login/2fa-setup/verify', {
      body: { code: wrongCode(setup.body.secret as string, t.clock()) },
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TOTP_CODE');
    expect(userRow(t, admin.id).totp_enabled).toBe(0);
    expect(unusedRecoveryCodes(t, admin.id)).toBe(0);
  });

  it('locks the account after repeated wrong confirmation codes', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin' });
    const { client } = await loginAs(t, admin, 'mfa_setup_required');
    const setup = await client.post('/api/auth/login/2fa-setup');
    const body = { code: wrongCode(setup.body.secret as string, t.clock()) };
    for (let i = 0; i < 4; i++) await client.post('/api/auth/login/2fa-setup/verify', { body });
    const locked = await client.post('/api/auth/login/2fa-setup/verify', { body });
    expect(errorCode(locked)).toBe('ACCOUNT_LOCKED');
  });

  it('requires the setup step before verify', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin' });
    const { client } = await loginAs(t, admin, 'mfa_setup_required');
    const res = await client.post('/api/auth/login/2fa-setup/verify', { body: { code: '123456' } });
    expect(res.status).toBe(409);
  });

  it('is not available to users who already have 2FA, or without a pending session', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ totp: true });
    const { client } = await loginAs(t, user, 'mfa_required');
    expect((await client.post('/api/auth/login/2fa-setup')).status).toBe(409);
    expect(
      (await client.post('/api/auth/login/2fa-setup/verify', { body: { code: '123456' } })).status,
    ).toBe(409);
    // The existing secret was not replaced.
    expect(userRow(t, user.id).totp_enabled).toBe(1);

    const anonymous = await csrfClient(t);
    expect((await anonymous.post('/api/auth/login/2fa-setup')).status).toBe(401);

    const full = await loginWithTotp(t, await t.createUser({ totp: true }));
    expect((await full.client.post('/api/auth/login/2fa-setup')).status).toBe(401);
  });

  it('does not accept the 2FA login step from a pending user without 2FA', async () => {
    const t = await createTestApp();
    const admin = await t.createUser({ role: 'admin' });
    const { client } = await loginAs(t, admin, 'mfa_setup_required');
    const res = await client.post('/api/auth/login/2fa', { body: { code: '123456' } });
    expect(res.status).toBe(409);
    const recovery = await client.post('/api/auth/login/recovery', {
      body: { recoveryCode: 'AAAA-AAAA-AAAA' },
    });
    expect(recovery.status).toBe(409);
  });
});
