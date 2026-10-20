import { describe, expect, it } from 'vitest';
import { brandingApp, makePng, uploadUrl } from './branding-fixtures.js';
import { bodyAs, errorCode } from './helpers.js';
import { loginAs } from './session-helpers.js';

const smtp = {
  host: '127.0.0.1',
  port: 2525,
  security: 'none',
  username: 'mailer',
  password: 'hunter2-smtp-password',
  fromEmail: 'noreply@example.com',
  fromName: 'EasySend',
};

describe('admin general settings', () => {
  it('returns env defaults, merges partial updates and audits them', async () => {
    const { t, admin } = await brandingApp();
    const first = await admin.get('/api/admin/settings');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      general: {
        diskReserveMb: t.config.defaultDiskReserveMb,
        chunkSizeMb: t.config.defaultChunkSizeMb,
        defaultLocale: 'it',
        updateCheck: true,
      },
      smtp: null,
    });

    const res = await admin.patch('/api/admin/settings', {
      body: { chunkSizeMb: 10, defaultLocale: 'en' },
    });
    expect(res.status).toBe(200);
    expect(bodyAs<{ general: unknown }>(res).general).toEqual({
      diskReserveMb: t.config.defaultDiskReserveMb,
      chunkSizeMb: 10,
      defaultLocale: 'en',
      updateCheck: true,
    });
    await admin.patch('/api/admin/settings', { body: { diskReserveMb: 0 } });
    expect(t.ctx.settings.get('general')).toEqual({
      diskReserveMb: 0,
      chunkSizeMb: 10,
      defaultLocale: 'en',
      updateCheck: true,
    });
    const rows = t.db.sqlite
      .prepare(
        "SELECT metadata FROM audit_log WHERE action = 'settings.general_updated' ORDER BY rowid",
      )
      .all() as { metadata: string }[];
    expect(rows.map((r) => JSON.parse(r.metadata) as unknown)).toEqual([
      { changed: ['chunkSizeMb', 'defaultLocale'] },
      { changed: ['diskReserveMb'] },
    ]);
  });

  it('validates the update', async () => {
    const { admin } = await brandingApp();
    for (const body of [{}, { chunkSizeMb: 51 }, { chunkSizeMb: 0 }, { defaultLocale: 'fr' }]) {
      expect((await admin.patch('/api/admin/settings', { body })).status).toBe(400);
    }
  });
});

describe('admin SMTP settings', () => {
  it('tests with the admin as recipient, then saves without exposing the password', async () => {
    const { t, admin, adminEmail } = await brandingApp();
    const test = await admin.post('/api/admin/settings/smtp/test', { body: smtp });
    expect(test.status).toBe(200);
    expect(test.body).toEqual({ ok: true, sentTo: adminEmail });
    expect(t.mailbox.last(adminEmail)).toBeDefined();

    const save = await admin.put('/api/admin/settings/smtp', { body: smtp });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ host: '127.0.0.1', hasPassword: true });
    expect(JSON.stringify(save.body)).not.toContain('hunter2');
    expect(t.ctx.settings.get('smtp')?.password).toBe(smtp.password);

    const get = await admin.get('/api/admin/settings');
    expect(JSON.stringify(get.body)).not.toContain('hunter2');
    expect(bodyAs<{ smtp: { hasPassword: boolean } }>(get).smtp.hasPassword).toBe(true);
    const audits = t.db.sqlite
      .prepare("SELECT metadata FROM audit_log WHERE action = 'settings.smtp_updated'")
      .all() as { metadata: string }[];
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).not.toContain('hunter2');
  });

  it('keeps the stored password when omitted', async () => {
    const { t, admin } = await brandingApp();
    await admin.post('/api/admin/settings/smtp/test', { body: smtp });
    await admin.put('/api/admin/settings/smtp', { body: smtp });

    const { password: _omit, ...rest } = smtp;
    const changed = { ...rest, port: 2626 };
    expect(errorCode(await admin.put('/api/admin/settings/smtp', { body: changed }))).toBe(
      'SMTP_NOT_VERIFIED',
    );
    expect((await admin.post('/api/admin/settings/smtp/test', { body: changed })).status).toBe(200);
    expect((await admin.put('/api/admin/settings/smtp', { body: changed })).status).toBe(200);
    expect(t.ctx.settings.get('smtp')).toMatchObject({ port: 2626, password: smtp.password });
  });

  it('requires a successful test before saving', async () => {
    const { t, admin } = await brandingApp();
    const res = await admin.put('/api/admin/settings/smtp', { body: smtp });
    expect(errorCode(res)).toBe('SMTP_NOT_VERIFIED');
    expect(t.ctx.settings.get('smtp')).toBeUndefined();
  });

  it('reports a failed test with SMTP_TEST_FAILED and does not unlock the save', async () => {
    const { t, admin } = await brandingApp();
    t.mailbox.failWith = new Error('connect ECONNREFUSED');
    const res = await admin.post('/api/admin/settings/smtp/test', { body: smtp });
    expect(errorCode(res)).toBe('SMTP_TEST_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    t.mailbox.failWith = undefined;
    expect(errorCode(await admin.put('/api/admin/settings/smtp', { body: smtp }))).toBe(
      'SMTP_NOT_VERIFIED',
    );
  });
});

describe('admin authorization', () => {
  it('rejects non-admins, anonymous clients and missing CSRF tokens', async () => {
    const { t, admin } = await brandingApp();
    const normal = loginAs(t, await t.createUser({ role: 'user' }));
    const anon = t.client();
    const png = await makePng();
    type Call = {
      method: 'get' | 'patch' | 'put' | 'post' | 'delete';
      url: string;
      body?: unknown;
    };
    const calls: Call[] = [
      { method: 'get', url: '/api/admin/settings' },
      { method: 'patch', url: '/api/admin/settings', body: { chunkSizeMb: 5 } },
      { method: 'put', url: '/api/admin/settings/smtp', body: smtp },
      { method: 'post', url: '/api/admin/settings/smtp/test', body: smtp },
      { method: 'put', url: '/api/admin/settings/appearance', body: {} },
      { method: 'post', url: '/api/admin/settings/appearance/reset' },
      { method: 'post', url: uploadUrl('logoLight'), body: png },
      { method: 'delete', url: uploadUrl('logoLight') },
    ];
    for (const c of calls) {
      const headers = c.body instanceof Buffer ? { 'Content-Type': 'image/png' } : undefined;
      const opts = { body: c.body, headers };
      const label = `${c.method} ${c.url}`;
      expect((await normal.request(c.method, c.url, opts)).status, label).toBe(403);
      expect((await anon.request(c.method, c.url, opts)).status, label).toBe(401);
      if (c.method !== 'get') {
        const res = await admin.request(c.method, c.url, { ...opts, csrf: false });
        expect(errorCode(res), label).toBe('CSRF_INVALID');
      }
    }
  });
});
