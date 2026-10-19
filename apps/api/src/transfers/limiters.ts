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
}

export function createTransferLimiters(): TransferLimiters {
  const { limits } = TRANSFER_POLICY;
  return {
    transferCreate: createLimiter(limits.transferCreate),
    download: createLimiter(limits.download),
    downloadPasswordIp: createLimiter(limits.downloadPasswordIp),
    downloadPasswordToken: createLimiter(limits.downloadPasswordToken),
  };
}
