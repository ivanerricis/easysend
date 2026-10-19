import { ERROR_CODES, type ErrorCode } from '@easysend/shared';

/** Application error carrying a stable shared error code. The HTTP status comes from the code. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError('NOT_FOUND', message);
