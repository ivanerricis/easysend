import { createHash } from 'node:crypto';
import type { S3Config } from '@easysend/shared';
import type { Clock } from '../clock.js';

export const STORAGE_VERIFICATION_TTL_MS = 30 * 60 * 1000;

export interface StorageVerification {
  /** Records that a connection test passed with exactly this configuration (secret included). */
  remember(config: S3Config): void;
  /** True when the same configuration was verified less than 30 minutes ago. */
  isVerified(config: S3Config): boolean;
  clear(): void;
}

/** SHA-256 of the configuration as canonical JSON (sorted keys). Only the hash stays in memory. */
function fingerprint(config: S3Config): string {
  const entries = Object.entries(config).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/** In-memory, one slot: the wizard and the admin panel test one configuration at a time. */
export function createStorageVerification(clock: Clock): StorageVerification {
  let slot: { hash: string; at: number } | undefined;
  return {
    remember(config) {
      slot = { hash: fingerprint(config), at: clock() };
    },
    isVerified(config) {
      if (!slot) return false;
      if (clock() - slot.at >= STORAGE_VERIFICATION_TTL_MS) {
        slot = undefined;
        return false;
      }
      return slot.hash === fingerprint(config);
    },
    clear() {
      slot = undefined;
    },
  };
}
