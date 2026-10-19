import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { keyLabel, type KeyPurpose } from './keys.js';

const VERSION = 'v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown when a payload is malformed, tampered with, or opened with the wrong key or purpose. */
export class DecryptError extends Error {
  constructor() {
    super('Unable to decrypt value');
    this.name = 'DecryptError';
  }
}

/**
 * AES-256-GCM for short secrets (TOTP secrets, SMTP password). Output format
 * `v1:<nonce>:<tag>:<ciphertext>` (base64url). The purpose label is bound as AAD, so a value
 * encrypted for one purpose cannot be decrypted as another even if the key were reused.
 */
export function encryptSecret(key: Uint8Array, purpose: KeyPurpose, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(keyLabel(purpose)));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(key: Uint8Array, purpose: KeyPurpose, payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptError();
  const [, nonceText, tagText, ciphertextText] = parts as [string, string, string, string];
  try {
    const nonce = Buffer.from(nonceText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new DecryptError();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(keyLabel(purpose)));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptError();
  }
}
