import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from '../src/auth/password.js';
import { AUTH_POLICY } from '../src/auth/policy.js';
import {
  findUnusedRecoveryCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../src/auth/recovery-codes.js';
import { generateTotpCode, generateTotpEnrollment, verifyTotp } from '../src/auth/totp.js';
import { FAST_ARGON2, TEST_SECRETS } from './helpers.js';
import { deriveKeys } from '../src/crypto/keys.js';

describe('policy', () => {
  it('matches the approved values', () => {
    expect(AUTH_POLICY.session).toMatchObject({
      idleSeconds: 7 * 86_400,
      absoluteSeconds: 30 * 86_400,
      mfaPendingSeconds: 600,
      lastSeenRefreshSeconds: 300,
    });
    expect(AUTH_POLICY.limits.loginAccount.points).toBe(5);
    expect(AUTH_POLICY.limits.loginIp.points).toBe(20);
    expect(AUTH_POLICY.argon2).toEqual({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    expect(AUTH_POLICY.welcomeTokenSeconds).toBe(72 * 3600);
  });
});

describe('password hashing', () => {
  const hasher = createPasswordHasher(FAST_ARGON2);

  it('hashes with argon2id and the configured parameters', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=8,t=1,p=1\$/);
    expect(await hasher.hash('correct horse battery')).not.toBe(hash);
  });

  it('verifies the right password only', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong password!!')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
  });

  it('runs a dummy verification without throwing', async () => {
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });

  it('defaults to the production parameters', async () => {
    const hash = await createPasswordHasher().hash('production password');
    expect(hash).toContain('m=19456,t=2,p=1');
  });
});

describe('TOTP', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 10);
  const { secret, otpauthUri } = generateTotpEnrollment({
    email: 'ada@example.com',
    issuer: 'My Box',
  });

  it('builds the provisioning URI with issuer and label', () => {
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/My%20Box:ada%40example\.com\?/);
    expect(otpauthUri).toContain('issuer=My%20Box');
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(generateTotpEnrollment({ email: 'a@b.c' }).otpauthUri).toContain('issuer=EasySend');
  });

  it('accepts the current code and returns its counter', () => {
    const result = verifyTotp({
      secret,
      code: generateTotpCode(secret, now),
      nowMs: now,
      lastCounter: null,
    });
    expect(result?.counter).toBe(Math.floor(now / 1000 / 30));
  });

  it('accepts one period of drift but not more', () => {
    const past = generateTotpCode(secret, now - 30_000);
    const future = generateTotpCode(secret, now + 30_000);
    const far = generateTotpCode(secret, now - 90_000);
    expect(verifyTotp({ secret, code: past, nowMs: now, lastCounter: null })).not.toBeNull();
    expect(verifyTotp({ secret, code: future, nowMs: now, lastCounter: null })).not.toBeNull();
    expect(verifyTotp({ secret, code: far, nowMs: now, lastCounter: null })).toBeNull();
  });

  it('rejects a replayed or older counter', () => {
    const code = generateTotpCode(secret, now);
    const first = verifyTotp({ secret, code, nowMs: now, lastCounter: null });
    expect(first).not.toBeNull();
    expect(verifyTotp({ secret, code, nowMs: now, lastCounter: first?.counter ?? 0 })).toBeNull();
    // An older (still in-window) code is also refused once a newer one was used.
    const older = generateTotpCode(secret, now - 30_000);
    expect(
      verifyTotp({ secret, code: older, nowMs: now, lastCounter: first?.counter ?? 0 }),
    ).toBeNull();
  });

  it('rejects wrong and malformed codes', () => {
    const good = generateTotpCode(secret, now);
    const wrong = good === '000000' ? '000001' : '000000';
    expect(verifyTotp({ secret, code: wrong, nowMs: now, lastCounter: null })).toBeNull();
    expect(verifyTotp({ secret, code: '12', nowMs: now, lastCounter: null })).toBeNull();
  });
});

describe('recovery codes', () => {
  const key = deriveKeys(TEST_SECRETS).recoveryCode;

  it('generates ten distinct codes as XXXX-XXXX-XXXX base32', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });

  it('ignores dashes, spaces and case', () => {
    expect(normalizeRecoveryCode(' abcd-efgh-2345 ')).toBe('ABCDEFGH2345');
    expect(hashRecoveryCode(key, 'abcd-efgh-2345')).toBe(hashRecoveryCode(key, 'ABCDEFGH2345'));
  });

  it('matches a stored unused code once', () => {
    const code = generateRecoveryCode();
    const rows = [
      { id: 'a', codeHash: hashRecoveryCode(key, generateRecoveryCode()), usedAt: null },
      { id: 'b', codeHash: hashRecoveryCode(key, code), usedAt: null },
    ];
    expect(findUnusedRecoveryCode(key, code.toLowerCase().replaceAll('-', ''), rows)?.id).toBe('b');
    // Once marked used it can no longer match.
    const used = rows.map((r) => (r.id === 'b' ? { ...r, usedAt: 123 } : r));
    expect(findUnusedRecoveryCode(key, code, used)).toBeUndefined();
    expect(findUnusedRecoveryCode(key, 'AAAA-AAAA-AAAA', rows)).toBeUndefined();
  });
});
