import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_FONTS,
  CHUNK_SIZE_MB,
  DEFAULT_FONT,
  EXPIRY_KEYS,
  EXPIRY_OPTIONS,
  PASSWORD_MIN_LENGTH,
} from './constants.js';

describe('constants', () => {
  it('has an expiry duration for every expiry key', () => {
    for (const key of EXPIRY_KEYS) {
      expect(EXPIRY_OPTIONS[key]).toBeGreaterThan(0);
    }
    expect(EXPIRY_OPTIONS['3d']).toBe(3 * 24 * 3600);
  });

  it('keeps the default chunk size within the maximum', () => {
    expect(CHUNK_SIZE_MB.default).toBeLessThanOrEqual(CHUNK_SIZE_MB.max);
    expect(CHUNK_SIZE_MB.max).toBeLessThanOrEqual(50);
  });

  it('uses IBM Plex Sans as the default font', () => {
    expect(DEFAULT_FONT).toBe('ibm-plex-sans');
    expect(AVAILABLE_FONTS[0]).toBe(DEFAULT_FONT);
  });

  it('requires a long enough password', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
