import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { endpoints, SAFE_METHODS, type EndpointDef } from '@easysend/shared/contract';
import { csrfClient } from './auth-flow.js';
import {
  createTestApp,
  errorCode,
  type TestApp,
  type TestClient,
  type TestResponse,
} from './helpers.js';
import { loginAs } from './session-helpers.js';

/**
 * Cross-cutting authorization and CSRF matrix, driven by the shared endpoint registry.
 *
 * Order of the checks in the server (documented here, asserted below):
 *   1. cross-site rejection  (Origin / Sec-Fetch-Site, unsafe methods)   -> 403 CSRF_INVALID
 *   2. authentication level                                              -> 401 UNAUTHENTICATED / 403 FORBIDDEN
 *   3. CSRF token                                                        -> 403 CSRF_INVALID
 *   4. params / query / body validation                                  -> 400 VALIDATION_ERROR
 *   5. handler
 *
 * Phase 2 owns the endpoints tagged `auth`, `me` and `users` (this includes `GET /api/config`,
 * tagged `me`). The "scope" tests below fail when a route of ANY other endpoint starts to answer,
 * or when a phase-2 endpoint is not mounted, so nothing can be added without being covered here.
 */

const PHASE2_TAGS: ReadonlySet<string> = new Set(['auth', 'me', 'users']);
/** Endpoints outside the phase-2 tags that are mounted (and covered by their own tests). */
const OTHER_IMPLEMENTED: ReadonlySet<string> = new Set(['health.check']);

/** Explicit list: adding a phase-2 endpoint to the registry forces an update of this test. */
const EXPECTED_PHASE2_IDS = [
  'auth.csrf',
  'auth.login',
  'auth.login2fa',
  'auth.login2faSetup',
  'auth.login2faSetupVerify',
  'auth.loginRecovery',
  'auth.logout',
  'auth.passwordResetConfirm',
  'auth.passwordResetRequest',
  'auth.session',
  'me.2faDisable',
  'me.2faEnable',
  'me.2faSetup',
  'me.config',
  'me.get',
  'me.password',
  'me.recoveryCodes',
  'me.update',
  'users.create',
  'users.delete',
  'users.get',
  'users.list',
  'users.reset2fa',
  'users.update',
];

/** Codes that mean "the request was refused for who/how it was sent". */
const BLOCKED: ReadonlySet<string> = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'CSRF_INVALID']);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const isRequestMethod = (m: string): boolean =>
  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m);
const isUnsafe = (e: EndpointDef): boolean => !SAFE_METHODS.includes(e.method);

const phase2 = endpoints.filter((e) => PHASE2_TAGS.has(e.tag));

/** Concrete URL: every `:param` gets a random id (the checks below never reach a handler). */
const urlOf = (e: EndpointDef): string => e.path.replace(/:[A-Za-z0-9_]+/g, () => randomUUID());
const send = (client: TestClient, e: EndpointDef, options: Parameters<TestClient['get']>[1] = {}) =>
  client.request(e.method.toLowerCase() as Method, urlOf(e), {
    // An invalid body proves authentication/CSRF run before validation.
    ...(e.body ? { body: {} } : {}),
    ...options,
  });

/** Users and ready-made clients, one per situation. */
async function fixtures(t: TestApp) {
  const admin = await t.createUser({ role: 'admin', totp: true });
  const user = await t.createUser({ totp: true });
  return {
    anon: () => t.client(),
    preLogin: () => csrfClient(t),
    user: () => loginAs(t, user),
    admin: () => loginAs(t, admin),
    userPending: () => loginAs(t, user, { mfaVerified: false }),
    adminPending: () => loginAs(t, admin, { mfaVerified: false }),
  };
}
type Fixtures = Awaited<ReturnType<typeof fixtures>>;

/** A client holding exactly the credentials the endpoint's auth level asks for. */
function properClient(f: Fixtures, e: EndpointDef): Promise<TestClient> | TestClient {
  switch (e.auth) {
    case 'admin':
      return f.admin();
    case 'session':
      return f.user();
    case 'mfa-pending':
      return f.userPending();
    default:
      return f.preLogin();
  }
}

/** Runs `check` on every endpoint and collects the failures, so one run shows all of them. */
async function forEach(
  list: EndpointDef[],
  check: (e: EndpointDef) => Promise<string | undefined>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const e of list) {
    const problem = await check(e);
    if (problem) failures.push(`${e.id} (${e.method} ${e.path}): ${problem}`);
  }
  return failures;
}

const expectError = (res: TestResponse, status: number, code: string): string | undefined =>
  res.status === status && errorCode(res) === code
    ? undefined
    : `expected ${status} ${code}, got ${res.status} ${errorCode(res) || '(no error body)'}`;

let checks = 0;
const count = (n: number): void => {
  checks += n;
};

describe('security matrix: scope', () => {
  it('covers exactly the expected phase-2 endpoints', () => {
    expect(phase2.map((e) => e.id).sort()).toEqual(EXPECTED_PHASE2_IDS);
    for (const e of phase2) expect(isRequestMethod(e.method)).toBe(true);
  });

  it('every phase-2 endpoint is mounted and nothing else is (except the allowlist)', async () => {
    const t = await createTestApp();
    const client = t.client();
    const wrong: string[] = [];
    for (const e of endpoints) {
      if (!isRequestMethod(e.method)) continue; // HEAD/OPTIONS belong to the tus endpoints (phase 3)
      const res = await send(client, e, { csrf: false });
      const mounted = !(res.status === 404 && errorCode(res) === 'NOT_FOUND');
      const shouldBeMounted = PHASE2_TAGS.has(e.tag) || OTHER_IMPLEMENTED.has(e.id);
      if (mounted !== shouldBeMounted) {
        wrong.push(
          `${e.id}: ${mounted ? 'is mounted but not covered by this matrix' : 'is not mounted'}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('security matrix: authentication', () => {
  it('rejects every authenticated endpoint without a session (401, before CSRF and validation)', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const list = phase2.filter((e) => e.auth !== 'public');
    const failures = await forEach(list, async (e) => {
      // No credentials at all, no CSRF token, then a bogus CSRF token: always 401.
      const none = expectError(await send(f.anon(), e, { csrf: false }), 401, 'UNAUTHENTICATED');
      if (none) return none;
      return expectError(await send(f.anon(), e, { csrf: 'bogus.token' }), 401, 'UNAUTHENTICATED');
    });
    count(list.length * 2);
    expect(failures).toEqual([]);
  });

  it('rejects session and admin endpoints with a pending (2FA not verified) session', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const list = phase2.filter((e) => e.auth === 'session' || e.auth === 'admin');
    const failures = await forEach(list, async (e) => {
      const who = e.auth === 'admin' ? f.adminPending() : f.userPending();
      // Valid CSRF token of the pending session: the level check must still refuse.
      return expectError(await send(who, e), 401, 'UNAUTHENTICATED');
    });
    count(list.length);
    expect(failures).toEqual([]);
  });

  it('rejects mfa-pending endpoints with a full session (except logout, which accepts both)', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const list = phase2.filter((e) => e.auth === 'mfa-pending' && e.id !== 'auth.logout');
    const failures = await forEach(list, async (e) =>
      expectError(await send(f.user(), e), 401, 'UNAUTHENTICATED'),
    );
    count(list.length);
    expect(failures).toEqual([]);

    const logout = phase2.find((e) => e.id === 'auth.logout')!;
    expect((await send(f.user(), logout)).status).toBe(204);
    expect((await send(f.userPending(), logout)).status).toBe(204);
    count(2);
  });

  it('rejects admin endpoints for a normal user with a valid session and CSRF token (403)', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const list = phase2.filter((e) => e.auth === 'admin');
    const failures = await forEach(list, async (e) =>
      expectError(await send(f.user(), e), 403, 'FORBIDDEN'),
    );
    count(list.length);
    expect(failures).toEqual([]);
  });

  it('accepts the right credentials: fixtures are valid, so the negative checks mean something', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(phase2, async (e) => {
      if (e.id === 'auth.logout') return undefined;
      const res = await send(await properClient(f, e), e);
      return BLOCKED.has(errorCode(res))
        ? `valid credentials were refused with ${res.status} ${errorCode(res)}`
        : undefined;
    });
    count(phase2.length);
    expect(failures).toEqual([]);
  });
});

describe('security matrix: CSRF', () => {
  const unsafe = phase2.filter((e) => isUnsafe(e) && e.csrf);

  it('only unsafe endpoints require a token and the contract flags all of them', () => {
    // A phase-2 unsafe endpoint with csrf:false would need an explicit decision here.
    expect(phase2.filter((e) => isUnsafe(e) && !e.csrf).map((e) => e.id)).toEqual([]);
    expect(unsafe.length).toBeGreaterThan(0);
  });

  it('rejects a missing token (403 CSRF_INVALID) with valid credentials', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(unsafe, async (e) =>
      expectError(await send(await properClient(f, e), e, { csrf: false }), 403, 'CSRF_INVALID'),
    );
    count(unsafe.length);
    expect(failures).toEqual([]);
  });

  it('rejects a wrong token, a token of another session and a pre-login token', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const foreign = f.user().csrfToken!;
    const preLogin = (await f.preLogin()).csrfToken!;
    const failures = await forEach(unsafe, async (e) => {
      for (const token of ['wrong-token', foreign, preLogin]) {
        const client = await properClient(f, e);
        // `foreign` is valid for another session only; for pre-login endpoints the cookie is
        // that of `client`, so it does not match either.
        const problem = expectError(await send(client, e, { csrf: token }), 403, 'CSRF_INVALID');
        if (problem) return `${problem} (token ${token === 'wrong-token' ? 'wrong' : 'foreign'})`;
      }
      return undefined;
    });
    count(unsafe.length * 3);
    expect(failures).toEqual([]);
  });

  it('rejects cross-site requests even with valid credentials and token', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(phase2.filter(isUnsafe), async (e) => {
      const evil = { headers: { Origin: 'https://evil.example' } };
      const site = { headers: { 'Sec-Fetch-Site': 'cross-site' } };
      const nullOrigin = { headers: { Origin: 'null' } };
      for (const options of [evil, site, nullOrigin]) {
        const problem = expectError(
          await send(await properClient(f, e), e, options),
          403,
          'CSRF_INVALID',
        );
        if (problem) return `${problem} (${JSON.stringify(options.headers)})`;
      }
      return undefined;
    });
    count(phase2.filter(isUnsafe).length * 3);
    expect(failures).toEqual([]);
  });

  it('rejects cross-site requests before authentication, so anonymous probes learn nothing', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(phase2.filter(isUnsafe), async (e) =>
      expectError(
        await send(f.anon(), e, { csrf: false, headers: { Origin: 'https://evil.example' } }),
        403,
        'CSRF_INVALID',
      ),
    );
    count(phase2.filter(isUnsafe).length);
    expect(failures).toEqual([]);
  });

  it('does not let a safe method change state or demand a token', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const safe = phase2.filter((e) => !isUnsafe(e));
    const failures = await forEach(safe, async (e) => {
      const res = await send(await properClient(f, e), e, {
        csrf: false,
        headers: { Origin: 'https://evil.example' },
      });
      // users.get answers 404 for the random id: only auth/CSRF refusals count as failures.
      return BLOCKED.has(errorCode(res))
        ? `safe request with valid credentials answered ${res.status} ${errorCode(res)}`
        : undefined;
    });
    count(safe.length);
    expect(failures).toEqual([]);
  });
});

describe('security matrix: summary', () => {
  it('ran a non-trivial number of checks', () => {
    // Guards against the loops above silently iterating over nothing.
    expect(checks).toBeGreaterThan(100);
  });
});
