import {
  SMTP_SECURITY,
  smtpSettingsSchema,
  type SmtpSettings,
  type SmtpSettingsPublic,
} from '@easysend/shared';
import type { TFunction } from 'i18next';
import { z } from 'zod';
import { isApiError } from '@/lib/api/client';
import { hasErrorCode } from '@/lib/errors';

/**
 * SMTP form shared by the setup wizard and the admin settings: the form holds strings, the
 * submit handler gets a `SmtpSettings` validated by the shared schema.
 */
export const smtpFormSchema = z
  .object({
    host: z.string(),
    port: z.string(),
    security: z.enum(SMTP_SECURITY),
    username: z.string(),
    password: z.string(),
    fromEmail: z.string(),
    fromName: z.string(),
  })
  .transform((v): SmtpSettings => ({
    host: v.host.trim(),
    port: v.port.trim() === '' ? Number.NaN : Number(v.port.trim()),
    security: v.security,
    username: v.username.trim() === '' ? undefined : v.username.trim(),
    // An empty password keeps the saved one (or none).
    password: v.password === '' ? undefined : v.password,
    fromEmail: v.fromEmail.trim(),
    fromName: v.fromName.trim() === '' ? undefined : v.fromName.trim(),
  }))
  .pipe(smtpSettingsSchema);
export type SmtpFormValues = z.input<typeof smtpFormSchema>;

/** Form values for the saved settings (or the usual defaults when none exist yet). */
export function smtpFormDefaults(smtp: SmtpSettingsPublic | null): SmtpFormValues {
  return {
    host: smtp?.host ?? '',
    port: String(smtp?.port ?? 587),
    security: smtp?.security ?? 'starttls',
    username: smtp?.username ?? '',
    password: '',
    fromEmail: smtp?.fromEmail ?? '',
    fromName: smtp?.fromName ?? '',
  };
}

/** Comparable form of the values: any difference from the tested snapshot invalidates the test. */
export function smtpSnapshot(values: Partial<SmtpFormValues>): string {
  return JSON.stringify([
    values.host?.trim(),
    values.port?.trim(),
    values.security,
    values.username?.trim(),
    values.password,
    values.fromEmail?.trim(),
    values.fromName?.trim(),
  ]);
}

const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Safe error code reported by the API for a failed test (EAUTH, ECONNREFUSED...), if any. */
export function failureReason(error: unknown): string | null {
  if (!isApiError(error)) return null;
  const raw = error.details?.['reason'] ?? error.details?.['code'];
  return typeof raw === 'string' && SAFE_REASON.test(raw) ? raw : null;
}

/** Message for a failed SMTP test with the safe reason, or null when the error is another one. */
export function smtpTestFailureText(t: TFunction, error: unknown): string | null {
  if (!hasErrorCode(error, 'SMTP_TEST_FAILED')) return null;
  const reason = failureReason(error);
  const base = t('setup.smtp.testFailed');
  return reason
    ? `${base} ${t('setup.smtp.reasonLabel')} ${t(`setup.smtp.reasons.${reason}`, { defaultValue: reason })}`
    : base;
}
