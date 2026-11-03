import { groupWithDashes, randomBase32 } from '../crypto/base32-code.js';
import { hmacBase64url, timingSafeEqualStrings } from '../crypto/hash.js';
import { AUTH_POLICY } from './policy.js';

/** One code: 12 base32 characters (60 bits) as `XXXX-XXXX-XXXX`. */
export function generateRecoveryCode(): string {
  const { groups, groupLength } = AUTH_POLICY.recoveryCodes;
  return groupWithDashes(randomBase32(groups * groupLength), groupLength);
}

export function generateRecoveryCodes(count: number = AUTH_POLICY.recoveryCodes.count): string[] {
  return Array.from({ length: count }, generateRecoveryCode);
}

/** Dashes, spaces and case are ignored when a user types a code. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Value stored in `recovery_codes.code_hash`: HMAC of the normalized code. */
export function hashRecoveryCode(key: Uint8Array, input: string): string {
  return hmacBase64url(key, normalizeRecoveryCode(input));
}

export interface StoredRecoveryCode {
  id: string;
  codeHash: string;
  usedAt: number | null;
}

/**
 * Finds the unused stored code matching the input. Scans every row without early exit so timing
 * does not depend on the position. The caller marks the returned row as used (single use).
 */
export function findUnusedRecoveryCode<T extends StoredRecoveryCode>(
  key: Uint8Array,
  input: string,
  rows: readonly T[],
): T | undefined {
  const candidate = hashRecoveryCode(key, input);
  let match: T | undefined;
  for (const row of rows) {
    if (timingSafeEqualStrings(candidate, row.codeHash) && row.usedAt === null) match ??= row;
  }
  return match;
}
