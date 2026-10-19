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
 * Covered: the endpoints tagged `auth`, `me` and `users` (phase 2, this includes `GET /api/config`,
 * tagged `me`), `transfers`, `uploads` and `downloads` (phase 3) plus `admin.storage`, `settings`
 * and `admin.tunnel*` (phase 4). The `setup` endpoints need an app whose setup is not completed:
 * they have their own block at the end. The tus `HEAD`/`OPTIONS` endpoints are left to the tus tests. The "scope" tests below fail when a route
 * of ANY other endpoint starts to answer, or when a covered endpoint is not mounted, so nothing
 * can be added without being covered here.
 */

const COVERED_TAGS: ReadonlySet<string> = new Set([
  'auth',
  'me',
  'users',
  'transfers',
  'uploads',
  'downloads',
  'settings',
]);
const COVERED_IDS: ReadonlySet<string> = new Set([
  'admin.storage',
  'admin.tunnelGet',
  'admin.tunnelSet',
]);
const isSetup = (e: EndpointDef): boolean => e.tag === 'setup';
/** Endpoints outside the covered set that are mounted (and covered by their own tests). */
const isOtherImplemented = (e: EndpointDef): boolean => e.id === 'health.check' || isSetup(e);
/** Unsafe endpoints without a CSRF token, each an explicit decision of the contract. */
const UNSAFE_WITHOUT_CSRF = ['downloads.unlock'];

/** Explicit list: adding a covered endpoint to the registry forces an update of this test. */
const EXPECTED_IDS = [
  'admin.storage',
  'admin.tunnelGet',
  'admin.tunnelSet',
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
  'downloads.file',
  'downloads.info',
  'downloads.unlock',
  'downloads.zip',
  'me.2faDisable',
  'me.2faEnable',
  'me.2faSetup',
  'me.config',
  'me.get',
  'me.password',
  'me.recoveryCodes',
  'me.update',
  'settings.adminGet',
  'settings.adminUpdate',
  'settings.appearanceReset',
  'settings.appearanceUpdate',
  'settings.asset',
  'settings.assetDelete',
  'settings.assetUpload',
  'settings.public',
  'settings.smtpSave',
  'settings.smtpTest',
  'transfers.adminList',
  'transfers.create',
  'transfers.delete',
  'transfers.deleteFile',
  'transfers.downloads',
  'transfers.finalize',
  'transfers.get',
  'transfers.list',
  'transfers.resend',
  'transfers.revoke',
  'transfers.update',
  'uploads.create',
  'uploads.delete',
  'uploads.patch',
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

const isCovered = (e: EndpointDef): boolean => COVERED_TAGS.has(e.tag) || COVERED_IDS.has(e.id);
const covered = endpoints.filter((e) => isCovered(e) && isRequestMethod(e.method));

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
  it('covers exactly the expected endpoints', () => {
    expect(covered.map((e) => e.id).sort()).toEqual(EXPECTED_IDS);
  });

  it('every covered endpoint is mounted and nothing else is (except the allowlist)', async () => {
    const t = await createTestApp();
    const client = t.client();
    const wrong: string[] = [];
    for (const e of endpoints) {
      if (!isRequestMethod(e.method)) continue; // tus HEAD/OPTIONS: see the tus tests
      const res = await send(client, e, { csrf: false });
      const mounted = !(res.status === 404 && errorCode(res) === 'NOT_FOUND');
      const shouldBeMounted = isCovered(e) || isOtherImplemented(e);
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
    const list = covered.filter((e) => e.auth !== 'public');
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
    const list = covered.filter((e) => e.auth === 'session' || e.auth === 'admin');
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
    const list = covered.filter((e) => e.auth === 'mfa-pending' && e.id !== 'auth.logout');
    const failures = await forEach(list, async (e) =>
      expectError(await send(f.user(), e), 401, 'UNAUTHENTICATED'),
    );
    count(list.length);
    expect(failures).toEqual([]);

    const logout = covered.find((e) => e.id === 'auth.logout')!;
    expect((await send(f.user(), logout)).status).toBe(204);
    expect((await send(f.userPending(), logout)).status).toBe(204);
    count(2);
  });

  it('rejects admin endpoints for a normal user with a valid session and CSRF token (403)', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const list = covered.filter((e) => e.auth === 'admin');
    const failures = await forEach(list, async (e) =>
      expectError(await send(f.user(), e), 403, 'FORBIDDEN'),
    );
    count(list.length);
    expect(failures).toEqual([]);
  });

  it('accepts the right credentials: fixtures are valid, so the negative checks mean something', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(covered, async (e) => {
      if (e.id === 'auth.logout') return undefined;
      const res = await send(await properClient(f, e), e);
      return BLOCKED.has(errorCode(res))
        ? `valid credentials were refused with ${res.status} ${errorCode(res)}`
        : undefined;
    });
    count(covered.length);
    expect(failures).toEqual([]);
  });
});

describe('security matrix: CSRF', () => {
  const unsafe = covered.filter((e) => isUnsafe(e) && e.csrf);

  it('only unsafe endpoints require a token and the contract flags all of them', () => {
    // An unsafe endpoint with csrf:false needs an explicit decision here.
    expect(covered.filter((e) => isUnsafe(e) && !e.csrf).map((e) => e.id)).toEqual(
      UNSAFE_WITHOUT_CSRF,
    );
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
    const failures = await forEach(covered.filter(isUnsafe), async (e) => {
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
    count(covered.filter(isUnsafe).length * 3);
    expect(failures).toEqual([]);
  });

  it('rejects cross-site requests before authentication, so anonymous probes learn nothing', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const failures = await forEach(covered.filter(isUnsafe), async (e) =>
      expectError(
        await send(f.anon(), e, { csrf: false, headers: { Origin: 'https://evil.example' } }),
        403,
        'CSRF_INVALID',
      ),
    );
    count(covered.filter(isUnsafe).length);
    expect(failures).toEqual([]);
  });

  it('does not let a safe method change state or demand a token', async () => {
    const t = await createTestApp();
    const f = await fixtures(t);
    const safe = covered.filter((e) => !isUnsafe(e));
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

describe('security matrix: setup wizard', () => {
  const setupList = endpoints.filter((e) => isSetup(e) && e.auth === 'setup');
  const unsafeSetup = setupList.filter((e) => isUnsafe(e) && e.csrf);

  /** Pre-login client that entered the setup code (holds the `es_setup` cookie). */
  async function unlocked(t: TestApp): Promise<TestClient> {
    const client = await csrfClient(t);
    const res = await client.post('/api/setup/code', { body: { code: t.ctx.setupCode.issue() } });
    expect(res.status).toBe(200);
    return client;
  }

  it('flags every unsafe setup endpoint for CSRF', () => {
    expect(setupList.filter((e) => isUnsafe(e) && !e.csrf).map((e) => e.id)).toEqual([]);
    expect(unsafeSetup.length).toBeGreaterThan(0);
  });

  it('rejects every setup endpoint without the setup cookie (401)', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const failures = await forEach(setupList, async (e) =>
      expectError(await send(await csrfClient(t), e), 401, 'UNAUTHENTICATED'),
    );
    count(setupList.length);
    expect(failures).toEqual([]);
  });

  it('rejects a missing or wrong CSRF token and cross-site requests with the setup cookie', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const failures = await forEach(unsafeSetup, async (e) => {
      const attempts: Parameters<TestClient['get']>[1][] = [
        { csrf: false },
        { csrf: 'wrong-token' },
        { headers: { Origin: 'https://evil.example' } },
        { headers: { 'Sec-Fetch-Site': 'cross-site' } },
      ];
      for (const options of attempts) {
        const problem = expectError(await send(client, e, options), 403, 'CSRF_INVALID');
        if (problem) return `${problem} (${JSON.stringify(options)})`;
      }
      return undefined;
    });
    count(unsafeSetup.length * 4);
    expect(failures).toEqual([]);
  });

  it('accepts the setup cookie with a valid token (not refused for who/how it was sent)', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const failures = await forEach(setupList, async (e) => {
      const res = await send(client, e);
      return BLOCKED.has(errorCode(res))
        ? `valid setup credentials were refused with ${res.status} ${errorCode(res)}`
        : undefined;
    });
    count(setupList.length);
    expect(failures).toEqual([]);
  });

  it('answers SETUP_ALREADY_COMPLETED to every setup endpoint once the setup is done', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    t.ctx.settings.set('setup_completed', true);
    const list = endpoints.filter((e) => isSetup(e) && e.id !== 'setup.status');
    const failures = await forEach(list, async (e) =>
      // setup.code is public and validates its body first: send a well-formed one.
      expectError(
        await send(client, e, e.id === 'setup.code' ? { body: { code: 'ABCD-EFGH-JKLM' } } : {}),
        409,
        'SETUP_ALREADY_COMPLETED',
      ),
    );
    count(list.length);
    expect(failures).toEqual([]);
  });
});

describe('security matrix: summary', () => {
  it('ran a non-trivial number of checks', () => {
    // Guards against the loops above silently iterating over nothing.
    expect(checks).toBeGreaterThan(100);
  });
});
