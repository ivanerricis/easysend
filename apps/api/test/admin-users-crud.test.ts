/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- response bodies are loosely typed (see TestResponse) */
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_POLICY } from '../src/auth/policy.js';
import { generateTotpCode } from '../src/auth/totp.js';
import { sha256Hex } from '../src/crypto/hash.js';
import {
  auditLog,
  passwordResetTokens,
  recoveryCodes,
  transfers,
  users,
} from '../src/db/schema/index.js';
import { createTestApp, type TestApp } from './helpers.js';
import { loginAs } from './session-helpers.js';

async function adminSetup() {
  const t = await createTestApp();
  const admin = await t.createUser({ role: 'admin', email: 'admin@example.com' });
  return { t, admin, client: loginAs(t, admin) };
}

const auditRows = (t: TestApp, action: string) =>
  t.db.db.select().from(auditLog).where(eq(auditLog.action, action)).all();

describe('permissions on /api/admin/users*', () => {
  it('answers 401 without a session and 403 for a regular user, on every endpoint', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const regular = loginAs(t, user);
    const anon = t.client();
    const id = user.id;
    const calls: [string, string, unknown?][] = [
      ['get', '/api/admin/users'],
      ['post', '/api/admin/users', { email: 'x@example.com', password: 'long-enough-password' }],
      ['get', `/api/admin/users/${id}`],
      ['patch', `/api/admin/users/${id}`, { quotaBytes: 1 }],
      ['post', `/api/admin/users/${id}/reset-2fa`],
      ['delete', `/api/admin/users/${id}?transfers=delete`],
    ];
    for (const [method, url, body] of calls) {
      const options = body === undefined ? {} : { body };
      const denied = await regular.request(method as 'get', url, options);
      expect([method, url, denied.status, denied.body.error?.code]).toEqual([
        method,
        url,
        403,
        'FORBIDDEN',
      ]);
      const unauth = await anon.request(method as 'get', url, { ...options, csrf: false });
      expect([method, url, unauth.status]).toEqual([method, url, 401]);
    }
    // Nothing was touched.
    expect(t.db.db.select().from(users).all()).toHaveLength(1);
  });

  it('refuses a pending (mfa) admin session', async () => {
    const { t, admin } = await adminSetup();
    const pending = loginAs(t, admin, { mfaVerified: false });
    expect((await pending.get('/api/admin/users')).status).toBe(401);
  });
});

describe('GET /api/admin/users', () => {
  it('lists with search, role filter, pagination, usage and transfer count', async () => {
    const { t, client, admin } = await adminSetup();
    const alice = await t.createUser({ email: 'alice@example.com' });
    await t.createUser({ email: 'Bob.Smith@example.com' });
    t.db.db
      .update(users)
      .set({ displayName: 'Carol Special', usedBytes: 99, quotaBytes: 1000 })
      .where(eq(users.id, alice.id))
      .run();
    t.db.db
      .insert(transfers)
      .values([
        { ownerId: alice.id, token: 't1', mode: 'link', expiresAt: 1, status: 'active' },
        { ownerId: alice.id, token: 't2', mode: 'link', expiresAt: 1, status: 'deleted' },
      ])
      .run();

    const all = await client.get('/api/admin/users');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    const aliceItem = all.body.items.find((u: { id: string }) => u.id === alice.id);
    expect(aliceItem).toMatchObject({
      usedBytes: 99,
      quotaBytes: 1000,
      disabled: false,
      transferCount: 1,
    });
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|totpSecret/);

    const byEmail = await client.get('/api/admin/users?q=BOB.sm');
    expect(byEmail.body.items.map((u: { email: string }) => u.email)).toEqual([
      'Bob.Smith@example.com',
    ]);
    const byName = await client.get('/api/admin/users?q=special');
    expect(byName.body.items.map((u: { id: string }) => u.id)).toEqual([alice.id]);
    // LIKE wildcards are plain characters.
    expect((await client.get('/api/admin/users?q=%25')).body.total).toBe(0);

    const admins = await client.get('/api/admin/users?role=admin');
    expect(admins.body.items.map((u: { id: string }) => u.id)).toEqual([admin.id]);

    const page2 = await client.get('/api/admin/users?pageSize=2&page=2');
    expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page2.body.items).toHaveLength(1);
  });
});

describe('POST /api/admin/users', () => {
  it('creates a user with a password and defaults', async () => {
    const { t, client } = await adminSetup();
    const res = await client.post('/api/admin/users', {
      body: {
        email: 'New.User@Example.com',
        password: 'long-enough-password',
        displayName: 'New User',
        quotaBytes: 5000,
        locale: 'en',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'new.user@example.com',
      role: 'user',
      displayName: 'New User',
      quotaBytes: 5000,
      usedBytes: 0,
      transferCount: 0,
      disabled: false,
      locale: 'en',
      totpEnabled: false,
    });
    expect(t.mailbox.sent).toHaveLength(0);
    expect(auditRows(t, 'admin.user_created')).toHaveLength(1);

    // The new user can use the password.
    const created = t.db.db.select().from(users).where(eq(users.id, res.body.id)).get()!;
    expect(await t.ctx.passwordHasher.verify(created.passwordHash, 'long-enough-password')).toBe(
      true,
    );
  });

  it('rejects a duplicate email (case-insensitive) with EMAIL_ALREADY_EXISTS', async () => {
    const { client } = await adminSetup();
    const res = await client.post('/api/admin/users', {
      body: { email: 'ADMIN@example.com', password: 'long-enough-password' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('without a password stores a 72 h token and sends a welcome email with a working link', async () => {
    const { t, client } = await adminSetup();
    const res = await client.post('/api/admin/users', {
      body: { email: 'invited@example.com', role: 'user', locale: 'en' },
    });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(1));
    const mail = t.mailbox.last('invited@example.com')!;
    expect(mail.text).toContain('/welcome?token=');
    const token = t.mailbox.lastToken('invited@example.com')!;
    expect(token).toBeTruthy();

    const stored = t.db.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, res.body.id))
      .all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(sha256Hex(token));
    expect(stored[0]!.tokenHash).not.toContain(token);
    expect(stored[0]!.usedAt).toBeNull();
    expect(stored[0]!.expiresAt - stored[0]!.createdAt).toBe(AUTH_POLICY.welcomeTokenSeconds);
    expect(AUTH_POLICY.welcomeTokenSeconds).toBe(72 * 3600);
  });

  it('validates the body', async () => {
    const { client } = await adminSetup();
    expect((await client.post('/api/admin/users', { body: { email: 'nope' } })).status).toBe(400);
    expect(
      (
        await client.post('/api/admin/users', {
          body: { email: 'a@example.com', password: 'short' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('GET /api/admin/users/:id', () => {
  it('returns one user and USER_NOT_FOUND for an unknown id', async () => {
    const { t, client } = await adminSetup();
    const user = await t.createUser();
    const ok = await client.get(`/api/admin/users/${user.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(user.id);
    const missing = await client.get('/api/admin/users/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('PATCH /api/admin/users/:id', () => {
  it('updates quota, locale, displayName and records only the field names in the audit log', async () => {
    const { t, client } = await adminSetup();
    const user = await t.createUser();
    const res = await client.patch(`/api/admin/users/${user.id}`, {
      body: { quotaBytes: 777, locale: 'en', displayName: 'Dana' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ quotaBytes: 777, locale: 'en', displayName: 'Dana' });

    const cleared = await client.patch(`/api/admin/users/${user.id}`, {
      body: { quotaBytes: null, displayName: null },
    });
    expect(cleared.body).toMatchObject({ quotaBytes: null, displayName: null });

    const rows = auditRows(t, 'admin.user_updated');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.metadata).toEqual({ fields: ['quotaBytes', 'locale', 'displayName'] });
    expect(JSON.stringify(rows)).not.toContain('777');
  });

  it('disabling a user destroys their sessions and blocks them', async () => {
    const { t, client } = await adminSetup();
    const user = await t.createUser();
    const victim = loginAs(t, user);
    expect((await victim.get('/api/me')).status).toBe(200);

    const res = await client.patch(`/api/admin/users/${user.id}`, { body: { disabled: true } });
    expect(res.body.disabled).toBe(true);
    expect((await victim.get('/api/me')).status).toBe(401);
  });

  it('a role change revokes the sessions of the user', async () => {
    const { t, client } = await adminSetup();
    const user = await t.createUser();
    const victim = loginAs(t, user);
    const res = await client.patch(`/api/admin/users/${user.id}`, { body: { role: 'admin' } });
    expect(res.body.role).toBe('admin');
    expect((await victim.get('/api/me')).status).toBe(401);
    // A change that does not touch role or disabled keeps the session.
    const other = await t.createUser();
    const otherClient = loginAs(t, other);
    await client.patch(`/api/admin/users/${other.id}`, { body: { quotaBytes: 10 } });
    expect((await otherClient.get('/api/me')).status).toBe(200);
  });

  it('refuses to demote or disable the last active admin (LAST_ADMIN) but allows it with two', async () => {
    const { t, client, admin } = await adminSetup();
    const demote = await client.patch(`/api/admin/users/${admin.id}`, { body: { role: 'user' } });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_ADMIN');
    const disable = await client.patch(`/api/admin/users/${admin.id}`, {
      body: { disabled: true },
    });
    expect(disable.body.error.code).toBe('LAST_ADMIN');
    expect(t.db.db.select().from(users).where(eq(users.id, admin.id)).get()).toMatchObject({
      role: 'admin',
      disabled: false,
    });

    // A disabled admin does not count as active.
    const second = await t.createUser({ role: 'admin', disabled: true });
    const stillLast = await client.patch(`/api/admin/users/${admin.id}`, {
      body: { role: 'user' },
    });
    expect(stillLast.body.error.code).toBe('LAST_ADMIN');

    await client.patch(`/api/admin/users/${second.id}`, { body: { disabled: false } });
    const ok = await client.patch(`/api/admin/users/${admin.id}`, { body: { role: 'user' } });
    expect(ok.status).toBe(200);
  });

  it('answers USER_NOT_FOUND and validates the body', async () => {
    const { client, admin } = await adminSetup();
    const missing = await client.patch('/api/admin/users/nope', { body: { quotaBytes: 1 } });
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
    expect((await client.patch(`/api/admin/users/${admin.id}`, { body: {} })).status).toBe(400);
    expect(
      (await client.patch(`/api/admin/users/${admin.id}`, { body: { quotaBytes: -1 } })).status,
    ).toBe(400);
  });
});

describe('POST /api/admin/users/:id/reset-2fa', () => {
  it('clears 2FA state, revokes sessions and audits', async () => {
    const { t, client } = await adminSetup();
    const user = await t.createUser({ totp: true });
    const victim = loginAs(t, user);
    // Seed recovery codes through the real endpoint.
    const codes = await victim.post('/api/me/2fa/recovery-codes', {
      body: { password: user.password, code: generateTotpCode(user.totpSecret!, t.clock()) },
    });
    expect(codes.status).toBe(200);

    const res = await client.post(`/api/admin/users/${user.id}/reset-2fa`);
    expect(res.status).toBe(204);
    expect(t.db.db.select().from(users).where(eq(users.id, user.id)).get()).toMatchObject({
      totpEnabled: false,
      totpSecretEnc: null,
      totpLastCounter: null,
    });
    expect(
      t.db.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).all(),
    ).toHaveLength(0);
    expect(auditRows(t, 'admin.2fa_reset')).toHaveLength(1);

    const missing = await client.post('/api/admin/users/nope/reset-2fa');
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
  });
});
