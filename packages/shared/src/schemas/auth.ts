import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../constants.js';
import { emailSchema } from './common.js';
import {
  passwordSchema,
  recoveryCodeSchema,
  totpCodeSchema,
  twoFactorSetupResponseSchema,
  userSchema,
} from './users.js';

export const csrfTokenSchema = z.string().min(16).max(256);

export const csrfResponseSchema = z.object({ csrfToken: csrfTokenSchema });
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    user: userSchema,
    csrfToken: csrfTokenSchema,
  }),
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * - `ok`: fully authenticated session.
 * - `mfa_required`: password accepted, an `mfa-pending` session is open; send a TOTP or recovery code.
 * - `mfa_setup_required`: password accepted but 2FA must be enrolled first (admin whose 2FA was reset).
 */
export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), user: userSchema, csrfToken: csrfTokenSchema }),
  z.object({ status: z.literal('mfa_required') }),
  z.object({ status: z.literal('mfa_setup_required') }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const login2faRequestSchema = z.object({ code: totpCodeSchema });
export type Login2faRequest = z.infer<typeof login2faRequestSchema>;

export const loginRecoveryRequestSchema = z.object({ recoveryCode: recoveryCodeSchema });
export type LoginRecoveryRequest = z.infer<typeof loginRecoveryRequestSchema>;

/** Completed login after the second factor. */
export const loginCompletedResponseSchema = z.object({
  user: userSchema,
  csrfToken: csrfTokenSchema,
  /** Recovery codes still unused, set only when a recovery code was just used. */
  recoveryCodesLeft: z.number().int().nonnegative().optional(),
});
export type LoginCompletedResponse = z.infer<typeof loginCompletedResponseSchema>;

/** Forced 2FA enrolment during login (`mfa_setup_required`). */
export const loginEnrollSetupResponseSchema = twoFactorSetupResponseSchema;

export const loginEnrollVerifyResponseSchema = z.object({
  user: userSchema,
  csrfToken: csrfTokenSchema,
  recoveryCodes: z.array(recoveryCodeSchema),
});
export type LoginEnrollVerifyResponse = z.infer<typeof loginEnrollVerifyResponseSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: passwordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;
