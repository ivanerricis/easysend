import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

/**
 * Sends every email through the real nodemailer path to a Mailpit container and reads it back
 * from the Mailpit API. Run with `pnpm test:mailpit` (starts Mailpit); skipped without MAILPIT_URL.
 */
const MAILPIT_URL = process.env.MAILPIT_URL;
const SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT ?? '1025');

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}
interface MailpitAttachment {
  ContentID: string;
  FileName: string;
  ContentType: string;
}
interface MailpitMessage extends MailpitSummary {
  From: { Address: string };
  HTML: string;
  Text: string;
  Inline: MailpitAttachment[];
  Attachments: MailpitAttachment[];
}
interface HtmlCheck {
  Total: { Tests: number; Supported: number; Partial: number; Unsupported: number };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}${path}`, init);
  if (!res.ok) throw new Error(`Mailpit ${path} answered ${res.status}`);
  return (init?.method === 'DELETE' ? res.text() : res.json()) as Promise<T>;
}

async function lastMessageTo(address: string): Promise<MailpitMessage> {
  const list = await api<{ messages: MailpitSummary[] }>('/api/v1/messages');
  const summary = list.messages.find((m) => m.To.some((t) => t.Address === address));
  if (!summary) throw new Error(`No message to ${address} in Mailpit`);
  return api<MailpitMessage>(`/api/v1/message/${summary.ID}`);
}

const SENDER_EMAIL = 'anna.secret@sender.example';
const FROM_EMAIL = 'noreply@easysend.example';

describe.skipIf(!MAILPIT_URL)('emails through a real SMTP server (Mailpit)', () => {
  it.each(['it', 'en'] as const)('delivers the five emails in %s', async (locale) => {
    const app = await createTestApp({ deps: { mailTransport: undefined } });
    app.ctx.settings.set('smtp', {
      host: '127.0.0.1',
      port: SMTP_PORT,
      security: 'none',
      fromEmail: FROM_EMAIL,
      fromName: 'EasySend',
    });
    app.ctx.settings.set('general', { defaultLocale: locale, diskReserveMb: 1, chunkSizeMb: 25 });
    await api('/api/v1/messages', { method: 'DELETE' });

    const mailer = app.ctx.mailer;
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const sent = {
      reset: await mailer.sendPasswordReset({ to: 'reset@example.com', locale, token: 'rt' }),
      welcome: await mailer.sendWelcome({ to: 'welcome@example.com', locale, token: 'wt' }),
      transfer: await mailer.sendTransferLink({
        to: 'recipient@example.com',
        transfer: {
          token: 'dl-token',
          title: 'Holiday <photos>',
          message: 'Line one\nLine two',
          senderName: 'Anna Rossi',
          expiresAt,
          fileCount: 3,
          totalBytes: 5_000_000,
        },
      }),
      first: await mailer.sendFirstDownload({
        to: 'owner@example.com',
        locale,
        transferId: 'tr-1',
        title: 'Holiday',
        downloadedAt: expiresAt,
      }),
      test: (
        await mailer.sendTest(
          {
            host: '127.0.0.1',
            port: SMTP_PORT,
            security: 'none',
            fromEmail: FROM_EMAIL,
            fromName: 'EasySend',
          },
          'admin@example.com',
          locale,
        )
      ).ok,
    };
    expect(sent).toEqual({ reset: true, welcome: true, transfer: true, first: true, test: true });

    const expected: Array<[string, RegExp, string?]> = [
      [
        'reset@example.com',
        locale === 'it' ? /reimposta la password/ : /reset your password/,
        'http://localhost:8080/reset-password?token=rt',
      ],
      [
        'welcome@example.com',
        locale === 'it' ? /Benvenuto/ : /Welcome/,
        'http://localhost:8080/welcome?token=wt',
      ],
      ['recipient@example.com', /Anna Rossi/, 'http://localhost:8080/d/dl-token'],
      ['owner@example.com', /Holiday/, 'http://localhost:8080/transfers/tr-1'],
      ['admin@example.com', locale === 'it' ? /email di prova/ : /test email/],
    ];
    for (const [to, subject, link] of expected) {
      const mail = await lastMessageTo(to);
      expect(mail.Subject, to).toMatch(subject);
      expect(mail.To.map((t) => t.Address)).toEqual([to]);
      expect(mail.From.Address).toBe(FROM_EMAIL);
      expect(mail.HTML, to).toContain(`<html lang="${locale}">`);
      expect(mail.Text.length, to).toBeGreaterThan(20);
      const logos = [...mail.Inline, ...mail.Attachments].filter((a) => a.ContentID === 'logo');
      expect(logos, to).toHaveLength(1);
      expect(logos[0]).toMatchObject({ FileName: 'logo.png', ContentType: 'image/png' });
      expect(mail.HTML).toContain('src="cid:logo"');
      if (link) {
        expect(mail.Text, to).toContain(link);
        expect(mail.HTML, to).toContain(`href="${link}"`);
      }
      expect(`${mail.HTML}${mail.Text}${mail.Subject}`, to).not.toContain(SENDER_EMAIL);
      expect(mail.HTML).not.toContain('<photos>');

      const check = await api<HtmlCheck>(`/api/v1/message/${mail.ID}/html-check`).catch(
        () => undefined,
      );
      if (check) {
        // Informational only: a score is not a pass/fail criterion.
        console.log(
          `html-check ${locale} ${to}: supported ${check.Total.Supported.toFixed(1)}%, ` +
            `partial ${check.Total.Partial.toFixed(1)}%, unsupported ${check.Total.Unsupported.toFixed(1)}%`,
        );
      }
    }
  });
});
