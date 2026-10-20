import { errorResponseSchema } from '@easysend/shared';
import { ApiError } from '@/lib/api/client';

/** Shape of the tus-js-client `DetailedError` that we rely on (avoids importing the class). */
interface TusErrorLike {
  originalResponse?: {
    getStatus(): number;
    getBody(): string;
    getHeader(name: string): string | undefined;
  } | null;
}

/** Thrown by an upload handle when the user cancels. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof UploadCancelledError;
}

/** Reads the standard `{ error: { code, ... } }` body of a failed tus request. */
export function parseTusResponse(
  response: NonNullable<TusErrorLike['originalResponse']>,
): ApiError {
  const status = response.getStatus();
  const retryHeader = response.getHeader('Retry-After');
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(response.getBody());
  } catch {
    payload = undefined;
  }
  const parsed = errorResponseSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError({ status, code, message, requestId, details, retryAfter });
  }
  if (status === 429) {
    return new ApiError({ status, code: 'RATE_LIMITED', message: 'Too many requests', retryAfter });
  }
  if (status === 413) {
    return new ApiError({ status, code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
  }
  if (status === 401) {
    return new ApiError({ status, code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
  }
  const unavailable = status === 502 || status === 503 || status === 504;
  return new ApiError({
    status,
    code: unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
    message: `Unexpected response (${status})`,
  });
}

/**
 * Maps whatever tus-js-client reports to an `ApiError`, so the UI can show
 * `errorMessage(t, error)` for QUOTA_EXCEEDED, INSUFFICIENT_DISK_SPACE, TRANSFER_NOT_UPLOADABLE,
 * INVALID_UPLOAD_METADATA, VALIDATION_ERROR, UNAUTHENTICATED... A request that never got a
 * response (network down after all retries) becomes SERVICE_UNAVAILABLE.
 */
export function mapTusError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const response = (error as TusErrorLike | null)?.originalResponse;
  if (response) return parseTusResponse(response);
  return new ApiError({ status: 0, code: 'SERVICE_UNAVAILABLE', message: 'Network error' });
}

/** Whether tus must retry after `error`, in addition to refreshing the CSRF token on 403. */
export function isRetryableStatus(status: number): boolean {
  // Same rule as the tus-js-client default: 4xx are final, except 409 (offset mismatch) and 423.
  return !(status >= 400 && status < 500 && status !== 409 && status !== 423);
}
