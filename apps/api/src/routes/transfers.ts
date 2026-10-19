import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import {
  EXPIRY_OPTIONS,
  type AdminListTransfersQuery,
  type CreateTransferRequest,
  type ListTransfersQuery,
  type UpdateTransferRequest,
} from '@easysend/shared';
import { audit, type AuditAction } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import {
  downloadLogs,
  transferFiles,
  transferRecipients,
  transfers,
  uploads,
  users,
} from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody, validParams, validQuery } from '../http/validate.js';
import { reserveBytes } from '../storage/disk.js';
import {
  deleteTransfer,
  deleteTransferFile,
  effectiveStatus,
  generateTransferToken,
  listTransfersPage,
  loadTransferForUser,
  notifyRecipients,
  toTransferDetail,
  type TransferRow,
} from '../transfers/service.js';

type IdParams = { id: string };

export function transfersRouter(ctx: AppContext): Router {
  const router = Router();
  const { db } = ctx;
  const guards = (id: string) => endpointGuards(ctx.csrf, id);

  const detailOf = (id: string) => {
    const row = db.select().from(transfers).where(eq(transfers.id, id)).get()!;
    return toTransferDetail(ctx, row, nowSeconds(ctx.clock));
  };

  /** Audit row for an action on a transfer; `byAdmin` is set when an admin acts on another user's. */
  function auditTransfer(
    req: Request,
    action: AuditAction,
    row: TransferRow,
    metadata: Record<string, unknown> = {},
    writer: Pick<typeof db, 'insert'> = db,
  ): void {
    const actorId = req.auth!.user.id;
    audit(writer, {
      actorId,
      action,
      targetType: 'transfer',
      targetId: row.id,
      metadata: { ...metadata, ...(actorId !== row.ownerId ? { byAdmin: true } : {}) },
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(ctx.clock),
    });
  }

  async function limitCreation(res: Response, userId: string): Promise<void> {
    assertNotLimited(res, await ctx.transferLimiters.transferCreate.consume(userId));
  }

  const senderNameOf = (req: Request): string | null => req.auth!.user.displayName;

  // ---- Create, finalize ------------------------------------------------------------------

  router.post('/transfers', ...guards('transfers.create'), async (req, res) => {
    const body = validBody<CreateTransferRequest>(req);
    const user = req.auth!.user;
    await limitCreation(res, user.id);

    const now = nowSeconds(ctx.clock);
    const passwordHash = body.password ? await ctx.passwordHasher.hash(body.password) : null;
    const recipients = [...new Set((body.recipients ?? []).map((r) => r.trim().toLowerCase()))];
    const id = db.transaction((tx) => {
      const created = tx
        .insert(transfers)
        .values({
          ownerId: user.id,
          token: generateTransferToken(),
          title: body.title ?? null,
          message: body.message ?? null,
          mode: body.mode,
          expiresAt: now + EXPIRY_OPTIONS[body.expiresIn],
          passwordHash,
          maxDownloads: body.maxDownloads ?? null,
          status: 'uploading',
          createdAt: now,
        })
        .returning()
        .get();
      for (const email of recipients) {
        tx.insert(transferRecipients).values({ transferId: created.id, email }).run();
      }
      auditTransfer(req, 'transfer.created', created, { mode: body.mode }, tx);
      return created.id;
    });
    sendJson(res, 'transfers.create', 201, detailOf(id));
  });

  router.post('/transfers/:id/finalize', ...guards('transfers.finalize'), async (req, res) => {
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    if (row.status !== 'uploading') {
      throw new AppError('TRANSFER_NOT_UPLOADABLE', 'The transfer is not a draft');
    }
    const pending = db
      .select({ n: count() })
      .from(uploads)
      .where(
        and(eq(uploads.transferId, row.id), inArray(uploads.status, ['in_progress', 'processing'])),
      )
      .get()!.n;
    if (pending > 0) throw new AppError('UPLOAD_INCOMPLETE', 'Some uploads are not finished yet');
    const fileCount = db
      .select({ n: count() })
      .from(transferFiles)
      .where(eq(transferFiles.transferId, row.id))
      .get()!.n;
    if (fileCount === 0) throw new AppError('TRANSFER_EMPTY', 'The transfer has no files');

    const now = nowSeconds(ctx.clock);
    const expiresAt = now + (row.expiresAt - row.createdAt);
    const activated = db.transaction((tx) => {
      tx.delete(uploads)
        .where(and(eq(uploads.transferId, row.id), eq(uploads.status, 'aborted')))
        .run();
      const updated = tx
        .update(transfers)
        .set({ status: 'active', expiresAt })
        .where(eq(transfers.id, row.id))
        .returning()
        .get();
      auditTransfer(req, 'transfer.finalized', row, { mode: row.mode, files: fileCount }, tx);
      return updated;
    });
    if (activated.mode === 'email') await notifyRecipients(ctx, activated, senderNameOf(req));
    sendJson(res, 'transfers.finalize', 200, detailOf(row.id));
  });

  // ---- Reading ---------------------------------------------------------------------------

  router.get('/transfers', ...guards('transfers.list'), (req, res) => {
    const query = validQuery<ListTransfersQuery>(req);
    const page = listTransfersPage(
      ctx,
      { ...query, ownerId: req.auth!.user.id },
      nowSeconds(ctx.clock),
    );
    sendJson(res, 'transfers.list', 200, { ...page, page: query.page, pageSize: query.pageSize });
  });

  router.get('/admin/transfers', ...guards('transfers.adminList'), (req, res) => {
    const query = validQuery<AdminListTransfersQuery>(req);
    const page = listTransfersPage(ctx, query, nowSeconds(ctx.clock));
    sendJson(res, 'transfers.adminList', 200, {
      ...page,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  router.get('/transfers/:id', ...guards('transfers.get'), (req, res) => {
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    sendJson(res, 'transfers.get', 200, toTransferDetail(ctx, row, nowSeconds(ctx.clock)));
  });

  router.get('/transfers/:id/downloads', ...guards('transfers.downloads'), (req, res) => {
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    const { page, pageSize } = validQuery<{ page: number; pageSize: number }>(req);
    const total = db
      .select({ n: count() })
      .from(downloadLogs)
      .where(eq(downloadLogs.transferId, row.id))
      .get()!.n;
    const items = db
      .select({
        id: downloadLogs.id,
        fileId: downloadLogs.fileId,
        fileName: transferFiles.originalName,
        bytesSent: downloadLogs.bytesSent,
        userAgent: downloadLogs.userAgent,
        createdAt: downloadLogs.createdAt,
      })
      .from(downloadLogs)
      .leftJoin(transferFiles, eq(transferFiles.id, downloadLogs.fileId))
      .where(eq(downloadLogs.transferId, row.id))
      .orderBy(desc(downloadLogs.createdAt), desc(downloadLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    sendJson(res, 'transfers.downloads', 200, { items, total, page, pageSize });
  });

  // ---- Changing --------------------------------------------------------------------------

  router.patch('/transfers/:id', ...guards('transfers.update'), async (req, res) => {
    const body = validBody<UpdateTransferRequest>(req);
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    const now = nowSeconds(ctx.clock);
    const status = effectiveStatus(row, now);
    if (status === 'expired') throw new AppError('TRANSFER_EXPIRED', 'The transfer has expired');
    if (status === 'revoked') throw new AppError('TRANSFER_REVOKED', 'The transfer was revoked');

    const changes: Partial<typeof transfers.$inferInsert> = {};
    const fields: string[] = [];
    if (body.title !== undefined) {
      changes.title = body.title;
      fields.push('title');
    }
    if (body.message !== undefined) {
      changes.message = body.message;
      fields.push('message');
    }
    if (body.expiresIn !== undefined) {
      // A draft keeps counting from its creation: `finalize` restarts the clock.
      const start = row.status === 'uploading' ? row.createdAt : now;
      changes.expiresAt = start + EXPIRY_OPTIONS[body.expiresIn];
      fields.push('expiresIn');
    }
    if (body.maxDownloads !== undefined) {
      changes.maxDownloads = body.maxDownloads;
      fields.push('maxDownloads');
    }
    if (body.password !== undefined) {
      changes.passwordHash = await ctx.passwordHasher.hash(body.password);
      fields.push('password');
    }
    if (body.removePassword) {
      changes.passwordHash = null;
      fields.push('removePassword');
    }

    db.transaction((tx) => {
      tx.update(transfers).set(changes).where(eq(transfers.id, row.id)).run();
      auditTransfer(req, 'transfer.updated', row, { fields }, tx);
    });
    sendJson(res, 'transfers.update', 200, detailOf(row.id));
  });

  router.post('/transfers/:id/revoke', ...guards('transfers.revoke'), (req, res) => {
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    if (row.status === 'uploading') {
      throw new AppError('TRANSFER_NOT_UPLOADABLE', 'A draft cannot be revoked: delete it');
    }
    if (row.status === 'active') {
      db.transaction((tx) => {
        tx.update(transfers).set({ status: 'revoked' }).where(eq(transfers.id, row.id)).run();
        auditTransfer(req, 'transfer.revoked', row, {}, tx);
      });
    }
    sendJson(res, 'transfers.revoke', 200, detailOf(row.id));
  });

  router.post('/transfers/:id/resend', ...guards('transfers.resend'), async (req, res) => {
    await limitCreation(res, req.auth!.user.id);
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    const status = effectiveStatus(row, nowSeconds(ctx.clock));
    if (status === 'expired') throw new AppError('TRANSFER_EXPIRED', 'The transfer has expired');
    if (status === 'revoked') throw new AppError('TRANSFER_REVOKED', 'The transfer was revoked');
    if (row.mode !== 'email' || status === 'uploading') {
      throw new AppError('CONFLICT', 'Only active email transfers can be sent again');
    }
    const sent = await notifyRecipients(ctx, row, senderNameOf(req));
    auditTransfer(req, 'transfer.resent', row, { sent });
    sendJson(res, 'transfers.resend', 200, detailOf(row.id));
  });

  router.delete('/transfers/:id', ...guards('transfers.delete'), async (req, res) => {
    const row = loadTransferForUser(ctx, validParams<IdParams>(req).id, req.auth!);
    const admin = req.auth!.user.id !== row.ownerId;
    await deleteTransfer(ctx, row.id, {
      actorId: req.auth!.user.id,
      ipHash: ctx.ipHashOf(req),
      reason: admin ? 'admin' : 'user',
    });
    res.status(204).end();
  });

  router.delete(
    '/transfers/:id/files/:fileId',
    ...guards('transfers.deleteFile'),
    async (req, res) => {
      const { id, fileId } = validParams<{ id: string; fileId: string }>(req);
      const row = loadTransferForUser(ctx, id, req.auth!);
      if (row.status !== 'uploading') {
        throw new AppError('TRANSFER_NOT_UPLOADABLE', 'Files can only be removed from a draft');
      }
      const removed = await deleteTransferFile(ctx, row.id, fileId, {
        actorId: req.auth!.user.id,
        ipHash: ctx.ipHashOf(req),
      });
      if (!removed) throw new AppError('FILE_NOT_FOUND', 'File not found');
      res.status(204).end();
    },
  );

  // ---- Admin storage ---------------------------------------------------------------------

  router.get('/admin/storage', ...guards('admin.storage'), async (_req, res) => {
    const disk = await ctx.diskSpace(ctx.config.storageDir);
    const reserve = reserveBytes(ctx);
    const now = nowSeconds(ctx.clock);
    const totals = db
      .select({
        stored: sql<number>`coalesce(sum(${transferFiles.storedSizeBytes}), 0)`,
        files: count(),
      })
      .from(transferFiles)
      .get()!;
    const active = db
      .select({ n: count() })
      .from(transfers)
      .where(and(eq(transfers.status, 'active'), gt(transfers.expiresAt, now)))
      .get()!.n;
    const rows = db
      .select({
        userId: users.id,
        email: users.email,
        usedBytes: users.usedBytes,
        quotaBytes: users.quotaBytes,
      })
      .from(users)
      .orderBy(asc(users.email))
      .all();
    sendJson(res, 'admin.storage', 200, {
      disk: {
        totalBytes: disk.totalBytes,
        freeBytes: disk.freeBytes,
        reserveBytes: reserve,
        usableBytes: Math.max(0, disk.freeBytes - reserve),
      },
      storedBytes: totals.stored,
      activeTransfers: active,
      totalFiles: totals.files,
      users: rows,
    });
  });

  return router;
}
