import { describe, expect, it } from 'vitest';
import { BASE32_ALPHABET, groupWithDashes, randomBase32 } from '../src/crypto/base32-code.js';

describe('base32 codes', () => {
  it('generates only alphabet characters of the requested length', () => {
    const code = randomBase32(200);
    expect(code).toHaveLength(200);
    for (const char of code) expect(BASE32_ALPHABET).toContain(char);
  });

  it('groups with dashes', () => {
    expect(groupWithDashes('ABCDEFGHIJKL', 4)).toBe('ABCD-EFGH-IJKL');
    expect(groupWithDashes('ABCDEF', 4)).toBe('ABCD-EF');
  });
});
