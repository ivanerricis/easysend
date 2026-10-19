import type { Locale, SmtpSettings, SmtpSettingsPublic } from '@easysend/shared';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';

type SmtpContext = Pick<AppContext, 'settings' | 'mailer' | 'smtpVerification'>;

/** The settings a test or save really uses: an omitted password means "keep the stored one". */
export function effectiveSmtpSettings(
  ctx: Pick<AppContext, 'settings'>,
  body: SmtpSettings,
): SmtpSettings {
  if (body.password !== undefined) return body;
  const stored = ctx.settings.get('smtp')?.password;
  return stored === undefined ? body : { ...body, password: stored };
}

/** Public view of SMTP settings: never the password, only whether one is stored. */
export function toSmtpPublic(settings: SmtpSettings): SmtpSettingsPublic {
  const { password, ...rest } = settings;
  return { ...rest, hasPassword: password !== undefined && password !== '' };
}

/**
 * Sends the test email with the given settings (stored password filled in when omitted). On
 * success the exact settings are remembered as verified; on failure `SMTP_TEST_FAILED` carries only
 * a safe error code. Rate limiting is up to the caller.
 */
export async function testSmtpSettings(
  ctx: SmtpContext,
  body: SmtpSettings,
  to: string,
  locale: Locale | null,
): Promise<void> {
  const settings = effectiveSmtpSettings(ctx, body);
  const result = await ctx.mailer.sendTest(settings, to, locale);
  if (!result.ok) {
    throw new AppError('SMTP_TEST_FAILED', 'The test email could not be sent', {
      code: result.code,
    });
  }
  ctx.smtpVerification.remember(settings);
}

/**
 * Stores the SMTP settings (password encrypted by the settings repo) when the same effective
 * settings passed a test, otherwise `SMTP_NOT_VERIFIED`. Returns the public view.
 */
export function saveVerifiedSmtpSettings(ctx: SmtpContext, body: SmtpSettings): SmtpSettingsPublic {
  const settings = effectiveSmtpSettings(ctx, body);
  if (!ctx.smtpVerification.isVerified(settings)) {
    throw new AppError(
      'SMTP_NOT_VERIFIED',
      'Send a successful test email with these settings first',
    );
  }
  ctx.settings.set('smtp', settings);
  ctx.smtpVerification.clear();
  return toSmtpPublic(settings);
}
