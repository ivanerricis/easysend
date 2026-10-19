import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@easysend/shared';
import { readEmailLogo } from '../src/branding/store.js';
import { createTestApp, makeTempDir, RecordingTransport } from './helpers.js';

const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls' as const,
  fromEmail: 'no-reply@example.com',
};

describe('runtime public URL', () => {
  it('uses the public_url setting in production when PUBLIC_URL is unset', async () => {
    const t = await createTestApp({ env: { APP_MODE: 'production' } });
    expect(t.ctx.publicUrl()).toBeUndefined();

    t.ctx.settings.set('public_url', 'https://files.example.com');
    expect(t.ctx.publicUrl()).toBe('https://files.example.com');

    // The CSRF origin check follows it at runtime.
    const client = t.client();
    client.csrfToken = (await client.get('/api/auth/csrf')).body['csrfToken'] as string;
    const res = await client.post('/api/auth/login', {
      headers: { Origin: 'https://files.example.com' },
      body: { email: 'a@example.com', password: 'x' },
    });
    expect(res.status).not.toBe(403);
    expect(
      (
        await client.post('/api/auth/login', {
          headers: { Origin: 'https://evil.example.com' },
          body: { email: 'a@example.com', password: 'x' },
        })
      ).status,
    ).toBe(403);

    // Mail links too.
    await t.ctx.mailer.sendWelcome({ to: 'x@example.com', locale: 'en', token: 'tok' });
    expect(t.mailbox.last('x@example.com')?.text).toContain(
      'https://files.example.com/welcome?token=tok',
    );
  });

  it('prefers the PUBLIC_URL env over the setting, then the local default', async () => {
    const env = await createTestApp({ env: { PUBLIC_URL: 'https://env.example.com' } });
    env.ctx.settings.set('public_url', 'https://setting.example.com');
    expect(env.ctx.publicUrl()).toBe('https://env.example.com');

    const local = await createTestApp();
    expect(local.ctx.publicUrl()).toBe('http://localhost:8080');
    local.ctx.settings.set('public_url', 'https://setting.example.com');
    expect(local.ctx.publicUrl()).toBe('https://setting.example.com');
  });
});

describe('settings repository additions', () => {
  it('returns the default appearance and the setup state', async () => {
    const t = await createTestApp({ setupCompleted: false });
    expect(t.ctx.settings.isSetupCompleted()).toBe(false);
    expect(t.ctx.settings.getAppearance()).toEqual(DEFAULT_APPEARANCE);
    t.ctx.settings.set('appearance', { ...DEFAULT_APPEARANCE, instanceName: 'Acme' });
    expect(t.ctx.settings.getInstanceName()).toBe('Acme');
    t.ctx.settings.set('setup_completed', true);
    expect(t.ctx.settings.isSetupCompleted()).toBe(true);
  });

  it('stores the pending admin encrypted as a whole', async () => {
    const t = await createTestApp();
    const pending = {
      email: 'admin@example.com',
      displayName: null,
      passwordHash: 'hash',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      createdAt: 1_700_000_000,
    };
    t.ctx.settings.set('setup_admin_pending', pending);
    const raw = t.db.sqlite
      .prepare("SELECT value, is_encrypted FROM settings WHERE key = 'setup_admin_pending'")
      .get() as { value: string; is_encrypted: number };
    expect(raw.is_encrypted).toBe(1);
    expect(raw.value).not.toContain('JBSWY3DPEHPK3PXP');
    expect(t.ctx.settings.get('setup_admin_pending')).toEqual(pending);
  });
});

describe('mailer.sendTest', () => {
  it('sends through the given settings and reports ok', async () => {
    const t = await createTestApp();
    t.ctx.settings.set('smtp', { ...SMTP, host: 'stored.example.com' });
    const result = await t.ctx.mailer.sendTest(SMTP, 'me@example.com', 'it');
    expect(result).toEqual({ ok: true });
    const sent = t.mailbox.last('me@example.com');
    expect(sent?.subject).toBe('EasySend: email di prova');
    expect(sent?.from).toBe('no-reply@example.com');
  });

  it('returns only allowlisted error codes', async () => {
    const t = await createTestApp();
    t.mailbox.failWith = Object.assign(new Error('535 bad password hunter2'), { code: 'EAUTH' });
    expect(await t.ctx.mailer.sendTest(SMTP, 'me@example.com', 'en')).toEqual({
      ok: false,
      code: 'EAUTH',
    });
    t.mailbox.failWith = Object.assign(new Error('secret'), { code: 'SOMETHING_ELSE' });
    expect(await t.ctx.mailer.sendTest(SMTP, 'me@example.com', 'en')).toEqual({
      ok: false,
      code: 'UNKNOWN',
    });
    t.mailbox.failWith = new Error('no code');
    expect(await t.ctx.mailer.sendTest(SMTP, 'me@example.com', 'en')).toEqual({
      ok: false,
      code: 'UNKNOWN',
    });
  });

  it('keeps html and attachments in the recorded message', async () => {
    const transport = new RecordingTransport();
    const attachment = {
      filename: 'logo.png',
      content: Buffer.from('x'),
      contentType: 'image/png',
      cid: 'logo',
    };
    await transport.sendMail({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      text: 'see ?token=abc',
      html: '<p>hi</p>',
      attachments: [attachment],
    });
    expect(transport.last()?.html).toBe('<p>hi</p>');
    expect(transport.last()?.attachments).toEqual([attachment]);
    expect(transport.lastToken('b@example.com')).toBe('abc');
  });
});

describe('readEmailLogo', () => {
  it('reads the file named by the emailLogo entry', async () => {
    const t = await createTestApp();
    expect(await readEmailLogo(t.ctx)).toBeNull();

    mkdirSync(t.config.brandingDir, { recursive: true });
    t.ctx.settings.set('branding_assets', {
      emailLogo: { etag: 'e1', updatedAt: 1, fileName: 'email-logo.png' },
    });
    expect(await readEmailLogo(t.ctx)).toBeNull(); // file missing

    writeFileSync(path.join(t.config.brandingDir, 'email-logo.png'), Buffer.from('png-bytes'));
    const logo = await readEmailLogo(t.ctx);
    expect(logo?.contentType).toBe('image/png');
    expect(logo?.content.toString()).toBe('png-bytes');
  });

  it('refuses names that leave the branding directory', async () => {
    const t = await createTestApp();
    const outside = makeTempDir();
    writeFileSync(path.join(outside, 'x.png'), 'x');
    t.ctx.settings.set('branding_assets', {
      emailLogo: {
        etag: 'e',
        updatedAt: 1,
        fileName: `..${path.sep}${path.basename(outside)}${path.sep}x.png`,
      },
    });
    expect(await readEmailLogo(t.ctx)).toBeNull();
  });
});
