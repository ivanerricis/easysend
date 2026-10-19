/* eslint-disable @typescript-eslint/no-unsafe-member-access -- response bodies are loosely typed (see TestResponse) */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_MB, EXPIRY_OPTIONS } from '@easysend/shared';
import { users } from '../src/db/schema/index.js';
import { createTestApp } from './helpers.js';
import { loginAs } from './session-helpers.js';

describe('GET /api/me', () => {
  it('answers 401 without a session and with a pending (mfa) session', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    expect((await t.client().get('/api/me')).status).toBe(401);
    expect((await t.client().get('/api/config')).status).toBe(401);
    const pending = loginAs(t, user, { mfaVerified: false });
    for (const res of [
      await pending.get('/api/me'),
      await pending.patch('/api/me', { body: { locale: 'en' } }),
      await pending.post('/api/me/2fa/setup'),
      await pending.get('/api/config'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('returns only the own data, with usage and quota', async () => {
    const t = await createTestApp();
    const alice = await t.createUser({ email: 'alice@example.com', locale: 'en' });
    await t.createUser({ email: 'bob@example.com' });
    t.db.db
      .update(users)
      .set({ usedBytes: 1234, quotaBytes: 5000 })
      .where(eq(users.id, alice.id))
      .run();

    const res = await loginAs(t, alice).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: alice.id,
      email: 'alice@example.com',
      locale: 'en',
      role: 'user',
      displayName: null,
      themePreference: null,
      totpEnabled: false,
    });
    expect(res.body.usedBytes).toBe(1234);
    expect(res.body.quotaBytes).toBe(5000);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret|bob@/);
  });

  it('reports a null quota as unlimited', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const res = await loginAs(t, user).get('/api/me');
    expect(res.body.quotaBytes).toBeNull();
  });

  it('falls back to the instance default locale when the user has none', async () => {
    const t = await createTestApp();
    const user = await t.createUser({ locale: null });
    const client = loginAs(t, user);
    expect((await client.get('/api/me')).body.user.locale).toBe('it');

    t.ctx.settings.set('general', { diskReserveMb: 0, chunkSizeMb: 25, defaultLocale: 'en' });
    expect((await client.get('/api/me')).body.user.locale).toBe('en');
  });
});

describe('PATCH /api/me', () => {
  it('updates locale, displayName and themePreference and clears the nullable ones', async () => {
    const t = await createTestApp();
    const user = await t.createUser();
    const client = loginAs(t, user);

    const res = await client.patch('/api/me', {
      body: { locale: 'en', displayName: '  Alice  ', themePreference: 'dark' },
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      locale: 'en',
      displayName: 'Alice',
      themePreference: 'dark',
    });

    const cleared = await client.patch('/api/me', {
      body: { displayName: null, themePreference: null },
    });
    expect(cleared.body.user).toMatchObject({
      displayName: null,
      themePreference: null,
      locale: 'en',
    });
  });

  it('rejects an empty body, an invalid value and a missing CSRF token', async () => {
    const t = await createTestApp();
    const client = loginAs(t, await t.createUser());
    expect((await client.patch('/api/me', { body: {} })).status).toBe(400);
    expect((await client.patch('/api/me', { body: { locale: 'xx' } })).status).toBe(400);
    const noCsrf = await client.patch('/api/me', { body: { locale: 'en' }, csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('GET /api/config', () => {
  it('uses the configured default chunk size and the shared constants', async () => {
    const t = await createTestApp({ env: { DEFAULT_CHUNK_SIZE_MB: '30' } });
    const res = await loginAs(t, await t.createUser()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.chunkSizeBytes).toBe(30 * 1024 * 1024);
    expect(res.body.maxChunkSizeBytes).toBe(CHUNK_SIZE_MB.max * 1024 * 1024);
    expect(res.body.expiryOptions).toContainEqual({ key: '3d', seconds: EXPIRY_OPTIONS['3d'] });
    expect(res.body.limits.passwordMinLength).toBe(12);
  });

  it('prefers the chunk size stored in the general settings', async () => {
    const t = await createTestApp();
    t.ctx.settings.set('general', { diskReserveMb: 0, chunkSizeMb: 10, defaultLocale: 'it' });
    const res = await loginAs(t, await t.createUser()).get('/api/config');
    expect(res.body.chunkSizeBytes).toBe(10 * 1024 * 1024);
  });
});
