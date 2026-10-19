import { createLimiter, type Limiter } from '../http/rate-limit.js';
import { AUTH_POLICY } from './policy.js';

/** Rate limiters of the auth flows, built per app instance from `AUTH_POLICY.limits`. */
export interface AuthLimiters {
  /** Failed logins per account (password and second factor share it). Use `check` + `fail`. */
  loginAccount: Limiter;
  /** Failed logins per client IP. Use `check` + `fail`. */
  loginIp: Limiter;
  /** Password reset requests per IP. Use `consume`. */
  resetRequestIp: Limiter;
  /** Password reset requests per email. Use `consume`. */
  resetRequestEmail: Limiter;
  /** Password reset confirmations per IP. Use `consume`. */
  resetConfirmIp: Limiter;
  /** Failed re-authentications (password / code on sensitive operations), per user id. Use `check` + `fail`. */
  reauth: Limiter;
}

export function createAuthLimiters(): AuthLimiters {
  const { limits } = AUTH_POLICY;
  return {
    loginAccount: createLimiter(limits.loginAccount),
    loginIp: createLimiter(limits.loginIp),
    resetRequestIp: createLimiter(limits.resetRequestIp),
    resetRequestEmail: createLimiter(limits.resetRequestEmail),
    resetConfirmIp: createLimiter(limits.resetConfirmIp),
    reauth: createLimiter(limits.reauth),
  };
}

/** Key for per-account limiters: emails are case-insensitive. */
export const accountKey = (email: string): string => email.trim().toLowerCase();
