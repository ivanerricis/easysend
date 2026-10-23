import type { ErrorCode } from '../schemas/errors.js';

/** Meaning of every error code, for the generated documentation. The type forces completeness. */
export const ERROR_MEANINGS: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Params, query or body failed validation (`details.issues` lists the fields).',
  UNAUTHENTICATED: 'No valid session (or setup cookie) for this endpoint.',
  FORBIDDEN: 'Authenticated but not allowed (e.g. admin-only endpoint).',
  CSRF_INVALID: 'Missing or wrong `X-CSRF-Token` header.',
  NOT_FOUND: 'Unknown route or resource.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  PAYLOAD_TOO_LARGE: 'Request body larger than the allowed maximum.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type not accepted by the endpoint.',
  RATE_LIMITED: 'Too many requests; retry after the `Retry-After` header (seconds).',
  INTERNAL_ERROR: 'Unexpected server error (the message never contains internals).',
  SERVICE_UNAVAILABLE: 'The service is not ready (e.g. database unavailable).',
  SETUP_REQUIRED: 'The first-run setup is not completed yet; use the setup wizard.',
  INVALID_CREDENTIALS: 'Wrong email or password (never says which).',
  ACCOUNT_DISABLED: 'The account was disabled by an admin.',
  ACCOUNT_LOCKED:
    'Temporarily blocked after too many failed logins or re-authentications; see `Retry-After`.',
  INVALID_TOTP_CODE: 'Wrong or expired TOTP code.',
  INVALID_RECOVERY_CODE: 'Wrong or already used recovery code.',
  TWO_FACTOR_REQUIRED: '2FA is mandatory for admins and cannot be disabled.',
  RESET_TOKEN_INVALID: 'Password reset token unknown, expired or already used.',
  USER_NOT_FOUND: 'No user with that id.',
  EMAIL_ALREADY_EXISTS: 'A user with that email already exists.',
  LAST_ADMIN: 'The operation would leave the instance without an active admin.',
  PASSWORD_INCORRECT: 'The password supplied for confirmation or unlock is wrong.',
  TRANSFER_NOT_FOUND:
    'No such transfer, or not visible to the caller (existence is never revealed).',
  TRANSFER_NOT_UPLOADABLE: 'The transfer is not a draft: files can no longer be added or removed.',
  TRANSFER_EMPTY: 'The draft has no completed file.',
  UPLOAD_INCOMPLETE: 'Some uploads of the draft are still in progress.',
  FILE_NOT_FOUND: 'No such file in the transfer.',
  INVALID_UPLOAD_METADATA: 'tus `Upload-Metadata` missing or invalid.',
  QUOTA_EXCEEDED: 'The upload would exceed the user quota.',
  INSUFFICIENT_DISK_SPACE: 'Not enough free disk space for the upload (2x size plus reserve).',
  PASSWORD_REQUIRED: 'The link is password protected and not unlocked (no valid `es_dl` cookie).',
  TRANSFER_EXPIRED: 'The transfer is expired.',
  TRANSFER_REVOKED: 'The transfer was revoked by its owner or an admin.',
  DOWNLOAD_LIMIT_REACHED: 'The maximum number of downloads was reached.',
  RANGE_NOT_SATISFIABLE: 'The `Range` header is outside the file size.',
  SETUP_ALREADY_COMPLETED: 'The setup wizard was already completed.',
  SETUP_CODE_INVALID: 'Wrong setup code.',
  SETUP_CODE_EXPIRED: 'The setup code expired; restart the API to get a new one.',
  SMTP_TEST_FAILED: 'The test email could not be sent (`details.reason` has a safe summary).',
  SMTP_NOT_VERIFIED: 'The SMTP settings were not verified with a successful test.',
  CLOUDFLARE_TOKEN_INVALID: 'The Cloudflare API token is invalid or lacks permissions.',
  CLOUDFLARE_ZONE_NOT_FOUND: 'The domain is not managed by the Cloudflare account.',
  CLOUDFLARE_RECORD_EXISTS: 'A conflicting DNS record already exists for the hostname.',
  CLOUDFLARE_API_ERROR: 'Cloudflare returned an unexpected error.',
  NOT_APPLICABLE_IN_LOCAL_MODE: 'The operation needs `APP_MODE=production`.',
  UPDATE_RUNNER_MISSING:
    'The host update runner is not installed (no valid `runner.json` in the update folder).',
  UPDATE_IN_PROGRESS: 'An update was already requested or is running.',
  UPDATE_VERSION_NOT_AVAILABLE:
    'The requested version is not a published release newer than the running one.',
  INVALID_IMAGE: 'The file is not a valid PNG, JPEG or WebP image (magic bytes checked).',
};

export const CONVENTIONS: readonly string[] = [
  '- **Base path**: every endpoint lives under `/api`. Bodies and responses are JSON (`application/json`) unless the endpoint says otherwise.',
  '- **Authentication**: session cookie `es_session` (httpOnly, Secure, SameSite). Levels: `public`, `setup` (signed `es_setup` cookie issued by the setup code step), `mfa-pending` (password accepted, second factor missing: valid only for the 2FA login steps and logout), `session` (any logged-in user), `admin` (role `admin`).',
  '- **CSRF**: every unsafe request (POST, PUT, PATCH, DELETE) that needs a session, plus the login, setup code and password reset requests, must send the `X-CSRF-Token` header. The token comes from `GET /api/auth/csrf` (before login, backed by a double-submit cookie) or from the login/session responses. Endpoints marked `CSRF: no` are public token-based endpoints (downloads).',
  '- **Errors**: always `{ "error": { "code", "message", "requestId", "details"? } }`. `code` is stable and translated by the web app (`errors.<CODE>`); `message` is English and informational. `requestId` matches the `X-Request-Id` response header. Codes and statuses are listed below.',
  '- **Timestamps**: Unix seconds (integer), same as the database. Sizes are bytes (integer).',
  '- **Pagination**: query `page` (from 1) and `pageSize` (default 20, max 100); response `{ items, total, page, pageSize }`.',
  '- **Ownership**: a user who is not the owner of a transfer receives `404 TRANSFER_NOT_FOUND`, never 403. Admins can read and manage every transfer.',
  '- **Setup gate**: until the setup is completed every endpoint other than `/api/health`, `/api/setup/*`, `/api/public/settings`, `/api/assets/*`, `/api/auth/csrf` and `/api/auth/session` answers `409 SETUP_REQUIRED`.',
  '- **Rate limiting**: endpoints with a rate limit answer `429 RATE_LIMITED` with a `Retry-After` header.',
  '- **Validation**: params, query and body are validated with the Zod schemas of `packages/shared`. Types below are generated from those schemas; rules that JSON Schema cannot express are written in the notes.',
];

export interface ContractDecision {
  title: string;
  text: string;
}

/** The contract decisions the project owner must approve. */
export const CONTRACT_DECISIONS: readonly ContractDecision[] = [
  {
    title: 'Draft-first transfer flow',
    text: '`POST /api/transfers` creates a draft (`uploading`); files are uploaded with tus carrying `transferId`; `POST /api/transfers/:id/finalize` activates the transfer, sends the emails and returns the share URL.',
  },
  {
    title: 'Download counting',
    text: 'Every file or zip request starting at byte 0 counts as one download. A counted file download sets the signed resume cookie `es_dlr` (`Path=/api/downloads/<token>/files/<fileId>`, valid 24 hours): a later `Range` request of that file carrying it is a free resume, without it the request counts. The first count triggers the sender notification.',
  },
  {
    title: 'Unix-second timestamps',
    text: 'All timestamps in the API are integer Unix seconds, like the database; no conversion layer.',
  },
  {
    title: 'mfa-pending auth level',
    text: 'Login is two-step: password first (open an `mfa-pending` session), then TOTP or recovery code. The same level covers forced 2FA enrolment for an admin whose 2FA was reset.',
  },
  {
    title: 'Unlock cookie scoped by path',
    text: 'Unlocking a password-protected link sets the signed cookie `es_dl` with `Path=/api/downloads/<token>`, `SameSite=Strict`, valid 1 hour, so plain `<a href>` links work without scripting.',
  },
  {
    title: 'Raw image upload for branding',
    text: 'Logos, favicon and background are uploaded as a raw body (`image/png`, `image/jpeg`, `image/webp`, max 2 MB, magic bytes checked), without multipart and without multer.',
  },
  {
    title: '404 for non-owners',
    text: "A user asking for a transfer they do not own gets 404 `TRANSFER_NOT_FOUND`, so the existence of other users' transfers is not revealed.",
  },
  {
    title: 'Forced 2FA enrolment at login',
    text: 'When an admin logs in after their 2FA was reset, login answers `mfa_setup_required` and the admin must enrol a new authenticator through `POST /api/auth/login/2fa-setup` and `/2fa-setup/verify` before getting a full session.',
  },
  {
    title: 'CSRF also before login',
    text: 'Login, password reset and the setup code step also require `X-CSRF-Token`, using the double-submit token from `GET /api/auth/csrf`. The only unsafe endpoint without CSRF is `POST /api/downloads/:token/unlock` (public, token-based). Login responses return a fresh `csrfToken` because the session id changes.',
  },
  {
    title: 'SMTP editable after setup',
    text: 'Admins can change SMTP later with `PUT /api/admin/settings/smtp`, which only saves after a successful `POST /api/admin/settings/smtp/test`, like the wizard.',
  },
  {
    title: 'Appearance vs general settings',
    text: 'Instance name, footer and default theme belong to `appearance`; disk reserve, chunk size and default language belong to the general settings. `PUT /api/setup/general` writes both.',
  },
  {
    title: 'Sender shown on the download page',
    text: 'Users have an optional display name (`displayName`, 1 to 80 characters), editable by the user and by admins. The public download page returns it as `senderName`; when it is not set the client shows the instance name. The owner email is never exposed.',
  },
  {
    title: 'Admins use the normal transfer endpoints',
    text: 'Admins manage any transfer through `/api/transfers/:id` (edit expiry, revoke, delete); `GET /api/admin/transfers` only adds the cross-user listing.',
  },
];
