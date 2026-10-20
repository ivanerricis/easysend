import type {
  CsrfResponse,
  Login2faRequest,
  LoginCompletedResponse,
  LoginEnrollVerifyResponse,
  LoginRecoveryRequest,
  LoginRequest,
  LoginResponse,
  OkResponse,
  PasswordResetConfirm,
  PasswordResetRequest,
  SessionResponse,
  TwoFactorSetupResponse,
} from '@easysend/shared';
import { setCsrfToken } from './client';
import { createApi } from './endpoint';

const api = createApi([
  'auth.csrf',
  'auth.session',
  'auth.login',
  'auth.login2fa',
  'auth.loginRecovery',
  'auth.login2faSetup',
  'auth.login2faSetupVerify',
  'auth.logout',
  'auth.passwordResetRequest',
  'auth.passwordResetConfirm',
] as const);

export const USED_ENDPOINTS = api.ids;

// Login-flow calls never trigger the "session expired" redirect: the page handles the error.
const flow = { skipAuthRedirect: true } as const;

/** Fetches a fresh CSRF token and stores it. */
export async function fetchCsrf(): Promise<CsrfResponse> {
  const data = await api.call<CsrfResponse>('auth.csrf', flow);
  setCsrfToken(data.csrfToken);
  return data;
}

/** Current session (`authenticated: false` for anonymous visitors). Stores the CSRF token. */
export async function getSession(): Promise<SessionResponse> {
  const data = await api.call<SessionResponse>('auth.session', flow);
  if (data.authenticated) setCsrfToken(data.csrfToken);
  return data;
}

/**
 * Login step 1. On `ok` the new CSRF token is stored; on `mfa_required` / `mfa_setup_required`
 * the token is cleared so the next call refetches it (the session id was rotated).
 */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const data = await api.call<LoginResponse>('auth.login', { ...flow, body });
  setCsrfToken(data.status === 'ok' ? data.csrfToken : null);
  return data;
}

export async function login2fa(body: Login2faRequest): Promise<LoginCompletedResponse> {
  const data = await api.call<LoginCompletedResponse>('auth.login2fa', { ...flow, body });
  setCsrfToken(data.csrfToken);
  return data;
}

export async function loginRecovery(body: LoginRecoveryRequest): Promise<LoginCompletedResponse> {
  const data = await api.call<LoginCompletedResponse>('auth.loginRecovery', { ...flow, body });
  setCsrfToken(data.csrfToken);
  return data;
}

/** Starts the forced 2FA enrolment of the login flow (secret + otpauth URI). */
export function login2faSetup(): Promise<TwoFactorSetupResponse> {
  return api.call('auth.login2faSetup', flow);
}

export async function login2faSetupVerify(
  body: Login2faRequest,
): Promise<LoginEnrollVerifyResponse> {
  const data = await api.call<LoginEnrollVerifyResponse>('auth.login2faSetupVerify', {
    ...flow,
    body,
  });
  setCsrfToken(data.csrfToken);
  return data;
}

/** Ends the session (also cancels a half-done login). */
export async function logout(): Promise<void> {
  try {
    await api.call('auth.logout', flow);
  } finally {
    setCsrfToken(null);
  }
}

export function requestPasswordReset(body: PasswordResetRequest): Promise<OkResponse> {
  return api.call('auth.passwordResetRequest', { ...flow, body });
}

export function confirmPasswordReset(body: PasswordResetConfirm): Promise<OkResponse> {
  return api.call('auth.passwordResetConfirm', { ...flow, body });
}
