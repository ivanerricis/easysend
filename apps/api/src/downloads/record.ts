import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Transform } from 'node:stream';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { downloadLogs, transfers, users } from '../db/schema/index.js';
import { AppError } from '../http/errors.js';
import type { TransferRow } from '../transfers/service.js';
import { unavailableError } from './access.js';

const USER_AGENT_MAX = 512;

/**
 * Sends the first-download notice to the owner. The claim on `notified_at` (meaning only "the
 * owner was notified") is atomic, so parallel downloads send one email; when the send fails or the
 * owner is gone the claim is released and the next download tries again. Never throws on a failed
 * send; the caller logs unexpected errors.
 */
async function notifyOwner(
  ctx: AppContext,
  transfer: TransferRow,
  downloadedAt: number,
  nowSec: number,
): Promise<void> {
  const claimed = ctx.db
    .update(transfers)
    .set({ notifiedAt: nowSec })
    .where(and(eq(transfers.id, transfer.id), isNull(transfers.notifiedAt)))
    .returning({ id: transfers.id })
    .get();
  if (!claimed) return;
  const release = (): void => {
    ctx.db.update(transfers).set({ notifiedAt: null }).where(eq(transfers.id, transfer.id)).run();
  };
  try {
    const owner = ctx.db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, transfer.ownerId))
      .get();
    const sent =
      owner !== undefined &&
      (await ctx.mailer.sendFirstDownload({
        to: owner.email,
        locale: owner.locale,
        transferId: transfer.id,
        title: transfer.title,
        downloadedAt,
      }));
    if (!sent) release();
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Counts one download, atomically: the single UPDATE re-checks status, expiry and the limit, so
 * two requests racing for the last download cannot both succeed. When the transfer is no longer
 * available the matching error is thrown. While the owner has not been notified (`notified_at`
 * empty) the download triggers the notice in the background (not awaited, so it never delays the
 * stream); a failed notice is therefore retried at the next download.
 */
export function claimDownload(ctx: AppContext, transfer: TransferRow): void {
  const nowSec = nowSeconds(ctx.clock);
  const updated = ctx.db
    .update(transfers)
    .set({
      downloadCount: sql`${transfers.downloadCount} + 1`,
      firstDownloadedAt: sql`coalesce(${transfers.firstDownloadedAt}, ${nowSec})`,
    })
    .where(
      and(
        eq(transfers.id, transfer.id),
        eq(transfers.status, 'active'),
        gt(transfers.expiresAt, nowSec),
        or(isNull(transfers.maxDownloads), lt(transfers.downloadCount, transfers.maxDownloads)),
      ),
    )
    .returning({
      notifiedAt: transfers.notifiedAt,
      firstDownloadedAt: transfers.firstDownloadedAt,
    })
    .get();

  if (!updated) {
    const current = ctx.db.select().from(transfers).where(eq(transfers.id, transfer.id)).get();
    throw (current && unavailableError(current, nowSec)) ?? new AppError('TRANSFER_NOT_FOUND');
  }
  if (updated.notifiedAt === null) {
    notifyOwner(ctx, transfer, updated.firstDownloadedAt ?? nowSec, nowSec).catch(
      (error: unknown) => {
        ctx.logger.warn({ transferId: transfer.id, err: error }, 'first download notice failed');
      },
    );
  }
}

/**
 * Counts the bytes that go through to the client and writes one `download_logs` row when the
 * response ends or the connection closes (a client abort records the partial count).
 * Put the returned Transform between the source and `res`.
 */
export function logDownloadOnClose(
  ctx: AppContext,
  req: Request,
  res: Response,
  entry: { transferId: string; fileId: string | null; ipHash: string },
): Transform {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  res.once('close', () => {
    try {
      ctx.db
        .insert(downloadLogs)
        .values({
          transferId: entry.transferId,
          fileId: entry.fileId,
          ipHash: entry.ipHash,
          userAgent: (req.get('user-agent') ?? '').slice(0, USER_AGENT_MAX) || null,
          bytesSent: bytes,
        })
        .run();
    } catch (error) {
      // The transfer may have been deleted meanwhile (FK): the log is lost with it.
      ctx.logger.warn({ transferId: entry.transferId, err: error }, 'download log failed');
    }
  });
  return counter;
}
