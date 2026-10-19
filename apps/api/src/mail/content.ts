import type { ReactElement } from 'react';
import type { Appearance, Locale } from '@easysend/shared';
import { sentByLine, type EmailBrand } from './components.js';
import { renderEmail } from './render.js';
import { FirstDownloadEmail } from './templates/first-download.js';
import { PasswordResetEmail } from './templates/password-reset.js';
import { SmtpTestEmail } from './templates/smtp-test.js';
import { TransferLinkEmail } from './templates/transfer-link.js';
import { WelcomeEmail } from './templates/welcome.js';

/** A ready-to-send email: header-safe subject, hidden preview text, plain text and HTML. */
export interface EmailContent {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}

/**
 * The words of one email, language already chosen. The plain text and the HTML are both built
 * from it, so they never drift apart. Every field is a plain string: the HTML side escapes it.
 */
export interface EmailCopy {
  subject: string;
  preheader: string;
  /** Heading of the HTML email (the plain text starts with the greeting). */
  heading: string;
  greeting: string;
  lead: string[];
  /** Labelled rows shown only in the HTML (the plain text carries the same facts in `lead`). */
  details: Array<{ label: string; value: string }>;
  title?: { label: string; value: string };
  message?: { label: string; text: string };
  cta?: { intro: string; label: string; url: string; fallback: string };
  after: string[];
}

/** One line: CR/LF (header injection) and runs of whitespace become single spaces. */
export const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** `1536` becomes `1.5 KB`. Binary units, one decimal at most, formatted for the locale. */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${number} ${units[unit]}`;
}

/** Date and time in the language of the email and the configured time zone. */
export function formatDateTime(unixSeconds: number, locale: Locale, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(unixSeconds * 1000));
}

/** Plain text from the copy, with the same footer line as the HTML. Never the sender's email. */
export function copyToText(copy: EmailCopy, brand: EmailBrand): string {
  const { appearance, locale } = brand;
  const footer = appearance.footer.trim();
  return [
    copy.greeting,
    ...copy.lead.flatMap((line) => ['', line]),
    ...(copy.title ? ['', `${copy.title.label}: ${copy.title.value}`] : []),
    ...(copy.message ? ['', `${copy.message.label}:`, copy.message.text] : []),
    ...(copy.cta ? ['', copy.cta.intro, copy.cta.url] : []),
    ...(copy.after.length > 0 ? [''] : []),
    ...copy.after,
    '',
    '--',
    sentByLine(locale, appearance.instanceName),
    ...(footer ? [footer] : []),
  ].join('\n');
}

function build(
  copy: EmailCopy,
  brand: EmailBrand,
  template: (props: { copy: EmailCopy; brand: EmailBrand }) => ReactElement,
): EmailContent {
  return {
    subject: copy.subject,
    preheader: copy.preheader,
    text: copyToText(copy, brand),
    html: renderEmail(template({ copy, brand })),
  };
}

interface BaseInput {
  locale: Locale;
  appearance: Appearance;
}

const brandOf = ({ locale, appearance }: BaseInput): EmailBrand => ({ locale, appearance });

/** Instance name as used in headers and sentences: one line, never empty. */
const nameOf = (appearance: Appearance): string => oneLine(appearance.instanceName);

// ---- Password reset ----------------------------------------------------------------------

export function passwordResetEmail(input: BaseInput & { link: string; ttlMinutes: number }) {
  const brand = brandOf(input);
  const name = nameOf(input.appearance);
  const { link, ttlMinutes } = input;
  const copy: EmailCopy =
    input.locale === 'en'
      ? {
          subject: `${name}: reset your password`,
          preheader: `The link is valid for ${ttlMinutes} minutes.`,
          heading: 'Reset your password',
          greeting: 'Hello,',
          lead: [`we received a request to reset your ${name} password.`],
          details: [],
          cta: {
            intro: 'Open this link to choose a new one:',
            label: 'Choose a new password',
            url: link,
            fallback: 'If the button does not work, copy this link into your browser:',
          },
          after: [
            `The link is valid for ${ttlMinutes} minutes and can be used only once.`,
            'If you did not ask for it, you can ignore this email: your password stays the same.',
          ],
        }
      : {
          subject: `${name}: reimposta la password`,
          preheader: `Il link vale ${ttlMinutes} minuti.`,
          heading: 'Reimposta la password',
          greeting: 'Ciao,',
          lead: [`abbiamo ricevuto una richiesta di reimpostazione della password di ${name}.`],
          details: [],
          cta: {
            intro: 'Apri questo link per sceglierne una nuova:',
            label: 'Scegli una nuova password',
            url: link,
            fallback: 'Se il pulsante non funziona, copia questo link nel browser:',
          },
          after: [
            `Il link vale ${ttlMinutes} minuti e si può usare una sola volta.`,
            'Se non l’hai chiesto tu, ignora questa email: la password non cambia.',
          ],
        };
  return build(copy, brand, PasswordResetEmail);
}

// ---- Welcome -----------------------------------------------------------------------------

export function welcomeEmail(input: BaseInput & { link: string; ttlHours: number }) {
  const brand = brandOf(input);
  const name = nameOf(input.appearance);
  const { link, ttlHours } = input;
  const copy: EmailCopy =
    input.locale === 'en'
      ? {
          subject: `Welcome to ${name}: set your password`,
          preheader: `Your account is ready. The link is valid for ${ttlHours} hours.`,
          heading: `Welcome to ${name}`,
          greeting: 'Hello,',
          lead: [`an account was created for you on ${name}.`],
          details: [],
          cta: {
            intro: 'Open this link to set your password:',
            label: 'Set your password',
            url: link,
            fallback: 'If the button does not work, copy this link into your browser:',
          },
          after: [`The link is valid for ${ttlHours} hours and can be used only once.`],
        }
      : {
          subject: `Benvenuto su ${name}: imposta la password`,
          preheader: `Il tuo account è pronto. Il link vale ${ttlHours} ore.`,
          heading: `Benvenuto su ${name}`,
          greeting: 'Ciao,',
          lead: [`è stato creato un account per te su ${name}.`],
          details: [],
          cta: {
            intro: 'Apri questo link per impostare la password:',
            label: 'Imposta la password',
            url: link,
            fallback: 'Se il pulsante non funziona, copia questo link nel browser:',
          },
          after: [`Il link vale ${ttlHours} ore e si può usare una sola volta.`],
        };
  return build(copy, brand, WelcomeEmail);
}

// ---- Transfer link -----------------------------------------------------------------------

export interface TransferLinkInput extends BaseInput {
  link: string;
  /** The sender's display name; the instance name is used when missing. Never the email. */
  senderName: string | null;
  title: string | null;
  message: string | null;
  /** Unix seconds. */
  expiresAt: number;
  fileCount: number;
  totalBytes: number;
  timezone: string;
}

/**
 * Email to a recipient of a transfer. It never carries the link password: the sender shares it
 * through another channel.
 */
export function transferLinkEmail(input: TransferLinkInput) {
  const brand = brandOf(input);
  const { locale, link } = input;
  const name = nameOf(input.appearance);
  const sender = oneLine(input.senderName ?? '') || name;
  const heading = input.title ? oneLine(input.title) : '';
  const size = formatBytes(input.totalBytes, locale);
  const expires = formatDateTime(input.expiresAt, locale, input.timezone);
  const note = input.message?.trim() ? input.message.trim() : undefined;

  const copy: EmailCopy =
    locale === 'en'
      ? {
          subject: heading
            ? `${sender} sent you files: ${heading}`
            : `${sender} sent you files via ${name}`,
          preheader: `Download them before ${expires}.`,
          heading: heading || 'You received some files',
          greeting: 'Hello,',
          lead: [
            `${sender} sent you ${input.fileCount === 1 ? '1 file' : `${input.fileCount} files`} (${size}) via ${name}.`,
          ],
          details: [
            { label: 'Files', value: String(input.fileCount) },
            { label: 'Total size', value: size },
            { label: 'Expires', value: expires },
          ],
          ...(heading ? { title: { label: 'Title', value: heading } } : {}),
          ...(note ? { message: { label: 'Message', text: note } } : {}),
          cta: {
            intro: 'Download them here:',
            label: 'Download files',
            url: link,
            fallback: 'If the button does not work, copy this link into your browser:',
          },
          after: [
            `The link expires on ${expires}.`,
            'If the link asks for a password, ask the sender: it is not included in this email.',
          ],
        }
      : {
          subject: heading
            ? `${sender} ti ha inviato dei file: ${heading}`
            : `${sender} ti ha inviato dei file con ${name}`,
          preheader: `Scaricali prima del ${expires}.`,
          heading: heading || 'Hai ricevuto dei file',
          greeting: 'Ciao,',
          lead: [
            `${sender} ti ha inviato ${input.fileCount === 1 ? '1 file' : `${input.fileCount} file`} (${size}) con ${name}.`,
          ],
          details: [
            { label: 'File', value: String(input.fileCount) },
            { label: 'Dimensione totale', value: size },
            { label: 'Scadenza', value: expires },
          ],
          ...(heading ? { title: { label: 'Titolo', value: heading } } : {}),
          ...(note ? { message: { label: 'Messaggio', text: note } } : {}),
          cta: {
            intro: 'Scaricali da qui:',
            label: 'Scarica i file',
            url: link,
            fallback: 'Se il pulsante non funziona, copia questo link nel browser:',
          },
          after: [
            `Il link scade il ${expires}.`,
            'Se il link chiede una password, chiedila al mittente: non è inclusa in questa email.',
          ],
        };
  return build(copy, brand, TransferLinkEmail);
}

// ---- First download ----------------------------------------------------------------------

export interface FirstDownloadInput extends BaseInput {
  title: string | null;
  /** Link to the owner's page of the transfer: `PUBLIC_URL/transfers/<id>`. */
  link: string;
  /** Unix seconds. */
  downloadedAt: number;
  timezone: string;
}

/** Notice to the owner that a transfer was downloaded for the first time. */
export function firstDownloadEmail(input: FirstDownloadInput) {
  const brand = brandOf(input);
  const { locale, link } = input;
  const name = nameOf(input.appearance);
  const heading = input.title ? oneLine(input.title) : '';
  const when = formatDateTime(input.downloadedAt, locale, input.timezone);

  const copy: EmailCopy =
    locale === 'en'
      ? {
          subject: heading
            ? `${name}: "${heading}" was downloaded`
            : `${name}: your transfer was downloaded`,
          preheader: `First download on ${when}.`,
          heading: 'Your transfer was downloaded',
          greeting: 'Hello,',
          lead: [
            `your transfer${heading ? ` "${heading}"` : ''} was downloaded for the first time on ${when}.`,
          ],
          details: [
            ...(heading ? [{ label: 'Title', value: heading }] : []),
            { label: 'First download', value: when },
          ],
          cta: {
            intro: 'See the details and the download log here:',
            label: 'View transfer',
            url: link,
            fallback: 'If the button does not work, copy this link into your browser:',
          },
          after: [],
        }
      : {
          subject: heading
            ? `${name}: "${heading}" è stato scaricato`
            : `${name}: il tuo trasferimento è stato scaricato`,
          preheader: `Primo download il ${when}.`,
          heading: 'Il tuo trasferimento è stato scaricato',
          greeting: 'Ciao,',
          lead: [
            `il tuo trasferimento${heading ? ` "${heading}"` : ''} è stato scaricato per la prima volta il ${when}.`,
          ],
          details: [
            ...(heading ? [{ label: 'Titolo', value: heading }] : []),
            { label: 'Primo download', value: when },
          ],
          cta: {
            intro: 'Vedi i dettagli e il registro dei download qui:',
            label: 'Apri il trasferimento',
            url: link,
            fallback: 'Se il pulsante non funziona, copia questo link nel browser:',
          },
          after: [],
        };
  return build(copy, brand, FirstDownloadEmail);
}

// ---- SMTP test ---------------------------------------------------------------------------

/** Test message of the admin settings: no link, it only proves the SMTP settings work. */
export function smtpTestEmail(input: BaseInput) {
  const brand = brandOf(input);
  const name = nameOf(input.appearance);
  const copy: EmailCopy =
    input.locale === 'en'
      ? {
          subject: `${name}: test email`,
          preheader: 'Your SMTP settings work.',
          heading: 'Test email',
          greeting: 'Hello,',
          lead: [
            `this is a test email sent by ${name}. If you can read it, your SMTP settings work.`,
          ],
          details: [],
          after: [],
        }
      : {
          subject: `${name}: email di prova`,
          preheader: 'Le impostazioni SMTP funzionano.',
          heading: 'Email di prova',
          greeting: 'Ciao,',
          lead: [
            `questa è un'email di prova inviata da ${name}. Se la leggi, le impostazioni SMTP funzionano.`,
          ],
          details: [],
          after: [],
        };
  return build(copy, brand, SmtpTestEmail);
}
