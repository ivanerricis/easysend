import type {
  CloudflareRequest,
  CloudflareResponse,
  OkResponse,
  SetupAdminRequest,
  SetupAdminVerifyRequest,
  SetupAdminVerifyResponse,
  SetupCodeRequest,
  SetupGeneralRequest,
  SetupSmtpResponse,
  SetupStatusResponse,
  SmtpSettings,
  SmtpSettingsPublic,
  SmtpTestResponse,
  TwoFactorSetupResponse,
} from '@easysend/shared';
import { setCsrfToken } from './client';
import { createApi } from './endpoint';

const api = createApi([
  'setup.status',
  'setup.code',
  'setup.admin',
  'setup.adminVerify',
  'setup.smtpGet',
  'setup.smtpTest',
  'setup.smtpSave',
  'setup.cloudflare',
  'setup.general',
  'setup.complete',
] as const);

export const USED_ENDPOINTS = api.ids;

// Wizard calls: a 401 means a wrong code or an expired cookie, handled by the wizard itself.
const flow = { skipAuthRedirect: true } as const;

export function getSetupStatus(): Promise<SetupStatusResponse> {
  return api.call('setup.status', flow);
}

/** Exchanges the setup code (printed in the API log) for the `es_setup` cookie. */
export function submitSetupCode(body: SetupCodeRequest): Promise<OkResponse> {
  return api.call('setup.code', { ...flow, body });
}

/** Creates the first admin (password step); returns the TOTP secret to enrol. */
export function createSetupAdmin(body: SetupAdminRequest): Promise<TwoFactorSetupResponse> {
  return api.call('setup.admin', { ...flow, body });
}

/** Verifies the TOTP code; returns recovery codes and a CSRF token for the new session. */
export async function verifySetupAdmin(
  body: SetupAdminVerifyRequest,
): Promise<SetupAdminVerifyResponse> {
  const data = await api.call<SetupAdminVerifyResponse>('setup.adminVerify', { ...flow, body });
  setCsrfToken(data.csrfToken);
  return data;
}

export function getSetupSmtp(): Promise<SetupSmtpResponse> {
  return api.call('setup.smtpGet', flow);
}

export function testSetupSmtp(body: SmtpSettings): Promise<SmtpTestResponse> {
  return api.call('setup.smtpTest', { ...flow, body });
}

export function saveSetupSmtp(body: SmtpSettings): Promise<SmtpSettingsPublic> {
  return api.call('setup.smtpSave', { ...flow, body });
}

export function setupCloudflare(body: CloudflareRequest): Promise<CloudflareResponse> {
  return api.call('setup.cloudflare', { ...flow, body });
}

export function saveSetupGeneral(body: SetupGeneralRequest): Promise<OkResponse> {
  return api.call('setup.general', { ...flow, body });
}

export function completeSetup(): Promise<OkResponse> {
  return api.call('setup.complete', flow);
}
