import { z } from 'zod';
import {
  CHUNK_SIZE_MB,
  EXPIRY_KEYS,
  EXPIRY_OPTIONS,
  FILENAME_MAX_LENGTH,
  LOCALES,
  MAX_DOWNLOADS_LIMIT,
  MAX_FILES_PER_TRANSFER,
  MAX_RECIPIENTS,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  THEME_PREFERENCES,
  TITLE_MAX_LENGTH,
  USER_ROLES,
} from '../constants.js';
import {
  byteSizeSchema,
  emailSchema,
  idSchema,
  paginatedSchema,
  paginationQuerySchema,
  unixSecondsSchema,
} from './common.js';

// ---- Shared building blocks -------------------------------------------------
export const userRoleSchema = z.enum(USER_ROLES);
export const localeSchema = z.enum(LOCALES);
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);

/** New password: length bounds only (no composition rules). */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Six-digit TOTP code. */
export const totpCodeSchema = z.string().regex(/^[0-9]{6}$/);

/** One-time recovery code as shown to the user (the server ignores dashes and case). */
export const recoveryCodeSchema = z.string().min(8).max(32);

/** Public representation of a user, as seen by the user themselves. */
export const userSchema = z.object({
  id: idSchema,
  email: emailSchema,
  role: z.enum(USER_ROLES),
  locale: localeSchema,
  themePreference: themePreferenceSchema.nullable(),
  totpEnabled: z.boolean(),
  createdAt: unixSecondsSchema,
  lastLoginAt: unixSecondsSchema.nullable(),
});
export type User = z.infer<typeof userSchema>;

// ---- /me ---------------------------------------------------------------------
export const meResponseSchema = z.object({
  user: userSchema,
  usedBytes: byteSizeSchema,
  /** `null` means no quota: only the free disk space limits uploads. */
  quotaBytes: byteSizeSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeRequestSchema = z
  .object({
    locale: localeSchema.optional(),
    /** `null` clears the personal override and falls back to the instance default. */
    themePreference: themePreferenceSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Re-authentication for sensitive 2FA operations. */
export const reauthRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

/** Pending TOTP enrolment: the secret is also shown as text next to the QR code. */
export const twoFactorSetupResponseSchema = z.object({
  secret: z.string().min(16).max(128),
  otpauthUri: z.string().max(512),
});
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponseSchema>;

export const twoFactorEnableRequestSchema = z.object({ code: totpCodeSchema });
export type TwoFactorEnableRequest = z.infer<typeof twoFactorEnableRequestSchema>;

export const recoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(recoveryCodeSchema),
});
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;

/** Client configuration: limits and options the upload form needs. */
export const configResponseSchema = z.object({
  chunkSizeBytes: z.number().int().min(1),
  maxChunkSizeBytes: z.number().int().min(1),
  expiryOptions: z.array(z.object({ key: z.enum(EXPIRY_KEYS), seconds: z.number().int().min(1) })),
  limits: z.object({
    maxRecipients: z.number().int(),
    maxFilesPerTransfer: z.number().int(),
    maxTitleLength: z.number().int(),
    maxMessageLength: z.number().int(),
    maxFilenameLength: z.number().int(),
    maxDownloadsLimit: z.number().int(),
    passwordMinLength: z.number().int(),
  }),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;

/** Values for the static parts of `GET /api/config`, taken from the shared constants. */
export const staticConfig = {
  maxChunkSizeBytes: CHUNK_SIZE_MB.max * 1024 * 1024,
  expiryOptions: EXPIRY_KEYS.map((key) => ({ key, seconds: EXPIRY_OPTIONS[key] })),
  limits: {
    maxRecipients: MAX_RECIPIENTS,
    maxFilesPerTransfer: MAX_FILES_PER_TRANSFER,
    maxTitleLength: TITLE_MAX_LENGTH,
    maxMessageLength: MESSAGE_MAX_LENGTH,
    maxFilenameLength: FILENAME_MAX_LENGTH,
    maxDownloadsLimit: MAX_DOWNLOADS_LIMIT,
    passwordMinLength: PASSWORD_MIN_LENGTH,
  },
} as const;

// ---- Admin: users --------------------------------------------------------------
export const adminUserSchema = userSchema.extend({
  disabled: z.boolean(),
  usedBytes: byteSizeSchema,
  quotaBytes: byteSizeSchema.nullable(),
  transferCount: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listUsersResponseSchema = paginatedSchema(adminUserSchema);
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

export const createUserRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(USER_ROLES).default('user'),
  /** When omitted, the user receives a welcome email with a link to set their password. */
  password: passwordSchema.optional(),
  locale: localeSchema.optional(),
  quotaBytes: byteSizeSchema.nullable().optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    /** `null` removes the quota. */
    quotaBytes: byteSizeSchema.nullable().optional(),
    disabled: z.boolean().optional(),
    locale: localeSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const deleteUserQuerySchema = z
  .object({
    /** What happens to the transfers owned by the deleted user. */
    transfers: z.enum(['delete', 'reassign']),
    /** Required when `transfers=reassign`: id of the receiving user. */
    reassignTo: idSchema.optional(),
  })
  .refine((v) => v.transfers !== 'reassign' || v.reassignTo !== undefined, {
    message: 'reassignTo is required when transfers=reassign',
    path: ['reassignTo'],
  });
export type DeleteUserQuery = z.infer<typeof deleteUserQuerySchema>;
