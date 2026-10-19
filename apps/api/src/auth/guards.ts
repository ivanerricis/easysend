import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';

/**
 * - `mfa-pending`: ONLY a session whose second factor is not verified yet (2FA login steps).
 * - `session`: only a fully authenticated session; a pending one is rejected with UNAUTHENTICATED.
 * - `admin`: a full session of a user with the `admin` role; others get FORBIDDEN.
 * - `any`: pending or full. Reserved for `auth.logout`, which must also cancel a half-done login.
 */
export type GuardLevel = 'mfa-pending' | 'session' | 'admin' | 'any';

export function requireAuth(level: GuardLevel): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(new AppError('UNAUTHENTICATED', 'Authentication required'));

    switch (level) {
      case 'any':
        return next();
      case 'mfa-pending':
        if (auth.level !== 'mfa-pending') {
          return next(new AppError('UNAUTHENTICATED', 'No login in progress'));
        }
        return next();
      case 'session':
      case 'admin':
        if (auth.level !== 'session') {
          return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
        }
        if (level === 'admin' && auth.user.role !== 'admin') {
          return next(new AppError('FORBIDDEN', 'Administrator role required'));
        }
        return next();
    }
  };
}
