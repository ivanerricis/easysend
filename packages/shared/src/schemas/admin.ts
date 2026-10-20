import { z } from 'zod';
import { APP_MODES } from '../constants.js';
import { byteSizeSchema, emailSchema, idSchema, unixSecondsSchema } from './common.js';

export const storageResponseSchema = z.object({
  disk: z.object({
    totalBytes: byteSizeSchema,
    freeBytes: byteSizeSchema,
    /** Configured reserve that uploads never use. */
    reserveBytes: byteSizeSchema,
    /** `max(0, freeBytes - reserveBytes)`: what uploads can actually use. */
    usableBytes: byteSizeSchema,
  }),
  /** Bytes used by encrypted files on disk. */
  storedBytes: byteSizeSchema,
  activeTransfers: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  users: z.array(
    z.object({
      userId: idSchema,
      email: emailSchema,
      usedBytes: byteSizeSchema,
      quotaBytes: byteSizeSchema.nullable(),
    }),
  ),
});
export type StorageResponse = z.infer<typeof storageResponseSchema>;

/** Domain and tunnel status (same logic as the Cloudflare step of the setup wizard). */
export const tunnelStatusResponseSchema = z.object({
  appMode: z.enum(APP_MODES),
  configured: z.boolean(),
  hostname: z.string().nullable(),
  publicUrl: z.string().nullable(),
  tunnelId: z.string().nullable(),
  configuredAt: unixSecondsSchema.nullable(),
});
export type TunnelStatusResponse = z.infer<typeof tunnelStatusResponseSchema>;

/** Query of `GET /api/admin/updates`. */
export const updateStatusQuerySchema = z.object({
  /** `true` bypasses the cached answer and asks GitHub again (rate limited). */
  refresh: z.enum(['true', 'false']).optional(),
});
export type UpdateStatusQuery = z.infer<typeof updateStatusQuerySchema>;

export const UPDATE_STATUSES = ['ok', 'disabled', 'unavailable'] as const;

/** Result of the "is a newer release available" check. */
export const updateStatusResponseSchema = z.object({
  /** The `general.updateCheck` setting. */
  enabled: z.boolean(),
  /** Version of the running instance, as configured (may not be a release number). */
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  releaseUrl: z.string().nullable(),
  publishedAt: unixSecondsSchema.nullable(),
  /** When the answer was obtained from GitHub (Unix seconds). */
  checkedAt: unixSecondsSchema.nullable(),
  status: z.enum(UPDATE_STATUSES),
});
export type UpdateStatusResponse = z.infer<typeof updateStatusResponseSchema>;
