import nodemailer from 'nodemailer';
import type { Locale, SmtpSettings } from '@easysend/shared';
import { AUTH_POLICY } from '../auth/policy.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { DEFAULT_INSTANCE_NAME, type SettingsRepo } from '../settings/repo.js';
import { passwordResetMessage, welcomeMessage } from './messages.js';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
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
}

export interface Mailer {
  /** Sends a plain-text email. Resolves true when sent, false otherwise; never throws. */
  send(mail: OutgoingMail): Promise<boolean>;
  /** Link `PUBLIC_URL/reset-password?token=...`. `locale` null falls back to the instance default. */
  sendPasswordReset(input: { to: string; locale: Locale | null; token: string }): Promise<boolean>;
  /** Link `PUBLIC_URL/welcome?token=...`, valid `AUTH_POLICY.welcomeTokenSeconds`. */
  sendWelcome(input: { to: string; locale: Locale | null; token: string }): Promise<boolean>;
}

const LOCAL_FROM = 'EasySend <no-reply@localhost>';
const TIMEOUT_MS = 15_000;

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

function createSmtpTransport(smtp: SmtpSettings, password: string | undefined): MailTransport {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    ...(smtp.username ? { auth: { user: smtp.username, pass: password ?? '' } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
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
    'mode' | 'publicUrl' | 'smtpDevHost' | 'smtpDevPort' | 'passwordResetTtlMinutes'
  >;
  settingsRepo: Pick<SettingsRepo, 'get' | 'getDefaultLocale' | 'getInstanceName'>;
  logger: Logger;
  transport?: MailTransport;
}): Mailer {
  const { config, settingsRepo, logger } = deps;

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
    if (!config.publicUrl) {
      logger.error('email not sent: PUBLIC_URL is not set, cannot build the link');
      return undefined;
    }
    const url = new URL(pathname, config.publicUrl);
    url.searchParams.set('token', token);
    return url.toString();
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
  };
}
