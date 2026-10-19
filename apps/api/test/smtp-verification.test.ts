import { describe, expect, it } from 'vitest';
import type { SmtpSettings } from '@easysend/shared';
import {
  SMTP_VERIFICATION_TTL_MS,
  createSmtpVerification,
} from '../src/settings/smtp-verification.js';
import { createTestClock } from './helpers.js';

const SMTP: SmtpSettings = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'user',
  password: 'secret',
  fromEmail: 'no-reply@example.com',
};

describe('smtp verification', () => {
  it('recognises the same settings, whatever the key order or undefined fields', () => {
    const v = createSmtpVerification(createTestClock());
    expect(v.isVerified(SMTP)).toBe(false);
    v.remember(SMTP);
    expect(v.isVerified(SMTP)).toBe(true);
    const reordered: SmtpSettings = {
      fromEmail: SMTP.fromEmail,
      password: 'secret',
      security: 'starttls',
      port: 587,
      host: SMTP.host,
      username: 'user',
      fromName: undefined,
    };
    expect(v.isVerified(reordered)).toBe(true);
  });

  it('treats any change, the password included, as unverified', () => {
    const v = createSmtpVerification(createTestClock());
    v.remember(SMTP);
    expect(v.isVerified({ ...SMTP, password: 'other' })).toBe(false);
    expect(v.isVerified({ ...SMTP, port: 25 })).toBe(false);
    expect(v.isVerified({ ...SMTP, fromName: 'X' })).toBe(false);
  });

  it('expires after 30 minutes and can be cleared', () => {
    const clock = createTestClock();
    const v = createSmtpVerification(clock);
    v.remember(SMTP);
    clock.advance(SMTP_VERIFICATION_TTL_MS / 1000 - 1);
    expect(v.isVerified(SMTP)).toBe(true);
    clock.advance(1);
    expect(v.isVerified(SMTP)).toBe(false);

    v.remember(SMTP);
    v.clear();
    expect(v.isVerified(SMTP)).toBe(false);
  });

  it('keeps one slot: a new verification replaces the old one', () => {
    const v = createSmtpVerification(createTestClock());
    v.remember(SMTP);
    v.remember({ ...SMTP, port: 25 });
    expect(v.isVerified(SMTP)).toBe(false);
    expect(v.isVerified({ ...SMTP, port: 25 })).toBe(true);
  });
});
