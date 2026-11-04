import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import {
  expiresAtFor,
  type CreateUploadRequest,
  type ListUploadRequestsQuery,
  type UpdateUploadRequest,
} from '@easysend/shared';
import { auditRequest } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { transfers, uploadRequests } from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody, validParams, validQuery } from '../http/validate.js';
import {
  generateRequestToken,
  listRequestsPage,
  loadRequestForOwner,
  requestClosedError,
  toRequestDetail,
} from '../requests/service.js';
import { deleteTransfer } from '../transfers/service.js';

type IdParams = { id: string };

/** Owner side of upload requests: `/api/requests`. Only the owner sees a request (admins included). */
export function requestsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db } = ctx;
  const guards = (id: string) => endpointGuards(ctx.csrf, id);

  const detailOf = (id: string) => {
    const row = db.select().from(uploadRequests).where(eq(uploadRequests.id, id)).get()!;
    return toRequestDetail(ctx, row, nowSeconds(ctx.clock));
  };

  router.get('/requests', ...guards('requests.list'), (req, res) => {
    const query = validQuery<ListUploadRequestsQuery>(req);
    const page = listRequestsPage(ctx, req.auth!.user.id, query, nowSeconds(ctx.clock));
    sendJson(res, 'requests.list', 200, { ...page, page: query.page, pageSize: query.pageSize });
  });

  router.post('/requests', ...guards('requests.create'), async (req, res) => {
    const body = validBody<CreateUploadRequest>(req);
    const user = req.auth!.user;
    assertNotLimited(res, await ctx.transferLimiters.requestCreate.consume(user.id));

    const now = nowSeconds(ctx.clock);
    const passwordHash = body.password ? await ctx.passwordHasher.hash(body.password) : null;
    const createdId = db.transaction((tx) => {
      const newId = tx
        .insert(uploadRequests)
        .values({
          ownerId: user.id,
          token: generateRequestToken(),
          title: body.title,
          message: body.message ?? null,
          passwordHash,
          maxTotalBytes: body.maxTotalBytes ?? null,
          maxSubmissions: body.maxSubmissions ?? null,
          requireName: body.requireName ?? false,
          requireEmail: body.requireEmail ?? false,
          expiresAt: expiresAtFor(now, body.expiresIn),
          expiresIn: body.expiresIn,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: uploadRequests.id })
        .get().id;
      auditRequest(
        ctx,
        req,
        'request.created',
        { targetType: 'upload_request', targetId: newId },
        tx,
      );
      return newId;
    });
    sendJson(res, 'requests.create', 201, detailOf(createdId));
  });

  router.get('/requests/:id', ...guards('requests.get'), (req, res) => {
    const row = loadRequestForOwner(ctx, validParams<IdParams>(req).id, req.auth!.user.id);
    sendJson(res, 'requests.get', 200, toRequestDetail(ctx, row, nowSeconds(ctx.clock)));
  });

  router.patch('/requests/:id', ...guards('requests.update'), async (req, res) => {
    const body = validBody<UpdateUploadRequest>(req);
    const row = loadRequestForOwner(ctx, validParams<IdParams>(req).id, req.auth!.user.id);
    const now = nowSeconds(ctx.clock);
    const closed = requestClosedError(row, now);
    if (closed) throw closed;

    const changes: Partial<typeof uploadRequests.$inferInsert> = { updatedAt: now };
    const fields: string[] = [];
    if (body.title !== undefined) {
      changes.title = body.title;
      fields.push('title');
    }
    if (body.message !== undefined) {
      changes.message = body.message;
      fields.push('message');
    }
    if (body.maxTotalBytes !== undefined) {
      changes.maxTotalBytes = body.maxTotalBytes;
      fields.push('maxTotalBytes');
    }
    if (body.maxSubmissions !== undefined) {
      changes.maxSubmissions = body.maxSubmissions;
      fields.push('maxSubmissions');
    }
    if (body.requireName !== undefined) {
      changes.requireName = body.requireName;
      fields.push('requireName');
    }
    if (body.requireEmail !== undefined) {
      changes.requireEmail = body.requireEmail;
      fields.push('requireEmail');
    }
    if (body.expiresIn !== undefined) {
      changes.expiresAt = expiresAtFor(now, body.expiresIn);
      changes.expiresIn = body.expiresIn;
      fields.push('expiresIn');
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
      tx.update(uploadRequests).set(changes).where(eq(uploadRequests.id, row.id)).run();
      auditRequest(
        ctx,
        req,
        'request.updated',
        { targetType: 'upload_request', targetId: row.id, metadata: { fields } },
        tx,
      );
    });
    sendJson(res, 'requests.update', 200, detailOf(row.id));
  });

  router.post('/requests/:id/revoke', ...guards('requests.revoke'), (req, res) => {
    const row = loadRequestForOwner(ctx, validParams<IdParams>(req).id, req.auth!.user.id);
    if (row.status === 'active') {
      db.transaction((tx) => {
        tx.update(uploadRequests)
          .set({ status: 'revoked', updatedAt: nowSeconds(ctx.clock) })
          .where(eq(uploadRequests.id, row.id))
          .run();
        auditRequest(
          ctx,
          req,
          'request.revoked',
          { targetType: 'upload_request', targetId: row.id },
          tx,
        );
      });
    }
    sendJson(res, 'requests.revoke', 200, detailOf(row.id));
  });

  router.delete('/requests/:id', ...guards('requests.delete'), async (req, res) => {
    const row = loadRequestForOwner(ctx, validParams<IdParams>(req).id, req.auth!.user.id);
    // Submissions still uploading go with the request; received transfers stay (FK set null).
    const drafts = db
      .select({ id: transfers.id })
      .from(transfers)
      .where(and(eq(transfers.uploadRequestId, row.id), eq(transfers.status, 'uploading')))
      .all();
    for (const draft of drafts) {
      await deleteTransfer(ctx, draft.id, { actorId: null, reason: 'request_deleted' });
    }
    db.transaction((tx) => {
      tx.delete(uploadRequests).where(eq(uploadRequests.id, row.id)).run();
      auditRequest(
        ctx,
        req,
        'request.deleted',
        { targetType: 'upload_request', targetId: row.id },
        tx,
      );
    });
    res.status(204).end();
  });

  return router;
}
