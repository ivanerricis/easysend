import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { schedule, validate } from 'node-cron';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import {
  auditLog,
  downloadLogs,
  passwordResetTokens,
  transferFiles,
  transfers,
  uploads,
} from '../db/schema/index.js';
import { isStorageName, isStorageEntry, PART_SUFFIX, tusFilePaths } from '../storage/paths.js';
import { removeFileQuietly } from '../storage/remove.js';
import { deleteTransfer, recomputeUsedBytes } from '../transfers/service.js';

/** Counters of one cleanup run, one entry per step. */
export interface CleanupReport {
  /** Expired, revoked and abandoned-draft transfers removed (rows and files). */
  deletedTransfers: number;
  /** `in_progress` uploads past their expiry and old `aborted` uploads removed. */
  abortedUploads: number;
  /** Files in `TMP_UPLOAD_DIR` with no `uploads` row, removed. */
  orphanTmpFiles: number;
  /** Files in `STORAGE_DIR` not referenced by any transfer file, removed. */
  orphanFiles: number;
  /** `download_logs` and `audit_log` rows past the retention. */
  purgedLogRows: number;
  /** Expired sessions plus expired or used password reset tokens. */
  purgedAuthRows: number;
  /** Users whose `used_bytes` was wrong and has been realigned. */
  usedBytesFixed: number;
  /** Names of the steps that threw (the others still ran). */
  failedSteps: string[];
}

/** An encrypted file this young may still be between "renamed" and "row inserted": never swept. */
const ORPHAN_GRACE_SECONDS = 3600;

const errorId = (error: unknown): string => {
  const e = error as { code?: unknown; name?: unknown };
  return typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : 'Error';
};

/** Streams the regular files of a directory; a missing directory is an empty one. */
async function* listFiles(dir: string): AsyncGenerator<{ name: string; full: string }> {
  let handle;
  try {
    handle = await opendir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for await (const entry of handle) {
    if (entry.isFile()) yield { name: entry.name, full: path.join(dir, entry.name) };
  }
}

const mtimeSeconds = async (file: string): Promise<number | undefined> => {
  try {
    return Math.floor((await stat(file)).mtimeMs / 1000);
  } catch {
    return undefined;
  }
};

/**
 * Transfers to delete: expired `active` ones, `revoked`/`expired`/`deleted` ones, and drafts
 * (`uploading`) idle for longer than the TTL. Draft activity is the latest of the transfer's
 * creation and its uploads' `last_activity_at`; a draft with an upload still `processing` is
 * never touched (the worker is encrypting its file).
 */
function selectDoomedTransfers(
  ctx: AppContext,
  now: number,
): { id: string; reason: 'expired' | 'revoked' | 'draft_abandoned' }[] {
  const { db } = ctx;
  const draftCutoff = now - ctx.config.incompleteUploadTtlHours * 3600;

  const finished = db
    .select({ id: transfers.id, status: transfers.status, expiresAt: transfers.expiresAt })
    .from(transfers)
    .where(
      or(
        and(eq(transfers.status, 'active'), lte(transfers.expiresAt, now)),
        inArray(transfers.status, ['revoked', 'expired', 'deleted']),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      reason: row.status === 'revoked' ? ('revoked' as const) : ('expired' as const),
    }));

  const drafts = db
    .all<{ id: string }>(
      sql`SELECT t.id AS id FROM transfers t
          WHERE t.status = 'uploading'
            AND max(t.created_at, COALESCE((SELECT max(u.last_activity_at) FROM uploads u WHERE u.transfer_id = t.id), 0)) <= ${draftCutoff}
            AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.transfer_id = t.id AND u.status = 'processing')`,
    )
    .map((row) => ({ id: row.id, reason: 'draft_abandoned' as const }));

  return [...finished, ...drafts];
}

async function cleanTransfers(ctx: AppContext, now: number): Promise<number> {
  let deleted = 0;
  for (const { id, reason } of selectDoomedTransfers(ctx, now)) {
    if (await deleteTransfer(ctx, id, { actorId: null, reason })) deleted += 1;
  }
  return deleted;
}

async function removeTusFiles(ctx: AppContext, uploadId: string): Promise<void> {
  if (!isStorageName(uploadId)) return;
  const { data, info } = tusFilePaths(ctx.config, uploadId);
  await removeFileQuietly(data, ctx.logger);
  await removeFileQuietly(info, ctx.logger);
}

/**
 * `in_progress` uploads past their expiry and `aborted` ones idle past the TTL: tus files and
 * row go. `processing` rows and their files are never touched. (@tus/server's own
 * `cleanUpExpiredUploads` is deliberately not used: it would not know about `processing`.)
 */
async function cleanUploads(ctx: AppContext, now: number): Promise<number> {
  const { db } = ctx;
  const abortedCutoff = now - ctx.config.incompleteUploadTtlHours * 3600;
  const rows = db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      or(
        and(eq(uploads.status, 'in_progress'), lte(uploads.expiresAt, now)),
        and(eq(uploads.status, 'aborted'), lte(uploads.lastActivityAt, abortedCutoff)),
      ),
    )
    .all();
  for (const { id } of rows) {
    await removeTusFiles(ctx, id);
    db.delete(uploads).where(eq(uploads.id, id)).run();
  }
  return rows.length;
}

/**
 * Files in `TMP_UPLOAD_DIR` (`<uuid>` or `<uuid>.json`) with no `uploads` row and untouched for
 * longer than the TTL. The set of upload ids is loaded in memory (one short string per upload:
 * fine at this scale).
 */
async function cleanTmpOrphans(ctx: AppContext, now: number): Promise<number> {
  const known = new Set(
    ctx.db
      .select({ id: uploads.id })
      .from(uploads)
      .all()
      .map((r) => r.id),
  );
  const cutoff = now - ctx.config.incompleteUploadTtlHours * 3600;
  let removed = 0;
  for await (const { name, full } of listFiles(ctx.config.tmpUploadDir)) {
    const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
    if (!isStorageName(id) || known.has(id)) continue;
    const mtime = await mtimeSeconds(full);
    if (mtime === undefined || mtime > cutoff) continue;
    if (await removeFileQuietly(full, ctx.logger)) removed += 1;
  }
  return removed;
}

/**
 * Encrypted files no `transfer_files` row points to: the retry path for failed unlinks and for
 * users deleted with `transfers=delete`. `.part` files are skipped (the upload worker removes
 * its leftovers at startup), as are names that are not UUIDs and files younger than an hour.
 * The referenced names are loaded as a set (36 bytes per file).
 */
async function cleanStorageOrphans(ctx: AppContext, now: number): Promise<number> {
  const referenced = new Set(
    ctx.db
      .select({ name: transferFiles.storageName })
      .from(transferFiles)
      .all()
      .map((r) => r.name),
  );
  const cutoff = now - ORPHAN_GRACE_SECONDS;
  let removed = 0;
  for await (const { name, full } of listFiles(ctx.config.storageDir)) {
    if (name.endsWith(PART_SUFFIX) || !isStorageEntry(name) || referenced.has(name)) continue;
    const mtime = await mtimeSeconds(full);
    if (mtime === undefined || mtime > cutoff) continue;
    if (await removeFileQuietly(full, ctx.logger)) removed += 1;
  }
  return removed;
}

function purgeOldLogs(ctx: AppContext, now: number): number {
  const cutoff = now - ctx.config.logRetentionDays * 86_400;
  const downloads = ctx.db.delete(downloadLogs).where(lte(downloadLogs.createdAt, cutoff - 1));
  const audits = ctx.db.delete(auditLog).where(lte(auditLog.createdAt, cutoff - 1));
  return downloads.run().changes + audits.run().changes;
}

function purgeAuthRows(ctx: AppContext, now: number): number {
  const tokens = ctx.db
    .delete(passwordResetTokens)
    .where(or(lte(passwordResetTokens.expiresAt, now), isNotNull(passwordResetTokens.usedAt)))
    .run().changes;
  return tokens + ctx.sessions.purgeExpired();
}

/**
 * One pass of the periodic cleanup. Each step is isolated: a failure is logged (error name or
 * code only) and the other steps still run. The job writes no audit rows (it is the system, not
 * a user): the summary log line is the record.
 */
export async function runCleanup(ctx: AppContext): Promise<CleanupReport> {
  const now = nowSeconds(ctx.clock);
  const report: CleanupReport = {
    deletedTransfers: 0,
    abortedUploads: 0,
    orphanTmpFiles: 0,
    orphanFiles: 0,
    purgedLogRows: 0,
    purgedAuthRows: 0,
    usedBytesFixed: 0,
    failedSteps: [],
  };

  const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      report.failedSteps.push(name);
      ctx.logger.error({ step: name, err: errorId(error) }, 'cleanup step failed');
    }
  };

  await step('transfers', async () => {
    report.deletedTransfers = await cleanTransfers(ctx, now);
  });
  await step('uploads', async () => {
    report.abortedUploads = await cleanUploads(ctx, now);
  });
  await step('tmp-orphans', async () => {
    report.orphanTmpFiles = await cleanTmpOrphans(ctx, now);
  });
  await step('storage-orphans', async () => {
    report.orphanFiles = await cleanStorageOrphans(ctx, now);
  });
  await step('logs', () => {
    report.purgedLogRows = purgeOldLogs(ctx, now);
  });
  await step('auth-rows', () => {
    report.purgedAuthRows = purgeAuthRows(ctx, now);
  });
  await step('used-bytes', () => {
    report.usedBytesFixed = recomputeUsedBytes(ctx.db);
  });

  ctx.logger.info({ ...report }, 'cleanup finished');
  return report;
}

export interface CleanupSchedule {
  stop(): void;
  /** Resolves when the run started at scheduling time has finished (tests await it). */
  initialRun: Promise<void>;
}

/**
 * Runs `runCleanup` once right away (in the background, startup is not delayed) and then on
 * `CLEANUP_CRON` in `TZ`. A run still in progress makes the next trigger skip. An invalid
 * expression throws at once, so a bad `CLEANUP_CRON` stops the startup with a clear message.
 */
export function scheduleCleanup(ctx: AppContext): CleanupSchedule {
  const expression = ctx.config.cleanupCron;
  if (!validate(expression)) {
    throw new Error(`Invalid CLEANUP_CRON expression: "${expression}"`);
  }

  let running = false;
  let stopped = false;
  const run = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runCleanup(ctx);
    } catch (error) {
      ctx.logger.error({ err: errorId(error) }, 'cleanup run failed');
    } finally {
      running = false;
    }
  };

  const task = schedule(expression, run, { timezone: ctx.config.timezone, name: 'cleanup' });
  const initialRun = run();
  return {
    initialRun,
    stop() {
      stopped = true;
      void task.destroy();
    },
  };
}
