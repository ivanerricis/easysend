import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatSpeed,
} from './format';

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1023, 'en')).toBe('1,023 B');
    expect(formatBytes(1024, 'en')).toBe('1 KiB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KiB');
    expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GiB');
    expect(formatBytes(250 * 1024 ** 2, 'en')).toBe('250 MiB');
  });
  it('follows the locale decimal separator', () => {
    expect(formatBytes(1536, 'it')).toBe('1,5 KiB');
  });
  it('handles invalid input', () => {
    expect(formatBytes(-1, 'en')).toBe('—');
    expect(formatBytes(Number.NaN, 'en')).toBe('—');
  });
});

describe('dates', () => {
  const ts = Date.UTC(2026, 0, 15, 12, 0) / 1000;
  it('formats dates and date-times', () => {
    expect(formatDate(ts, 'en')).toContain('2026');
    expect(formatDateTime(ts, 'en')).toContain('2026');
    expect(formatDateTime(ts, 'it')).toContain('2026');
  });
  it('formats relative times in both directions', () => {
    const now = 1_000_000;
    expect(formatRelative(now + 3 * 86_400, 'en', now)).toBe('in 3 days');
    expect(formatRelative(now - 2 * 3_600, 'en', now)).toBe('2 hours ago');
    expect(formatRelative(now + 3 * 86_400, 'it', now)).toBe('tra 3 giorni');
  });
});

describe('formatDuration / formatSpeed', () => {
  it('formats durations', () => {
    expect(formatDuration(45, 'en')).toBe('45 s');
    expect(formatDuration(200, 'en')).toBe('3 min 20 s');
    expect(formatDuration(7500, 'en')).toBe('2 h 05 min');
    expect(formatDuration(-1, 'en')).toBe('—');
  });
  it('formats speeds', () => {
    expect(formatSpeed(12.4 * 1024 * 1024, 'en')).toBe('12.4 MiB/s');
  });
});
