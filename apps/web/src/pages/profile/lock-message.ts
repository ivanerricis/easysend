import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatDuration } from '@/lib/format';

/** Message for a rate-limit / lock error, with the retry time when the API sent one. */
export function lockMessage(t: TFunction, locale: string, error: unknown): string {
  if (isApiError(error) && error.retryAfter) {
    return t('profile.retryIn', { time: formatDuration(error.retryAfter, locale) });
  }
  return errorMessage(t, error);
}
