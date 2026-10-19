import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** HMAC-SHA-256 as base64url. */
export function hmacBase64url(key: Uint8Array, data: string | Uint8Array): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Constant-time string comparison. Different lengths return false without comparing content. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Random token (default 32 bytes) as base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
