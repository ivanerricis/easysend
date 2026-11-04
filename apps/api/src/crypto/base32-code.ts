import { randomInt } from 'node:crypto';

/** RFC 4648 base32 alphabet (no padding). */
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `length` uniformly random base32 characters, from the OS CSPRNG. */
export function randomBase32(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)];
  return out;
}

/** `ABCDEFGH` with groups of 4 becomes `ABCD-EFGH`. */
export function groupWithDashes(raw: string, groupLength: number): string {
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += groupLength) groups.push(raw.slice(i, i + groupLength));
  return groups.join('-');
}
