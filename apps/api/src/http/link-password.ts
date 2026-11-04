import type { Response } from 'express';
import type { PasswordHasher } from '../auth/password.js';
import { AppError } from './errors.js';
import { assertNotLimited, limitedError, type Limiter } from './rate-limit.js';

/**
 * Checks the password of a public link (download or upload request) with two failure counters:
 * one per `ipKey` and one per `tokenKey`. Throws `RATE_LIMITED` while either is exhausted and
 * `PASSWORD_INCORRECT` for a wrong password; a right one clears the per-IP counter.
 */
export async function verifyLinkPassword(
  res: Response,
  hasher: Pick<PasswordHasher, 'verify'>,
  input: {
    passwordHash: string;
    password: string;
    ipKey: string;
    tokenKey: string;
    byIp: Limiter;
    byToken: Limiter;
  },
): Promise<void> {
  const { byIp, byToken, ipKey, tokenKey } = input;
  assertNotLimited(res, await byToken.check(tokenKey));
  assertNotLimited(res, await byIp.check(ipKey));

  if (!(await hasher.verify(input.passwordHash, input.password))) {
    const [token, ip] = await Promise.all([byToken.fail(tokenKey), byIp.fail(ipKey)]);
    const limited = [token, ip].filter((s) => s.limited);
    if (limited.length > 0) {
      throw limitedError(res, Math.max(...limited.map((s) => s.retryAfterSeconds)));
    }
    throw new AppError('PASSWORD_INCORRECT', 'Incorrect password');
  }
  await byIp.reset(ipKey);
}
