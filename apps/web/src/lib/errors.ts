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
