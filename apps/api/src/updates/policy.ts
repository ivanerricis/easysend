import type { LimitPolicy } from '../auth/policy.js';
import { createLimiter, type Limiter } from '../http/rate-limit.js';

const HOUR = 3600;

/** Rate limits of the admin update tools. */
export const UPDATES_POLICY = {
  limits: {
    /** Forced "check for updates now" requests of the admin panel, single key. */
    updateCheck: { points: 10, durationSeconds: HOUR, blockSeconds: HOUR },
    /** One-click update requests of the admin panel, single key. */
    updateStart: { points: 5, durationSeconds: HOUR, blockSeconds: HOUR },
  } satisfies Record<string, LimitPolicy>,
} as const;

export interface UpdateLimiters {
  /** Forced update checks, single key `refresh`. Use `consume`. */
  updateCheck: Limiter;
  /** Update requests, single key `start`. Use `consume`. */
  updateStart: Limiter;
}

export function createUpdateLimiters(): UpdateLimiters {
  const { limits } = UPDATES_POLICY;
  return {
    updateCheck: createLimiter(limits.updateCheck),
    updateStart: createLimiter(limits.updateStart),
  };
}
