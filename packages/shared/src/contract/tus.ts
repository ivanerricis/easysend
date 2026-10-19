import type { ErrorCode } from '../schemas/errors.js';
import { tusUploadMetadataSchema } from '../schemas/uploads.js';

/** Static description of the tus upload protocol as exposed by the API. */
export interface TusHookError {
  hook: 'onIncomingRequest' | 'onUploadCreate' | 'onUploadFinish';
  code: ErrorCode;
  when: string;
}

export const TUS_VERSION = '1.0.0';
export const TUS_BASE_PATH = '/api/uploads';
export const TUS_EXTENSIONS = ['creation', 'termination', 'expiration'] as const;

export const tusMetadataSchema = tusUploadMetadataSchema;

export const tusProtocolNotes: readonly string[] = [
  `Endpoint base: \`${TUS_BASE_PATH}\`. Protocol version \`Tus-Resumable: ${TUS_VERSION}\`; extensions: ${TUS_EXTENSIONS.join(', ')}.`,
  'Every request needs the session cookie and the `X-CSRF-Token` header (tus-js-client option `headers`). Unsafe requests without them are rejected by the `onIncomingRequest` hook.',
  'Upload creation (`POST`) sends `Upload-Length` and `Upload-Metadata`. Each metadata value is base64-encoded as required by tus; after decoding it must match the metadata schema below.',
  'The file is always attached to a draft transfer created beforehand with `POST /api/transfers`: the `transferId` metadata key is mandatory.',
  'Chunks are sent with `PATCH` and `Content-Type: application/offset+octet-stream`. The client chunk size comes from `GET /api/config` (`chunkSizeBytes`, default 25 MB, never above 50 MB because of the Cloudflare 100 MB request limit).',
  'The response of the PATCH carrying the last byte is returned after SHA-256 and encryption complete (`onUploadFinish`). Clients that time out can poll `GET /api/transfers/:id`: the file appears in `files` and disappears from `uploads` once ready.',
  'Interrupted uploads resume with `HEAD` (reads `Upload-Offset`) followed by `PATCH` from that offset. Incomplete uploads expire after 24 hours (`Upload-Expires` header, `expiration` extension) and are cleaned up by the periodic job.',
  'Only the owner of the draft transfer can create or continue an upload; uploads of other users answer 404.',
  'A transfer accepts at most `limits.maxFilesPerTransfer` files (see `GET /api/config`): creating more answers 400 `VALIDATION_ERROR` with `details.limit`.',
  'Hook errors are returned in the standard error shape (`{ error: { code, message, requestId, details? } }`), not as plain text.',
  'Space check at creation: the free space minus the reserve must be at least twice the file size (encryption needs temporary room), otherwise 507 `INSUFFICIENT_DISK_SPACE`; the user quota is checked against `Upload-Length`, otherwise 413 `QUOTA_EXCEEDED`.',
];

export const tusHookErrors: readonly TusHookError[] = [
  { hook: 'onIncomingRequest', code: 'UNAUTHENTICATED', when: 'missing or invalid session' },
  { hook: 'onIncomingRequest', code: 'CSRF_INVALID', when: 'missing or invalid CSRF header' },
  { hook: 'onUploadCreate', code: 'INVALID_UPLOAD_METADATA', when: 'metadata fails validation' },
  { hook: 'onUploadCreate', code: 'TRANSFER_NOT_FOUND', when: 'draft missing or not owned' },
  {
    hook: 'onUploadCreate',
    code: 'TRANSFER_NOT_UPLOADABLE',
    when: 'transfer is not a draft (`uploading`)',
  },
  { hook: 'onUploadCreate', code: 'QUOTA_EXCEEDED', when: 'user quota would be exceeded' },
  {
    hook: 'onUploadCreate',
    code: 'INSUFFICIENT_DISK_SPACE',
    when: 'free space less than 2x size plus reserve',
  },
];
