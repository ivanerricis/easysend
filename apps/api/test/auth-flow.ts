import type { User } from '@easysend/shared';
import { expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateRecoveryCodes, hashRecoveryCode } from '../src/auth/recovery-codes.js';
import { generateTotpCode } from '../src/auth/totp.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';
import { recoveryCodes } from '../src/db/schema/index.js';
import {
  bodyAs,
  errorCode,
  type TestApp,
  type TestClient,
  type TestResponse,
  type TestUser,
} from './helpers.js';

export { errorCode };

/** A client that already holds a pre-login CSRF token. */
export async function csrfClient(t: TestApp): Promise<TestClient> {
  const client = t.client();
  const res = await client.get('/api/auth/csrf');
  expect(res.status).toBe(200);
  client.csrfToken = bodyAs<{ csrfToken: string }>(res).csrfToken;
  return client;
}

export async function postLogin(
  client: TestClient,
  user: Pick<TestUser, 'email' | 'password'>,
  password: string = user.password,
): Promise<TestResponse> {
  return client.post('/api/auth/login', { body: { email: user.email, password } });
}

/** Logs in with the right password and expects `status`; keeps the CSRF token up to date. */
export async function loginAs(
  t: TestApp,
  user: TestUser,
  expected: 'ok' | 'mfa_required' | 'mfa_setup_required' = 'ok',
  client?: TestClient,
): Promise<{ client: TestClient; res: TestResponse }> {
  const c = client ?? (await csrfClient(t));
  const res = await postLogin(c, user);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe(expected);
  if (res.body.csrfToken) {
    c.csrfToken = bodyAs<{ csrfToken: string }>(res).csrfToken;
  } else {
    // Pending session: the client asks for the token bound to it.
    c.csrfToken = bodyAs<{ csrfToken: string }>(await c.get('/api/auth/csrf')).csrfToken;
  }
  return { client: c, res };
}

/** Full login of a user with 2FA: password step plus a fresh TOTP code. */
export async function loginWithTotp(t: TestApp, user: TestUser, client?: TestClient) {
  const { client: c } = await loginAs(t, user, 'mfa_required', client);
  const res = await c.post('/api/auth/login/2fa', {
    body: { code: generateTotpCode(user.totpSecret as string, t.clock()) },
  });
  expect(res.status).toBe(200);
  c.csrfToken = bodyAs<{ csrfToken: string }>(res).csrfToken;
  return { client: c, res };
}

/** Stores recovery codes for the user and returns them in clear. */
export function giveRecoveryCodes(t: TestApp, userId: string, count = 10): string[] {
  const codes = generateRecoveryCodes(count);
  t.db.db
    .insert(recoveryCodes)
    .values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(t.ctx.keys.recoveryCode, c) })))
    .run();
  return codes;
}

export const unusedRecoveryCodes = (t: TestApp, userId: string): number =>
  t.db.db
    .select()
    .from(recoveryCodes)
    .where(eq(recoveryCodes.userId, userId))
    .all()
    .filter((r) => r.usedAt === null).length;

export const sessionRows = (t: TestApp) =>
  t.db.sqlite.prepare('SELECT * FROM sessions').all() as Array<{
    id: string;
    user_id: string;
    mfa_verified: number;
  }>;

export const auditActions = (t: TestApp): string[] =>
  (
    t.db.sqlite.prepare('SELECT action FROM audit_log ORDER BY rowid').all() as Array<{
      action: string;
    }>
  ).map((r) => r.action);

export const sessionCookie = (client: TestClient): string | undefined =>
  client.cookie(SESSION_COOKIE);

/** The `user` field of a response body, typed. */
export const userOf = (res: TestResponse): User => bodyAs<{ user: User }>(res).user;
