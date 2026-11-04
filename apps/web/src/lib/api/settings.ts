import type {
  AdminSettingsResponse,
  Appearance,
  AppearanceStateResponse,
  BrandingAssetKind,
  SmtpSettings,
  SmtpSettingsPublic,
  SmtpTestResponse,
  StorageSettingsResponse,
  StorageTestRequest,
  StorageTestResponse,
  StorageUpdateRequest,
  UpdateGeneralSettingsRequest,
  UploadBrandingAssetResponse,
} from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi([
  'settings.adminGet',
  'settings.adminUpdate',
  'settings.smtpSave',
  'settings.smtpTest',
  'settings.appearanceUpdate',
  'settings.appearanceReset',
  'settings.assetUpload',
  'settings.assetDelete',
  'settings.storage',
  'settings.storageTest',
  'settings.storageUpdate',
] as const);

export const USED_ENDPOINTS = api.ids;

/** General + SMTP settings (the SMTP password is never returned: only `hasPassword`). */
export function getAdminSettings(): Promise<AdminSettingsResponse> {
  return api.call('settings.adminGet');
}

export function updateGeneralSettings(
  body: UpdateGeneralSettingsRequest,
): Promise<AdminSettingsResponse> {
  return api.call('settings.adminUpdate', { body });
}

/** Saving requires a successful `testSmtp` of the same settings (else `SMTP_NOT_VERIFIED`). */
export function saveSmtp(body: SmtpSettings): Promise<SmtpSettingsPublic> {
  return api.call('settings.smtpSave', { body });
}

/** Sends a test email to the requesting admin. */
export function testSmtp(body: SmtpSettings): Promise<SmtpTestResponse> {
  return api.call('settings.smtpTest', { body });
}

export function updateAppearance(body: Appearance): Promise<AppearanceStateResponse> {
  return api.call('settings.appearanceUpdate', { body });
}

export function resetAppearance(): Promise<AppearanceStateResponse> {
  return api.call('settings.appearanceReset');
}

/** Uploads a branding image (png / jpeg / webp) as a raw body. */
export function uploadBrandingAsset(
  kind: BrandingAssetKind,
  file: Blob,
): Promise<UploadBrandingAssetResponse> {
  return api.call('settings.assetUpload', {
    params: { kind },
    raw: { body: file, contentType: file.type },
  });
}

export function deleteBrandingAsset(kind: BrandingAssetKind): Promise<void> {
  return api.call('settings.assetDelete', { params: { kind } });
}

/** URL of a branding asset; `updatedAt` busts the cache when the image changes. */
export function assetUrl(kind: BrandingAssetKind, updatedAt: number): string {
  return `/api/assets/${kind}?v=${updatedAt}`;
}

/** Storage configuration, usage per driver and locked fields. */
export function getStorageSettings(): Promise<StorageSettingsResponse> {
  return api.call('settings.storage');
}

/** Checks the S3 connection; saving an S3 configuration needs a successful test of the same values. */
export function testStorage(body: StorageTestRequest): Promise<StorageTestResponse> {
  return api.call('settings.storageTest', { body });
}

export function saveStorage(body: StorageUpdateRequest): Promise<StorageSettingsResponse> {
  return api.call('settings.storageUpdate', { body });
}
