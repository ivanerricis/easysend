// Renders every email in Italian and English into `.local-data/mail-preview/` for a visual check:
// `pnpm mail:preview`, then open the .html files in a browser (the logo is inlined as data: URI).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_APPEARANCE, type Locale } from '@easysend/shared';
import {
  firstDownloadEmail,
  passwordResetEmail,
  smtpTestEmail,
  transferLinkEmail,
  welcomeEmail,
  type EmailContent,
} from '../src/mail/content.js';
import { DEFAULT_EMAIL_LOGO } from '../src/mail/default-logo.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = path.join(root, '.local-data', 'mail-preview');
mkdirSync(outDir, { recursive: true });

const logoUri = `data:image/png;base64,${DEFAULT_EMAIL_LOGO.content.toString('base64')}`;
const appearance = { ...DEFAULT_APPEARANCE, footer: 'Sample footer text\nSecond footer line' };
const base = 'https://files.example.com';
const nextWeek = Math.floor(Date.now() / 1000) + 7 * 86_400;

function emails(locale: Locale): Record<string, EmailContent> {
  const common = { locale, appearance };
  return {
    'password-reset': passwordResetEmail({
      ...common,
      link: `${base}/reset-password?token=sample-token`,
      ttlMinutes: 30,
    }),
    welcome: welcomeEmail({ ...common, link: `${base}/welcome?token=sample-token`, ttlHours: 72 }),
    'transfer-link': transferLinkEmail({
      ...common,
      link: `${base}/d/sample-token`,
      senderName: 'Anna Rossi',
      title: 'Holiday photos',
      message: 'Here are the pictures.\nHave a look and tell me what you think!\n\nSee you soon.',
      expiresAt: nextWeek,
      fileCount: 12,
      totalBytes: 734_003_200,
      timezone: 'Europe/Rome',
    }),
    'first-download': firstDownloadEmail({
      ...common,
      title: 'Holiday photos',
      link: `${base}/transfers/sample-id`,
      downloadedAt: Math.floor(Date.now() / 1000),
      timezone: 'Europe/Rome',
    }),
    'smtp-test': smtpTestEmail(common),
  };
}

for (const locale of ['it', 'en'] as const) {
  for (const [name, mail] of Object.entries(emails(locale))) {
    const html = mail.html.replaceAll('cid:logo', logoUri);
    writeFileSync(path.join(outDir, `${name}-${locale}.html`), html);
    writeFileSync(path.join(outDir, `${name}-${locale}.txt`), `${mail.subject}\n\n${mail.text}\n`);
  }
}
console.log(`Email previews written to ${outDir}`);
