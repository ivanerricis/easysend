/** Shared constants. Arrays are `as const` so Zod enums and Drizzle enums use the same source. */

// ---- Expiry ----------------------------------------------------------------
/** Transfer expiry options, in seconds. */
export const EXPIRY_OPTIONS = {
  '3d': 259_200,
  '1w': 604_800,
  '1m': 2_592_000,
} as const;
export const EXPIRY_KEYS = ['3d', '1w', '1m'] as const;
export type ExpiryKey = (typeof EXPIRY_KEYS)[number];

// ---- Upload ----------------------------------------------------------------
/** tus chunk size in MB (Cloudflare free caps requests at 100 MB). */
export const CHUNK_SIZE_MB = { default: 25, max: 50 } as const;
export const BYTES_PER_MB = 1024 * 1024;

// ---- Enums -----------------------------------------------------------------
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const TRANSFER_STATUSES = ['uploading', 'active', 'revoked', 'expired', 'deleted'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_MODES = ['link', 'email'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

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
export const FILENAME_MAX_LENGTH = 255;
export const INSTANCE_NAME_MAX_LENGTH = 60;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const FOOTER_MAX_LENGTH = 200;
export const MAX_RECIPIENTS = 20;
export const MAX_FILES_PER_TRANSFER = 100;
export const MAX_DOWNLOADS_LIMIT = 100_000;

// ---- Branding --------------------------------------------------------------
export const BRANDING_ASSET_KINDS = ['logoLight', 'logoDark', 'favicon', 'background'] as const;
export type BrandingAssetKind = (typeof BRANDING_ASSET_KINDS)[number];

/** Maximum size of an uploaded branding image, in bytes. */
export const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

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
