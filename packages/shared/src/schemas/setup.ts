import { z } from 'zod';
import { APP_MODES } from '../constants.js';
import { emailSchema } from './common.js';
import {
  displayNameSchema,
  recoveryCodeSchema,
  passwordSchema,
  totpCodeSchema,
  userSchema,
} from './users.js';
import { csrfTokenSchema } from './auth.js';
import { appearanceSchema, generalSettingsSchema, smtpSettingsPublicSchema } from './settings.js';

// ---- Status and setup code ---------------------------------------------------
export const setupStatusResponseSchema = z.object({
  setupCompleted: z.boolean(),
  appMode: z.enum(APP_MODES),
  /** The setup code was accepted for this browser (valid `es_setup` cookie). */
  codeVerified: z.boolean(),
  steps: z.object({
    admin: z.boolean(),
    smtp: z.boolean(),
    /** Always `true` in local mode, where the step is skipped. */
    cloudflare: z.boolean(),
    general: z.boolean(),
  }),
});
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const setupCodeRequestSchema = z.object({ code: z.string().min(1).max(64) });
export type SetupCodeRequest = z.infer<typeof setupCodeRequestSchema>;

// ---- Admin account -----------------------------------------------------------
export const setupAdminRequestSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema.optional(),
  password: passwordSchema,
});
export type SetupAdminRequest = z.infer<typeof setupAdminRequestSchema>;

export const setupAdminVerifyRequestSchema = z.object({ code: totpCodeSchema });
export type SetupAdminVerifyRequest = z.infer<typeof setupAdminVerifyRequestSchema>;

/** The admin exists after this step; recovery codes are shown only once. */
export const setupAdminVerifyResponseSchema = z.object({
  user: userSchema,
  csrfToken: csrfTokenSchema,
  recoveryCodes: z.array(recoveryCodeSchema),
});
export type SetupAdminVerifyResponse = z.infer<typeof setupAdminVerifyResponseSchema>;

// ---- SMTP --------------------------------------------------------------------
/** Suggested SMTP values (Mailpit in local mode) and whether a test already succeeded. */
export const setupSmtpResponseSchema = z.object({
  smtp: smtpSettingsPublicSchema,
  verified: z.boolean(),
});
export type SetupSmtpResponse = z.infer<typeof setupSmtpResponseSchema>;

// ---- Cloudflare --------------------------------------------------------------
/** Fully qualified domain name managed by Cloudflare, without scheme or path. */
export const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?=.{3,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/);

export const subdomainSchema = z.string().regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/);

/** The API token is used for this request only and is never stored or logged. */
export const cloudflareRequestSchema = z.object({
  domain: domainSchema,
  subdomain: subdomainSchema.optional(),
  apiToken: z.string().min(20).max(256),
});
export type CloudflareRequest = z.infer<typeof cloudflareRequestSchema>;

export const cloudflareResponseSchema = z.object({
  hostname: z.string(),
  publicUrl: z.string(),
  tunnelId: z.string(),
});
export type CloudflareResponse = z.infer<typeof cloudflareResponseSchema>;

// ---- General -----------------------------------------------------------------
export const setupGeneralRequestSchema = generalSettingsSchema.extend({
  instanceName: appearanceSchema.shape.instanceName,
  defaultTheme: appearanceSchema.shape.defaultTheme,
});
export type SetupGeneralRequest = z.infer<typeof setupGeneralRequestSchema>;
