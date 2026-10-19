import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { randomToken, sha256Hex } from '../crypto/hash.js';
import { passwordResetTokens, users } from '../db/schema/index.js';
import { normalizeEmail } from '../users/service.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { accountKey } from './limiters.js';

/** Password reset by email. Welcome links (created by the admin) share table and confirm step. */
export function createPasswordResetService(ctx: AppContext) {
  const { db, clock, limiters } = ctx;

  const ipHash = (req: Request) => ctx.ipHashOf(req);

  return {
    /**
     * Always resolves: the caller answers 202 whatever happens. When a limit is hit or the email
     * is unknown or disabled nothing is stored and nothing is sent.
     */
    async request(req: Request, email: string): Promise<void> {
      const [ip, mailbox] = await Promise.all([
        limiters.resetRequestIp.consume(ctx.clientIp(req)),
        limiters.resetRequestEmail.consume(accountKey(email)),
      ]);
      if (ip.limited || mailbox.limited) return;

      const user = db
        .select()
        .from(users)
        .where(eq(users.email, normalizeEmail(email)))
        .get();
      if (!user || user.disabled) return;

      const now = nowSeconds(clock);
      const token = randomToken(32);
      db.insert(passwordResetTokens)
        .values({
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: now + ctx.config.passwordResetTtlMinutes * 60,
          createdAt: now,
        })
        .run();
      audit(db, {
        actorId: null,
        action: 'auth.password_reset_requested',
        targetType: 'user',
        targetId: user.id,
        ipHash: ipHash(req),
        now,
      });
      // Not awaited: the response time must not tell whether an email was sent. Never rejects.
      void ctx.mailer.sendPasswordReset({ to: user.email, locale: user.locale, token });
    },

    async confirm(
      req: Request,
      res: Response,
      input: { token: string; newPassword: string },
    ): Promise<void> {
      assertNotLimited(res, await limiters.resetConfirmIp.consume(ctx.clientIp(req)));

      const tokenHash = sha256Hex(input.token);
      const invalid = () => new AppError('RESET_TOKEN_INVALID', 'Invalid or expired link');
      const findToken = () =>
        db
          .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
          .from(passwordResetTokens)
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, nowSeconds(clock)),
            ),
          )
          .get();

      // Hashing is slow: look the token up first so garbage never costs an argon2 run.
      if (!findToken()) throw invalid();
      const newHash = await ctx.passwordHasher.hash(input.newPassword);

      const email = db.transaction((tx) => {
        const token = findToken();
        if (!token) throw invalid();
        const user = tx.select().from(users).where(eq(users.id, token.userId)).get();
        if (!user || user.disabled) throw invalid();
        const now = nowSeconds(clock);

        tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id)).run();
        // Burns this token and every other pending one (older reset or welcome links).
        tx.update(passwordResetTokens)
          .set({ usedAt: now })
          .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
          .run();
        ctx.sessions.revokeAllForUser(user.id);
        audit(tx, {
          actorId: user.id,
          action: 'auth.password_reset',
          targetType: 'user',
          targetId: user.id,
          ipHash: ipHash(req),
          now,
        });
        return user.email;
      });
      // Two-factor settings are left untouched on purpose. A reset also lifts a login lockout.
      await limiters.loginAccount.reset(accountKey(email));
    },
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
