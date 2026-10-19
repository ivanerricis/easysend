import { hkdfSync } from 'node:crypto';
import type { Secrets } from '../secrets.js';

/** Purposes of the keys derived from `APP_SECRET_KEY`: encryption keys re-wrapped by the master key rotation CLI. */
export const APP_KEY_PURPOSES = ['totp', 'smtp', 'file'] as const;
/**
 * Purposes of the keys derived from `SESSION_SECRET`: signatures and keyed hashes. Recovery codes
 * live here because their HMACs cannot be re-keyed when the master key is rotated (SPEC 4).
 */
export const SESSION_KEY_PURPOSES = [
  'csrf',
  'ip-hash',
  'download-cookie',
  'setup-cookie',
  'recovery-code',
] as const;

export type AppKeyPurpose = (typeof APP_KEY_PURPOSES)[number];
export type SessionKeyPurpose = (typeof SESSION_KEY_PURPOSES)[number];
export type KeyPurpose = AppKeyPurpose | SessionKeyPurpose;

/** Versioned HKDF `info` label, also used as AAD by the AEAD helpers. */
export const keyLabel = (purpose: KeyPurpose): string => `easysend/v1/${purpose}`;

const KEY_BYTES = 32;

/** HKDF-SHA256 with an empty salt: the master keys already are uniformly random 32-byte values. */
export function deriveKey(master: Uint8Array, purpose: KeyPurpose): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), keyLabel(purpose), KEY_BYTES));
}

export interface DerivedKeys {
  totp: Buffer;
  smtp: Buffer;
  /** Master key that wraps the per-file data keys (used from phase 3). */
  file: Buffer;
  /** HMAC key for the stored hashes of recovery codes. */
  recoveryCode: Buffer;
  csrf: Buffer;
  ipHash: Buffer;
  downloadCookie: Buffer;
  setupCookie: Buffer;
}

export function deriveKeys(secrets: Secrets): DerivedKeys {
  const app = (purpose: AppKeyPurpose) => deriveKey(secrets.appSecretKey, purpose);
  const session = (purpose: SessionKeyPurpose) => deriveKey(secrets.sessionSecret, purpose);
  return {
    totp: app('totp'),
    smtp: app('smtp'),
    file: app('file'),
    recoveryCode: session('recovery-code'),
    csrf: session('csrf'),
    ipHash: session('ip-hash'),
    downloadCookie: session('download-cookie'),
    setupCookie: session('setup-cookie'),
  };
}
