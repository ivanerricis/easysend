import { z } from 'zod';

/** Stable error codes mapped to their HTTP status. The frontend translates `errors.<CODE>`. */
export const ERROR_CODES = {
  // Generic
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  SETUP_REQUIRED: 409,
  // Auth and users
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  ACCOUNT_LOCKED: 429,
  INVALID_TOTP_CODE: 401,
  INVALID_RECOVERY_CODE: 401,
  TWO_FACTOR_REQUIRED: 403,
  RESET_TOKEN_INVALID: 400,
  USER_NOT_FOUND: 404,
  EMAIL_ALREADY_EXISTS: 409,
  LAST_ADMIN: 409,
  PASSWORD_INCORRECT: 403,
  // Transfers, uploads, downloads
  TRANSFER_NOT_FOUND: 404,
  TRANSFER_NOT_UPLOADABLE: 409,
  TRANSFER_EMPTY: 409,
  UPLOAD_INCOMPLETE: 409,
  FILE_NOT_FOUND: 404,
  INVALID_UPLOAD_METADATA: 400,
  QUOTA_EXCEEDED: 413,
  INSUFFICIENT_DISK_SPACE: 507,
  PASSWORD_REQUIRED: 401,
  TRANSFER_EXPIRED: 410,
  TRANSFER_REVOKED: 410,
  DOWNLOAD_LIMIT_REACHED: 410,
  RANGE_NOT_SATISFIABLE: 416,
  // Setup and settings
  SETUP_ALREADY_COMPLETED: 409,
  SETUP_CODE_INVALID: 401,
  SETUP_CODE_EXPIRED: 410,
  SMTP_TEST_FAILED: 422,
  SMTP_NOT_VERIFIED: 409,
  CLOUDFLARE_TOKEN_INVALID: 422,
  CLOUDFLARE_ZONE_NOT_FOUND: 422,
  CLOUDFLARE_RECORD_EXISTS: 409,
  CLOUDFLARE_API_ERROR: 502,
  NOT_APPLICABLE_IN_LOCAL_MODE: 409,
  INVALID_IMAGE: 422,
  // One-click update
  UPDATE_RUNNER_MISSING: 409,
  UPDATE_IN_PROGRESS: 409,
  UPDATE_VERSION_NOT_AVAILABLE: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODE_LIST);

/** Standard error body: `{ error: { code, message, requestId, details? } }`. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const httpStatusFor = (code: ErrorCode): number => ERROR_CODES[code];
