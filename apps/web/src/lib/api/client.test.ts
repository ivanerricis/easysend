import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  configureApiClient,
  fillPath,
  getCsrfToken,
  buildQuery,
  request,
  setCsrfToken,
} from './client';

function errorBody(code: string, message = 'x') {
  return { error: { code, message, requestId: 'req-1' } };
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

beforeEach(() => {
  setCsrfToken(null);
  configureApiClient({});
});
afterEach(() => vi.unstubAllGlobals());

describe('path and query helpers', () => {
  it('fills and encodes placeholders', () => {
    expect(fillPath('/api/t/:id/files/:fileId', { id: 'a b', fileId: 7 })).toBe(
      '/api/t/a%20b/files/7',
    );
    expect(() => fillPath('/api/t/:id')).toThrow();
  });
  it('skips undefined query values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(buildQuery({})).toBe('');
  });
});

describe('request', () => {
  it('sends the CSRF header on unsafe methods only, fetching the token first', async () => {
    const fetchMock = stubFetch(
      Response.json({ csrfToken: 'token-0123456789abcdef' }),
      Response.json({ ok: true }),
    );
    await request({ method: 'POST', path: '/api/x', body: { a: 1 } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/csrf');
    const second = fetchMock.mock.calls[1] ?? [];
    expect(headersOf(second)['X-CSRF-Token']).toBe('token-0123456789abcdef');
    expect(headersOf(second)['Content-Type']).toBe('application/json');
    expect((second[1] as RequestInit).body).toBe('{"a":1}');
    expect((second[1] as RequestInit).credentials).toBe('same-origin');

    stubFetch(Response.json({ ok: true }));
    await request({ method: 'GET', path: '/api/x' });
  });

  it('does not send the CSRF header on GET', async () => {
    setCsrfToken('abc');
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await request({ method: 'GET', path: '/api/x' });
    expect(headersOf(fetchMock.mock.calls[0] ?? [])['X-CSRF-Token']).toBeUndefined();
  });

  it('refetches the token and retries once on CSRF_INVALID', async () => {
    setCsrfToken('stale');
    const fetchMock = stubFetch(
      Response.json(errorBody('CSRF_INVALID'), { status: 403 }),
      Response.json({ csrfToken: 'fresh-0123456789abcdef' }),
      new Response(null, { status: 204 }),
    );
    await expect(request({ method: 'DELETE', path: '/api/x' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(headersOf(fetchMock.mock.calls[2] ?? [])['X-CSRF-Token']).toBe('fresh-0123456789abcdef');
    expect(getCsrfToken()).toBe('fresh-0123456789abcdef');
  });

  it('gives up after one CSRF retry', async () => {
    setCsrfToken('stale');
    stubFetch(
      Response.json(errorBody('CSRF_INVALID'), { status: 403 }),
      Response.json({ csrfToken: 'fresh-0123456789abcdef' }),
      Response.json(errorBody('CSRF_INVALID'), { status: 403 }),
    );
    await expect(request({ method: 'POST', path: '/api/x' })).rejects.toMatchObject({
      code: 'CSRF_INVALID',
    });
  });

  it('parses error responses and Retry-After', async () => {
    setCsrfToken('abc');
    stubFetch(
      Response.json(errorBody('ACCOUNT_LOCKED', 'locked'), {
        status: 429,
        headers: { 'Retry-After': '120' },
      }),
    );
    const error = await request({ method: 'POST', path: '/api/x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'ACCOUNT_LOCKED',
      requestId: 'req-1',
      retryAfter: 120,
    });
  });

  it('maps non-JSON failures and network errors', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(request({ method: 'GET', path: '/api/x' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    stubFetch(new Response('oops', { status: 500 }));
    await expect(request({ method: 'GET', path: '/api/x' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(request({ method: 'GET', path: '/api/x' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 0,
    });
  });

  it('rejects a response that does not match the schema', async () => {
    const { z } = await import('zod');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(Response.json({ nope: true }));
    await expect(
      request({ method: 'GET', path: '/api/x', schema: z.object({ ok: z.literal(true) }) }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('runs the SETUP_REQUIRED and UNAUTHENTICATED hooks unless skipped', async () => {
    const onSetupRequired = vi.fn();
    const onUnauthenticated = vi.fn();
    configureApiClient({ onSetupRequired, onUnauthenticated });

    stubFetch(Response.json(errorBody('SETUP_REQUIRED'), { status: 409 }));
    await request({ method: 'GET', path: '/api/x' }).catch(() => undefined);
    expect(onSetupRequired).toHaveBeenCalledTimes(1);

    stubFetch(Response.json(errorBody('UNAUTHENTICATED'), { status: 401 }));
    await request({ method: 'GET', path: '/api/x' }).catch(() => undefined);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);

    stubFetch(Response.json(errorBody('UNAUTHENTICATED'), { status: 401 }));
    await request({ method: 'GET', path: '/api/x', skipAuthRedirect: true }).catch(() => undefined);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('sends raw bodies with their own content type', async () => {
    setCsrfToken('abc');
    const fetchMock = stubFetch(Response.json({ ok: true }));
    const blob = new Blob(['x'], { type: 'image/png' });
    await request({
      method: 'POST',
      path: '/api/x',
      raw: { body: blob, contentType: 'image/png' },
    });
    const call = fetchMock.mock.calls[0] ?? [];
    expect(headersOf(call)['Content-Type']).toBe('image/png');
    expect((call[1] as RequestInit).body).toBe(blob);
  });
});
