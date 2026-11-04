import { z } from 'zod';
import {
  S3_ACCESS_KEY_ID_MAX_LENGTH,
  S3_ENDPOINT_MAX_LENGTH,
  S3_PREFIX_MAX_LENGTH,
  S3_REGION_MAX_LENGTH,
  S3_SECRET_ACCESS_KEY_MAX_LENGTH,
  STORAGE_DRIVERS,
  STORAGE_MIGRATION_STATUSES,
  STORAGE_TEST_REASONS,
} from '../constants.js';
import { byteSizeSchema, unixSecondsSchema } from './common.js';

export const storageDriverSchema = z.enum(STORAGE_DRIVERS);

/** Who wrote the stored configuration: the first-start `.env` import or the admin panel / wizard. */
export const storageSourceSchema = z.enum(['env', 'panel']);
export type StorageSource = z.infer<typeof storageSourceSchema>;

/** `http(s)` URL of the S3 endpoint, without trailing slash. */
export const s3EndpointSchema = z
  .url({ protocol: /^https?$/ })
  .max(S3_ENDPOINT_MAX_LENGTH)
  .transform((value) => value.replace(/\/+$/, ''));

/** Bucket name rules shared by AWS, R2, MinIO, B2 and Wasabi (3-63 chars, lowercase, digits, `.`, `-`). */
export const s3BucketSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);

/** Key prefix: no leading slash, no `..` segments, no control characters. Empty = bucket root. */
export const s3PrefixSchema = z
  .string()
  .max(S3_PREFIX_MAX_LENGTH)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]*$/)
  .refine((value) => [...value].every((char) => char.charCodeAt(0) > 31), {
    message: 'Control characters are not allowed',
  })
  .transform((value) => value.replace(/\/+$/, ''));

const s3ConfigFields = {
  endpoint: s3EndpointSchema,
  region: z.string().min(1).max(S3_REGION_MAX_LENGTH),
  bucket: s3BucketSchema,
  prefix: s3PrefixSchema,
  forcePathStyle: z.boolean(),
  accessKeyId: z.string().min(1).max(S3_ACCESS_KEY_ID_MAX_LENGTH),
};

/** S3 configuration as stored (encrypted): the secret is always present. */
export const s3ConfigSchema = z.object({
  ...s3ConfigFields,
  secretAccessKey: z.string().min(1).max(S3_SECRET_ACCESS_KEY_MAX_LENGTH),
});
export type S3Config = z.infer<typeof s3ConfigSchema>;

/** S3 configuration as sent by the client. `secretAccessKey` omitted = keep the stored one. */
export const s3InputSchema = z.object({
  ...s3ConfigFields,
  secretAccessKey: z.string().min(1).max(S3_SECRET_ACCESS_KEY_MAX_LENGTH).optional(),
});
export type S3Input = z.infer<typeof s3InputSchema>;

/** S3 configuration as returned by the server: the secret is never sent back. */
export const s3PublicSchema = z.object({
  ...s3ConfigFields,
  hasSecret: z.boolean(),
});
export type S3Public = z.infer<typeof s3PublicSchema>;

const usageSchema = z.object({ files: z.number().int().nonnegative(), bytes: byteSizeSchema });

/** Fields of the S3 configuration that cannot change while files live on S3. */
export const STORAGE_LOCKABLE_FIELDS = ['endpoint', 'bucket', 'prefix'] as const;

/**
 * Storage configuration as shown in the admin panel and the wizard. Used by `settings.storage`,
 * `settings.storageUpdate`, `setup.storage` and `setup.storageSave` (in the wizard `usage` is
 * all zeros and `locked` is empty).
 */
export const storageSettingsResponseSchema = z.object({
  /** Driver used for NEW files. Existing files stay where they are (`usage` says how many). */
  driver: storageDriverSchema,
  /** Last S3 configuration saved, also while the driver is `local`; null when never configured. */
  s3: s3PublicSchema.nullable(),
  source: storageSourceSchema,
  /** The `.env` S3 configuration differs from the active one (never exposes values). */
  envDiffers: z.boolean(),
  usage: z.object({ local: usageSchema, s3: usageSchema }),
  locked: z.object({
    fields: z.array(z.enum(STORAGE_LOCKABLE_FIELDS)),
    /** `s3_has_files`: endpoint, bucket and prefix change only after migrating the files away. */
    reason: z.enum(['s3_has_files']).nullable(),
  }),
});
export type StorageSettingsResponse = z.infer<typeof storageSettingsResponseSchema>;

/** Body of `PUT .../storage`: `s3` is required when `driver` is `s3`. */
export const storageUpdateRequestSchema = z
  .object({
    driver: storageDriverSchema,
    s3: s3InputSchema.optional(),
  })
  .refine((value) => value.driver === 'local' || value.s3 !== undefined, {
    message: 's3 is required when driver is s3',
    path: ['s3'],
  });
export type StorageUpdateRequest = z.infer<typeof storageUpdateRequestSchema>;

/** Body of `POST .../storage/test`. */
export const storageTestRequestSchema = z.object({ s3: s3InputSchema });
export type StorageTestRequest = z.infer<typeof storageTestRequestSchema>;

export const storageTestResponseSchema = z.object({ ok: z.literal(true) });
export type StorageTestResponse = z.infer<typeof storageTestResponseSchema>;

/** `details.reason` of `STORAGE_TEST_FAILED`. */
export const storageTestReasonSchema = z.enum(STORAGE_TEST_REASONS);

// ---- Migration ---------------------------------------------------------------
export const storageMigrationSchema = z.object({
  id: z.string().min(1).max(64),
  target: storageDriverSchema,
  status: z.enum(STORAGE_MIGRATION_STATUSES),
  totalFiles: z.number().int().nonnegative(),
  doneFiles: z.number().int().nonnegative(),
  totalBytes: byteSizeSchema,
  doneBytes: byteSizeSchema,
  failedFiles: z.number().int().nonnegative(),
  /** Stable error code when `status` is `failed` (for example `INSUFFICIENT_DISK_SPACE`). */
  errorCode: z.string().nullable(),
  startedAt: unixSecondsSchema,
  updatedAt: unixSecondsSchema,
  finishedAt: unixSecondsSchema.nullable(),
});
export type StorageMigration = z.infer<typeof storageMigrationSchema>;

/** The latest migration, or null when none ever ran. */
export const storageMigrationResponseSchema = z.object({
  migration: storageMigrationSchema.nullable(),
});
export type StorageMigrationResponse = z.infer<typeof storageMigrationResponseSchema>;

export const storageMigrationStartRequestSchema = z.object({ target: storageDriverSchema });
export type StorageMigrationStartRequest = z.infer<typeof storageMigrationStartRequestSchema>;
