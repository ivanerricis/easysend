import type { LimitPolicy } from '../auth/policy.js';

const MINUTE = 60;
const HOUR = 3600;

/** Rate limits and fixed durations of transfers and public downloads. */
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
    /** Creating upload requests, per user. */
    requestCreate: { points: 30, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Public view of an upload request, per client IP. */
    requestView: { points: 600, durationSeconds: 10 * MINUTE, blockSeconds: 10 * MINUTE },
    /** New submissions, per client IP. */
    submissionCreateIp: { points: 20, durationSeconds: HOUR, blockSeconds: HOUR },
    /** New submissions, per upload request. */
    submissionCreateRequest: { points: 100, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Wrong request passwords, per `${token}:${ipHash}`. */
    requestPasswordIp: { points: 10, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
    /** Wrong request passwords from anywhere, per token. */
    requestPasswordToken: { points: 50, durationSeconds: HOUR, blockSeconds: HOUR },
    /** tus upload creations authorized by a submission token (no session), per client IP. */
    anonymousUploadCreate: { points: 200, durationSeconds: HOUR, blockSeconds: HOUR },
  } satisfies Record<string, LimitPolicy>,
  /** Validity of the `es_dl` cookie that unlocks a password-protected link. */
  unlockCookieSeconds: HOUR,
  /** Validity of the `es_ru` cookie that unlocks a password-protected upload request. */
  requestUnlockCookieSeconds: HOUR,
  /** Validity of the `X-Submission-Token` handed out when a submission starts. */
  submissionTokenSeconds: 12 * HOUR,
  /** Validity of the `es_dlr` cookie that makes later Range requests of a counted download free. */
  resumeCookieSeconds: 24 * HOUR,
  /** Random bytes of a download token (43 base64url characters). */
  tokenBytes: 32,
} as const;
