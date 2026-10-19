import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { audit, type AuditAction } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { decryptSecret, encryptSecret } from '../crypto/aead.js';
import { recoveryCodes, users } from '../db/schema/index.js';
import { normalizeEmail, toUser } from '../users/service.js';
import { AppError } from '../http/errors.js';
import { limitedError } from '../http/rate-limit.js';
import { accountKey } from './limiters.js';
import {
  findUnusedRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
} from './recovery-codes.js';
import type { UserRow } from './session.js';
import { generateTotpEnrollment, verifyTotp } from './totp.js';

/** Login flows: password step, second factor, recovery codes and forced 2FA enrolment. */
export function createLoginService(ctx: AppContext) {
  const { db, clock, limiters } = ctx;

  const record = (
    req: Request,
    action: AuditAction,
    actorId: string | null,
    metadata?: Record<string, unknown>,
  ): void => {
    audit(db, {
      actorId,
      action,
      ...(actorId ? { targetType: 'user' as const, targetId: actorId } : {}),
      ...(metadata ? { metadata } : {}),
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(clock),
    });
  };

  const findByEmail = (email: string): UserRow | undefined =>
    db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();

  /** Refuses the attempt while the IP or the account is blocked. Never reveals if the account exists. */
  async function assertCanAttempt(req: Request, res: Response, email: string): Promise<void> {
    const ip = await limiters.loginIp.check(ctx.clientIp(req));
    if (ip.limited) throw limitedError(res, ip.retryAfterSeconds, 'RATE_LIMITED');
    const account = await limiters.loginAccount.check(accountKey(email));
    if (account.limited) throw limitedError(res, account.retryAfterSeconds, 'ACCOUNT_LOCKED');
  }

  /** Counts a failure on both limiters, audits it and throws the right error. */
  async function failure(
    req: Request,
    res: Response,
    user: UserRow | undefined,
    email: string,
    error: AppError,
    reason: string,
  ): Promise<never> {
    const ip = await limiters.loginIp.fail(ctx.clientIp(req));
    const account = await limiters.loginAccount.fail(accountKey(email));
    // Metadata never holds the typed email: it may belong to nobody.
    record(req, 'auth.login_failed', user?.id ?? null, { reason });
    if (account.limited) {
      record(req, 'auth.lockout', user?.id ?? null);
      throw limitedError(res, account.retryAfterSeconds, 'ACCOUNT_LOCKED');
    }
    if (ip.limited) throw limitedError(res, ip.retryAfterSeconds, 'RATE_LIMITED');
    throw error;
  }

  /** Opens the full session (rotating the current one) and records the login. */
  async function completeLogin(req: Request, res: Response, user: UserRow) {
    db.update(users)
      .set({ lastLoginAt: nowSeconds(clock) })
      .where(eq(users.id, user.id))
      .run();
    const fresh = db.select().from(users).where(eq(users.id, user.id)).get() ?? user;
    const { session } = ctx.sessions.start(req, res, { userId: user.id, mfaVerified: true });
    // Reset only here: a correct password alone must not clear the counter of second-factor guesses.
    await limiters.loginAccount.reset(accountKey(user.email));
    record(req, 'auth.login', user.id);
    return { user: toUser(ctx, fresh), csrfToken: ctx.csrf.sessionToken(session.id) };
  }

  /** User of the pending session (guards guarantee there is one). */
  const pendingUser = (req: Request): UserRow => {
    if (!req.auth) throw new AppError('UNAUTHENTICATED', 'No login in progress');
    return req.auth.user;
  };

  const requireTotpEnabled = (user: UserRow): void => {
    if (!user.totpEnabled) {
      throw new AppError('CONFLICT', 'Two-factor authentication is not enabled');
    }
  };

  /** Stores the matched TOTP counter; false when it was used already (replay, also concurrent). */
  function consumeCounter(userId: string, counter: number): boolean {
    return (
      db
        .update(users)
        .set({ totpLastCounter: counter })
        .where(
          and(
            eq(users.id, userId),
            sql`(${users.totpLastCounter} IS NULL OR ${users.totpLastCounter} < ${counter})`,
          ),
        )
        .run().changes === 1
    );
  }

  async function verifyCode(
    req: Request,
    res: Response,
    user: UserRow,
    secretEnc: string | null,
    code: string,
  ): Promise<void> {
    await assertCanAttempt(req, res, user.email);
    let counter: number | null = null;
    if (secretEnc) {
      const secret = decryptSecret(ctx.keys.totp, 'totp', secretEnc);
      counter =
        verifyTotp({ secret, code, nowMs: clock(), lastCounter: user.totpLastCounter })?.counter ??
        null;
    }
    if (counter === null || !consumeCounter(user.id, counter)) {
      await failure(
        req,
        res,
        user,
        user.email,
        new AppError('INVALID_TOTP_CODE', 'Wrong or expired code'),
        'totp',
      );
    }
  }

  return {
    async login(req: Request, res: Response, input: { email: string; password: string }) {
      const { email, password } = input;
      await assertCanAttempt(req, res, email);

      const user = findByEmail(email);
      let passwordOk = false;
      if (user) passwordOk = await ctx.passwordHasher.verify(user.passwordHash, password);
      else await ctx.passwordHasher.verifyDummy(password);
      if (!user || !passwordOk) {
        return failure(
          req,
          res,
          user,
          email,
          new AppError('INVALID_CREDENTIALS', 'Wrong email or password'),
          'password',
        );
      }
      // Only after a correct password, so the disabled state is not visible to guessers.
      if (user.disabled) throw new AppError('ACCOUNT_DISABLED', 'Account disabled');

      if (user.totpEnabled) {
        ctx.sessions.start(req, res, { userId: user.id, mfaVerified: false });
        return { status: 'mfa_required' as const };
      }
      if (user.role === 'admin') {
        ctx.sessions.start(req, res, { userId: user.id, mfaVerified: false });
        return { status: 'mfa_setup_required' as const };
      }
      return { status: 'ok' as const, ...(await completeLogin(req, res, user)) };
    },

    async login2fa(req: Request, res: Response, input: { code: string }) {
      const user = pendingUser(req);
      requireTotpEnabled(user);
      await verifyCode(req, res, user, user.totpSecretEnc, input.code);
      return completeLogin(req, res, user);
    },

    async loginRecovery(req: Request, res: Response, input: { recoveryCode: string }) {
      const user = pendingUser(req);
      requireTotpEnabled(user);
      await assertCanAttempt(req, res, user.email);

      const rows = db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).all();
      const match = findUnusedRecoveryCode(ctx.keys.recoveryCode, input.recoveryCode, rows);
      const used =
        match !== undefined &&
        db
          .update(recoveryCodes)
          .set({ usedAt: nowSeconds(clock) })
          .where(and(eq(recoveryCodes.id, match.id), isNull(recoveryCodes.usedAt)))
          .run().changes === 1;
      if (!match || !used) {
        return failure(
          req,
          res,
          user,
          user.email,
          new AppError('INVALID_RECOVERY_CODE', 'Wrong or already used recovery code'),
          'recovery',
        );
      }
      record(req, 'auth.recovery_used', user.id);
      const left = rows.filter((row) => row.usedAt === null && row.id !== match.id).length;
      return { ...(await completeLogin(req, res, user)), recoveryCodesLeft: left };
    },

    /** Forced enrolment, step 1: a pending secret (2FA stays disabled until it is confirmed). */
    login2faSetup(req: Request) {
      const user = pendingUser(req);
      if (user.totpEnabled) {
        throw new AppError('CONFLICT', 'Two-factor authentication is already enabled');
      }
      const enrollment = generateTotpEnrollment({
        email: user.email,
        issuer: ctx.settings.getInstanceName(),
      });
      db.update(users)
        .set({ totpSecretEnc: encryptSecret(ctx.keys.totp, 'totp', enrollment.secret) })
        .where(eq(users.id, user.id))
        .run();
      return enrollment;
    },

    /** Forced enrolment, step 2: confirm the first code, enable 2FA, issue the recovery codes. */
    async login2faSetupVerify(req: Request, res: Response, input: { code: string }) {
      const user = pendingUser(req);
      if (user.totpEnabled) {
        throw new AppError('CONFLICT', 'Two-factor authentication is already enabled');
      }
      if (!user.totpSecretEnc) throw new AppError('CONFLICT', 'Start the enrolment first');
      await verifyCode(req, res, user, user.totpSecretEnc, input.code);

      const codes = generateRecoveryCodes();
      db.transaction((tx) => {
        tx.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id)).run();
        tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();
        tx.insert(recoveryCodes)
          .values(
            codes.map((code) => ({
              userId: user.id,
              codeHash: hashRecoveryCode(ctx.keys.recoveryCode, code),
            })),
          )
          .run();
      });
      record(req, 'auth.2fa_enabled', user.id);
      const completed = await completeLogin(req, res, user);
      return { ...completed, recoveryCodes: codes };
    },

    logout(req: Request, res: Response): void {
      if (req.auth) record(req, 'auth.logout', req.auth.user.id);
      ctx.sessions.end(req, res);
    },
  };
}

export type LoginService = ReturnType<typeof createLoginService>;
