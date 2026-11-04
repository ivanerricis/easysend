import { and, count, desc, eq, gt, lte, sql, type SQL } from 'drizzle-orm';
import type { Request, Response } from 'express';
import {
  type ListUploadRequestsQuery,
  type UploadRequestDetail,
  type UploadRequestEffectiveStatus,
  type UploadRequestSummary,
} from '@easysend/shared';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { hmacBase64url, randomToken } from '../crypto/hash.js';
import { escapeLike } from '../db/like.js';
import { transfers, uploadRequests } from '../db/schema/index.js';
import { passwordFingerprint } from '../downloads/access.js';
import { readCookie, setCookie } from '../http/cookies.js';
import { AppError } from '../http/errors.js';
import { signCookieValue, verifySignedCookie } from '../http/signed-cookie.js';
import { TRANSFER_POLICY } from '../transfers/policy.js';
import { listTransfersPage, type TransferRow } from '../transfers/service.js';

export type UploadRequestRow = typeof uploadRequests.$inferSelect;

export const REQUEST_UNLOCK_COOKIE = 'es_ru';
export const SUBMISSION_TOKEN_HEADER = 'x-submission-token';

/** A new unguessable upload request token (32 random bytes, base64url). */
export const generateRequestToken = (): string => randomToken(TRANSFER_POLICY.tokenBytes);

/** An `active` request past its expiry reads as `expired` even before the cleanup job runs. */
export function effectiveRequestStatus(
  row: Pick<UploadRequestRow, 'status' | 'expiresAt'>,
  nowSec: number,
): UploadRequestEffectiveStatus {
  return row.status === 'active' && row.expiresAt <= nowSec ? 'expired' : row.status;
}

/** Why the request cannot take new submissions right now, or null when it is open. */
export function requestClosedError(row: UploadRequestRow, nowSec: number): AppError | null {
  const status = effectiveRequestStatus(row, nowSec);
  if (status === 'revoked') return new AppError('REQUEST_REVOKED', 'Upload request revoked');
  if (status === 'expired') return new AppError('REQUEST_EXPIRED', 'Upload request expired');
  return null;
}

/** Like `requestClosedError`, plus `REQUEST_FULL` once `max_submissions` finalized submissions exist. */
export function requestUnavailableError(row: UploadRequestRow, nowSec: number): AppError | null {
  return (
    requestClosedError(row, nowSec) ??
    (row.maxSubmissions !== null && row.submissionCount >= row.maxSubmissions
      ? new AppError('REQUEST_FULL', 'Upload request is full')
      : null)
  );
}

/** The request of its owner. Anyone else (admins included) and a missing id get `REQUEST_NOT_FOUND`. */
export function loadRequestForOwner(
  ctx: Pick<AppContext, 'db'>,
  id: string,
  userId: string,
): UploadRequestRow {
  const row = ctx.db.select().from(uploadRequests).where(eq(uploadRequests.id, id)).get();
  if (!row || row.ownerId !== userId) {
    throw new AppError('REQUEST_NOT_FOUND', 'Upload request not found');
  }
  return row;
}

export function loadRequestByToken(ctx: Pick<AppContext, 'db'>, token: string): UploadRequestRow {
  const row = ctx.db.select().from(uploadRequests).where(eq(uploadRequests.token, token)).get();
  if (!row) throw new AppError('REQUEST_NOT_FOUND', 'Upload request not found');
  return row;
}

/** `<PUBLIC_URL>/r/<token>`, or null when no public URL is known. */
export const requestShareUrl = (row: UploadRequestRow, publicUrl: string | undefined) =>
  publicUrl ? new URL(`/r/${row.token}`, publicUrl).toString() : null;

export function toRequestSummary(
  ctx: Pick<AppContext, 'publicUrl'>,
  row: UploadRequestRow,
  nowSec: number,
): UploadRequestSummary {
  return {
    id: row.id,
    title: row.title,
    status: effectiveRequestStatus(row, nowSec),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    expiresIn: row.expiresIn,
    hasPassword: row.passwordHash !== null,
    maxTotalBytes: row.maxTotalBytes,
    maxSubmissions: row.maxSubmissions,
    requireName: row.requireName,
    requireEmail: row.requireEmail,
    submissionCount: row.submissionCount,
    receivedBytes: row.receivedBytes,
    shareUrl: requestShareUrl(row, ctx.publicUrl()),
  };
}

/** Most received transfers listed in the detail of a request (newest first). */
const DETAIL_TRANSFERS_LIMIT = 500;

export function toRequestDetail(
  ctx: Pick<AppContext, 'db' | 'publicUrl'>,
  row: UploadRequestRow,
  nowSec: number,
): UploadRequestDetail {
  const received = listTransfersPage(
    ctx,
    { uploadRequestId: row.id, page: 1, pageSize: DETAIL_TRANSFERS_LIMIT },
    nowSec,
  );
  return { ...toRequestSummary(ctx, row, nowSec), message: row.message, transfers: received.items };
}

/** One page of the owner's requests, newest first. */
export function listRequestsPage(
  ctx: Pick<AppContext, 'db' | 'publicUrl'>,
  ownerId: string,
  query: ListUploadRequestsQuery,
  nowSec: number,
): { items: UploadRequestSummary[]; total: number } {
  const pattern = query.q ? `%${escapeLike(query.q)}%` : undefined;
  let statusCondition: SQL | undefined;
  if (query.status === 'active') {
    statusCondition = and(
      eq(uploadRequests.status, 'active'),
      gt(uploadRequests.expiresAt, nowSec),
    );
  } else if (query.status === 'expired') {
    statusCondition = and(
      eq(uploadRequests.status, 'active'),
      lte(uploadRequests.expiresAt, nowSec),
    );
  } else if (query.status) {
    statusCondition = eq(uploadRequests.status, query.status);
  }
  const where = and(
    eq(uploadRequests.ownerId, ownerId),
    statusCondition,
    pattern ? sql`${uploadRequests.title} LIKE ${pattern} ESCAPE '\\'` : undefined,
  );
  const total = ctx.db.select({ n: count() }).from(uploadRequests).where(where).get()!.n;
  const rows = ctx.db
    .select()
    .from(uploadRequests)
    .where(where)
    .orderBy(desc(uploadRequests.createdAt), desc(uploadRequests.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all();
  return { items: rows.map((row) => toRequestSummary(ctx, row, nowSec)), total };
}

// ---- Unlock cookie ------------------------------------------------------------------------

/** Binds the cookie to the request and its current password (changing or removing it invalidates it). */
const unlockMac = (ctx: AppContext, row: UploadRequestRow, exp: number): string =>
  hmacBase64url(
    ctx.keys.downloadCookie,
    `request:${row.id}:${exp}:${passwordFingerprint(row.passwordHash ?? '')}`,
  );

/** Sets the `es_ru` cookie (`<exp>.<mac>`), scoped to the request path. */
export function setRequestUnlockCookie(
  ctx: AppContext,
  res: Response,
  row: UploadRequestRow,
  nowSec: number,
): void {
  const ttl = TRANSFER_POLICY.requestUnlockCookieSeconds;
  const exp = nowSec + ttl;
  setCookie(res, REQUEST_UNLOCK_COOKIE, signCookieValue(exp, unlockMac(ctx, row, exp)), ttl, {
    path: `/api/r/${row.token}`,
    sameSite: 'strict',
  });
}

/** True when the request has no password or the caller carries a valid, unexpired `es_ru` cookie. */
export function isRequestUnlocked(
  ctx: AppContext,
  req: Request,
  row: UploadRequestRow,
  nowSec: number,
): boolean {
  if (row.passwordHash === null) return true;
  return verifySignedCookie(readCookie(req, REQUEST_UNLOCK_COOKIE), nowSec, (exp) =>
    unlockMac(ctx, row, exp),
  );
}

// ---- Submission token ---------------------------------------------------------------------

/** The `submission:` prefix keeps these MACs apart from the other cookies made with the same key. */
const submissionMac = (ctx: Pick<AppContext, 'keys'>, transferId: string, exp: number): string =>
  hmacBase64url(ctx.keys.downloadCookie, `submission:${transferId}:${exp}`);

/** `exp.HMAC(submission:<transferId>:exp)`: proves its holder started this submission. */
export function signSubmissionToken(
  ctx: Pick<AppContext, 'keys'>,
  transferId: string,
  nowSec: number,
): { token: string; expiresAt: number } {
  const expiresAt = nowSec + TRANSFER_POLICY.submissionTokenSeconds;
  return {
    token: signCookieValue(expiresAt, submissionMac(ctx, transferId, expiresAt)),
    expiresAt,
  };
}

export function verifySubmissionToken(
  ctx: Pick<AppContext, 'keys'>,
  token: string | undefined,
  transferId: string,
  nowSec: number,
): boolean {
  return verifySignedCookie(token, nowSec, (exp) => submissionMac(ctx, transferId, exp));
}

/**
 * The received draft or transfer named by a submission token: it must belong to the request and
 * the `X-Submission-Token` header must be the one signed for it. Anything else is
 * `TRANSFER_NOT_FOUND`, so nothing about other transfers is revealed.
 */
export function loadSubmission(
  ctx: AppContext,
  req: Request,
  request: UploadRequestRow,
  transferId: string,
): TransferRow {
  const row = ctx.db.select().from(transfers).where(eq(transfers.id, transferId)).get();
  if (
    !row ||
    row.source !== 'received' ||
    row.uploadRequestId !== request.id ||
    !verifySubmissionToken(ctx, req.get(SUBMISSION_TOKEN_HEADER), transferId, nowSeconds(ctx.clock))
  ) {
    throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found');
  }
  return row;
}
