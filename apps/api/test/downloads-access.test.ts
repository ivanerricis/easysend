import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { transfers, users } from '../src/db/schema/index.js';
import { TRANSFER_POLICY } from '../src/transfers/policy.js';
import { bodyAs, createTestApp, errorCode, makeTempDir, type TestClient } from './helpers.js';
import { createTransferFixture } from './transfer-fixtures.js';

const setup = () => createTestApp({ env: { DATA_DIR: makeTempDir() } });
const small = [{ name: 'a.txt', size: 10 }];

describe('GET /api/downloads/:token', () => {
  it('returns the public info without exposing the owner email', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      title: 'Holiday',
      message: 'Hi',
      files: [
        { name: 'b.txt', size: 5 },
        { name: 'a.txt', size: 7 },
      ],
    });
    t.ctx.db.update(users).set({ displayName: 'Anna' }).where(eq(users.id, fx.owner.id)).run();

    const res = await t.client().get(`/api/downloads/${fx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      locked: false,
      title: 'Holiday',
      message: 'Hi',
      senderName: 'Anna',
      totalBytes: 12,
      downloadCount: 0,
      maxDownloads: null,
    });
    const files = bodyAs<{ files: { name: string }[] }>(res).files;
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    expect(JSON.stringify(res.body)).not.toContain(fx.owner.email);
  });

  it('has a null sender name when the owner set none', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small });
    const res = await t.client().get(`/api/downloads/${fx.token}`);
    expect(res.body.senderName).toBeNull();
  });

  it('answers only { locked, expiresAt } for a protected link', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const res = await t.client().get(`/api/downloads/${fx.token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'locked']);
    expect(res.body.locked).toBe(true);
  });

  it('refuses unknown tokens, drafts, revoked, expired and exhausted links', async () => {
    const t = await setup();
    const c = t.client();
    expect(errorCode(await c.get(`/api/downloads/${'x'.repeat(43)}`))).toBe('TRANSFER_NOT_FOUND');

    const draft = await createTransferFixture(t, { files: small, status: 'uploading' });
    const draftRes = await c.get(`/api/downloads/${draft.token}`);
    expect([draftRes.status, errorCode(draftRes)]).toEqual([404, 'TRANSFER_NOT_FOUND']);

    const revoked = await createTransferFixture(t, { files: small, status: 'revoked' });
    const revokedRes = await c.get(`/api/downloads/${revoked.token}`);
    expect([revokedRes.status, errorCode(revokedRes)]).toEqual([410, 'TRANSFER_REVOKED']);

    const expired = await createTransferFixture(t, { files: small, status: 'expired' });
    expect(errorCode(await c.get(`/api/downloads/${expired.token}`))).toBe('TRANSFER_EXPIRED');

    const limited = await createTransferFixture(t, { files: small, maxDownloads: 1 });
    t.ctx.db.update(transfers).set({ downloadCount: 1 }).where(eq(transfers.id, limited.id)).run();
    const limitedRes = await c.get(`/api/downloads/${limited.token}`);
    expect([limitedRes.status, errorCode(limitedRes)]).toEqual([410, 'DOWNLOAD_LIMIT_REACHED']);
  });

  it('checks the expiry on every request with the injected clock', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, expiresInSeconds: 60 });
    expect((await t.client().get(`/api/downloads/${fx.token}`)).status).toBe(200);
    t.clock.advance(61);
    const res = await t.client().get(`/api/downloads/${fx.token}`);
    expect([res.status, errorCode(res)]).toEqual([410, 'TRANSFER_EXPIRED']);
  });
});

describe('POST /api/downloads/:token/unlock', () => {
  const unlock = (c: TestClient, token: string, password: string) =>
    c.post(`/api/downloads/${token}/unlock`, { body: { password }, csrf: false });

  it('sets a scoped cookie for the right password and then shows the info', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const c = t.client();
    const res = await unlock(c, fx.token, 'secret-pass');
    expect(res.status).toBe(204);
    const header = String(res.headers['set-cookie']?.[0]);
    expect(header).toMatch(/^es_dl=\d+\.[A-Za-z0-9_-]+;/);
    expect(header).toContain(`Path=/api/downloads/${fx.token}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain(`Max-Age=${TRANSFER_POLICY.unlockCookieSeconds}`);

    const info = await c.get(`/api/downloads/${fx.token}`);
    expect(info.body.locked).toBe(false);
  });

  it('answers 403 PASSWORD_INCORRECT for a wrong password, without cookie', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const res = await unlock(t.client(), fx.token, 'nope');
    expect([res.status, errorCode(res)]).toEqual([403, 'PASSWORD_INCORRECT']);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 204 without cookie when the link has no password', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small });
    const res = await unlock(t.client(), fx.token, 'anything');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('expires the cookie after one hour', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: small,
      password: 'secret-pass',
      expiresInSeconds: 86_400,
    });
    const c = t.client();
    await unlock(c, fx.token, 'secret-pass');
    t.clock.advance(TRANSFER_POLICY.unlockCookieSeconds - 5);
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(false);
    t.clock.advance(10);
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(true);
  });

  it('invalidates the cookie when the password changes or is removed', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const c = t.client();
    await unlock(c, fx.token, 'secret-pass');

    const newHash = await t.ctx.passwordHasher.hash('other-password');
    t.ctx.db.update(transfers).set({ passwordHash: newHash }).where(eq(transfers.id, fx.id)).run();
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(true);

    t.ctx.db.update(transfers).set({ passwordHash: null }).where(eq(transfers.id, fx.id)).run();
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(false);
  });

  it('rejects a tampered cookie', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const c = t.client();
    await unlock(c, fx.token, 'secret-pass');
    const [exp, mac] = c.cookie('es_dl')!.split('.');
    c.setCookie('es_dl', `${Number(exp) + 100000}.${mac}`);
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(true);
    c.setCookie('es_dl', 'garbage');
    expect((await c.get(`/api/downloads/${fx.token}`)).body.locked).toBe(true);
  });

  it('rate limits wrong passwords per link and IP, then refuses even the right one', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'secret-pass' });
    const c = t.client();
    const attempts = TRANSFER_POLICY.limits.downloadPasswordIp.points;
    for (let i = 1; i < attempts; i += 1) {
      expect((await unlock(c, fx.token, 'nope')).status).toBe(403);
    }
    const last = await unlock(c, fx.token, 'nope');
    expect([last.status, errorCode(last)]).toEqual([429, 'RATE_LIMITED']);
    expect(last.headers['retry-after']).toBeDefined();
    expect((await unlock(c, fx.token, 'secret-pass')).status).toBe(429);
  });

  it('applies the status checks (revoked link)', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: small, password: 'p', status: 'revoked' });
    expect(errorCode(await unlock(t.client(), fx.token, 'p'))).toBe('TRANSFER_REVOKED');
  });
});
