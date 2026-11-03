import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it('uses binary units with the locale decimal separator', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1024, 'en')).toBe('1 KiB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KiB');
    expect(formatBytes(1536, 'it')).toBe('1,5 KiB');
    expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GiB');
    expect(formatBytes(250 * 1024 ** 2, 'en')).toBe('250 MiB');
  });

  it('returns a dash for invalid values', () => {
    expect(formatBytes(-1, 'en')).toBe('—');
    expect(formatBytes(Number.NaN, 'en')).toBe('—');
  });
});
