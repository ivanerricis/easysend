import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_FONTS,
  CHUNK_SIZE_MB,
  DEFAULT_FONT,
  EXPIRY_KEYS,
  EXPIRY_OPTIONS,
  NEVER_EXPIRES_AT,
  PASSWORD_MIN_LENGTH,
  expiresAtFor,
  publicExpiresAt,
} from './constants.js';

describe('constants', () => {
  it('has an expiry duration for every expiry key', () => {
    for (const key of EXPIRY_KEYS) {
      if (key === 'never') continue;
      expect(EXPIRY_OPTIONS[key]).toBeGreaterThan(0);
    }
    expect(EXPIRY_OPTIONS['3d']).toBe(3 * 24 * 3600);
  });

  it('stores "never" as a far-future timestamp and reports it as null', () => {
    expect(expiresAtFor(1_000, '1w')).toBe(1_000 + 604_800);
    expect(expiresAtFor(1_000, 'never')).toBe(NEVER_EXPIRES_AT);
    expect(publicExpiresAt(NEVER_EXPIRES_AT)).toBeNull();
    expect(publicExpiresAt(1_000)).toBe(1_000);
  });

  it('keeps the default chunk size within the maximum', () => {
    expect(CHUNK_SIZE_MB.default).toBeLessThanOrEqual(CHUNK_SIZE_MB.max);
    expect(CHUNK_SIZE_MB.max).toBeLessThanOrEqual(50);
  });

  it('uses Plus Jakarta Sans as the default font', () => {
    expect(DEFAULT_FONT).toBe('plus-jakarta-sans');
    expect(AVAILABLE_FONTS[0]).toBe(DEFAULT_FONT);
  });

  it('requires a long enough password', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
