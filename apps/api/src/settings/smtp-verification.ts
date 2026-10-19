import { createHash } from 'node:crypto';
import type { SmtpSettings } from '@easysend/shared';
import type { Clock } from '../clock.js';

export const SMTP_VERIFICATION_TTL_MS = 30 * 60 * 1000;

export interface SmtpVerification {
  /** Records that a test email went out with exactly these settings (password included). */
  remember(settings: SmtpSettings): void;
  /** True when the same settings were verified less than 30 minutes ago. */
  isVerified(settings: SmtpSettings): boolean;
  clear(): void;
}

/** SHA-256 of the settings as canonical JSON (sorted keys, undefined omitted). */
function fingerprint(settings: SmtpSettings): string {
  const entries = Object.entries(settings)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/** In-memory, one slot: the wizard and the admin panel test one configuration at a time. */
export function createSmtpVerification(clock: Clock): SmtpVerification {
  let slot: { hash: string; at: number } | undefined;
  return {
    remember(settings) {
      slot = { hash: fingerprint(settings), at: clock() };
    },
    isVerified(settings) {
      if (!slot) return false;
      if (clock() - slot.at >= SMTP_VERIFICATION_TTL_MS) {
        slot = undefined;
        return false;
      }
      return slot.hash === fingerprint(settings);
    },
    clear() {
      slot = undefined;
    },
  };
}
