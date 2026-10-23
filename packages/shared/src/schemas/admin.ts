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

/** Plain release number `X.Y.Z` (no `v`, no pre-release label). */
export const releaseVersionSchema = z.string().regex(/^\d{1,9}\.\d{1,9}\.\d{1,9}$/);

/** A published release newer than the running version. */
export const availableVersionSchema = z.object({
  version: releaseVersionSchema,
  releaseUrl: z.string(),
  publishedAt: unixSecondsSchema.nullable(),
});
export type AvailableVersion = z.infer<typeof availableVersionSchema>;

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
  /** Releases newer than the running version, newest first (at most 30). Empty when unknown. */
  availableVersions: z.array(availableVersionSchema).max(30),
});
export type UpdateStatusResponse = z.infer<typeof updateStatusResponseSchema>;

// ---- one-click update (request/status file protocol with the host runner) ------------------

export const UPDATE_RUN_STATES = ['running', 'succeeded', 'rolled_back', 'failed'] as const;
export const UPDATE_RUN_STEPS = [
  'starting',
  'compose',
  'backup',
  'pull',
  'restart',
  'health',
  'rollback',
  'done',
] as const;
export const UPDATE_RUN_ERRORS = [
  'busy',
  'invalid_request',
  'already_current',
  'compose',
  'backup',
  'deploy',
  'rollback_failed',
] as const;

/** Contents of `status.json`, written by the host runner. */
export const updateRunStatusSchema = z.object({
  id: z.string().nullable(),
  targetVersion: z.string().nullable(),
  fromVersion: z.string().nullable(),
  state: z.enum(UPDATE_RUN_STATES),
  step: z.enum(UPDATE_RUN_STEPS),
  error: z.enum(UPDATE_RUN_ERRORS).nullable(),
  startedAt: unixSecondsSchema,
  updatedAt: unixSecondsSchema,
  finishedAt: unixSecondsSchema.nullable(),
});
export type UpdateRunStatus = z.infer<typeof updateRunStatusSchema>;

export const UPDATE_RUNNER_STATES = ['installed', 'missing', 'local'] as const;

/** Request written by the API and not yet picked up (or not yet reported) by the runner. */
export const pendingUpdateSchema = z.object({
  id: z.string(),
  version: releaseVersionSchema,
  requestedAt: unixSecondsSchema,
  /** Older than 2 minutes with no status of the same id: the runner is not picking it up. */
  stale: z.boolean(),
});
export type PendingUpdate = z.infer<typeof pendingUpdateSchema>;

/** Response of `GET /api/admin/updates/run`. */
export const updateRunResponseSchema = z.object({
  runner: z.enum(UPDATE_RUNNER_STATES),
  pending: pendingUpdateSchema.nullable(),
  run: updateRunStatusSchema.nullable(),
});
export type UpdateRunResponse = z.infer<typeof updateRunResponseSchema>;

/** Body of `POST /api/admin/updates/run`. */
export const startUpdateRequestSchema = z.object({ version: releaseVersionSchema });
export type StartUpdateRequest = z.infer<typeof startUpdateRequestSchema>;

/** Response (202) of `POST /api/admin/updates/run`. */
export const startUpdateResponseSchema = z.object({
  id: z.string(),
  version: releaseVersionSchema,
  requestedAt: unixSecondsSchema,
});
export type StartUpdateResponse = z.infer<typeof startUpdateResponseSchema>;
