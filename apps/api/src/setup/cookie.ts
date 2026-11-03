import type { Request, Response } from 'express';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { hmacBase64url } from '../crypto/hash.js';
import { SETUP_COOKIE, readCookie, setCookie } from '../http/cookies.js';
import { signCookieValue, verifySignedCookie } from '../http/signed-cookie.js';
import { SETUP_POLICY } from './policy.js';

export const SETUP_COOKIE_PATH = '/api/setup';

const mac = (ctx: AppContext, exp: number): string =>
  hmacBase64url(ctx.keys.setupCookie, `setup:${exp}`);

/** Sets the `es_setup` cookie (`<exp>.<mac>`) scoped to the setup endpoints. */
export function setSetupCookie(ctx: AppContext, res: Response): void {
  const exp = nowSeconds(ctx.clock) + SETUP_POLICY.setupCookieSeconds;
  setCookie(
    res,
    SETUP_COOKIE,
    signCookieValue(exp, mac(ctx, exp)),
    SETUP_POLICY.setupCookieSeconds,
    {
      path: SETUP_COOKIE_PATH,
      sameSite: 'strict',
    },
  );
}

/** Expires the cookie on the path it was set on. */
export function clearSetupCookie(res: Response): void {
  setCookie(res, SETUP_COOKIE, '', 0, { path: SETUP_COOKIE_PATH, sameSite: 'strict' });
}

/** True when the request carries a well-formed, unexpired, correctly signed `es_setup` cookie. */
export function hasValidSetupCookie(ctx: AppContext, req: Request): boolean {
  return verifySignedCookie(readCookie(req, SETUP_COOKIE), nowSeconds(ctx.clock), (exp) =>
    mac(ctx, exp),
  );
}
