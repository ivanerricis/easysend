import { Secret, TOTP } from 'otpauth';
import { AUTH_POLICY } from './policy.js';

const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation

function build(secretBase32: string, label: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: AUTH_POLICY.totp.digits,
    period: AUTH_POLICY.totp.periodSeconds,
    secret: Secret.fromBase32(secretBase32),
  });
}

export interface TotpEnrollment {
  /** Base32 secret, shown to the user as text next to the QR code. */
  secret: string;
  /** `otpauth://` URI the client turns into a QR code. */
  otpauthUri: string;
}

/** New random secret plus the provisioning URI (issuer = instance name, label = email). */
export function generateTotpEnrollment(options: {
  email: string;
  issuer?: string | undefined;
}): TotpEnrollment {
  const secret = new Secret({ size: SECRET_BYTES }).base32;
  const issuer = options.issuer?.trim() || AUTH_POLICY.totp.defaultIssuer;
  return { secret, otpauthUri: build(secret, options.email, issuer).toString() };
}

export interface TotpVerification {
  /** Time-step counter that matched. Store it as `totp_last_counter`. */
  counter: number;
}

/**
 * Checks a code with a window of +-1 period. A counter at or below `lastCounter` is rejected
 * (replay: a code can be used once). Returns the matched counter, or null.
 */
export function verifyTotp(options: {
  secret: string;
  code: string;
  nowMs: number;
  lastCounter: number | null;
}): TotpVerification | null {
  const totp = build(options.secret, 'user', AUTH_POLICY.totp.defaultIssuer);
  const delta = totp.validate({
    token: options.code,
    timestamp: options.nowMs,
    window: AUTH_POLICY.totp.window,
  });
  if (delta === null) return null;
  const counter = Math.floor(options.nowMs / 1000 / AUTH_POLICY.totp.periodSeconds) + delta;
  if (options.lastCounter !== null && counter <= options.lastCounter) return null;
  return { counter };
}

/** Code valid at `nowMs`. Used by tests to play the role of the authenticator app. */
export function generateTotpCode(secret: string, nowMs: number): string {
  return build(secret, 'user', AUTH_POLICY.totp.defaultIssuer).generate({ timestamp: nowMs });
}
