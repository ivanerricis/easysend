import type { HealthResponse, PublicSettingsResponse } from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi(['health.check', 'settings.public'] as const);

export const USED_ENDPOINTS = api.ids;

export function getHealth(): Promise<HealthResponse> {
  return api.call('health.check', { skipAuthRedirect: true });
}

/** Instance appearance, assets, app mode and setup state. Works without a session. */
export function getPublicSettings(): Promise<PublicSettingsResponse> {
  return api.call('settings.public', { skipAuthRedirect: true });
}
