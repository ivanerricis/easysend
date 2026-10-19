import { z } from 'zod';
import { FILENAME_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '../constants.js';
import { byteSizeSchema, idSchema, unixSecondsSchema } from './common.js';
import { maxDownloadsSchema } from './transfers.js';

/** Random, long and non-guessable link token. */
export const downloadTokenSchema = z.string().min(20).max(128);

export const downloadTokenParamsSchema = z.object({ token: downloadTokenSchema });
export const downloadFileParamsSchema = z.object({
  token: downloadTokenSchema,
  fileId: idSchema,
});

export const downloadFileSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(FILENAME_MAX_LENGTH),
  sizeBytes: byteSizeSchema,
});
export type DownloadFile = z.infer<typeof downloadFileSchema>;

/**
 * Public view of a transfer. When the link is protected and not yet unlocked only the
 * minimal `locked` variant is returned, without any file information.
 */
export const downloadInfoResponseSchema = z.discriminatedUnion('locked', [
  z.object({
    locked: z.literal(true),
    expiresAt: unixSecondsSchema,
  }),
  z.object({
    locked: z.literal(false),
    title: z.string().nullable(),
    message: z.string().nullable(),
    /** Sender display name: the part of the owner's email before the `@`. */
    sender: z.string(),
    files: z.array(downloadFileSchema),
    totalBytes: byteSizeSchema,
    expiresAt: unixSecondsSchema,
    downloadCount: z.number().int().nonnegative(),
    maxDownloads: maxDownloadsSchema.nullable(),
  }),
]);
export type DownloadInfoResponse = z.infer<typeof downloadInfoResponseSchema>;

export const unlockRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;

/**
 * Zip download. `fileIds` is a comma-separated list of file ids; when omitted the zip
 * contains every file of the transfer.
 */
export const zipQuerySchema = z.object({
  fileIds: z.string().min(1).max(4096).optional(),
});
export type ZipQuery = z.infer<typeof zipQuerySchema>;
