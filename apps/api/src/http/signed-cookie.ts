import { timingSafeEqualStrings } from '../crypto/hash.js';

const SIGNED_COOKIE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** Value of a signed cookie: the expiry (Unix seconds), a dot and the MAC (base64url). */
export const signCookieValue = (exp: number, mac: string): string => `${exp}.${mac}`;

/**
 * True when `value` is a well-formed `<exp>.<mac>` cookie that has not expired and whose MAC
 * equals `macFor(exp)` (constant-time comparison).
 */
export function verifySignedCookie(
  value: string | undefined,
  nowSec: number,
  macFor: (exp: number) => string,
): boolean {
  const match = value ? SIGNED_COOKIE.exec(value) : null;
  if (!match) return false;
  const exp = Number(match[1]);
  return exp > nowSec && timingSafeEqualStrings(match[2]!, macFor(exp));
}
