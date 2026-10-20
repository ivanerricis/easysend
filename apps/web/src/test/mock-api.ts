import { DEFAULT_APPEARANCE, type PublicSettingsResponse, type User } from '@easysend/shared';
import { vi, type Mock } from 'vitest';

export const TEST_CSRF = 'test-csrf-token-0123456789';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    displayName: null,
    role: 'user',
    locale: 'en',
    themePreference: null,
    totpEnabled: true,
    createdAt: 1_700_000_000,
    lastLoginAt: 1_700_000_000,
    ...overrides,
  };
}

export function makeAdmin(overrides: Partial<User> = {}): User {
  return makeUser({ id: 'admin-1', email: 'admin@example.com', role: 'admin', ...overrides });
}

export function makePublicSettings(
  overrides: Partial<PublicSettingsResponse> = {},
): PublicSettingsResponse {
  return {
    setupCompleted: true,
    appMode: 'local',
    defaultLocale: 'en',
    appearance: { ...DEFAULT_APPEARANCE },
    assets: { logoLight: null, logoDark: null, favicon: null, background: null },
    ...overrides,
  };
}

/** What a handler receives. */
export interface MockRequest {
  method: string;
  /** Path without the query string. */
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body (undefined when there is none or it is raw). */
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Route table keyed by `METHOD /api/path` (query string ignored), e.g. `'GET /api/me'`.
 * A value is one of:
 * - a plain object / array: JSON response with status 200;
 * - `{ status, body?, headers? }`: custom response (`{ status: 204 }` for no content);
 * - a `Response`;
 * - a function `(request: MockRequest) => value | Promise<value>` returning any of the above.
 */
export type MockRoutes = Record<string, unknown>;

export function apiError(status: number, code: string, message = code) {
  return { status, body: { error: { code, message, requestId: 'req-test' } } };
}

interface CustomReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function isCustom(reply: unknown): reply is CustomReply {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    typeof (reply as { status?: unknown }).status === 'number'
  );
}

function toResponse(reply: unknown): Response {
  if (reply instanceof Response) return reply;
  if (isCustom(reply)) {
    const { status, body, headers } = reply;
    if (status === 204 || body === undefined) return new Response(null, { status, headers });
    return Response.json(body, { status, headers });
  }
  return Response.json(reply);
}

export interface MockApi {
  fetchMock: Mock<typeof fetch>;
  /** Every request received, in order. */
  calls: MockRequest[];
  /** Requests matching a `METHOD /api/path` key. */
  callsTo: (key: string) => MockRequest[];
}

/**
 * Replaces `fetch` with a router over `routes` (keys `METHOD /api/path`). Unmatched requests
 * answer 404 NOT_FOUND so a missing mock is visible. Call it before rendering; it uses
 * `vi.stubGlobal`, which the test setup restores after each test.
 *
 * @example
 * const api = mockApi({
 *   'GET /api/me': { user: makeUser(), usedBytes: 0, quotaBytes: null },
 *   'POST /api/transfers': (req) => ({ status: 201, body: makeTransfer(req.body) }),
 *   'DELETE /api/transfers/t1': { status: 204 },
 * });
 * ...
 * expect(api.callsTo('DELETE /api/transfers/t1')).toHaveLength(1);
 */
export function mockApi(routes: MockRoutes): MockApi {
  const calls: MockRequest[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body) {
      body = init.body;
    }
    const request: MockRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(request);
    const handler = routes[`${method} ${url.pathname}`];
    if (handler === undefined) return toResponse(apiError(404, 'NOT_FOUND'));
    const reply: unknown =
      typeof handler === 'function'
        ? await (handler as (r: MockRequest) => unknown)(request)
        : handler;
    return toResponse(reply);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    calls,
    callsTo: (key) => calls.filter((call) => `${call.method} ${call.path}` === key),
  };
}
