import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import {
  EXPIRY_OPTIONS,
  type CreateSubmissionRequest,
  type RequestInfoResponse,
} from '@easysend/shared';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { transferFiles, transfers, uploadRequests, uploads, users } from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { verifyLinkPassword } from '../http/link-password.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody, validParams } from '../http/validate.js';
import {
  isRequestUnlocked,
  loadRequestByToken,
  loadSubmission,
  requestClosedError,
  requestUnavailableError,
  setRequestUnlockCookie,
  signSubmissionToken,
  type UploadRequestRow,
} from '../requests/service.js';
import { normalizeEmail } from '../users/service.js';
import {
  deleteTransfer,
  finalizableFileCount,
  generateTransferToken,
  toTransferDetail,
} from '../transfers/service.js';

type TokenParams = { token: string };
type SubmissionParams = { token: string; id: string };

/**
 * Public side of upload requests: `/api/r/:token`. No account is needed: a password-protected
 * request is opened with the `es_ru` cookie, a submission is driven with the
 * `X-Submission-Token` header returned when it starts.
 */
export function submissionsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, transferLimiters } = ctx;
  const guards = (id: string) => endpointGuards(ctx.csrf, id);

  /** Request by token that is open for submissions (not revoked, expired or full). */
  async function openRequest(
    req: Request,
    res: Response,
    token: string,
    limiter: 'requestView' | 'submissionCreateIp' | null,
  ): Promise<{ request: UploadRequestRow; ipHash: string; nowSec: number }> {
    const ipHash = ctx.ipHashOf(req);
    if (limiter) {
      assertNotLimited(res, await transferLimiters[limiter].consume(ipHash));
    }
    const request = loadRequestByToken(ctx, token);
    const nowSec = nowSeconds(ctx.clock);
    const error = requestUnavailableError(request, nowSec);
    if (error) throw error;
    return { request, ipHash, nowSec };
  }

  router.get('/r/:token', ...guards('submissions.info'), async (req, res) => {
    const { token } = validParams<TokenParams>(req);
    const { request, nowSec } = await openRequest(req, res, token, 'requestView');
    if (!isRequestUnlocked(ctx, req, request, nowSec)) {
      sendJson(res, 'submissions.info', 200, { locked: true, expiresAt: request.expiresAt });
      return;
    }
    const owner = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, request.ownerId))
      .get();
    const info: RequestInfoResponse = {
      locked: false,
      title: request.title,
      message: request.message,
      ownerName: owner?.displayName ?? null,
      requireName: request.requireName,
      requireEmail: request.requireEmail,
      remainingBytes:
        request.maxTotalBytes === null
          ? null
          : Math.max(0, request.maxTotalBytes - request.receivedBytes),
      expiresAt: request.expiresAt,
    };
    sendJson(res, 'submissions.info', 200, info);
  });

  router.post('/r/:token/unlock', ...guards('submissions.unlock'), async (req, res) => {
    const { token } = validParams<TokenParams>(req);
    const { request, ipHash, nowSec } = await openRequest(req, res, token, null);
    if (request.passwordHash === null) {
      res.status(204).end();
      return;
    }
    await verifyLinkPassword(res, ctx.passwordHasher, {
      passwordHash: request.passwordHash,
      password: validBody<{ password: string }>(req).password,
      ipKey: `${token}:${ipHash}`,
      tokenKey: token,
      byIp: transferLimiters.requestPasswordIp,
      byToken: transferLimiters.requestPasswordToken,
    });
    setRequestUnlockCookie(ctx, res, request, nowSec);
    res.status(204).end();
  });

  router.post('/r/:token/submissions', ...guards('submissions.create'), async (req, res) => {
    const { token } = validParams<TokenParams>(req);
    const body = validBody<CreateSubmissionRequest>(req);
    const { request, nowSec } = await openRequest(req, res, token, 'submissionCreateIp');
    if (!isRequestUnlocked(ctx, req, request, nowSec)) {
      throw new AppError('PASSWORD_REQUIRED', 'Password required');
    }
    assertNotLimited(res, await transferLimiters.submissionCreateRequest.consume(request.id));

    const issues: { path: string; code: string; message: string }[] = [];
    if (request.requireName && !body.name) {
      issues.push({ path: 'name', code: 'invalid_type', message: 'Name is required' });
    }
    if (request.requireEmail && !body.email) {
      issues.push({ path: 'email', code: 'invalid_type', message: 'Email is required' });
    }
    if (issues.length > 0) throw new AppError('VALIDATION_ERROR', 'Invalid request', { issues });

    const transferId = db
      .insert(transfers)
      .values({
        ownerId: request.ownerId,
        token: generateTransferToken(),
        title: request.title,
        message: body.message?.trim() ? body.message.trim() : null,
        mode: 'link',
        expiresAt: nowSec + EXPIRY_OPTIONS[request.expiresIn],
        status: 'uploading',
        createdAt: nowSec,
        source: 'received',
        uploadRequestId: request.id,
        senderName: body.name ?? null,
        senderEmail: body.email ? normalizeEmail(body.email) : null,
      })
      .returning({ id: transfers.id })
      .get().id;
    const submission = signSubmissionToken(ctx, transferId, nowSec);
    sendJson(res, 'submissions.create', 201, {
      transferId,
      submissionToken: submission.token,
      submissionTokenExpiresAt: submission.expiresAt,
    });
  });

  router.get('/r/:token/submissions/:id', ...guards('submissions.get'), (req, res) => {
    const { token, id } = validParams<SubmissionParams>(req);
    const request = loadRequestByToken(ctx, token);
    const row = loadSubmission(ctx, req, request, id);
    const closed = requestClosedError(request, nowSeconds(ctx.clock));
    if (closed) throw closed;
    const detail = toTransferDetail(ctx, row, nowSeconds(ctx.clock));
    sendJson(res, 'submissions.get', 200, {
      transferId: row.id,
      status: detail.status,
      files: detail.files,
      uploads: detail.uploads,
    });
  });

  router.post(
    '/r/:token/submissions/:id/finalize',
    ...guards('submissions.finalize'),
    async (req, res) => {
      const { token, id } = validParams<SubmissionParams>(req);
      const request = loadRequestByToken(ctx, token);
      const row = loadSubmission(ctx, req, request, id);
      const now = nowSeconds(ctx.clock);
      const closed = requestClosedError(request, now);
      if (closed) throw closed;
      if (row.status !== 'uploading') {
        throw new AppError('TRANSFER_NOT_UPLOADABLE', 'The submission is already complete');
      }
      const fileCount = finalizableFileCount(db, row.id);

      const totalBytes = db.transaction((tx) => {
        const bytes = Number(
          tx
            .select({ total: sql<number>`coalesce(sum(${transferFiles.sizeBytes}), 0)` })
            .from(transferFiles)
            .where(eq(transferFiles.transferId, row.id))
            .get()!.total,
        );
        // The single UPDATE re-checks the request, so racing finalizes cannot pass `max_submissions`.
        const claimed = tx
          .update(uploadRequests)
          .set({
            submissionCount: sql`${uploadRequests.submissionCount} + 1`,
            receivedBytes: sql`${uploadRequests.receivedBytes} + ${bytes}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(uploadRequests.id, request.id),
              eq(uploadRequests.status, 'active'),
              gt(uploadRequests.expiresAt, now),
              or(
                isNull(uploadRequests.maxSubmissions),
                lt(uploadRequests.submissionCount, uploadRequests.maxSubmissions),
              ),
            ),
          )
          .returning({ id: uploadRequests.id })
          .get();
        if (!claimed) return null;
        tx.delete(uploads)
          .where(and(eq(uploads.transferId, row.id), eq(uploads.status, 'aborted')))
          .run();
        tx.update(transfers)
          .set({
            status: 'active',
            expiresAt: now + EXPIRY_OPTIONS[request.expiresIn],
            totalBytes: bytes,
          })
          .where(and(eq(transfers.id, row.id), eq(transfers.status, 'uploading')))
          .run();
        audit(tx, {
          actorId: null,
          action: 'request.submission_received',
          targetType: 'upload_request',
          targetId: request.id,
          metadata: { transferId: row.id, files: fileCount, bytes },
          ipHash: ctx.ipHashOf(req),
          now,
        });
        return bytes;
      });
      if (totalBytes === null) {
        const current = db
          .select()
          .from(uploadRequests)
          .where(eq(uploadRequests.id, request.id))
          .get();
        throw (
          (current && requestUnavailableError(current, now)) ??
          new AppError('REQUEST_NOT_FOUND', 'Upload request not found')
        );
      }

      const owner = db
        .select({ email: users.email, locale: users.locale })
        .from(users)
        .where(eq(users.id, request.ownerId))
        .get();
      if (owner) {
        await ctx.mailer
          .sendSubmissionReceived({
            to: owner.email,
            locale: owner.locale,
            transferId: row.id,
            requestTitle: request.title,
            submitterName: row.senderName,
            submitterEmail: row.senderEmail,
            fileCount,
            totalBytes,
          })
          .catch((error: unknown) => {
            ctx.logger.warn({ transferId: row.id, err: error }, 'submission notice failed');
          });
      }
      sendJson(res, 'submissions.finalize', 200, { transferId: row.id, fileCount, totalBytes });
    },
  );

  router.delete('/r/:token/submissions/:id', ...guards('submissions.cancel'), async (req, res) => {
    const { token, id } = validParams<SubmissionParams>(req);
    const request = loadRequestByToken(ctx, token);
    const row = loadSubmission(ctx, req, request, id);
    if (row.status !== 'uploading') {
      throw new AppError('TRANSFER_NOT_UPLOADABLE', 'A completed submission cannot be cancelled');
    }
    await deleteTransfer(ctx, row.id, { actorId: null, reason: 'submission_cancelled' });
    res.status(204).end();
  });

  return router;
}
