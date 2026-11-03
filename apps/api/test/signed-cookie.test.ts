import { describe, expect, it } from 'vitest';
import { hmacBase64url } from '../src/crypto/hash.js';
import { signCookieValue, verifySignedCookie } from '../src/http/signed-cookie.js';

const key = new Uint8Array(32).fill(7);
const macFor = (exp: number): string => hmacBase64url(key, `test:${exp}`);

describe('signed cookie helpers', () => {
  it('accepts a fresh, correctly signed value', () => {
    const value = signCookieValue(2000, macFor(2000));
    expect(value).toBe(`2000.${macFor(2000)}`);
    expect(verifySignedCookie(value, 1000, macFor)).toBe(true);
  });

  it('rejects expired, tampered, malformed and missing values', () => {
    expect(verifySignedCookie(signCookieValue(1000, macFor(1000)), 1000, macFor)).toBe(false);
    expect(verifySignedCookie(signCookieValue(3000, macFor(2000)), 1000, macFor)).toBe(false);
    expect(verifySignedCookie('garbage', 1000, macFor)).toBe(false);
    expect(verifySignedCookie(undefined, 1000, macFor)).toBe(false);
  });
});
