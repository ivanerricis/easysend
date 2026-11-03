import { createLimiter, type Limiter } from '../http/rate-limit.js';
import { SETUP_POLICY } from './policy.js';

/** Rate limiters of the setup wizard and the admin SMTP/tunnel tools, from `SETUP_POLICY.limits`. */
export interface SetupLimiters {
  /** Wrong setup codes, key: client `ip_hash`. Use `check` + `fail`. */
  setupCodeIp: Limiter;
  /** Wrong setup codes, single key `global`. Use `check` + `fail`. */
  setupCodeGlobal: Limiter;
  /** SMTP test emails, key: `setup` or `admin`. Use `consume`. */
  smtpTest: Limiter;
  /** Cloudflare configuration attempts, single key `global`. Use `consume`. */
  cloudflare: Limiter;
}

export function createSetupLimiters(): SetupLimiters {
  const { limits } = SETUP_POLICY;
  return {
    setupCodeIp: createLimiter(limits.setupCodeIp),
    setupCodeGlobal: createLimiter(limits.setupCodeGlobal),
    smtpTest: createLimiter(limits.smtpTest),
    cloudflare: createLimiter(limits.cloudflare),
  };
}
