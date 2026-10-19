import { randomBytes } from 'node:crypto';
import { nowSeconds } from '../src/clock.js';
import { sha256Hex } from '../src/crypto/hash.js';
import { sessions } from '../src/db/schema/index.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';
import type { TestApp, TestClient, TestUser } from './helpers.js';

/**
 * A client that is already logged in as `user`, without going through the login endpoint (the
 * auth flows have their own tests). `mfaVerified: false` gives a pending session.
 */
export function loginAs(
  t: TestApp,
  user: Pick<TestUser, 'id'>,
  options: { mfaVerified?: boolean } = {},
): TestClient {
  const token = randomBytes(32).toString('base64url');
  const id = sha256Hex(token);
  const now = nowSeconds(t.clock);
  t.db.db
    .insert(sessions)
    .values({
      id,
      userId: user.id,
      expiresAt: now + 3600,
      absoluteExpiresAt: now + 86_400,
      createdAt: now,
      lastSeenAt: now,
      mfaVerified: options.mfaVerified ?? true,
    })
    .run();
  const client = t.client();
  client.setCookie(SESSION_COOKIE, token);
  client.csrfToken = t.ctx.csrf.sessionToken(id);
  return client;
}
