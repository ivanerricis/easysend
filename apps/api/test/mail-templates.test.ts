import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, contrastRatio, type Appearance } from '@easysend/shared';
import {
  firstDownloadEmail,
  passwordResetEmail,
  smtpTestEmail,
  transferLinkEmail,
  welcomeEmail,
} from '../src/mail/content.js';
import { DEFAULT_EMAIL_LOGO } from '../src/mail/default-logo.js';
import { createTestApp } from './helpers.js';

const EXPIRES_AT = Date.UTC(2030, 0, 15, 22, 30) / 1000;
const EVIL = `<script>alert("x")</script> & 'q'`;

const transferInput = {
  link: 'https://files.example.com/d/tok',
  senderName: 'Anna Rossi',
  title: 'Holiday',
  message: 'First line\nSecond line\n\nNew paragraph',
  expiresAt: EXPIRES_AT,
  fileCount: 3,
  totalBytes: 2048,
  timezone: 'Europe/Rome',
};

function allEmails(appearance: Appearance, locale: 'it' | 'en') {
  const base = { locale, appearance };
  return {
    reset: passwordResetEmail({
      ...base,
      link: 'https://x.test/reset-password?token=t',
      ttlMinutes: 30,
    }),
    welcome: welcomeEmail({ ...base, link: 'https://x.test/welcome?token=t', ttlHours: 72 }),
    transfer: transferLinkEmail({ ...base, ...transferInput }),
    first: firstDownloadEmail({
      ...base,
      title: 'Holiday',
      link: 'https://x.test/transfers/1',
      downloadedAt: EXPIRES_AT,
      timezone: 'Europe/Rome',
    }),
    test: smtpTestEmail(base),
  };
}

describe('email content', () => {
  it('has Italian and English subjects and key strings', () => {
    const it = allEmails(DEFAULT_APPEARANCE, 'it');
    const en = allEmails(DEFAULT_APPEARANCE, 'en');
    expect(it.reset.subject).toBe('EasySend: reimposta la password');
    expect(en.reset.subject).toBe('EasySend: reset your password');
    expect(it.welcome.subject).toBe('Benvenuto su EasySend: imposta la password');
    expect(en.welcome.subject).toBe('Welcome to EasySend: set your password');
    expect(it.transfer.subject).toBe('Anna Rossi ti ha inviato dei file: Holiday');
    expect(en.transfer.subject).toBe('Anna Rossi sent you files: Holiday');
    expect(it.first.subject).toBe('EasySend: "Holiday" è stato scaricato');
    expect(en.first.subject).toBe('EasySend: "Holiday" was downloaded');
    expect(it.test.subject).toBe('EasySend: email di prova');
    expect(en.test.subject).toBe('EasySend: test email');

    expect(it.transfer.html).toContain('<html lang="it">');
    expect(en.transfer.html).toContain('<html lang="en">');
    expect(it.transfer.html).toContain('Scarica i file');
    expect(en.transfer.html).toContain('Download files');
    expect(it.reset.text).toContain('Il link vale 30 minuti');
    expect(en.welcome.text).toContain('72 hours');
    for (const mail of [...Object.values(it), ...Object.values(en)]) {
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.preheader.length).toBeGreaterThan(0);
      expect(mail.html.startsWith('<!DOCTYPE html><html lang=')).toBe(true);
      expect(mail.html).toContain('name="color-scheme"');
      expect(mail.html).not.toContain('preload');
      expect(mail.html).toContain('src="cid:logo"');
      expect(mail.html).toContain('alt="EasySend"');
    }
  });

  it('puts the link in both the plain text and the HTML (button and fallback)', () => {
    const { transfer, reset } = allEmails(DEFAULT_APPEARANCE, 'en');
    expect(transfer.text).toContain('https://files.example.com/d/tok');
    expect(transfer.html.match(/href="https:\/\/files\.example\.com\/d\/tok"/g)).toHaveLength(2);
    expect(reset.text).toContain('https://x.test/reset-password?token=t');
    expect(reset.html).toContain('href="https://x.test/reset-password?token=t"');
  });

  it('escapes the title, message and sender name in the HTML', () => {
    for (const locale of ['it', 'en'] as const) {
      const mail = transferLinkEmail({
        ...transferInput,
        locale,
        appearance: { ...DEFAULT_APPEARANCE, instanceName: EVIL, footer: EVIL },
        senderName: EVIL,
        title: EVIL,
        message: EVIL,
      });
      expect(mail.html).not.toContain('<script');
      expect(mail.html).not.toContain('alert("x")');
      expect(mail.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
      expect(mail.html).toContain('&amp;');
      expect(mail.html).toContain('&#x27;q&#x27;');
      expect(mail.html).not.toContain('alt="<');
    }
    const first = firstDownloadEmail({
      locale: 'en',
      appearance: DEFAULT_APPEARANCE,
      title: EVIL,
      link: 'https://x.test/transfers/1',
      downloadedAt: EXPIRES_AT,
      timezone: 'UTC',
    });
    expect(first.html).not.toContain('<script');
  });

  it('renders message line breaks as <br/> and blank lines as paragraphs', () => {
    const { html } = allEmails(DEFAULT_APPEARANCE, 'en').transfer;
    expect(html).toContain('First line<br/>Second line');
    expect(html).toContain('New paragraph');
    expect(html.indexOf('Second line')).toBeLessThan(html.indexOf('New paragraph'));
  });

  it('keeps headers safe and never shows the link password or an email address', () => {
    const mail = transferLinkEmail({
      ...transferInput,
      locale: 'en',
      appearance: DEFAULT_APPEARANCE,
      senderName: 'Eve\r\nBcc: evil@example.com',
      title: 'a\r\nb',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Eve Bcc: evil@example.com sent you files: a b');
  });

  it('picks a readable button text colour and uses the radius from the appearance', () => {
    const dark = allEmails(DEFAULT_APPEARANCE, 'en').reset.html;
    expect(dark).toMatch(/background-color:#18181b;border-radius:0"/);
    expect(dark).toContain('color:#ffffff;font-family');

    const yellow = '#fde047';
    const light = allEmails({ ...DEFAULT_APPEARANCE, primaryColor: yellow, radius: 0.5 }, 'en')
      .reset.html;
    expect(light).toContain(`background-color:${yellow};border-radius:8px`);
    expect(light).toContain('color:#000000;font-family');
    expect(contrastRatio(yellow, '#000000')).toBeGreaterThan(4.5);
  });

  it('shows the footer only when it is not empty, and always who sent the email', () => {
    const none = allEmails(DEFAULT_APPEARANCE, 'en').reset;
    expect(none.html).toContain('Sent by EasySend');
    expect(none.text.trimEnd().endsWith('Sent by EasySend')).toBe(true);

    const branded = allEmails(
      { ...DEFAULT_APPEARANCE, instanceName: 'Acme Drop', footer: 'Acme Ltd\nVia Roma 1' },
      'it',
    ).reset;
    expect(branded.html).toContain('Acme Ltd<br/>Via Roma 1');
    expect(branded.html).toContain('Inviata da Acme Drop');
    expect(branded.text).toContain('Acme Ltd\nVia Roma 1');
  });
});

describe('mailer', () => {
  it('sends text, HTML and the default logo inline', async () => {
    const app = await createTestApp();
    await app.ctx.mailer.sendTransferLink({
      to: 'r@example.com',
      transfer: {
        token: 'tok',
        title: 'Holiday',
        message: null,
        senderName: null,
        expiresAt: EXPIRES_AT,
        fileCount: 1,
        totalBytes: 10,
      },
    });
    const mail = app.mailbox.last('r@example.com')!;
    expect(mail.html).toContain('http://localhost:8080/d/tok');
    expect(mail.text).toContain('http://localhost:8080/d/tok');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0]).toMatchObject({
      filename: 'logo.png',
      cid: 'logo',
      contentType: 'image/png',
    });
    expect(mail.attachments?.[0]?.content.equals(DEFAULT_EMAIL_LOGO.content)).toBe(true);
  });

  it('embeds the uploaded email logo and follows the branding settings', async () => {
    const app = await createTestApp();
    const custom = Buffer.from('custom-logo-bytes');
    mkdirSync(app.config.brandingDir, { recursive: true });
    writeFileSync(path.join(app.config.brandingDir, 'email-logo.png'), custom);
    app.ctx.settings.set('branding_assets', {
      emailLogo: { etag: 'e', updatedAt: 1, fileName: 'email-logo.png' },
    });
    app.ctx.settings.set('appearance', {
      ...DEFAULT_APPEARANCE,
      instanceName: 'Acme Drop',
      footer: 'Acme Ltd',
      primaryColor: '#1d4ed8',
    });

    await app.ctx.mailer.sendWelcome({ to: 'n@example.com', locale: 'en', token: 'w' });
    const mail = app.mailbox.last('n@example.com')!;
    expect(mail.attachments?.[0]?.content.equals(custom)).toBe(true);
    expect(mail.subject).toBe('Welcome to Acme Drop: set your password');
    expect(mail.html).toContain('background-color:#1d4ed8');
    expect(mail.html).toContain('Acme Ltd');
  });

  it('sends the SMTP test through the template, with the logo', async () => {
    const app = await createTestApp();
    const result = await app.ctx.mailer.sendTest(
      { host: 'h', port: 25, security: 'none', fromEmail: 'from@example.com' },
      'to@example.com',
      'en',
    );
    expect(result).toEqual({ ok: true });
    const mail = app.mailbox.last('to@example.com')!;
    expect(mail.subject).toBe('EasySend: test email');
    expect(mail.html).toContain('<html lang="en">');
    expect(mail.attachments?.[0]?.cid).toBe('logo');
    expect(contrastRatio('#52525b', '#ffffff')).toBeGreaterThan(4.5);
  });
});
