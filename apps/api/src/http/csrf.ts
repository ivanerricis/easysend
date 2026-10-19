import type { Request, RequestHandler, Response } from 'express';
import { hmacBase64url, randomToken, timingSafeEqualStrings } from '../crypto/hash.js';
import { AUTH_POLICY } from '../auth/policy.js';
import { CSRF_COOKIE, readCookie, setCookie } from './cookies.js';
import { AppError } from './errors.js';

export const CSRF_HEADER = 'x-csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfService {
  /** New pre-login token: sets the `es_csrf` cookie and returns the token to send back in the header. */
  issuePreLoginToken(res: Response): string;
  /** Token of the current cookie when it is valid, otherwise a new one (idempotent for GET /auth/csrf). */
  ensurePreLoginToken(req: Request, res: Response): string;
  /** Token bound to a session: HMAC of the session id, nothing is stored. */
  sessionToken(sessionId: string): string;
  /** The right token for this request: session-bound when logged in (also pending), else pre-login. */
  tokenFor(req: Request, res: Response): string;
  /** Rejects cross-site `Origin` / `Sec-Fetch-Site` on unsafe methods. Mounted globally under /api. */
  rejectCrossSite: RequestHandler;
  /** `rejectCrossSite` plus the token check. Use on endpoints with `csrf: true`. */
  requireCsrf: RequestHandler;
}

export function createCsrf(deps: {
  /** Current public URL (evaluated per request: the wizard can set it at runtime). */
  publicUrl: () => string | undefined;
  csrfKey: Uint8Array;
}): CsrfService {
  const { publicUrl, csrfKey } = deps;

  const sign = (kind: 'pre' | 'session', value: string): string =>
    hmacBase64url(csrfKey, `${kind}:${value}`);

  const isValidPreLoginToken = (token: string | undefined): token is string => {
    if (!token) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    return timingSafeEqualStrings(token.slice(dot + 1), sign('pre', token.slice(0, dot)));
  };

  const issuePreLoginToken = (res: Response): string => {
    const nonce = randomToken(24);
    const token = `${nonce}.${sign('pre', nonce)}`;
    setCookie(res, CSRF_COOKIE, token, AUTH_POLICY.csrfCookieSeconds);
    return token;
  };

  const sessionToken = (sessionId: string): string => sign('session', sessionId);

  const ensurePreLoginToken = (req: Request, res: Response): string => {
    const existing = readCookie(req, CSRF_COOKIE);
    return isValidPreLoginToken(existing) ? existing : issuePreLoginToken(res);
  };

  const requestOrigin = (req: Request): string | undefined => {
    const host = req.get('host');
    return host ? `${req.protocol}://${host}` : undefined;
  };

  const rejectCrossSite: RequestHandler = (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (req.get('sec-fetch-site') === 'cross-site') {
      return next(new AppError('CSRF_INVALID', 'Cross-site request rejected'));
    }
    const origin = req.get('origin');
    const configured = publicUrl();
    const publicOrigin = configured ? new URL(configured).origin : undefined;
    if (origin !== undefined && origin !== publicOrigin && origin !== requestOrigin(req)) {
      return next(new AppError('CSRF_INVALID', 'Cross-site request rejected'));
    }
    next();
  };

  const requireCsrf: RequestHandler = (req, res, next) => {
    rejectCrossSite(req, res, (error?: unknown) => {
      if (error) return next(error);
      const header = req.get(CSRF_HEADER);
      let valid = false;
      if (header) {
        if (req.auth) {
          valid = timingSafeEqualStrings(header, sessionToken(req.auth.session.id));
        } else {
          const cookie = readCookie(req, CSRF_COOKIE);
          valid = isValidPreLoginToken(cookie) && timingSafeEqualStrings(header, cookie);
        }
      }
      if (!valid) return next(new AppError('CSRF_INVALID', 'Missing or invalid CSRF token'));
      next();
    });
  };

  return {
    issuePreLoginToken,
    ensurePreLoginToken,
    sessionToken,
    tokenFor(req, res) {
      return req.auth ? sessionToken(req.auth.session.id) : ensurePreLoginToken(req, res);
    },
    rejectCrossSite,
    requireCsrf,
  };
}
