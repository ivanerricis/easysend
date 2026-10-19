import { z } from 'zod';
import {
  EXPIRY_KEYS,
  FILENAME_MAX_LENGTH,
  MAX_DOWNLOADS_LIMIT,
  MAX_RECIPIENTS,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TRANSFER_MODES,
  TRANSFER_STATUSES,
  UPLOAD_STATUSES,
} from '../constants.js';
import {
  byteSizeSchema,
  emailSchema,
  idSchema,
  paginatedSchema,
  paginationQuerySchema,
  unixSecondsSchema,
} from './common.js';

/** Minimum length of the optional password protecting a download link. */
export const LINK_PASSWORD_MIN_LENGTH = 8;

export const expiryKeySchema = z.enum(EXPIRY_KEYS);
export const transferModeSchema = z.enum(TRANSFER_MODES);
export const transferStatusSchema = z.enum(TRANSFER_STATUSES);

export const linkPasswordSchema = z.string().min(LINK_PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const maxDownloadsSchema = z.number().int().min(1).max(MAX_DOWNLOADS_LIMIT);

export const transferTitleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
export const transferMessageSchema = z.string().max(MESSAGE_MAX_LENGTH);

// ---- Requests ----------------------------------------------------------------
/**
 * Creates a draft transfer (status `uploading`). Files are then uploaded with tus and the
 * draft is activated with `finalize`.
 * Rules not expressible in JSON Schema: `mode=email` requires at least one recipient,
 * `mode=link` forbids recipients, recipients must be unique (case-insensitive).
 */
export const createTransferRequestSchema = z
  .object({
    title: transferTitleSchema.optional(),
    message: transferMessageSchema.optional(),
    mode: transferModeSchema,
    recipients: z.array(emailSchema).max(MAX_RECIPIENTS).optional(),
    expiresIn: expiryKeySchema,
    password: linkPasswordSchema.optional(),
    maxDownloads: maxDownloadsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const count = v.recipients?.length ?? 0;
    if (v.mode === 'email' && count === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'At least one recipient is required in email mode',
      });
    }
    if (v.mode === 'link' && count > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'Recipients are only allowed in email mode',
      });
    }
    if (new Set((v.recipients ?? []).map((r) => r.toLowerCase())).size !== count) {
      ctx.addIssue({ code: 'custom', path: ['recipients'], message: 'Recipients must be unique' });
    }
  });
export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

/**
 * Edits an existing transfer. `expiresIn` is counted from now (not from the creation date).
 * `password` and `removePassword` are mutually exclusive; at least one field is required.
 */
export const updateTransferRequestSchema = z
  .object({
    title: transferTitleSchema.nullable().optional(),
    message: transferMessageSchema.nullable().optional(),
    expiresIn: expiryKeySchema.optional(),
    maxDownloads: maxDownloadsSchema.nullable().optional(),
    password: linkPasswordSchema.optional(),
    removePassword: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine((v) => !(v.password !== undefined && v.removePassword), {
    message: 'password and removePassword are mutually exclusive',
  });
export type UpdateTransferRequest = z.infer<typeof updateTransferRequestSchema>;

export const transferFileParamsSchema = z.object({ id: idSchema, fileId: idSchema });

export const listTransfersQuerySchema = paginationQuerySchema.extend({
  status: transferStatusSchema.optional(),
  mode: transferModeSchema.optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;

export const adminListTransfersQuerySchema = listTransfersQuerySchema.extend({
  ownerId: idSchema.optional(),
});
export type AdminListTransfersQuery = z.infer<typeof adminListTransfersQuerySchema>;

export const listDownloadLogsQuerySchema = paginationQuerySchema;

// ---- Responses ---------------------------------------------------------------
export const transferFileSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(FILENAME_MAX_LENGTH),
  sizeBytes: byteSizeSchema,
  mimeType: z.string().max(255).nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: unixSecondsSchema,
});
export type TransferFile = z.infer<typeof transferFileSchema>;

export const transferRecipientSchema = z.object({
  email: emailSchema,
  /** `null` until the notification email has been sent. */
  notifiedAt: unixSecondsSchema.nullable(),
});
export type TransferRecipient = z.infer<typeof transferRecipientSchema>;

/**
 * Upload attached to a draft transfer that is not a file yet: `in_progress` (receiving chunks),
 * `processing` (all bytes received, hashing and encryption running) or `aborted`.
 */
export const transferUploadSchema = z.object({
  id: idSchema,
  fileName: z.string().max(FILENAME_MAX_LENGTH),
  totalSize: byteSizeSchema,
  status: z.enum(UPLOAD_STATUSES),
  expiresAt: unixSecondsSchema,
});
export type TransferUpload = z.infer<typeof transferUploadSchema>;

export const transferSummarySchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  mode: transferModeSchema,
  status: transferStatusSchema,
  ownerId: idSchema,
  ownerEmail: emailSchema,
  createdAt: unixSecondsSchema,
  expiresAt: unixSecondsSchema,
  totalBytes: byteSizeSchema,
  fileCount: z.number().int().nonnegative(),
  recipientCount: z.number().int().nonnegative(),
  downloadCount: z.number().int().nonnegative(),
  maxDownloads: maxDownloadsSchema.nullable(),
  hasPassword: z.boolean(),
});
export type TransferSummary = z.infer<typeof transferSummarySchema>;

export const transferDetailSchema = transferSummarySchema.extend({
  message: z.string().nullable(),
  /** Public download URL `<PUBLIC_URL>/d/<token>`. `null` while the transfer is still a draft (`uploading`). */
  shareUrl: z.string().nullable(),
  firstDownloadedAt: unixSecondsSchema.nullable(),
  files: z.array(transferFileSchema),
  recipients: z.array(transferRecipientSchema),
  uploads: z.array(transferUploadSchema),
});
export type TransferDetail = z.infer<typeof transferDetailSchema>;

export const listTransfersResponseSchema = paginatedSchema(transferSummarySchema);
export type ListTransfersResponse = z.infer<typeof listTransfersResponseSchema>;

export const downloadLogEntrySchema = z.object({
  id: idSchema,
  fileId: idSchema.nullable(),
  fileName: z.string().nullable(),
  bytesSent: byteSizeSchema,
  userAgent: z.string().max(512).nullable(),
  createdAt: unixSecondsSchema,
});
export type DownloadLogEntry = z.infer<typeof downloadLogEntrySchema>;

export const listDownloadLogsResponseSchema = paginatedSchema(downloadLogEntrySchema);
export type ListDownloadLogsResponse = z.infer<typeof listDownloadLogsResponseSchema>;
