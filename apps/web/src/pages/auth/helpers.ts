import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';

/** Accepts only same-origin relative paths: `/x`, never `//host` or a backslash. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return '/';
  return value;
}

/** "Try again in about 15 minutes." from a `Retry-After` value in seconds. */
export function retryHint(t: TFunction, seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return '';
  if (seconds < 90) return t('errors.retryAfterSeconds', { count: seconds });
  return t('errors.retryAfterMinutes', { count: Math.ceil(seconds / 60) });
}

/**
 * User-facing text for an API error. Lockouts and rate limits add how long to wait
 * (`Retry-After`); everything else goes through `errorMessage`.
 */
export function apiErrorText(t: TFunction, error: unknown): string {
  if (isApiError(error)) {
    if (error.code === 'ACCOUNT_LOCKED') {
      return `${t('auth.errors.locked')} ${retryHint(t, error.retryAfter)}`.trim();
    }
    if (error.code === 'RATE_LIMITED') {
      return `${t('auth.errors.rateLimited')} ${retryHint(t, error.retryAfter)}`.trim();
    }
  }
  return errorMessage(t, error);
}

/** Groups a TOTP secret in blocks of four characters for reading and typing. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}
