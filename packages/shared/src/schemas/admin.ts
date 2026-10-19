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
