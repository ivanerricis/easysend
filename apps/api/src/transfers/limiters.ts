import { createLimiter, type Limiter } from '../http/rate-limit.js';
import { TRANSFER_POLICY } from './policy.js';

/** Rate limiters of transfers and downloads, built per app instance from `TRANSFER_POLICY.limits`. */
export interface TransferLimiters {
  /** Draft creation and resend, key: user id. Use `consume`. */
  transferCreate: Limiter;
  /** Public download requests, key: client `ip_hash`. Use `consume`. */
  download: Limiter;
  /** Wrong link passwords, key: `${token}:${ipHash}`. Use `check` + `fail`. */
  downloadPasswordIp: Limiter;
  /** Wrong link passwords, key: token. Use `check` + `fail`. */
  downloadPasswordToken: Limiter;
  /** Upload request creation, key: user id. Use `consume`. */
  requestCreate: Limiter;
  /** Public upload request views, key: client `ip_hash`. Use `consume`. */
  requestView: Limiter;
  /** New submissions, key: client `ip_hash`. Use `consume`. */
  submissionCreateIp: Limiter;
  /** New submissions, key: upload request id. Use `consume`. */
  submissionCreateRequest: Limiter;
  /** Wrong request passwords, key: `${token}:${ipHash}`. Use `check` + `fail`. */
  requestPasswordIp: Limiter;
  /** Wrong request passwords, key: token. Use `check` + `fail`. */
  requestPasswordToken: Limiter;
  /** tus creations authorized by a submission token, key: client `ip_hash`. Use `consume`. */
  anonymousUploadCreate: Limiter;
}

export function createTransferLimiters(): TransferLimiters {
  const { limits } = TRANSFER_POLICY;
  return {
    transferCreate: createLimiter(limits.transferCreate),
    download: createLimiter(limits.download),
    downloadPasswordIp: createLimiter(limits.downloadPasswordIp),
    downloadPasswordToken: createLimiter(limits.downloadPasswordToken),
    requestCreate: createLimiter(limits.requestCreate),
    requestView: createLimiter(limits.requestView),
    submissionCreateIp: createLimiter(limits.submissionCreateIp),
    submissionCreateRequest: createLimiter(limits.submissionCreateRequest),
    requestPasswordIp: createLimiter(limits.requestPasswordIp),
    requestPasswordToken: createLimiter(limits.requestPasswordToken),
    anonymousUploadCreate: createLimiter(limits.anonymousUploadCreate),
  };
}
