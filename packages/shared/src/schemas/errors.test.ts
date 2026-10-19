import { describe, expect, it } from 'vitest';
import { ERROR_CODES, errorResponseSchema, httpStatusFor } from './errors.js';
import { healthResponseSchema } from './health.js';

describe('error schema', () => {
  it('maps every code to a 4xx or 5xx status', () => {
    for (const status of Object.values(ERROR_CODES)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('resolves the status of a code', () => {
    expect(httpStatusFor('QUOTA_EXCEEDED')).toBe(413);
    expect(httpStatusFor('INSUFFICIENT_DISK_SPACE')).toBe(507);
    expect(httpStatusFor('TRANSFER_EXPIRED')).toBe(410);
  });

  it('accepts a valid error body and rejects an unknown code', () => {
    const ok = { error: { code: 'TRANSFER_NOT_FOUND', message: 'Not found', requestId: 'abc' } };
    expect(errorResponseSchema.safeParse(ok).success).toBe(true);
    const bad = { error: { code: 'NOPE', message: 'x', requestId: 'abc' } };
    expect(errorResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('health schema', () => {
  it('parses a valid health response', () => {
    const res = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      mode: 'local',
      db: 'ok',
    });
    expect(res.success).toBe(true);
  });
});
