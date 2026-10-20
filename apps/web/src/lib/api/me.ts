import type {
  ChangePasswordRequest,
  ConfigResponse,
  MeResponse,
  ReauthRequest,
  RecoveryCodesResponse,
  TwoFactorEnableRequest,
  TwoFactorSetupResponse,
  UpdateMeRequest,
} from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi([
  'me.get',
  'me.update',
  'me.password',
  'me.2faSetup',
  'me.2faEnable',
  'me.2faDisable',
  'me.recoveryCodes',
  'me.config',
] as const);

export const USED_ENDPOINTS = api.ids;

/** Current user with storage usage and quota. */
export function getMe(): Promise<MeResponse> {
  return api.call('me.get');
}

export function updateMe(body: UpdateMeRequest): Promise<MeResponse> {
  return api.call('me.update', { body });
}

/** Changes the password. Other sessions are revoked, the current one is rotated. */
export function changePassword(body: ChangePasswordRequest): Promise<void> {
  return api.call('me.password', { body });
}

export function start2faSetup(): Promise<TwoFactorSetupResponse> {
  return api.call('me.2faSetup');
}

/** Confirms the TOTP code and returns the recovery codes (shown once). */
export function enable2fa(body: TwoFactorEnableRequest): Promise<RecoveryCodesResponse> {
  return api.call('me.2faEnable', { body });
}

export function disable2fa(body: ReauthRequest): Promise<void> {
  return api.call('me.2faDisable', { body });
}

/** Regenerates the recovery codes (the old ones stop working). */
export function regenerateRecoveryCodes(body: ReauthRequest): Promise<RecoveryCodesResponse> {
  return api.call('me.recoveryCodes', { body });
}

/** Upload limits, chunk size and expiry options. */
export function getConfig(): Promise<ConfigResponse> {
  return api.call('me.config');
}
