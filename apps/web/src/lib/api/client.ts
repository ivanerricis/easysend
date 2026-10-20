import { errorResponseSchema, type ErrorCode } from '@easysend/shared';
import type { z } from 'zod';

/** Error thrown by every API call: HTTP failures, network failures and contract mismatches. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  /** Seconds from the `Retry-After` header, when the server sent one. */
  readonly retryAfter: number | undefined;

  constructor(init: {
    status: number;
    code: ErrorCode;
    message: string;
    requestId?: string | undefined;
    details?: Record<string, unknown> | undefined;
    retryAfter?: number | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryAfter = init.retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path with `:param` placeholders, e.g. `/api/transfers/:id`. */
  path: string;
  params?: Record<string, string | number> | undefined;
  /** Undefined / null values are skipped. */
  query?: Record<string, QueryValue> | undefined;
  /** JSON body. */
  body?: unknown;
  /** Raw body (branding images): sent as is with its own content type. */
  raw?: { body: Blob; contentType: string } | undefined;
  /** Validates (and types) a successful JSON response. */
  schema?: z.ZodType<T> | undefined;
  /** Do not run the SETUP_REQUIRED / UNAUTHENTICATED hooks (login-flow calls). */
  skipAuthRedirect?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface ApiHooks {
  /** A request got 409 SETUP_REQUIRED. */
  onSetupRequired?: () => void;
  /** A request got 401 UNAUTHENTICATED (expired or missing session). */
  onUnauthenticated?: () => void;
}

let hooks: ApiHooks = {};

/** Registered once by the app (router and query client live outside this module). */
export function configureApiClient(next: ApiHooks): void {
  hooks = next;
}

// ---- CSRF ------------------------------------------------------------------
let csrfToken: string | null = null;
let csrfInflight: Promise<string> | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Returns the in-memory token, fetching it from `GET /api/auth/csrf` when missing. */
export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfInflight ??= (async () => {
    try {
      const data = await request<{ csrfToken: string }>({
        method: 'GET',
        path: '/api/auth/csrf',
        skipAuthRedirect: true,
      });
      csrfToken = data.csrfToken;
      return data.csrfToken;
    } finally {
      csrfInflight = null;
    }
  })();
  return csrfInflight;
}

// ---- Request ---------------------------------------------------------------
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Replaces `:name` placeholders with URI-encoded values. */
export function fillPath(path: string, params?: Record<string, string | number>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryHeader = response.headers.get('Retry-After');
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const parsed = errorResponseSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError({ status: response.status, code, message, requestId, details, retryAfter });
  }
  const unavailable = response.status === 502 || response.status === 503 || response.status === 504;
  return new ApiError({
    status: response.status,
    code: unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
    message: `Unexpected response (${response.status})`,
    retryAfter,
  });
}

async function send(options: RequestOptions<unknown>, retriedCsrf: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method: options.method, credentials: 'same-origin', headers };
  if (options.signal) init.signal = options.signal;
  if (options.raw) {
    headers['Content-Type'] = options.raw.contentType;
    init.body = options.raw.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (!SAFE.has(options.method)) headers['X-CSRF-Token'] = await ensureCsrfToken();

  const url = fillPath(options.path, options.params) + buildQuery(options.query);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ status: 0, code: 'SERVICE_UNAVAILABLE', message: 'Network error' });
  }
  if (response.status === 403 && !retriedCsrf && !SAFE.has(options.method)) {
    const error = await toApiError(response.clone());
    if (error.code === 'CSRF_INVALID') {
      csrfToken = null;
      return send(options, true);
    }
  }
  return response;
}

/**
 * Typed JSON request with CSRF handling and standard error mapping.
 * Resolves to `undefined` for 204 responses.
 */
export async function request<T = void>(options: RequestOptions<T>): Promise<T> {
  const response = await send(options, false);
  if (!response.ok) {
    const error = await toApiError(response);
    if (!options.skipAuthRedirect) {
      if (error.code === 'SETUP_REQUIRED') hooks.onSetupRequired?.();
      else if (error.code === 'UNAUTHENTICATED') hooks.onUnauthenticated?.();
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      message: 'Response is not valid JSON',
    });
  }
  if (!options.schema) return data as T;
  const parsed = options.schema.safeParse(data);
  if (!parsed.success) {
    if (import.meta.env.DEV) console.error('API response mismatch', options.path, parsed.error);
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected response shape',
    });
  }
  return parsed.data;
}
