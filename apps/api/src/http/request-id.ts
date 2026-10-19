import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept a caller-supplied id only if it is short and made of safe characters. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns `req.id` (reusing a safe incoming `X-Request-Id`) and echoes it in the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

export function getRequestId(req: { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : 'unknown';
}
