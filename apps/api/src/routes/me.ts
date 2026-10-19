import { eq } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import {
  BYTES_PER_MB,
  CHUNK_SIZE_MB,
  staticConfig,
  type ReauthRequest,
  type UpdateMeRequest,
} from '@easysend/shared';
import { generateTotpEnrollment, verifyTotp } from '../auth/totp.js';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { decryptSecret, encryptSecret } from '../crypto/aead.js';
import { users } from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited, limitedError } from '../http/rate-limit.js';
import { sendJson, validBody } from '../http/validate.js';
import { clearTwoFactor, replaceRecoveryCodes, toMe } from '../users/service.js';

export function meRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, limiters } = ctx;

  const currentUser = (req: Request) => {
    const row = db.select().from(users).where(eq(users.id, req.auth!.user.id)).get();
    if (!row) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    return row;
  };

  /** Wrong password or code on a sensitive operation: counts a failure, locks at the threshold. */
  async function reauthFailure(res: Response, userId: string, error: AppError): Promise<AppError> {
    const status = await limiters.reauth.fail(userId);
    return status.limited ? limitedError(res, status.retryAfterSeconds, 'ACCOUNT_LOCKED') : error;
  }

  /**
   * Password + current TOTP code of the logged-in user, behind the `reauth` limiter. A code that
   * was already used is refused (replay). Stores the accepted counter. Throws on any failure.
   */
  async function reauthenticate(req: Request, res: Response, input: ReauthRequest): Promise<void> {
    const user = currentUser(req);
    assertNotLimited(res, await limiters.reauth.check(user.id), 'ACCOUNT_LOCKED');

    if (!(await ctx.passwordHasher.verify(user.passwordHash, input.password))) {
      throw await reauthFailure(res, user.id, new AppError('PASSWORD_INCORRECT'));
    }
    const verified =
      user.totpSecretEnc === null
        ? null
        : verifyTotp({
            secret: decryptSecret(ctx.keys.totp, 'totp', user.totpSecretEnc),
            code: input.code,
            nowMs: ctx.clock(),
            lastCounter: user.totpLastCounter,
          });
    if (!verified) {
      throw await reauthFailure(res, user.id, new AppError('INVALID_TOTP_CODE'));
    }
    db.update(users).set({ totpLastCounter: verified.counter }).where(eq(users.id, user.id)).run();
    await limiters.reauth.reset(user.id);
  }

  router.get('/me', ...endpointGuards(ctx.csrf, 'me.get'), (req, res) => {
    sendJson(res, 'me.get', 200, toMe(ctx, currentUser(req)));
  });

  router.patch('/me', ...endpointGuards(ctx.csrf, 'me.update'), (req, res) => {
    const body = validBody<UpdateMeRequest>(req);
    const changes: Partial<typeof users.$inferInsert> = {};
    if (body.locale !== undefined) changes.locale = body.locale;
    if (body.displayName !== undefined) changes.displayName = body.displayName;
    if (body.themePreference !== undefined) changes.themePreference = body.themePreference;
    db.update(users).set(changes).where(eq(users.id, req.auth!.user.id)).run();
    sendJson(res, 'me.update', 200, toMe(ctx, currentUser(req)));
  });

  router.post('/me/password', ...endpointGuards(ctx.csrf, 'me.password'), async (req, res) => {
    const body = validBody<{ currentPassword: string; newPassword: string }>(req);
    const user = currentUser(req);
    assertNotLimited(res, await limiters.reauth.check(user.id), 'ACCOUNT_LOCKED');
    if (!(await ctx.passwordHasher.verify(user.passwordHash, body.currentPassword))) {
      throw await reauthFailure(res, user.id, new AppError('PASSWORD_INCORRECT'));
    }
    await limiters.reauth.reset(user.id);

    const passwordHash = await ctx.passwordHasher.hash(body.newPassword);
    db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
    // Every other device is logged out; the current one gets a fresh session id.
    ctx.sessions.revokeAllForUser(user.id, req.auth!.session.id);
    ctx.sessions.start(req, res, { userId: user.id, mfaVerified: true });
    audit(db, {
      actorId: user.id,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(ctx.clock),
    });
    res.status(204).end();
  });

  router.post('/me/2fa/setup', ...endpointGuards(ctx.csrf, 'me.2faSetup'), (req, res) => {
    const user = currentUser(req);
    if (user.totpEnabled) throw new AppError('CONFLICT', '2FA is already enabled');
    const enrollment = generateTotpEnrollment({
      email: user.email,
      issuer: ctx.settings.getInstanceName(),
    });
    // The pending secret stays inactive (totp_enabled = 0) until `enable`; a new setup replaces it.
    db.update(users)
      .set({
        totpSecretEnc: encryptSecret(ctx.keys.totp, 'totp', enrollment.secret),
        totpLastCounter: null,
      })
      .where(eq(users.id, user.id))
      .run();
    sendJson(res, 'me.2faSetup', 200, enrollment);
  });

  router.post('/me/2fa/enable', ...endpointGuards(ctx.csrf, 'me.2faEnable'), (req, res) => {
    const { code } = validBody<{ code: string }>(req);
    const user = currentUser(req);
    if (user.totpEnabled || user.totpSecretEnc === null) {
      throw new AppError('CONFLICT', 'No pending 2FA enrolment');
    }
    const verified = verifyTotp({
      secret: decryptSecret(ctx.keys.totp, 'totp', user.totpSecretEnc),
      code,
      nowMs: ctx.clock(),
      lastCounter: user.totpLastCounter,
    });
    if (!verified) throw new AppError('INVALID_TOTP_CODE');

    const codes = db.transaction((tx) => {
      tx.update(users)
        .set({ totpEnabled: true, totpLastCounter: verified.counter })
        .where(eq(users.id, user.id))
        .run();
      const created = replaceRecoveryCodes(ctx, tx, user.id);
      audit(tx, {
        actorId: user.id,
        action: 'auth.2fa_enabled',
        targetType: 'user',
        targetId: user.id,
        ipHash: ctx.ipHashOf(req),
        now: nowSeconds(ctx.clock),
      });
      return created;
    });
    sendJson(res, 'me.2faEnable', 200, { recoveryCodes: codes });
  });

  router.post('/me/2fa/disable', ...endpointGuards(ctx.csrf, 'me.2faDisable'), async (req, res) => {
    const user = currentUser(req);
    if (user.role === 'admin') {
      throw new AppError('TWO_FACTOR_REQUIRED', '2FA is mandatory for admins');
    }
    if (!user.totpEnabled) throw new AppError('CONFLICT', '2FA is not enabled');
    await reauthenticate(req, res, validBody<ReauthRequest>(req));

    db.transaction((tx) => {
      clearTwoFactor(tx, user.id);
      audit(tx, {
        actorId: user.id,
        action: 'auth.2fa_disabled',
        targetType: 'user',
        targetId: user.id,
        ipHash: ctx.ipHashOf(req),
        now: nowSeconds(ctx.clock),
      });
    });
    res.status(204).end();
  });

  router.post(
    '/me/2fa/recovery-codes',
    ...endpointGuards(ctx.csrf, 'me.recoveryCodes'),
    async (req, res) => {
      if (!currentUser(req).totpEnabled) throw new AppError('CONFLICT', '2FA is not enabled');
      await reauthenticate(req, res, validBody<ReauthRequest>(req));

      const userId = req.auth!.user.id;
      const codes = db.transaction((tx) => {
        const created = replaceRecoveryCodes(ctx, tx, userId);
        audit(tx, {
          actorId: userId,
          action: 'auth.recovery_regenerated',
          targetType: 'user',
          targetId: userId,
          ipHash: ctx.ipHashOf(req),
          now: nowSeconds(ctx.clock),
        });
        return created;
      });
      sendJson(res, 'me.recoveryCodes', 200, { recoveryCodes: codes });
    },
  );

  router.get('/config', ...endpointGuards(ctx.csrf, 'me.config'), (_req, res) => {
    const chunkMb = Math.min(
      ctx.settings.get('general')?.chunkSizeMb ?? ctx.config.defaultChunkSizeMb,
      CHUNK_SIZE_MB.max,
    );
    sendJson(res, 'me.config', 200, { chunkSizeBytes: chunkMb * BYTES_PER_MB, ...staticConfig });
  });

  return router;
}
