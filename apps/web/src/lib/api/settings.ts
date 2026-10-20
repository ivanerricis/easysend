import type {
  AdminSettingsResponse,
  Appearance,
  AppearanceStateResponse,
  BrandingAssetKind,
  SmtpSettings,
  SmtpSettingsPublic,
  SmtpTestResponse,
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
