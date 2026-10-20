import type { ErrorCode } from '@easysend/shared';
import type { TFunction } from 'i18next';
import { isApiError } from './api/client';

/** Translated, user-facing message for any thrown value (ApiError codes live in `errors.*`). */
export function errorMessage(t: TFunction, error: unknown): string {
  if (isApiError(error)) {
    const key = `errors.${error.code}`;
    return t(key, { defaultValue: t('errors.generic') });
  }
  return t('errors.generic');
}

/** Whether `error` is an ApiError with one of the given codes. */
export function hasErrorCode(error: unknown, ...codes: ErrorCode[]): boolean {
  return isApiError(error) && codes.includes(error.code);
}

/**
 * Maps a `VALIDATION_ERROR` onto form fields. The API sends
 * `details: { issues: [{ path: 'a.b', code, message }] }`; the result is keyed by the dotted
 * path (the first issue per path wins) and holds the server's English message, so callers
 * should show their own translated text and use this only to know which fields to mark.
 */
export function fieldErrorsFromApi(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return {};
  const issues = error.details?.['issues'];
  if (!Array.isArray(issues)) return {};
  const result: Record<string, string> = {};
  for (const issue of issues as unknown[]) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || path === '' || typeof message !== 'string') continue;
    result[path] ??= message;
  }
  return result;
}
