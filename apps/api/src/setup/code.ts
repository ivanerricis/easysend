import type { Clock } from '../clock.js';
import { groupWithDashes, randomBase32 } from '../crypto/base32-code.js';
import { sha256Hex, timingSafeEqualStrings } from '../crypto/hash.js';
import type { Logger } from '../logger.js';
import { SETUP_POLICY } from './policy.js';

export type SetupCodeResult = 'ok' | 'invalid' | 'expired';

/**
 * One-time code printed in the API logs that authorises the first-run wizard. Only the hash lives
 * in memory; there is at most one valid code, it is single use and dies at restart.
 */
export interface SetupCodeService {
  /** New code (replaces any previous one), returned as `XXXX-XXXX-XXXX`. */
  issue(): string;
  /** Checks a typed code. `ok` consumes it. `expired` also issues and logs a fresh code. */
  verify(input: string): SetupCodeResult;
}

const normalize = (input: string): string => input.toUpperCase().replace(/[\s-]/g, '');

export function createSetupCodeService(deps: {
  clock: Clock;
  ttlMinutes: number;
  logger: Logger;
}): SetupCodeService {
  const { clock, ttlMinutes, logger } = deps;
  let current: { hash: string; expiresAtMs: number } | null = null;

  const issue = (): string => {
    const raw = randomBase32(SETUP_POLICY.setupCodeLength);
    current = { hash: sha256Hex(raw), expiresAtMs: clock() + ttlMinutes * 60_000 };
    return groupWithDashes(raw, 4);
  };

  return {
    issue,
    verify(input) {
      if (!current) return 'invalid';
      if (clock() >= current.expiresAtMs) {
        const code = issue();
        logger.warn(
          `Setup code: ${code} (valid ${ttlMinutes} minutes). The previous one expired. Open the app to start the setup wizard.`,
        );
        return 'expired';
      }
      if (!timingSafeEqualStrings(sha256Hex(normalize(input)), current.hash)) return 'invalid';
      current = null;
      return 'ok';
    },
  };
}
