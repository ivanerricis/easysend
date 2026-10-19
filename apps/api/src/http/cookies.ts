import { parseCookie, stringifySetCookie } from 'cookie';
import type { RequestHandler, Response } from 'express';

export const SESSION_COOKIE = 'es_session';
export const CSRF_COOKIE = 'es_csrf';

/** Parses the `Cookie` header into `req.cookies` (empty object when absent). Read with `readCookie`. */
export const cookieParser: RequestHandler = (req, _res, next) => {
  const header = req.headers.cookie;
  req.cookies = header ? parseCookie(header) : {};
  next();
};

export interface CookieOptions {
  /** Default `/`. */
  path?: string;
  /** Default `lax`. */
  sameSite?: 'lax' | 'strict';
}

/**
 * Sets an HttpOnly, Secure cookie (SameSite=Lax and Path=/ unless `options` say otherwise).
 * Secure is kept in local mode too: browsers accept it on http://localhost (Safari does not, use
 * Chrome or Firefox). `append` keeps the other Set-Cookie headers of the response.
 */
export function setCookie(
  res: Response,
  name: string,
  value: string,
  maxAgeSeconds: number,
  options: CookieOptions = {},
): void {
  res.append(
    'Set-Cookie',
    stringifySetCookie({
      name,
      value,
      httpOnly: true,
      secure: true,
      sameSite: options.sameSite ?? 'lax',
      path: options.path ?? '/',
      maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
    }),
  );
}

export function clearCookie(res: Response, name: string): void {
  setCookie(res, name, '', 0);
}

/**
 * Value of a request cookie. `req.cookies` is typed `any` by Express, so read it through here
 * to get a properly typed result.
 */
export function readCookie(req: { cookies?: unknown }, name: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[name];
}
