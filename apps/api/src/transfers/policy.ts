import type { LimitPolicy } from '../auth/policy.js';

const MINUTE = 60;
const HOUR = 3600;

/** Rate limits and fixed durations of transfers and public downloads (phase 3 plan). */
export const TRANSFER_POLICY = {
  limits: {
    /** Creating a draft or resending the notification emails, per user. */
    transferCreate: { points: 30, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Every public download request (info, file, zip), per client IP. */
    download: { points: 600, durationSeconds: 10 * MINUTE, blockSeconds: 10 * MINUTE },
    /** Wrong link passwords, per `${token}:${ipHash}`. */
    downloadPasswordIp: { points: 10, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
    /** Wrong link passwords from anywhere, per token. */
    downloadPasswordToken: { points: 50, durationSeconds: HOUR, blockSeconds: HOUR },
  } satisfies Record<string, LimitPolicy>,
  /** Validity of the `es_dl` cookie that unlocks a password-protected link. */
  unlockCookieSeconds: HOUR,
  /** Validity of the `es_dlr` cookie that makes later Range requests of a counted download free. */
  resumeCookieSeconds: 24 * HOUR,
  /** Random bytes of a download token (43 base64url characters). */
  tokenBytes: 32,
} as const;
