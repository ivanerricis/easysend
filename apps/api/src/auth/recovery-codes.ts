import { randomBytes } from 'node:crypto';
import { hmacBase64url, timingSafeEqualStrings } from '../crypto/hash.js';
import { AUTH_POLICY } from './policy.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32

/** One code: 12 base32 characters (60 bits) as `XXXX-XXXX-XXXX`. */
export function generateRecoveryCode(): string {
  const { groups, groupLength } = AUTH_POLICY.recoveryCodes;
  const length = groups * groupLength;
  const bytes = randomBytes(length);
  let chars = '';
  for (let i = 0; i < length; i++) chars += ALPHABET[(bytes[i] as number) & 31];
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) parts.push(chars.slice(g * groupLength, (g + 1) * groupLength));
  return parts.join('-');
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
