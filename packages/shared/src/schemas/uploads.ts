import { z } from 'zod';
import { FILE_PATH_MAX_LENGTH, FILENAME_MAX_LENGTH } from '../constants.js';
import { idSchema } from './common.js';

/**
 * Decoded `Upload-Metadata` of a tus upload creation request. On the wire each value is
 * base64-encoded as the tus protocol requires; the server decodes it before validating.
 */
export const tusUploadMetadataSchema = z.object({
  /** Draft transfer the file belongs to (created with `POST /api/transfers`). */
  transferId: idSchema,
  /** Original file name. The server sanitises it and never uses it as a storage path. */
  filename: z.string().min(1).max(FILENAME_MAX_LENGTH),
  /** Folder of the file inside the transfer (from the dropped folder); sanitised by the server. */
  relativePath: z.string().max(FILE_PATH_MAX_LENGTH).optional(),
  /** Optional MIME type reported by the browser. Informational only. */
  filetype: z.string().max(255).optional(),
});
export type TusUploadMetadata = z.infer<typeof tusUploadMetadataSchema>;

export const tusUploadParamsSchema = z.object({ id: idSchema });
