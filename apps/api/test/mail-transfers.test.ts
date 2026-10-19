import { describe, expect, it } from 'vitest';
import { firstDownloadMessage, formatBytes, transferLinkMessage } from '../src/mail/messages.js';
import { createTestApp } from './helpers.js';

const EXPIRES_AT = Date.UTC(2030, 0, 15, 22, 30) / 1000; // 23:30 in Europe/Rome

const notice = {
  token: 'tok_ABCdef-123',
  title: 'Holiday\r\nBcc: evil@example.com',
  message: 'See you soon!',
  senderName: 'Anna Rossi',
  expiresAt: EXPIRES_AT,
  fileCount: 3,
  totalBytes: 5 * 1024 * 1024 + 300_000,
};

describe('formatBytes', () => {
  it('uses binary units and the locale decimal separator', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1023, 'en')).toBe('1,023 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(1536, 'it')).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GB');
  });
});

describe('transfer emails', () => {
  it('sends the link to a recipient in Italian (the instance default)', async () => {
    const app = await createTestApp();
    expect(await app.ctx.mailer.sendTransferLink({ to: 'r@example.com', transfer: notice })).toBe(
      true,
    );

    const mail = app.mailbox.last('r@example.com')!;
    expect(mail.subject).toBe('Anna Rossi ti ha inviato dei file: Holiday Bcc: evil@example.com');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain('http://localhost:8080/d/tok_ABCdef-123');
    expect(mail.text).toContain('3 file');
    expect(mail.text).toContain('5,3 MB');
    expect(mail.text).toContain('See you soon!');
    expect(mail.text).toContain('15 gennaio 2030');
    expect(mail.text).toContain('23:30');
    expect(mail.text).toContain('password');
  });

  it('follows the instance language and falls back to the instance name', async () => {
    const app = await createTestApp();
    app.ctx.settings.set('general', { defaultLocale: 'en', diskReserveMb: 1, chunkSizeMb: 25 });
    app.ctx.settings.set('appearance', {
      instanceName: 'Acme Drop',
      footer: '',
      primaryColor: '#047857',
      accentColor: '#047857',
      radius: 0,
      font: 'system',
      defaultTheme: 'system',
    });
    await app.ctx.mailer.sendTransferLink({
      to: 'r@example.com',
      transfer: { ...notice, title: null, message: null, senderName: null, fileCount: 1 },
    });

    const mail = app.mailbox.last('r@example.com')!;
    expect(mail.subject).toBe('Acme Drop sent you files via Acme Drop');
    expect(mail.text).toContain('sent you 1 file (5.3 MB)');
    expect(mail.text).toContain('January 15, 2030');
    expect(mail.text).not.toContain('Message:');
    expect(mail.text).not.toContain('Title:');
  });

  it('never contains the sender email or a password', () => {
    const { text, subject } = transferLinkMessage({
      locale: 'en',
      link: 'https://x.test/d/abc',
      instanceName: 'EasySend',
      senderName: null,
      title: null,
      message: null,
      expiresAt: EXPIRES_AT,
      fileCount: 2,
      totalBytes: 10,
      timezone: 'Europe/Rome',
    });
    expect(`${subject}\n${text}`).not.toMatch(/@/);
  });

  it('is not sent when PUBLIC_URL is missing', async () => {
    const app = await createTestApp({ env: { APP_MODE: 'production' } });
    expect(await app.ctx.mailer.sendTransferLink({ to: 'r@example.com', transfer: notice })).toBe(
      false,
    );
    expect(app.mailbox.sent).toHaveLength(0);
  });

  it('notifies the owner in their language with a link to the transfer page', async () => {
    const app = await createTestApp();
    const base = {
      to: 'o@example.com',
      transferId: 'tr-1',
      title: 'Rep\r\nort',
      downloadedAt: EXPIRES_AT,
    };

    await app.ctx.mailer.sendFirstDownload({ ...base, locale: 'en' });
    const en = app.mailbox.last('o@example.com')!;
    expect(en.subject).toBe('EasySend: "Rep ort" was downloaded');
    expect(en.text).toContain('http://localhost:8080/transfers/tr-1');
    expect(en.text).toContain('first time on January 15, 2030');

    await app.ctx.mailer.sendFirstDownload({ ...base, locale: null, title: null });
    const it = app.mailbox.last('o@example.com')!;
    expect(it.subject).toBe('EasySend: il tuo trasferimento è stato scaricato');
    expect(it.text).toContain('prima volta il 15 gennaio 2030');
  });

  it('firstDownloadMessage strips line breaks from the title in both languages', () => {
    for (const locale of ['it', 'en'] as const) {
      const { subject } = firstDownloadMessage({
        locale,
        instanceName: 'EasySend',
        title: 'a\nb\r\nc',
        link: 'https://x.test/transfers/1',
        downloadedAt: EXPIRES_AT,
        timezone: 'Europe/Rome',
      });
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject).toContain('a b c');
    }
  });
});
