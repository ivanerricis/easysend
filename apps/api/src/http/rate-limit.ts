import type { Request, RequestHandler, Response } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import type { LimitPolicy } from '../auth/policy.js';
import { AppError } from './errors.js';

export interface LimitStatus {
  /** True when the caller must be refused. */
  limited: boolean;
  /** Seconds until the key is free again (0 when not limited). */
  retryAfterSeconds: number;
}

/**
 * In-memory limiter (state is lost on restart, acceptable with a single instance). Create one per
 * app instance: there are no module-level singletons, so tests never share counters.
 * Time comes from the library (real clock): tests use short policies instead of a fake clock.
 */
export interface Limiter {
  /**
   * Counts a request. `limited` is true when this request goes over the limit; the key is then
   * blocked for the policy's `blockSeconds`. Use for plain request-rate limits.
   */
  consume(key: string, cost?: number): Promise<LimitStatus>;
  /**
   * Non-consuming look: is the key currently exhausted or blocked? Pair it with `fail` for
   * lockouts ("N failures, then locked").
   */
  check(key: string): Promise<LimitStatus>;
  /**
   * Records a failure. `limited` becomes true as soon as the threshold is reached and the key is
   * blocked for `blockSeconds` from that moment.
   */
  fail(key: string, cost?: number): Promise<LimitStatus>;
  /** Gives points back (e.g. after a success). */
  reward(key: string, cost?: number): Promise<void>;
  /** Forgets the key (counter and block). */
  reset(key: string): Promise<void>;
  /** Blocks the key for an explicit time. */
  block(key: string, seconds: number): Promise<void>;
}

const OK: LimitStatus = { limited: false, retryAfterSeconds: 0 };

const toStatus = (res: RateLimiterRes): LimitStatus => ({
  limited: true,
  retryAfterSeconds: Math.max(1, Math.ceil(res.msBeforeNext / 1000)),
});

export function createLimiter(policy: LimitPolicy): Limiter {
  const memory = new RateLimiterMemory({
    points: policy.points,
    duration: policy.durationSeconds,
    blockDuration: policy.blockSeconds,
  });

  const run = async (key: string, cost: number, blockWhenReached: boolean) => {
    try {
      const res = await memory.consume(key, cost);
      if (blockWhenReached && res.remainingPoints <= 0) {
        await memory.block(key, policy.blockSeconds);
        return { limited: true, retryAfterSeconds: policy.blockSeconds };
      }
      return OK;
    } catch (error) {
      if (error instanceof RateLimiterRes) return toStatus(error);
      throw error;
    }
  };

  return {
    consume: (key, cost = 1) => run(key, cost, false),
    fail: (key, cost = 1) => run(key, cost, true),
    async check(key) {
      const res = await memory.get(key);
      return res && res.remainingPoints <= 0 && res.msBeforeNext > 0 ? toStatus(res) : OK;
    },
    async reward(key, cost = 1) {
      await memory.reward(key, cost);
    },
    async reset(key) {
      await memory.delete(key);
    },
    async block(key, seconds) {
      await memory.block(key, seconds);
    },
  };
}

export type LimitedCode = 'RATE_LIMITED' | 'ACCOUNT_LOCKED';

/** Sets `Retry-After` on the response and builds the 429 error to throw or pass to `next`. */
export function limitedError(
  res: Response,
  retryAfterSeconds: number,
  code: LimitedCode = 'RATE_LIMITED',
): AppError {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return new AppError(
    code,
    code === 'ACCOUNT_LOCKED' ? 'Account temporarily locked' : 'Too many requests',
    { retryAfterSeconds },
  );
}

/** Throws the 429 error when `status.limited`. */
export function assertNotLimited(
  res: Response,
  status: LimitStatus,
  code: LimitedCode = 'RATE_LIMITED',
): void {
  if (status.limited) throw limitedError(res, status.retryAfterSeconds, code);
}

/** Middleware that consumes one point per request and answers 429 `RATE_LIMITED` with `Retry-After`. */
export function rateLimit(
  limiter: Limiter,
  key: (req: Request) => string,
  code: LimitedCode = 'RATE_LIMITED',
): RequestHandler {
  return (req, res, next) => {
    limiter.consume(key(req)).then((status) => {
      next(status.limited ? limitedError(res, status.retryAfterSeconds, code) : undefined);
    }, next);
  };
}
