import type { Locale } from '@easysend/shared';

export interface MailContent {
  subject: string;
  text: string;
}

interface MessageInput {
  locale: Locale;
  link: string;
  instanceName: string;
}

/** Plain-text password reset email. Phase 4 replaces it with the branded templates. */
export function passwordResetMessage(input: MessageInput & { ttlMinutes: number }): MailContent {
  const { locale, link, instanceName, ttlMinutes } = input;
  if (locale === 'en') {
    return {
      subject: `${instanceName}: reset your password`,
      text: [
        'Hello,',
        '',
        `we received a request to reset your ${instanceName} password.`,
        'Open this link to choose a new one:',
        link,
        '',
        `The link is valid for ${ttlMinutes} minutes and can be used only once.`,
        'If you did not ask for it, you can ignore this email: your password stays the same.',
      ].join('\n'),
    };
  }
  return {
    subject: `${instanceName}: reimposta la password`,
    text: [
      'Ciao,',
      '',
      `abbiamo ricevuto una richiesta di reimpostazione della password di ${instanceName}.`,
      'Apri questo link per sceglierne una nuova:',
      link,
      '',
      `Il link vale ${ttlMinutes} minuti e si può usare una sola volta.`,
      'Se non l’hai chiesto tu, ignora questa email: la password non cambia.',
    ].join('\n'),
  };
}

/** Plain-text welcome email for a user created by an admin without a password. */
export function welcomeMessage(input: MessageInput & { ttlHours: number }): MailContent {
  const { locale, link, instanceName, ttlHours } = input;
  if (locale === 'en') {
    return {
      subject: `Welcome to ${instanceName}: set your password`,
      text: [
        'Hello,',
        '',
        `an account was created for you on ${instanceName}.`,
        'Open this link to set your password:',
        link,
        '',
        `The link is valid for ${ttlHours} hours and can be used only once.`,
      ].join('\n'),
    };
  }
  return {
    subject: `Benvenuto su ${instanceName}: imposta la password`,
    text: [
      'Ciao,',
      '',
      `è stato creato un account per te su ${instanceName}.`,
      'Apri questo link per impostare la password:',
      link,
      '',
      `Il link vale ${ttlHours} ore e si può usare una sola volta.`,
    ].join('\n'),
  };
}

// ---- Transfers ---------------------------------------------------------------------------

/** One line: CR/LF (header injection) and runs of whitespace become single spaces. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

export interface TransferLinkInput {
  locale: Locale;
  link: string;
  instanceName: string;
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
 * Plain-text email to a recipient of a transfer. It never carries the link password: the sender
 * shares it through another channel. Phase 4 replaces it with the branded template.
 */
export function transferLinkMessage(input: TransferLinkInput): MailContent {
  const { locale, link, instanceName, title, message } = input;
  const sender = oneLine(input.senderName ?? '') || instanceName;
  const heading = title ? oneLine(title) : '';
  const size = formatBytes(input.totalBytes, locale);
  const expires = formatDateTime(input.expiresAt, locale, input.timezone);
  const note = message?.trim() ? message.trim() : undefined;

  if (locale === 'en') {
    const files = input.fileCount === 1 ? '1 file' : `${input.fileCount} files`;
    return {
      subject: heading
        ? `${sender} sent you files: ${heading}`
        : `${sender} sent you files via ${instanceName}`,
      text: [
        'Hello,',
        '',
        `${sender} sent you ${files} (${size}) via ${instanceName}.`,
        ...(heading ? ['', `Title: ${heading}`] : []),
        ...(note ? ['', 'Message:', note] : []),
        '',
        'Download them here:',
        link,
        '',
        `The link expires on ${expires}.`,
        'If the link asks for a password, ask the sender: it is not included in this email.',
      ].join('\n'),
    };
  }
  const files = input.fileCount === 1 ? '1 file' : `${input.fileCount} file`;
  return {
    subject: heading
      ? `${sender} ti ha inviato dei file: ${heading}`
      : `${sender} ti ha inviato dei file con ${instanceName}`,
    text: [
      'Ciao,',
      '',
      `${sender} ti ha inviato ${files} (${size}) con ${instanceName}.`,
      ...(heading ? ['', `Titolo: ${heading}`] : []),
      ...(note ? ['', 'Messaggio:', note] : []),
      '',
      'Scaricali da qui:',
      link,
      '',
      `Il link scade il ${expires}.`,
      'Se il link chiede una password, chiedila al mittente: non è inclusa in questa email.',
    ].join('\n'),
  };
}

export interface FirstDownloadInput {
  locale: Locale;
  instanceName: string;
  title: string | null;
  /** Link to the owner's page of the transfer: `PUBLIC_URL/transfers/<id>`. */
  link: string;
  /** Unix seconds. */
  downloadedAt: number;
  timezone: string;
}

/** Plain-text notice to the owner that a transfer was downloaded for the first time. */
export function firstDownloadMessage(input: FirstDownloadInput): MailContent {
  const { locale, instanceName, link } = input;
  const heading = input.title ? oneLine(input.title) : '';
  const when = formatDateTime(input.downloadedAt, locale, input.timezone);

  if (locale === 'en') {
    return {
      subject: heading
        ? `${instanceName}: "${heading}" was downloaded`
        : `${instanceName}: your transfer was downloaded`,
      text: [
        'Hello,',
        '',
        `your transfer${heading ? ` "${heading}"` : ''} was downloaded for the first time on ${when}.`,
        'See the details and the download log here:',
        link,
      ].join('\n'),
    };
  }
  return {
    subject: heading
      ? `${instanceName}: "${heading}" è stato scaricato`
      : `${instanceName}: il tuo trasferimento è stato scaricato`,
    text: [
      'Ciao,',
      '',
      `il tuo trasferimento${heading ? ` "${heading}"` : ''} è stato scaricato per la prima volta il ${when}.`,
      'Vedi i dettagli e il registro dei download qui:',
      link,
    ].join('\n'),
  };
}
