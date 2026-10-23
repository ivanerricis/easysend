import type { z } from 'zod';
import type { ErrorCode } from '../schemas/errors.js';

/**
 * Who may call an endpoint.
 * - `public`: no authentication.
 * - `setup`: signed `es_setup` cookie issued by `POST /api/setup/code`; only while setup is incomplete.
 * - `mfa-pending`: session whose second factor is not verified yet; valid only for the 2FA steps of the login (and logout, which also cancels a half-done login).
 * - `session`: fully authenticated session (any role).
 * - `admin`: fully authenticated session with the `admin` role.
 */
export const AUTH_LEVELS = ['public', 'mfa-pending', 'session', 'admin', 'setup'] as const;
export type AuthLevel = (typeof AUTH_LEVELS)[number];

export const ENDPOINT_TAGS = [
  'health',
  'setup',
  'auth',
  'me',
  'users',
  'transfers',
  'uploads',
  'downloads',
  'admin',
  'settings',
] as const;
export type EndpointTag = (typeof ENDPOINT_TAGS)[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const SAFE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'OPTIONS'];

export const RATE_LIMITS = [
  'login',
  'reauth',
  'passwordReset',
  'transferCreate',
  'downloadPassword',
  'download',
  'setupCode',
  'updateCheck',
  'updateStart',
] as const;
export type RateLimitName = (typeof RATE_LIMITS)[number];

/**
 * - `json`: JSON body described by `schema`.
 * - `binary`: raw bytes (file or image).
 * - `stream`: streamed binary generated on the fly (zip).
 * - `tus`: tus protocol response, see the tus section.
 * - `empty`: no body.
 */
export type ResponseKind = 'json' | 'binary' | 'stream' | 'tus' | 'empty';

export interface EndpointResponse {
  status: number;
  kind: ResponseKind;
  schema?: z.ZodType;
  /** Relevant response headers, name to description. */
  headers?: Record<string, string>;
}

/** Raw (non-JSON) request body, used by image upload and tus PATCH. */
export interface RawBody {
  contentTypes: readonly string[];
  /** Maximum size in bytes, when bounded. */
  maxBytes?: number;
  description: string;
}

export interface EndpointDef {
  /** Stable identifier, `<tag>.<action>`. */
  id: string;
  tag: EndpointTag;
  method: HttpMethod;
  /** Express-style path under `/api`, e.g. `/api/transfers/:id`. */
  path: string;
  summary: string;
  auth: AuthLevel;
  /** Requires the `X-CSRF-Token` header. */
  csrf: boolean;
  rateLimit?: RateLimitName;
  params?: z.ZodObject;
  query?: z.ZodObject;
  /** JSON request body. */
  body?: z.ZodType;
  /** Non-JSON request body (mutually exclusive with `body`). */
  rawBody?: RawBody;
  /** Relevant request headers, name to description. */
  requestHeaders?: Record<string, string>;
  response: EndpointResponse;
  /** Endpoint-specific errors only: generic ones follow from the auth level. */
  errors: readonly ErrorCode[];
  notes?: string;
}

/** Input of `defineEndpoint`: `csrf` and `errors` can be omitted. */
export type EndpointInput = Omit<EndpointDef, 'csrf' | 'errors'> & {
  csrf?: boolean;
  errors?: readonly ErrorCode[];
};

/**
 * Builds an endpoint definition. `csrf` defaults to `true` when the method is unsafe and the
 * endpoint is not public; `errors` defaults to none.
 */
export const defineEndpoint = (input: EndpointInput): EndpointDef => ({
  ...input,
  csrf: input.csrf ?? (!SAFE_METHODS.includes(input.method) && input.auth !== 'public'),
  errors: input.errors ?? [],
});

/** Names of the `:param` placeholders of an Express-style path, in order. */
export const pathParamNames = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);

/** Errors every endpoint can return because of its auth level, CSRF, rate limit or validation. */
export const implicitErrors = (e: EndpointDef): ErrorCode[] => {
  const codes: ErrorCode[] = [];
  if (e.params || e.query || e.body) codes.push('VALIDATION_ERROR');
  if (e.auth !== 'public') codes.push('UNAUTHENTICATED');
  if (e.auth === 'admin') codes.push('FORBIDDEN');
  if (e.auth === 'setup') codes.push('SETUP_ALREADY_COMPLETED');
  if (e.csrf) codes.push('CSRF_INVALID');
  if (e.rateLimit) codes.push('RATE_LIMITED');
  codes.push('INTERNAL_ERROR');
  return codes;
};
