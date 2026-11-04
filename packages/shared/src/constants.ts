/** Shared constants. Arrays are `as const` so Zod enums and Drizzle enums use the same source. */

// ---- Expiry ----------------------------------------------------------------
/** Transfer expiry options, in seconds (`null`: the link never expires). */
export const EXPIRY_OPTIONS = {
  '3d': 259_200,
  '1w': 604_800,
  '1m': 2_592_000,
  never: null,
} as const;
export const EXPIRY_KEYS = ['3d', '1w', '1m', 'never'] as const;
export type ExpiryKey = (typeof EXPIRY_KEYS)[number];

/**
 * Value stored in `expires_at` for "never" (9999-12-31T23:59:59Z): it keeps every
 * `expires_at <= now` comparison working. The API reports it as `expiresAt: null`.
 */
export const NEVER_EXPIRES_AT = 253_402_300_799;

/** Expiry timestamp for a duration counted from `start` (the stored value for "never"). */
export function expiresAtFor(start: number, key: ExpiryKey): number {
  const seconds = EXPIRY_OPTIONS[key];
  return seconds === null ? NEVER_EXPIRES_AT : start + seconds;
}

/** Expiry as shown to clients: `null` when the stored value means "never". */
export function publicExpiresAt(expiresAt: number): number | null {
  return expiresAt >= NEVER_EXPIRES_AT ? null : expiresAt;
}

// ---- Upload ----------------------------------------------------------------
/** tus chunk size in MB (Cloudflare free caps requests at 100 MB). */
export const CHUNK_SIZE_MB = { default: 25, max: 50 } as const;
export const BYTES_PER_MB = 1024 * 1024;

// ---- Enums -----------------------------------------------------------------
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** `expired` and `deleted` are reserved: never stored (expiry is derived, deleting removes the row). */
export const TRANSFER_STATUSES = ['uploading', 'active', 'revoked', 'expired', 'deleted'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_MODES = ['link', 'email'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

/** Where a transfer comes from: sent by its owner, or received through an upload request link. */
export const TRANSFER_SOURCES = ['sent', 'received'] as const;
export type TransferSource = (typeof TRANSFER_SOURCES)[number];

/** Stored status of an upload request; `expired` is derived from `expires_at`, never stored. */
export const UPLOAD_REQUEST_STATUSES = ['active', 'revoked'] as const;
export type UploadRequestStatus = (typeof UPLOAD_REQUEST_STATUSES)[number];

export const UPLOAD_STATUSES = ['in_progress', 'processing', 'completed', 'aborted'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const APP_MODES = ['local', 'production'] as const;
export type AppMode = (typeof APP_MODES)[number];

// ---- Auth ------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const RECOVERY_CODES_COUNT = 10;
export const TOTP_CODE_LENGTH = 6;

// ---- Field limits ----------------------------------------------------------
export const EMAIL_MAX_LENGTH = 254;
export const TITLE_MAX_LENGTH = 120;
export const MESSAGE_MAX_LENGTH = 2000;
export const SENDER_NAME_MAX_LENGTH = 80;
export const FILENAME_MAX_LENGTH = 255;
export const INSTANCE_NAME_MAX_LENGTH = 60;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const FOOTER_MAX_LENGTH = 200;
export const MAX_RECIPIENTS = 20;
/** Default and hard cap of the admin-configurable limit of files per transfer. */
export const MAX_FILES_PER_TRANSFER_DEFAULT = 1000;
export const MAX_FILES_PER_TRANSFER_CAP = 5000;
/** Relative folder of a file inside a transfer: segments joined by "/", "" for the root. */
export const FILE_PATH_MAX_LENGTH = 1024;
export const FILE_PATH_MAX_DEPTH = 32;
export const MAX_DOWNLOADS_LIMIT = 100_000;
/** Maximum value of the optional submission limit of an upload request. */
export const MAX_SUBMISSIONS_LIMIT = 1000;
/** Free disk space (MB) that can be reserved: 10 TiB. */
export const DISK_RESERVE_MAX_MB = 10_485_760;

// ---- SMTP and Cloudflare form limits ---------------------------------------
export const SMTP_HOST_MAX_LENGTH = 255;
export const SMTP_PORT_MAX = 65_535;
export const SMTP_USERNAME_MAX_LENGTH = 255;
export const SMTP_PASSWORD_MAX_LENGTH = 1024;
export const SMTP_FROM_NAME_MAX_LENGTH = 100;
export const CLOUDFLARE_TOKEN_MIN_LENGTH = 20;
export const CLOUDFLARE_TOKEN_MAX_LENGTH = 256;

// ---- Branding --------------------------------------------------------------
export const BRANDING_ASSET_KINDS = ['logoLight', 'logoDark', 'favicon', 'background'] as const;
export type BrandingAssetKind = (typeof BRANDING_ASSET_KINDS)[number];

/** Maximum size of an uploaded branding image, in bytes. */
export const BRANDING_MAX_BYTES = 2 * BYTES_PER_MB;

/** Only raster images: no SVG, to avoid stored XSS. */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

// ---- Appearance ------------------------------------------------------------
/** Fonts bundled with the app (no external font services). The first is the default. */
export const AVAILABLE_FONTS = ['plus-jakarta-sans', 'ibm-plex-sans', 'system'] as const;
export type AvailableFont = (typeof AVAILABLE_FONTS)[number];
export const DEFAULT_FONT: AvailableFont = 'plus-jakarta-sans';

// ---- Pagination ------------------------------------------------------------
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

// ---- Storage ---------------------------------------------------------------
/** Where the encrypted files live: the server disk or an S3-compatible object store. */
export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriverKind = (typeof STORAGE_DRIVERS)[number];

export const STORAGE_MIGRATION_STATUSES = [
  'running',
  'cancelling',
  'cancelled',
  'done',
  'failed',
] as const;
export type StorageMigrationStatus = (typeof STORAGE_MIGRATION_STATUSES)[number];

/** Size of the parts of an S3 multipart upload (the S3 minimum is 5 MiB). */
export const S3_PART_SIZE_BYTES = 16 * BYTES_PER_MB;

/** Safe reasons reported by a failed storage connection test (`details.reason`). */
export const STORAGE_TEST_REASONS = [
  'ACCESS_DENIED',
  'NO_SUCH_BUCKET',
  'SIGNATURE',
  'TIMEOUT',
  'NETWORK',
  'ENDPOINT',
] as const;
export type StorageTestReason = (typeof STORAGE_TEST_REASONS)[number];

export const S3_ENDPOINT_MAX_LENGTH = 2048;
export const S3_REGION_MAX_LENGTH = 64;
export const S3_PREFIX_MAX_LENGTH = 256;
export const S3_ACCESS_KEY_ID_MAX_LENGTH = 128;
export const S3_SECRET_ACCESS_KEY_MAX_LENGTH = 256;
