import { and, asc, count, desc, eq, gt, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type {
  TransferDetail,
  TransferMode,
  TransferStatus,
  TransferSummary,
  UserRole,
} from '@easysend/shared';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { randomToken } from '../crypto/hash.js';
import type { Db } from '../db/client.js';
import {
  transferFiles,
  transferRecipients,
  transfers,
  uploads,
  users,
} from '../db/schema/index.js';
import { AppError } from '../http/errors.js';
import { isStorageName, storagePath, tusFilePaths } from '../storage/paths.js';
import { removeFileQuietly } from '../storage/remove.js';
import { TRANSFER_POLICY } from './policy.js';

export type TransferRow = typeof transfers.$inferSelect;

/** What the service needs to know about the caller: who they are and whether they are an admin. */
export interface Actor {
  user: { id: string; role: UserRole };
}

type ServiceContext = Pick<AppContext, 'db' | 'config' | 'logger' | 'clock'>;

/** A new unguessable link token (32 random bytes, base64url). */
export const generateTransferToken = (): string => randomToken(TRANSFER_POLICY.tokenBytes);

/** An `active` transfer past its expiry reads as `expired` even before the cleanup job runs. */
export function effectiveStatus(
  row: Pick<TransferRow, 'status' | 'expiresAt'>,
  nowSec: number,
): TransferStatus {
  return row.status === 'active' && row.expiresAt <= nowSec ? 'expired' : row.status;
}

/**
 * The transfer for its owner or an admin. Anyone else (and a missing id) gets the same
 * `TRANSFER_NOT_FOUND`, so the existence of other users' transfers is not revealed.
 */
export function loadTransferForUser(
  ctx: Pick<AppContext, 'db'>,
  id: string,
  auth: Actor,
): TransferRow {
  const row = ctx.db.select().from(transfers).where(eq(transfers.id, id)).get();
  if (!row || (row.ownerId !== auth.user.id && auth.user.role !== 'admin')) {
    throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found');
  }
  return row;
}

/** Summary from a row plus the three values that come from other tables (pure, for list queries). */
export function summaryFrom(
  row: TransferRow,
  extra: { ownerEmail: string; fileCount: number; recipientCount: number },
  nowSec: number,
): TransferSummary {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: effectiveStatus(row, nowSec),
    ownerId: row.ownerId,
    ownerEmail: extra.ownerEmail,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    totalBytes: row.totalBytes,
    fileCount: extra.fileCount,
    recipientCount: extra.recipientCount,
    downloadCount: row.downloadCount,
    maxDownloads: row.maxDownloads,
    hasPassword: row.passwordHash !== null,
  };
}

function countFor(db: Db, table: typeof transferFiles | typeof transferRecipients, id: string) {
  return db.select({ n: count() }).from(table).where(eq(table.transferId, id)).get()!.n;
}

export function toTransferSummary(
  ctx: Pick<AppContext, 'db'>,
  row: TransferRow,
  nowSec: number,
): TransferSummary {
  const owner = ctx.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.ownerId))
    .get();
  return summaryFrom(
    row,
    {
      ownerEmail: owner?.email ?? '',
      fileCount: countFor(ctx.db, transferFiles, row.id),
      recipientCount: countFor(ctx.db, transferRecipients, row.id),
    },
    nowSec,
  );
}

/** Full view: summary plus files, recipients, pending uploads and the public link. */
export function toTransferDetail(
  ctx: Pick<AppContext, 'db' | 'publicUrl'>,
  row: TransferRow,
  nowSec: number,
): TransferDetail {
  const { db } = ctx;
  const files = db
    .select()
    .from(transferFiles)
    .where(eq(transferFiles.transferId, row.id))
    .orderBy(asc(transferFiles.originalName), asc(transferFiles.createdAt))
    .all();
  const recipients = db
    .select()
    .from(transferRecipients)
    .where(eq(transferRecipients.transferId, row.id))
    .orderBy(asc(transferRecipients.email))
    .all();
  const pending = db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.transferId, row.id),
        inArray(uploads.status, ['in_progress', 'processing', 'aborted']),
      ),
    )
    .orderBy(asc(uploads.createdAt))
    .all();
  const owner = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.ownerId))
    .get();

  return {
    ...summaryFrom(
      row,
      {
        ownerEmail: owner?.email ?? '',
        fileCount: files.length,
        recipientCount: recipients.length,
      },
      nowSec,
    ),
    message: row.message,
    shareUrl:
      row.status !== 'uploading' && ctx.publicUrl()
        ? new URL(`/d/${row.token}`, ctx.publicUrl()).toString()
        : null,
    firstDownloadedAt: row.firstDownloadedAt,
    files: files.map((file) => ({
      id: file.id,
      name: file.originalName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      sha256: file.sha256 ?? '',
      createdAt: file.createdAt,
    })),
    recipients: recipients.map((r) => ({ email: r.email, notifiedAt: r.notifiedAt })),
    uploads: pending.map((u) => ({
      id: u.id,
      fileName: u.fileName,
      totalSize: u.totalSize,
      status: u.status,
      expiresAt: u.expiresAt,
    })),
  };
}

export interface DeleteContext {
  /** User performing the deletion; null for the cleanup job (no audit row is written). */
  actorId: string | null;
  ipHash?: string | null;
  /** Why, for the log only (`user`, `admin`, `expired`, `revoked`, `draft_abandoned`...). */
  reason: string;
}

export interface DeleteTransferResult {
  ownerId: string;
  fileCount: number;
  /** Plaintext bytes released from the owner's `used_bytes`. */
  freedBytes: number;
  /** Encrypted files and tus temporary files that could not be unlinked (the orphan sweep retries). */
  unlinkFailures: number;
}

/** `used_bytes - bytes`, floored at zero so drift can never make it negative. */
const minusBytes = (bytes: number) => sql`max(0, ${users.usedBytes} - ${bytes})`;

/**
 * Deletes a transfer. The database part is one transaction: the owner's `used_bytes` shrinks by
 * the size of its files and the transfer row goes away (foreign keys cascade to files,
 * recipients, download logs and uploads). Only after the commit are the files unlinked, so a
 * crash can leave orphan files (the cleanup job sweeps them) but never rows pointing at nothing.
 * Returns null when the transfer does not exist.
 */
export async function deleteTransfer(
  ctx: ServiceContext,
  transferId: string,
  context: DeleteContext,
): Promise<DeleteTransferResult | null> {
  const outcome = ctx.db.transaction((tx) => {
    const row = tx.select().from(transfers).where(eq(transfers.id, transferId)).get();
    if (!row) return null;
    const files = tx
      .select({ storageName: transferFiles.storageName, sizeBytes: transferFiles.sizeBytes })
      .from(transferFiles)
      .where(eq(transferFiles.transferId, transferId))
      .all();
    const uploadIds = tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.transferId, transferId))
      .all()
      .map((u) => u.id);
    const freedBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

    if (freedBytes > 0) {
      tx.update(users)
        .set({ usedBytes: minusBytes(freedBytes) })
        .where(eq(users.id, row.ownerId))
        .run();
    }
    tx.delete(transfers).where(eq(transfers.id, transferId)).run();
    if (context.actorId) {
      audit(tx, {
        actorId: context.actorId,
        action: 'transfer.deleted',
        targetType: 'transfer',
        targetId: transferId,
        ...(context.actorId !== row.ownerId ? { metadata: { byAdmin: true } } : {}),
        ipHash: context.ipHash ?? null,
        now: nowSeconds(ctx.clock),
      });
    }
    return {
      ownerId: row.ownerId,
      freedBytes,
      storageNames: files.map((f) => f.storageName),
      uploadIds,
    };
  });
  if (!outcome) return null;

  let unlinkFailures = 0;
  const targets = [
    ...outcome.storageNames.filter(isStorageName).map((name) => storagePath(ctx.config, name)),
    ...outcome.uploadIds.filter(isStorageName).flatMap((id) => {
      const { data, info } = tusFilePaths(ctx.config, id);
      return [data, info];
    }),
  ];
  for (const target of targets) {
    if (!(await removeFileQuietly(target, ctx.logger))) unlinkFailures += 1;
  }
  ctx.logger.info(
    {
      transferId,
      reason: context.reason,
      files: outcome.storageNames.length,
      freedBytes: outcome.freedBytes,
      unlinkFailures,
    },
    'transfer deleted',
  );
  return {
    ownerId: outcome.ownerId,
    fileCount: outcome.storageNames.length,
    freedBytes: outcome.freedBytes,
    unlinkFailures,
  };
}

/**
 * Removes one file from a transfer (drafts only: the caller checks the status): the row, the
 * transfer's `total_bytes` and the owner's `used_bytes` in one transaction, then the encrypted
 * file. Returns false when the file does not belong to the transfer.
 */
export async function deleteTransferFile(
  ctx: ServiceContext,
  transferId: string,
  fileId: string,
  context: Omit<DeleteContext, 'reason'>,
): Promise<boolean> {
  const outcome = ctx.db.transaction((tx) => {
    const row = tx.select().from(transfers).where(eq(transfers.id, transferId)).get();
    const file = tx
      .select()
      .from(transferFiles)
      .where(and(eq(transferFiles.id, fileId), eq(transferFiles.transferId, transferId)))
      .get();
    if (!row || !file) return null;

    tx.delete(transferFiles).where(eq(transferFiles.id, fileId)).run();
    tx.update(transfers)
      .set({ totalBytes: sql`max(0, ${transfers.totalBytes} - ${file.sizeBytes})` })
      .where(eq(transfers.id, transferId))
      .run();
    tx.update(users)
      .set({ usedBytes: minusBytes(file.sizeBytes) })
      .where(eq(users.id, row.ownerId))
      .run();
    if (context.actorId) {
      audit(tx, {
        actorId: context.actorId,
        action: 'transfer.file_deleted',
        targetType: 'transfer',
        targetId: transferId,
        metadata: {
          fileId,
          ...(context.actorId !== row.ownerId ? { byAdmin: true } : {}),
        },
        ipHash: context.ipHash ?? null,
        now: nowSeconds(ctx.clock),
      });
    }
    return file.storageName;
  });
  if (outcome === null) return false;
  if (isStorageName(outcome)) await removeFileQuietly(storagePath(ctx.config, outcome), ctx.logger);
  return true;
}

/**
 * Realigns every user's `used_bytes` with the plaintext size of the files of their transfers
 * (the single source of truth). Returns how many users had a wrong value.
 */
export function recomputeUsedBytes(db: Db): number {
  const result = db.run(sql`
    UPDATE users SET used_bytes = (
      SELECT COALESCE(SUM(f.size_bytes), 0)
      FROM transfer_files f JOIN transfers t ON t.id = f.transfer_id
      WHERE t.owner_id = users.id
    )
    WHERE used_bytes != (
      SELECT COALESCE(SUM(f.size_bytes), 0)
      FROM transfer_files f JOIN transfers t ON t.id = f.transfer_id
      WHERE t.owner_id = users.id
    )
  `);
  return result.changes;
}

/** Escapes `%`, `_` and the escape character itself for a `LIKE ... ESCAPE '\'` pattern. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface TransferListFilter {
  /** Restrict to one owner (the user's own list, or the admin's `ownerId` filter). */
  ownerId?: string | undefined;
  /** Effective status: `expired` also matches `active` rows past their expiry. */
  status?: TransferStatus | undefined;
  mode?: TransferMode | undefined;
  /** Substring of the title or of a recipient email. */
  q?: string | undefined;
  page: number;
  pageSize: number;
}

function statusCondition(status: TransferStatus, nowSec: number): SQL | undefined {
  if (status === 'active') {
    return and(eq(transfers.status, 'active'), gt(transfers.expiresAt, nowSec));
  }
  if (status === 'expired') {
    return or(
      eq(transfers.status, 'expired'),
      and(eq(transfers.status, 'active'), lte(transfers.expiresAt, nowSec)),
    );
  }
  return eq(transfers.status, status);
}

/** One page of transfers, newest first, with the total number of matches. */
export function listTransfersPage(
  ctx: Pick<AppContext, 'db'>,
  filter: TransferListFilter,
  nowSec: number,
): { items: TransferSummary[]; total: number } {
  const pattern = filter.q ? `%${escapeLike(filter.q)}%` : undefined;
  const where = and(
    filter.ownerId ? eq(transfers.ownerId, filter.ownerId) : undefined,
    filter.status ? statusCondition(filter.status, nowSec) : undefined,
    filter.mode ? eq(transfers.mode, filter.mode) : undefined,
    pattern
      ? or(
          sql`${transfers.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`EXISTS (SELECT 1 FROM ${transferRecipients} WHERE ${transferRecipients.transferId} = ${transfers.id} AND ${transferRecipients.email} LIKE ${pattern} ESCAPE '\\')`,
        )
      : undefined,
  );
  const total = ctx.db.select({ n: count() }).from(transfers).where(where).get()!.n;
  const rows = ctx.db
    .select()
    .from(transfers)
    .where(where)
    .orderBy(desc(transfers.createdAt), desc(transfers.id))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize)
    .all();
  return { items: rows.map((row) => toTransferSummary(ctx, row, nowSec)), total };
}

/**
 * Sends the link email to every recipient of an email-mode transfer and stamps `notified_at` on
 * those that went out (the mailer never throws and answers false on failure). Returns how many
 * emails were sent.
 */
export async function notifyRecipients(
  ctx: Pick<AppContext, 'db' | 'mailer' | 'clock'>,
  row: TransferRow,
  senderName: string | null,
): Promise<number> {
  const files = ctx.db
    .select({ n: count(), bytes: sql<number>`coalesce(sum(${transferFiles.sizeBytes}), 0)` })
    .from(transferFiles)
    .where(eq(transferFiles.transferId, row.id))
    .get()!;
  const recipients = ctx.db
    .select()
    .from(transferRecipients)
    .where(eq(transferRecipients.transferId, row.id))
    .orderBy(asc(transferRecipients.email))
    .all();

  let sent = 0;
  for (const recipient of recipients) {
    const ok = await ctx.mailer.sendTransferLink({
      to: recipient.email,
      transfer: {
        token: row.token,
        title: row.title,
        message: row.message,
        senderName,
        expiresAt: row.expiresAt,
        fileCount: files.n,
        totalBytes: files.bytes,
      },
    });
    if (!ok) continue;
    sent += 1;
    ctx.db
      .update(transferRecipients)
      .set({ notifiedAt: nowSeconds(ctx.clock) })
      .where(eq(transferRecipients.id, recipient.id))
      .run();
  }
  if (sent > 0) {
    ctx.db
      .update(transfers)
      .set({ notifiedAt: nowSeconds(ctx.clock) })
      .where(eq(transfers.id, row.id))
      .run();
  }
  return sent;
}
