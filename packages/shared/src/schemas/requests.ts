import { z } from 'zod';
import {
  FILENAME_MAX_LENGTH,
  MAX_SUBMISSIONS_LIMIT,
  MESSAGE_MAX_LENGTH,
  SENDER_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  UPLOAD_REQUEST_STATUSES,
} from '../constants.js';
import {
  atLeastOneField,
  byteSizeSchema,
  emailSchema,
  idSchema,
  paginatedSchema,
  paginationQuerySchema,
  unixSecondsSchema,
} from './common.js';
import { downloadTokenSchema } from './downloads.js';
import {
  expiryKeySchema,
  linkPasswordSchema,
  transferMessageSchema,
  transferStatusSchema,
  transferSummarySchema,
  transferTitleSchema,
  transferUploadSchema,
} from './transfers.js';
import { displayNameSchema } from './users.js';

export const uploadRequestStatusSchema = z.enum(UPLOAD_REQUEST_STATUSES);
/** Status as reported: an `active` request past its expiry is `expired` even before the cleanup job runs. */
export const uploadRequestEffectiveStatusSchema = z.enum([...UPLOAD_REQUEST_STATUSES, 'expired']);
export type UploadRequestEffectiveStatus = z.infer<typeof uploadRequestEffectiveStatusSchema>;

export const maxTotalBytesSchema = z.number().int().min(1);
export const maxSubmissionsSchema = z.number().int().min(1).max(MAX_SUBMISSIONS_LIMIT);

/** Name of the person who uploads. */
export const submitterNameSchema = z.string().trim().min(1).max(SENDER_NAME_MAX_LENGTH);

// ---- Owner side: requests ----------------------------------------------------
/** Creates an upload request. Name/email requirements default to `false`. */
export const createUploadRequestSchema = z.object({
  title: transferTitleSchema,
  /** Instructions shown to the people who upload. */
  message: transferMessageSchema.optional(),
  /** Validity of the link, and the lifetime of every received transfer (counted from its finalize). */
  expiresIn: expiryKeySchema,
  password: linkPasswordSchema.optional(),
  /** Total bytes the request may receive; omitted or `null` for no limit. */
  maxTotalBytes: maxTotalBytesSchema.nullable().optional(),
  /** Maximum number of submissions; omitted or `null` for no limit. */
  maxSubmissions: maxSubmissionsSchema.nullable().optional(),
  requireName: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/**
 * Edits an upload request. `expiresIn` is counted from now. `password` and `removePassword`
 * are mutually exclusive; at least one field is required.
 */
export const updateUploadRequestSchema = atLeastOneField(
  z.object({
    title: transferTitleSchema.optional(),
    message: transferMessageSchema.nullable().optional(),
    expiresIn: expiryKeySchema.optional(),
    password: linkPasswordSchema.optional(),
    removePassword: z.literal(true).optional(),
    maxTotalBytes: maxTotalBytesSchema.nullable().optional(),
    maxSubmissions: maxSubmissionsSchema.nullable().optional(),
    requireName: z.boolean().optional(),
    requireEmail: z.boolean().optional(),
  }),
).refine((v) => !(v.password !== undefined && v.removePassword), {
  message: 'password and removePassword are mutually exclusive',
});
export type UpdateUploadRequest = z.infer<typeof updateUploadRequestSchema>;

export const listUploadRequestsQuerySchema = paginationQuerySchema.extend({
  status: uploadRequestEffectiveStatusSchema.optional(),
  /** Matches the title. */
  q: z.string().min(1).max(100).optional(),
});
export type ListUploadRequestsQuery = z.infer<typeof listUploadRequestsQuerySchema>;

export const uploadRequestSummarySchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  status: uploadRequestEffectiveStatusSchema,
  createdAt: unixSecondsSchema,
  updatedAt: unixSecondsSchema,
  expiresAt: unixSecondsSchema,
  /** Duration chosen for the link and for the received transfers. */
  expiresIn: expiryKeySchema,
  hasPassword: z.boolean(),
  maxTotalBytes: maxTotalBytesSchema.nullable(),
  maxSubmissions: maxSubmissionsSchema.nullable(),
  requireName: z.boolean(),
  requireEmail: z.boolean(),
  submissionCount: z.number().int().nonnegative(),
  /** Plaintext bytes of the files received so far. */
  receivedBytes: byteSizeSchema,
  /** Public upload URL `<PUBLIC_URL>/r/<token>`; `null` when no public URL is known. */
  shareUrl: z.string().nullable(),
});
export type UploadRequestSummary = z.infer<typeof uploadRequestSummarySchema>;

export const uploadRequestDetailSchema = uploadRequestSummarySchema.extend({
  message: z.string().max(MESSAGE_MAX_LENGTH).nullable(),
  /** Transfers received through this request, newest first. */
  transfers: z.array(transferSummarySchema),
});
export type UploadRequestDetail = z.infer<typeof uploadRequestDetailSchema>;

export const listUploadRequestsResponseSchema = paginatedSchema(uploadRequestSummarySchema);
export type ListUploadRequestsResponse = z.infer<typeof listUploadRequestsResponseSchema>;

// ---- Public side: submissions ------------------------------------------------
/** `:token` of the request link. */
export const requestTokenParamsSchema = z.object({ token: downloadTokenSchema });
export const submissionParamsSchema = z.object({ token: downloadTokenSchema, id: idSchema });

/**
 * Public view of an upload request. A password-protected request answers the minimal `locked`
 * variant until it is unlocked. The owner email is never exposed.
 */
export const requestInfoResponseSchema = z.discriminatedUnion('locked', [
  z.object({
    locked: z.literal(true),
    expiresAt: unixSecondsSchema,
  }),
  z.object({
    locked: z.literal(false),
    title: z.string(),
    /** Instructions of the owner. */
    message: z.string().nullable(),
    /** The owner's display name; `null` when not set (the client shows the instance name). */
    ownerName: displayNameSchema.nullable(),
    requireName: z.boolean(),
    requireEmail: z.boolean(),
    /** Bytes that can still be uploaded; `null` when the request has no total limit. */
    remainingBytes: byteSizeSchema.nullable(),
    expiresAt: unixSecondsSchema,
    /** tus chunk size of this instance (the public page cannot read `GET /api/config`). */
    chunkSizeBytes: z.number().int().positive(),
  }),
]);
export type RequestInfoResponse = z.infer<typeof requestInfoResponseSchema>;

/** Starts a submission. `name` and `email` are required when the request says so. */
export const createSubmissionRequestSchema = z.object({
  name: submitterNameSchema.optional(),
  email: emailSchema.optional(),
  message: z.string().max(MESSAGE_MAX_LENGTH).optional(),
});
export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequestSchema>;

export const createSubmissionResponseSchema = z.object({
  /** Draft transfer to pass as `transferId` in the tus metadata. */
  transferId: idSchema,
  /** Value of the `X-Submission-Token` header for tus, status and finalize. */
  submissionToken: z.string().min(1).max(512),
  /** Expiry of the submission token. */
  submissionTokenExpiresAt: unixSecondsSchema,
});
export type CreateSubmissionResponse = z.infer<typeof createSubmissionResponseSchema>;

export const submissionFileSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(FILENAME_MAX_LENGTH),
  sizeBytes: byteSizeSchema,
});

/** State of a submission, polled while the server encrypts the files. */
export const submissionStatusResponseSchema = z.object({
  transferId: idSchema,
  status: transferStatusSchema,
  /** Completed files. */
  files: z.array(submissionFileSchema),
  /** Uploads not completed yet (`in_progress`, `processing`, `aborted`). */
  uploads: z.array(transferUploadSchema),
});
export type SubmissionStatusResponse = z.infer<typeof submissionStatusResponseSchema>;

export const finalizeSubmissionResponseSchema = z.object({
  transferId: idSchema,
  fileCount: z.number().int().nonnegative(),
  totalBytes: byteSizeSchema,
});
export type FinalizeSubmissionResponse = z.infer<typeof finalizeSubmissionResponseSchema>;
