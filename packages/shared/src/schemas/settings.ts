import { z } from 'zod';
import {
  APP_MODES,
  AVAILABLE_FONTS,
  BRANDING_ASSET_KINDS,
  CHUNK_SIZE_MB,
  DEFAULT_FONT,
  FOOTER_MAX_LENGTH,
  INSTANCE_NAME_MAX_LENGTH,
  THEME_PREFERENCES,
} from '../constants.js';
import { emailSchema, unixSecondsSchema } from './common.js';
import { localeSchema } from './users.js';

// ---- Appearance --------------------------------------------------------------
/** Colour as `#rrggbb`. Contrast against the text colour is checked by the client (WCAG AA). */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Corner radius of components, in rem (0 = square corners). */
export const radiusSchema = z.number().min(0).max(2);

export const brandingAssetKindSchema = z.enum(BRANDING_ASSET_KINDS);
export const brandingAssetParamsSchema = z.object({ kind: brandingAssetKindSchema });

/** Appearance settings editable from the admin panel; also applied to the email templates. */
export const appearanceSchema = z.object({
  instanceName: z.string().trim().min(1).max(INSTANCE_NAME_MAX_LENGTH),
  /** Footer text of the public pages. Empty string hides the footer. */
  footer: z.string().max(FOOTER_MAX_LENGTH),
  primaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  radius: radiusSchema,
  font: z.enum(AVAILABLE_FONTS),
  /** Instance default; each user can override it in their profile. */
  defaultTheme: z.enum(THEME_PREFERENCES),
});
export type Appearance = z.infer<typeof appearanceSchema>;

/** Metadata of an uploaded branding image. `updatedAt` is used as cache-busting query (`?v=`). */
export const brandingAssetInfoSchema = z.object({ updatedAt: unixSecondsSchema });
export type BrandingAssetInfo = z.infer<typeof brandingAssetInfoSchema>;

/** Which branding images are set; `null` means the built-in default is used. */
export const brandingAssetsSchema = z.object({
  logoLight: brandingAssetInfoSchema.nullable(),
  logoDark: brandingAssetInfoSchema.nullable(),
  favicon: brandingAssetInfoSchema.nullable(),
  background: brandingAssetInfoSchema.nullable(),
});
export type BrandingAssets = z.infer<typeof brandingAssetsSchema>;

export const publicSettingsResponseSchema = z.object({
  setupCompleted: z.boolean(),
  appMode: z.enum(APP_MODES),
  defaultLocale: localeSchema,
  appearance: appearanceSchema,
  assets: brandingAssetsSchema,
});
export type PublicSettingsResponse = z.infer<typeof publicSettingsResponseSchema>;

export const uploadBrandingAssetResponseSchema = z.object({
  kind: brandingAssetKindSchema,
  updatedAt: unixSecondsSchema,
});
export type UploadBrandingAssetResponse = z.infer<typeof uploadBrandingAssetResponseSchema>;

// ---- General -----------------------------------------------------------------
const generalSettingsFields = {
  /** Free disk space (MB) never used by uploads. */
  diskReserveMb: z.number().int().min(0).max(10_485_760),
  /** tus chunk size in MB; capped by the Cloudflare 100 MB per request limit. */
  chunkSizeMb: z.number().int().min(1).max(CHUNK_SIZE_MB.max),
  defaultLocale: localeSchema,
};

export const generalSettingsSchema = z.object({
  ...generalSettingsFields,
  /** Once a day the server asks GitHub for the latest release (admin "update available" notice). */
  updateCheck: z.boolean().default(true),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

// Built from the plain fields: `.partial()` on the schema above would apply the default to a
// missing `updateCheck` and silently re-enable the check on every unrelated PATCH.
export const updateGeneralSettingsRequestSchema = z
  .object({ ...generalSettingsFields, updateCheck: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateGeneralSettingsRequest = z.infer<typeof updateGeneralSettingsRequestSchema>;

// ---- SMTP --------------------------------------------------------------------
export const SMTP_SECURITY = ['none', 'starttls', 'tls'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** SMTP configuration as sent by the client. The password is stored encrypted. */
export const smtpSettingsSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(SMTP_SECURITY),
  username: z.string().max(255).optional(),
  /** Omitted on update = keep the stored password. */
  password: z.string().max(1024).optional(),
  fromEmail: emailSchema,
  fromName: z.string().max(100).optional(),
});
export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;

/** SMTP configuration as returned by the server: the password is never sent back. */
export const smtpSettingsPublicSchema = smtpSettingsSchema.omit({ password: true }).extend({
  hasPassword: z.boolean(),
});
export type SmtpSettingsPublic = z.infer<typeof smtpSettingsPublicSchema>;

export const smtpTestResponseSchema = z.object({
  ok: z.literal(true),
  /** Address the test email was sent to (the current admin). */
  sentTo: emailSchema,
});
export type SmtpTestResponse = z.infer<typeof smtpTestResponseSchema>;

export const adminSettingsResponseSchema = z.object({
  general: generalSettingsSchema,
  smtp: smtpSettingsPublicSchema.nullable(),
});
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;

/** Appearance plus the branding images, returned after every appearance change. */
export const appearanceStateResponseSchema = z.object({
  appearance: appearanceSchema,
  assets: brandingAssetsSchema,
});
export type AppearanceStateResponse = z.infer<typeof appearanceStateResponseSchema>;

/** Appearance used until an admin saves one (also what "reset to default" restores). */
export const DEFAULT_APPEARANCE: Appearance = {
  instanceName: 'EasySend',
  footer: '',
  primaryColor: '#18181b',
  accentColor: '#047857',
  radius: 0,
  font: DEFAULT_FONT,
  defaultTheme: 'system',
};
