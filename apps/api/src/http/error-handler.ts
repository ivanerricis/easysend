import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, type ErrorCode, type ErrorResponse } from '@easysend/shared';
import type { Logger } from '../logger.js';
import { AppError } from './errors.js';
import { getRequestId } from './request-id.js';

function send(
  res: Response,
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  const body: ErrorResponse = {
    error: { code, message, requestId, ...(details ? { details } : {}) },
  };
  res.status(ERROR_CODES[code]).json(body);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, getRequestId(req), 'NOT_FOUND', 'Resource not found');
};

/** Errors from body-parser and other http-errors style libraries. */
function httpErrorCode(error: unknown): ErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { type, status } = error as { type?: unknown; status?: unknown };
  if (type === 'entity.too.large') return 'PAYLOAD_TOO_LARGE';
  if (type === 'entity.parse.failed' || type === 'encoding.unsupported') return 'VALIDATION_ERROR';
  if (type === 'charset.unsupported' || status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  return undefined;
}

/** Renders every error in the standard shape. Stack traces are logged, never sent. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error handlers by their four-argument signature.
  return (error: unknown, req, res, _next) => {
    const requestId = getRequestId(req);

    if (res.headersSent) {
      logger.error({ err: error, requestId }, 'error after headers were sent');
      res.destroy();
      return;
    }

    if (error instanceof AppError) {
      send(res, requestId, error.code, error.message, error.details);
      return;
    }

    if (error instanceof ZodError) {
      send(res, requestId, 'VALIDATION_ERROR', 'Invalid request', {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
      return;
    }

    const code = httpErrorCode(error);
    if (code) {
      send(res, requestId, code, code === 'VALIDATION_ERROR' ? 'Malformed request body' : code);
      return;
    }

    logger.error({ err: error, requestId }, 'unhandled error');
    send(res, requestId, 'INTERNAL_ERROR', 'Internal server error');
  };
}
