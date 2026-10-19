import { z } from 'zod';
import { FILENAME_MAX_LENGTH } from '../constants.js';
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
  /** Optional MIME type reported by the browser. Informational only. */
  filetype: z.string().max(255).optional(),
});
export type TusUploadMetadata = z.infer<typeof tusUploadMetadataSchema>;

export const tusUploadParamsSchema = z.object({ id: idSchema });
