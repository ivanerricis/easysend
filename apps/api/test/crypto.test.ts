import { describe, expect, it } from 'vitest';
import { DecryptError, decryptSecret, encryptSecret } from '../src/crypto/aead.js';
import {
  hmacBase64url,
  randomToken,
  sha256Hex,
  timingSafeEqualStrings,
} from '../src/crypto/hash.js';
import {
  APP_KEY_PURPOSES,
  SESSION_KEY_PURPOSES,
  deriveKey,
  deriveKeys,
  keyLabel,
} from '../src/crypto/keys.js';
import { TEST_SECRETS } from './helpers.js';

describe('key derivation', () => {
  it('is deterministic and 32 bytes long', () => {
    const a = deriveKey(TEST_SECRETS.appSecretKey, 'totp');
    const b = deriveKey(TEST_SECRETS.appSecretKey, 'totp');
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it('separates purposes and master keys', () => {
    const all = [
      ...APP_KEY_PURPOSES.map((p) => deriveKey(TEST_SECRETS.appSecretKey, p).toString('hex')),
      ...SESSION_KEY_PURPOSES.map((p) => deriveKey(TEST_SECRETS.sessionSecret, p).toString('hex')),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(
      deriveKey(TEST_SECRETS.appSecretKey, 'totp').equals(
        deriveKey(TEST_SECRETS.sessionSecret, 'totp'),
      ),
    ).toBe(false);
  });

  it('uses versioned labels and never returns a master key', () => {
    expect(keyLabel('totp')).toBe('easysend/v1/totp');
    const keys = deriveKeys(TEST_SECRETS);
    for (const key of Object.values(keys) as Buffer[]) {
      expect(key.equals(TEST_SECRETS.appSecretKey)).toBe(false);
      expect(key.equals(TEST_SECRETS.sessionSecret)).toBe(false);
    }
  });
});

describe('AES-256-GCM secrets', () => {
  const key = deriveKey(TEST_SECRETS.appSecretKey, 'totp');

  it('round-trips and uses the documented format', () => {
    const payload = encryptSecret(key, 'totp', 'JBSWY3DPEHPK3PXP');
    expect(payload).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(key, 'totp', payload)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh nonce every time', () => {
    expect(encryptSecret(key, 'totp', 'x')).not.toBe(encryptSecret(key, 'totp', 'x'));
  });

  it('detects tampering in every part', () => {
    const [v, nonce, tag, data] = encryptSecret(key, 'totp', 'secret value').split(':') as [
      string,
      string,
      string,
      string,
    ];
    const flip = (s: string) => (s.startsWith('A') ? `B${s.slice(1)}` : `A${s.slice(1)}`);
    for (const broken of [
      [v, flip(nonce), tag, data],
      [v, nonce, flip(tag), data],
      [v, nonce, tag, flip(data)],
      ['v2', nonce, tag, data],
      [v, nonce, tag],
    ]) {
      expect(() => decryptSecret(key, 'totp', broken.join(':'))).toThrow(DecryptError);
    }
  });

  it('fails with the wrong purpose or the wrong key', () => {
    const payload = encryptSecret(key, 'totp', 'x');
    expect(() => decryptSecret(key, 'smtp', payload)).toThrow(DecryptError);
    expect(() =>
      decryptSecret(deriveKey(TEST_SECRETS.appSecretKey, 'smtp'), 'totp', payload),
    ).toThrow(DecryptError);
  });
});

describe('hash helpers', () => {
  it('computes sha256 hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('computes keyed HMACs that depend on key and data', () => {
    const k1 = Buffer.alloc(32, 1);
    const k2 = Buffer.alloc(32, 2);
    expect(hmacBase64url(k1, 'a')).toBe(hmacBase64url(k1, 'a'));
    expect(hmacBase64url(k1, 'a')).not.toBe(hmacBase64url(k2, 'a'));
    expect(hmacBase64url(k1, 'a')).not.toBe(hmacBase64url(k1, 'b'));
  });

  it('compares in constant time semantics', () => {
    expect(timingSafeEqualStrings('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStrings('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStrings('abc', 'abcd')).toBe(false);
  });

  it('generates url-safe random tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });
});
