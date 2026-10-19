import nodemailer from 'nodemailer';
import type { Locale, SmtpSettings } from '@easysend/shared';
import { AUTH_POLICY } from '../auth/policy.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { DEFAULT_INSTANCE_NAME, type SettingsRepo } from '../settings/repo.js';
import {
  firstDownloadMessage,
  passwordResetMessage,
  transferLinkMessage,
  welcomeMessage,
} from './messages.js';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Content-ID for inline images referenced as `cid:` in the HTML. */
  cid?: string;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

/** Minimal transport contract: nodemailer's transporter fits, tests inject a recorder. */
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
  close?(): void;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

/** Result of a test email: a safe error code (never a message) when it fails. */
export type MailTestResult = { ok: true } | { ok: false; code: string };

/** What the notification email to a recipient says about a transfer. */
export interface TransferNotice {
  /** The download token: the link is `PUBLIC_URL/d/<token>`. */
  token: string;
  title: string | null;
  message: string | null;
  /** Display name of the sender, null to use the instance name. */
  senderName: string | null;
  /** Unix seconds. */
  expiresAt: number;
  fileCount: number;
  totalBytes: number;
}

export interface Mailer {
  /** Sends a plain-text email. Resolves true when sent, false otherwise; never throws. */
  send(mail: OutgoingMail): Promise<boolean>;
  /** Link `PUBLIC_URL/reset-password?token=...`. `locale` null falls back to the instance default. */
  sendPasswordReset(input: { to: string; locale: Locale | null; token: string }): Promise<boolean>;
  /** Link `PUBLIC_URL/welcome?token=...`, valid `AUTH_POLICY.welcomeTokenSeconds`. */
  sendWelcome(input: { to: string; locale: Locale | null; token: string }): Promise<boolean>;
  /** Link `PUBLIC_URL/d/<token>` to a recipient, in the instance default language. */
  sendTransferLink(input: { to: string; transfer: TransferNotice }): Promise<boolean>;
  /** Tells the owner (in their language, null = instance default) that the transfer was downloaded. */
  sendFirstDownload(input: {
    to: string;
    locale: Locale | null;
    transferId: string;
    title: string | null;
    /** Unix seconds. */
    downloadedAt: number;
  }): Promise<boolean>;
  /**
   * Sends a test message through the GIVEN settings (never the stored ones) and reports the outcome.
   * `code` is a nodemailer error code from a fixed allowlist, else `UNKNOWN`. Never throws.
   */
  sendTest(settings: SmtpSettings, to: string, locale: Locale | null): Promise<MailTestResult>;
}

const LOCAL_FROM = 'EasySend <no-reply@localhost>';
const TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 10_000;

/** Error codes of a failed test send that are safe to show to the admin. */
const SAFE_TEST_ERROR_CODES = new Set([
  'EAUTH',
  'ECONNECTION',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ETLS',
  'EENVELOPE',
  'EMESSAGE',
  'EPROTOCOL',
]);

interface ResolvedSmtp {
  transport: MailTransport;
  from: string;
  /** True when this module created the transport and must close it after use. */
  owned: boolean;
}

function formatFrom(smtp: SmtpSettings): string {
  return smtp.fromName
    ? `"${smtp.fromName.replace(/["\\\r\n]/g, '')}" <${smtp.fromEmail}>`
    : smtp.fromEmail;
}

function createSmtpTransport(
  smtp: SmtpSettings,
  password: string | undefined,
  timeoutMs: number = TIMEOUT_MS,
): MailTransport {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    ...(smtp.username ? { auth: { user: smtp.username, pass: password ?? '' } } : {}),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  return {
    sendMail: (message) => transporter.sendMail(message),
    close: () => transporter.close(),
  };
}

/** Error summary that is safe to log: never the message (it may echo server replies or credentials). */
function safeError(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) return { name: 'UnknownError' };
  const { name, code, responseCode, command } = error as Record<string, unknown>;
  return { name, code, responseCode, command };
}

/**
 * Builds the mailer. SMTP comes from the `smtp` setting (password encrypted at rest). In local
 * mode without it, `SMTP_DEV_HOST`/`SMTP_DEV_PORT` (Mailpit) are used. A `transport` override
 * wins over both (tests). Without any SMTP the send fails: logged, never thrown.
 */
export function createMailer(deps: {
  config: Pick<
    AppConfig,
    'mode' | 'publicUrl' | 'smtpDevHost' | 'smtpDevPort' | 'passwordResetTtlMinutes' | 'timezone'
  >;
  /** Current public URL (env, setting or local default). Default: `config.publicUrl`. */
  publicUrl?: () => string | undefined;
  settingsRepo: Pick<SettingsRepo, 'get' | 'getDefaultLocale' | 'getInstanceName'>;
  logger: Logger;
  transport?: MailTransport;
}): Mailer {
  const { config, settingsRepo, logger } = deps;
  const publicUrl = deps.publicUrl ?? (() => config.publicUrl);

  function resolve(): ResolvedSmtp | undefined {
    const smtp = settingsRepo.get('smtp');
    const from = smtp ? formatFrom(smtp) : LOCAL_FROM;
    if (deps.transport) return { transport: deps.transport, from, owned: false };
    if (smtp) {
      return { transport: createSmtpTransport(smtp, smtp.password), from, owned: true };
    }
    if (config.mode === 'local' && config.smtpDevHost && config.smtpDevPort) {
      const dev: SmtpSettings = {
        host: config.smtpDevHost,
        port: config.smtpDevPort,
        security: 'none',
        fromEmail: 'no-reply@localhost',
      };
      return { transport: createSmtpTransport(dev, undefined), from: LOCAL_FROM, owned: true };
    }
    return undefined;
  }

  async function send(mail: OutgoingMail): Promise<boolean> {
    let resolved: ResolvedSmtp | undefined;
    try {
      resolved = resolve();
      if (!resolved) {
        logger.error('email not sent: SMTP is not configured');
        return false;
      }
      await resolved.transport.sendMail({ from: resolved.from, ...mail });
      return true;
    } catch (error) {
      logger.error({ err: safeError(error) }, 'email not sent');
      return false;
    } finally {
      if (resolved?.owned) resolved.transport.close?.();
    }
  }

  function buildLink(pathname: string, token: string): string | undefined {
    const base = publicUrl();
    if (!base) {
      logger.error('email not sent: PUBLIC_URL is not set, cannot build the link');
      return undefined;
    }
    const url = new URL(pathname, base);
    url.searchParams.set('token', token);
    return url.toString();
  }

  function buildUrl(pathname: string): string | undefined {
    const base = publicUrl();
    if (!base) {
      logger.error('email not sent: PUBLIC_URL is not set, cannot build the link');
      return undefined;
    }
    return new URL(pathname, base).toString();
  }

  const localeOf = (locale: Locale | null): Locale => locale ?? settingsRepo.getDefaultLocale();

  return {
    send,

    async sendPasswordReset({ to, locale, token }) {
      const link = buildLink('/reset-password', token);
      if (!link) return false;
      const content = passwordResetMessage({
        locale: localeOf(locale),
        link,
        instanceName: settingsRepo.getInstanceName() || DEFAULT_INSTANCE_NAME,
        ttlMinutes: config.passwordResetTtlMinutes,
      });
      return send({ to, ...content });
    },

    async sendWelcome({ to, locale, token }) {
      const link = buildLink('/welcome', token);
      if (!link) return false;
      const content = welcomeMessage({
        locale: localeOf(locale),
        link,
        instanceName: settingsRepo.getInstanceName() || DEFAULT_INSTANCE_NAME,
        ttlHours: Math.round(AUTH_POLICY.welcomeTokenSeconds / 3600),
      });
      return send({ to, ...content });
    },

    async sendTransferLink({ to, transfer }) {
      const link = buildUrl(`/d/${transfer.token}`);
      if (!link) return false;
      const content = transferLinkMessage({
        locale: settingsRepo.getDefaultLocale(),
        link,
        instanceName: settingsRepo.getInstanceName() || DEFAULT_INSTANCE_NAME,
        senderName: transfer.senderName,
        title: transfer.title,
        message: transfer.message,
        expiresAt: transfer.expiresAt,
        fileCount: transfer.fileCount,
        totalBytes: transfer.totalBytes,
        timezone: config.timezone,
      });
      return send({ to, ...content });
    },

    async sendFirstDownload({ to, locale, transferId, title, downloadedAt }) {
      const link = buildUrl(`/transfers/${transferId}`);
      if (!link) return false;
      const content = firstDownloadMessage({
        locale: localeOf(locale),
        instanceName: settingsRepo.getInstanceName() || DEFAULT_INSTANCE_NAME,
        title,
        link,
        downloadedAt,
        timezone: config.timezone,
      });
      return send({ to, ...content });
    },

    async sendTest(smtp, to, locale) {
      const transport = deps.transport ?? createSmtpTransport(smtp, smtp.password, TEST_TIMEOUT_MS);
      try {
        const name = settingsRepo.getInstanceName() || DEFAULT_INSTANCE_NAME;
        const it = localeOf(locale) === 'it';
        await transport.sendMail({
          from: formatFrom(smtp),
          to,
          subject: it ? `${name}: email di prova` : `${name}: test email`,
          text: it
            ? `Questa è un'email di prova inviata da ${name}. Se la leggi, l'SMTP funziona.`
            : `This is a test email sent by ${name}. If you can read it, SMTP works.`,
        });
        return { ok: true };
      } catch (error) {
        // Never the message: it may echo server replies or credentials.
        const code = (error as { code?: unknown } | null)?.code;
        logger.warn({ err: safeError(error) }, 'test email not sent');
        return {
          ok: false,
          code: typeof code === 'string' && SAFE_TEST_ERROR_CODES.has(code) ? code : 'UNKNOWN',
        };
      } finally {
        if (!deps.transport) transport.close?.();
      }
    },
  };
}
