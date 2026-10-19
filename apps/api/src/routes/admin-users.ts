import { and, desc, asc, count, eq, sql, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import type {
  CreateUserRequest,
  DeleteUserQuery,
  ListUsersQuery,
  UpdateUserRequest,
} from '@easysend/shared';
import { AUTH_POLICY } from '../auth/policy.js';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { randomToken, sha256Hex } from '../crypto/hash.js';
import { passwordResetTokens, transfers, uploads, users } from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { sendJson, validBody, validParams, validQuery } from '../http/validate.js';
import {
  clearTwoFactor,
  countActiveAdmins,
  normalizeEmail,
  toAdminUser,
} from '../users/service.js';

/** Escapes LIKE wildcards so `q` is always a plain substring. */
const likePattern = (q: string): string =>
  `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function adminUsersRouter(ctx: AppContext): Router {
  const router = Router();
  const { db } = ctx;

  const transferCountSql = sql<number>`(select count(*) from ${transfers} where ${transfers.ownerId} = "users"."id" and ${transfers.status} != 'deleted')`;

  const findUser = (id: string) => {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');
    return row;
  };

  const adminView = (id: string) => {
    const row = findUser(id);
    const { n } = db
      .select({ n: count() })
      .from(transfers)
      .where(and(eq(transfers.ownerId, id), sql`${transfers.status} != 'deleted'`))
      .get()!;
    return toAdminUser(ctx, row, n);
  };

  const auditBase = (req: Request) => ({
    actorId: req.auth?.user.id ?? null,
    ipHash: ctx.ipHashOf(req),
    now: nowSeconds(ctx.clock),
  });

  router.get('/admin/users', ...endpointGuards(ctx.csrf, 'users.list'), (req, res) => {
    const { q, role, page, pageSize } = validQuery<ListUsersQuery>(req);
    const filters: SQL[] = [];
    if (q) {
      const pattern = likePattern(q);
      filters.push(
        sql`(lower(${users.email}) like ${pattern} escape '\\' or lower(${users.displayName}) like ${pattern} escape '\\')`,
      );
    }
    if (role) filters.push(eq(users.role, role));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const total = db.select({ n: count() }).from(users).where(where).get()!.n;
    const rows = db
      .select({ user: users, transferCount: transferCountSql })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), asc(users.email))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    sendJson(res, 'users.list', 200, {
      items: rows.map((r) => toAdminUser(ctx, r.user, Number(r.transferCount))),
      total,
      page,
      pageSize,
    });
  });

  router.post('/admin/users', ...endpointGuards(ctx.csrf, 'users.create'), async (req, res) => {
    const body = validBody<CreateUserRequest>(req);
    const email = normalizeEmail(body.email);
    if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
      throw new AppError('EMAIL_ALREADY_EXISTS', 'A user with that email already exists');
    }

    // Without a password the stored hash is that of a random secret nobody knows: the user sets
    // a real one through the welcome link.
    const passwordHash = await ctx.passwordHasher.hash(body.password ?? randomToken());
    const now = nowSeconds(ctx.clock);
    const welcomeToken = body.password === undefined ? randomToken() : undefined;

    const id = db.transaction((tx) => {
      const created = tx
        .insert(users)
        .values({
          email,
          passwordHash,
          role: body.role,
          displayName: body.displayName ?? null,
          locale: body.locale ?? null,
          quotaBytes: body.quotaBytes ?? null,
          createdAt: now,
        })
        .returning({ id: users.id })
        .get();
      if (welcomeToken) {
        tx.insert(passwordResetTokens)
          .values({
            userId: created.id,
            tokenHash: sha256Hex(welcomeToken),
            expiresAt: now + AUTH_POLICY.welcomeTokenSeconds,
            createdAt: now,
          })
          .run();
      }
      audit(tx, {
        ...auditBase(req),
        action: 'admin.user_created',
        targetType: 'user',
        targetId: created.id,
        metadata: { role: body.role, welcomeEmail: welcomeToken !== undefined },
      });
      return created.id;
    });

    // Not awaited: a slow SMTP server must not delay the response. Failures are logged by the mailer.
    if (welcomeToken) {
      void ctx.mailer.sendWelcome({
        to: email,
        locale: body.locale ?? null,
        token: welcomeToken,
      });
    }
    sendJson(res, 'users.create', 201, adminView(id));
  });

  router.get('/admin/users/:id', ...endpointGuards(ctx.csrf, 'users.get'), (req, res) => {
    sendJson(res, 'users.get', 200, adminView(validParams<{ id: string }>(req).id));
  });

  router.patch('/admin/users/:id', ...endpointGuards(ctx.csrf, 'users.update'), (req, res) => {
    const { id } = validParams<{ id: string }>(req);
    const body = validBody<UpdateUserRequest>(req);

    db.transaction((tx) => {
      const target = findUser(id);
      const isActiveAdmin = target.role === 'admin' && !target.disabled;
      const losesAdmin =
        (body.role !== undefined && body.role !== 'admin') || body.disabled === true;
      if (isActiveAdmin && losesAdmin && countActiveAdmins(tx) <= 1) {
        throw new AppError('LAST_ADMIN', 'Cannot demote or disable the last active admin');
      }

      const changes: Partial<typeof users.$inferInsert> = {};
      if (body.role !== undefined) changes.role = body.role;
      if (body.quotaBytes !== undefined) changes.quotaBytes = body.quotaBytes;
      if (body.disabled !== undefined) changes.disabled = body.disabled;
      if (body.locale !== undefined) changes.locale = body.locale;
      if (body.displayName !== undefined) changes.displayName = body.displayName;
      tx.update(users).set(changes).where(eq(users.id, id)).run();

      // A new role or a disabled account must not keep working with the old session.
      const roleChanged = body.role !== undefined && body.role !== target.role;
      const nowDisabled = body.disabled === true && !target.disabled;
      if (roleChanged || nowDisabled) ctx.sessions.revokeAllForUser(id);

      audit(tx, {
        ...auditBase(req),
        action: 'admin.user_updated',
        targetType: 'user',
        targetId: id,
        metadata: { fields: Object.keys(changes) },
      });
    });
    sendJson(res, 'users.update', 200, adminView(id));
  });

  router.post(
    '/admin/users/:id/reset-2fa',
    ...endpointGuards(ctx.csrf, 'users.reset2fa'),
    (req, res) => {
      const { id } = validParams<{ id: string }>(req);
      db.transaction((tx) => {
        findUser(id);
        clearTwoFactor(tx, id);
        ctx.sessions.revokeAllForUser(id);
        audit(tx, {
          ...auditBase(req),
          action: 'admin.2fa_reset',
          targetType: 'user',
          targetId: id,
        });
      });
      res.status(204).end();
    },
  );

  router.delete('/admin/users/:id', ...endpointGuards(ctx.csrf, 'users.delete'), (req, res) => {
    const { id } = validParams<{ id: string }>(req);
    const query = validQuery<DeleteUserQuery>(req);

    // The contract forbids deleting yourself (CONFLICT): an admin who wants to leave asks another
    // admin, which also guarantees the request is never the one that removes the last admin.
    if (id === req.auth!.user.id) {
      throw new AppError('CONFLICT', 'You cannot delete your own account');
    }

    db.transaction((tx) => {
      const target = findUser(id);
      if (target.role === 'admin' && !target.disabled && countActiveAdmins(tx) <= 1) {
        throw new AppError('LAST_ADMIN', 'Cannot delete the last active admin');
      }

      if (query.transfers === 'reassign') {
        const newOwnerId = query.reassignTo!;
        if (newOwnerId === id) {
          throw new AppError('VALIDATION_ERROR', 'reassignTo must be a different user');
        }
        findUser(newOwnerId); // USER_NOT_FOUND when it does not exist
        tx.update(transfers).set({ ownerId: newOwnerId }).where(eq(transfers.ownerId, id)).run();
        tx.update(uploads).set({ ownerId: newOwnerId }).where(eq(uploads.ownerId, id)).run();
        tx.update(users)
          .set({ usedBytes: sql`${users.usedBytes} + ${target.usedBytes}` })
          .where(eq(users.id, newOwnerId))
          .run();
      } else {
        // TODO(phase 3): the cleanup job removes the encrypted files of these transfers from disk
        // and reconciles orphan files; here only the database rows go away.
        tx.update(transfers).set({ status: 'deleted' }).where(eq(transfers.ownerId, id)).run();
        tx.delete(uploads).where(eq(uploads.ownerId, id)).run();
        tx.delete(transfers).where(eq(transfers.ownerId, id)).run();
      }

      // Sessions, recovery codes and reset tokens go with the user (ON DELETE CASCADE).
      tx.delete(users).where(eq(users.id, id)).run();
      audit(tx, {
        ...auditBase(req),
        action: 'admin.user_deleted',
        targetType: 'user',
        targetId: id,
        metadata: {
          transfers: query.transfers,
          ...(query.transfers === 'reassign' ? { reassignTo: query.reassignTo } : {}),
        },
      });
    });
    res.status(204).end();
  });

  return router;
}
