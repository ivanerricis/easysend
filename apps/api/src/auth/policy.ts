import { RECOVERY_CODES_COUNT, TOTP_CODE_LENGTH } from '@easysend/shared';

/** A rate limit: `points` events per `durationSeconds`, then blocked for `blockSeconds`. */
export interface LimitPolicy {
  points: number;
  durationSeconds: number;
  blockSeconds: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** Every duration and threshold of the authentication layer (phase 2 plan, decision 8). */
export const AUTH_POLICY = {
  session: {
    /** A full session expires after 7 days without activity... */
    idleSeconds: 7 * DAY,
    /** ...and in any case 30 days after it was created. */
    absoluteSeconds: 30 * DAY,
    /** Password accepted, second factor missing. */
    mfaPendingSeconds: 10 * MINUTE,
    /** `last_seen_at` and the idle expiry move forward at most this often. */
    lastSeenRefreshSeconds: 5 * MINUTE,
    userAgentMaxLength: 255,
  },
  /** Lifetime of the pre-login CSRF cookie. */
  csrfCookieSeconds: DAY,
  limits: {
    /** Failed logins (password or second factor) per account. */
    loginAccount: { points: 5, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
    /** Failed logins per client IP. */
    loginIp: { points: 20, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
    resetRequestIp: { points: 5, durationSeconds: HOUR, blockSeconds: HOUR },
    resetRequestEmail: { points: 3, durationSeconds: HOUR, blockSeconds: HOUR },
    resetConfirmIp: { points: 10, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Wrong password or code when re-authenticating a sensitive operation, per user. */
    reauth: { points: 5, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
  } satisfies Record<string, LimitPolicy>,
  /** Validity of the link sent to a user created by an admin without a password. */
  welcomeTokenSeconds: 72 * HOUR,
  /** Argon2id, the OWASP minimum recommendation (19 MiB, 2 passes, 1 lane). */
  argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 },
  totp: { digits: TOTP_CODE_LENGTH, periodSeconds: 30, window: 1, defaultIssuer: 'EasySend' },
  recoveryCodes: { count: RECOVERY_CODES_COUNT, groups: 3, groupLength: 4 },
} as const;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}
