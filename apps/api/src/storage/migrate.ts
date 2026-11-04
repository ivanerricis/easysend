import { Readable } from 'node:stream';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  ErrorCode,
  StorageDriverKind,
  StorageMigration,
  StorageMigrationStatus,
} from '@easysend/shared';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { storageMigrations, transferFiles } from '../db/schema/index.js';
import { AppError } from '../http/errors.js';
import { reserveBytes } from './disk.js';
import { enqueueDeletion } from './deletions.js';
import { StorageObjectNotFoundError, type StorageReader } from './types.js';

/** The source object stays this long after a move, so downloads already reading it can finish. */
export const SOURCE_GRACE_SECONDS = 3600;
/** Bytes read from the source per call (constant memory: one block at a time). */
const COPY_BLOCK_BYTES = 4 * 1024 * 1024;
/** Failures in a row because a storage is unreachable before the whole job gives up. */
export const MAX_CONSECUTIVE_UNAVAILABLE = 5;

type MigrationContext = Pick<
  AppContext,
  'db' | 'dbHandle' | 'clock' | 'logger' | 'storage' | 'settings' | 'config'
>;
type MigrationRow = typeof storageMigrations.$inferSelect;

export interface MigrationEstimate {
  files: number;
  /** Stored (encrypted) bytes that would be copied. */
  bytes: number;
}

/** API view of a migration row. */
export function toMigrationView(row: MigrationRow): StorageMigration {
  return {
    id: row.id,
    target: row.target,
    status: row.status,
    totalFiles: row.totalFiles,
    doneFiles: row.doneFiles,
    totalBytes: row.totalBytes,
    doneBytes: row.doneBytes,
    failedFiles: row.failedFiles,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

/** Latest migration row (running ones included), or null when none ever ran. */
export function latestMigration(ctx: Pick<AppContext, 'db'>): StorageMigration | null {
  const row = ctx.db
    .select()
    .from(storageMigrations)
    .orderBy(desc(storageMigrations.startedAt), desc(sql`rowid`))
    .limit(1)
    .get();
  return row ? toMigrationView(row) : null;
}

function activeRow(ctx: Pick<AppContext, 'db'>): MigrationRow | undefined {
  return ctx.db
    .select()
    .from(storageMigrations)
    .where(inArray(storageMigrations.status, ['running', 'cancelling']))
    .limit(1)
    .get();
}

/** Files (and stored bytes) that live on a driver other than `target`. */
export function estimateMigration(
  ctx: Pick<AppContext, 'db'>,
  target: StorageDriverKind,
): MigrationEstimate {
  const row = ctx.db
    .select({
      files: count(),
      bytes: sql<number>`coalesce(sum(${transferFiles.storedSizeBytes}), 0)`,
    })
    .from(transferFiles)
    .where(ne(transferFiles.storage, target))
    .get();
  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 };
}

const errorId = (error: unknown): string =>
  error instanceof AppError
    ? error.code
    : error instanceof Error
      ? ((error as NodeJS.ErrnoException).code ?? error.name)
      : 'unknown';

// ---- Loop state (one per application) ------------------------------------------------------

interface LoopState {
  promise: Promise<void>;
  /** Set on shutdown: the loop stops between two files and leaves the row `running` (resumed later). */
  stop: boolean;
}
const loops = new WeakMap<object, LoopState>();

/** Resolves when the loop running in this process (if any) has ended. For tests and the CLI. */
export async function waitForMigration(ctx: object): Promise<void> {
  await loops.get(ctx)?.promise;
}

/** Asks the loop of this process to stop after the current file (shutdown); resolves when it did. */
export async function stopMigrationLoop(ctx: object): Promise<void> {
  const state = loops.get(ctx);
  if (!state) return;
  state.stop = true;
  await state.promise;
}

// ---- Start, cancel, resume -----------------------------------------------------------------

export interface StartMigrationOptions {
  target: StorageDriverKind;
  /** Admin who asked for it; null for the CLI. */
  startedBy: string | null;
  /** HMAC of the client IP for the audit row (panel requests). */
  ipHash?: string | null;
}

export interface MigrationHandle {
  migration: StorageMigration;
  /** Settles when the background loop of this migration ends (never rejects). */
  done: Promise<void>;
}

/**
 * Starts moving every stored file that is not on `target` yet. Refuses while another migration is
 * `running` or `cancelling` (checked in an immediate transaction, so also against the CLI running
 * in another process). Target `s3` needs a saved configuration; target `local` needs room for all
 * the bytes. The copy then runs in the background, one file at a time.
 */
export async function startMigration(
  ctx: MigrationContext,
  options: StartMigrationOptions,
): Promise<MigrationHandle> {
  const { target } = options;
  if (target === 's3' && !ctx.settings.get('storage')?.s3) {
    throw new AppError('CONFLICT', 'Save an S3 configuration before moving files to S3');
  }
  const driver = ctx.storage.forFile(target); // STORAGE_UNAVAILABLE when it cannot be built
  if (activeRow(ctx)) throw new AppError('MIGRATION_RUNNING', 'A migration is already running');

  const estimate = estimateMigration(ctx, target);
  const capacity = await driver.capacity();
  if (capacity && capacity.freeBytes - reserveBytes(ctx) < estimate.bytes) {
    throw new AppError('INSUFFICIENT_DISK_SPACE', 'Not enough free disk space for the migration');
  }

  const now = nowSeconds(ctx.clock);
  const row = ctx.dbHandle.db.transaction(
    (tx) => {
      const existing = tx
        .select({ id: storageMigrations.id })
        .from(storageMigrations)
        .where(inArray(storageMigrations.status, ['running', 'cancelling']))
        .get();
      if (existing) throw new AppError('MIGRATION_RUNNING', 'A migration is already running');
      const created = tx
        .insert(storageMigrations)
        .values({
          target,
          status: 'running',
          totalFiles: estimate.files,
          totalBytes: estimate.bytes,
          startedBy: options.startedBy,
          startedAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      audit(tx, {
        actorId: options.startedBy,
        action: 'storage.migration_started',
        targetType: 'storage_migration',
        targetId: created.id,
        metadata: { target, files: estimate.files, bytes: estimate.bytes },
        ipHash: options.ipHash ?? null,
        now,
      });
      return created;
    },
    { behavior: 'immediate' },
  );

  return { migration: toMigrationView(row), done: launchLoop(ctx, row.id) };
}

/**
 * Asks the running migration to stop after the current file (`cancelling`; the loop then marks it
 * `cancelled`). `CONFLICT` when none is running.
 */
export function cancelMigration(
  ctx: MigrationContext,
  options: { actorId: string | null; ipHash?: string | null },
): StorageMigration {
  const row = ctx.db
    .select()
    .from(storageMigrations)
    .where(eq(storageMigrations.status, 'running'))
    .limit(1)
    .get();
  if (!row) throw new AppError('CONFLICT', 'No migration is running');
  const now = nowSeconds(ctx.clock);
  const updated = ctx.db
    .update(storageMigrations)
    .set({ status: 'cancelling', updatedAt: now })
    .where(eq(storageMigrations.id, row.id))
    .returning()
    .get();
  audit(ctx.db, {
    actorId: options.actorId,
    action: 'storage.migration_cancelled',
    targetType: 'storage_migration',
    targetId: row.id,
    metadata: { target: row.target },
    ipHash: options.ipHash ?? null,
    now,
  });
  return toMigrationView(updated);
}

/**
 * Startup: a migration left `running` by a restart continues where it stopped (files already
 * moved are not listed again); one left `cancelling` is closed as `cancelled`. Returns the loop's
 * promise, or undefined when there was nothing to resume.
 */
export function resumeMigration(ctx: MigrationContext): Promise<void> | undefined {
  const row = activeRow(ctx);
  if (!row) return undefined;
  if (row.status === 'cancelling') {
    finish(ctx, row.id, 'cancelled', null);
    return Promise.resolve();
  }
  ctx.logger.info({ migrationId: row.id, target: row.target }, 'resuming storage migration');
  return launchLoop(ctx, row.id);
}

// ---- The loop ------------------------------------------------------------------------------

function launchLoop(ctx: MigrationContext, id: string): Promise<void> {
  const state: LoopState = {
    stop: false,
    promise: Promise.resolve(),
  };
  state.promise = runLoop(ctx, id, state).catch((error: unknown) => {
    // Unexpected: never leave the row `running` with nothing behind it.
    ctx.logger.error({ migrationId: id, err: errorId(error) }, 'storage migration crashed');
    try {
      finish(ctx, id, 'failed', 'INTERNAL_ERROR');
    } catch {
      // The database itself is failing: the next start resumes the row.
    }
  });
  loops.set(ctx, state);
  return state.promise;
}

/** A failure that ends the whole job instead of counting against one file. */
class FatalMigrationError extends Error {
  readonly errorCode: ErrorCode;
  constructor(errorCode: ErrorCode) {
    super(errorCode);
    this.errorCode = errorCode;
  }
}

function finish(
  ctx: MigrationContext,
  id: string,
  status: Extract<StorageMigrationStatus, 'done' | 'failed' | 'cancelled'>,
  errorCode: string | null,
): void {
  const now = nowSeconds(ctx.clock);
  const row = ctx.db
    .update(storageMigrations)
    .set({ status, errorCode, updatedAt: now, finishedAt: now })
    .where(eq(storageMigrations.id, id))
    .returning()
    .get();
  audit(ctx.db, {
    actorId: row.startedBy,
    action: 'storage.migration_finished',
    targetType: 'storage_migration',
    targetId: id,
    metadata: {
      status,
      target: row.target,
      doneFiles: row.doneFiles,
      failedFiles: row.failedFiles,
      ...(errorCode ? { errorCode } : {}),
    },
    now,
  });
}

async function runLoop(ctx: MigrationContext, id: string, state: LoopState): Promise<void> {
  const initial = ctx.db.select().from(storageMigrations).where(eq(storageMigrations.id, id)).get();
  if (!initial) return;
  const { target } = initial;
  // Snapshot of what to move: files stored elsewhere now. Files uploaded later are not chased.
  const ids = ctx.db
    .select({ id: transferFiles.id })
    .from(transferFiles)
    .where(ne(transferFiles.storage, target))
    .orderBy(asc(transferFiles.createdAt), asc(transferFiles.id))
    .all()
    .map((r) => r.id);

  let consecutiveUnavailable = 0;
  try {
    for (const fileId of ids) {
      if (state.stop) return; // shutdown: stays `running`, resumed at the next start
      const status = ctx.db
        .select({ status: storageMigrations.status })
        .from(storageMigrations)
        .where(eq(storageMigrations.id, id))
        .get()?.status;
      if (status === 'cancelling') {
        finish(ctx, id, 'cancelled', null);
        return;
      }
      if (status !== 'running') return;

      const file = ctx.db.select().from(transferFiles).where(eq(transferFiles.id, fileId)).get();
      if (!file || file.storage === target) continue; // deleted or moved meanwhile

      try {
        await checkRoom(ctx, target, file.storedSizeBytes);
        await moveFile(ctx, file, target);
        consecutiveUnavailable = 0;
        bump(ctx, id, { doneFiles: 1, doneBytes: file.storedSizeBytes });
      } catch (error) {
        if (error instanceof FatalMigrationError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
          throw new FatalMigrationError('INSUFFICIENT_DISK_SPACE');
        }
        ctx.logger.warn(
          { migrationId: id, fileId, err: errorId(error) },
          'storage migration: file not moved',
        );
        bump(ctx, id, { failedFiles: 1 });
        if (error instanceof AppError && error.code === 'STORAGE_UNAVAILABLE') {
          consecutiveUnavailable += 1;
          if (consecutiveUnavailable >= MAX_CONSECUTIVE_UNAVAILABLE) {
            throw new FatalMigrationError('STORAGE_UNAVAILABLE');
          }
        }
      }
    }
    finish(ctx, id, 'done', null);
  } catch (error) {
    if (!(error instanceof FatalMigrationError)) throw error;
    ctx.logger.error({ migrationId: id, errorCode: error.errorCode }, 'storage migration failed');
    finish(ctx, id, 'failed', error.errorCode);
  }
}

function bump(
  ctx: MigrationContext,
  id: string,
  by: { doneFiles?: number; doneBytes?: number; failedFiles?: number },
): void {
  ctx.db
    .update(storageMigrations)
    .set({
      ...(by.doneFiles ? { doneFiles: sql`${storageMigrations.doneFiles} + ${by.doneFiles}` } : {}),
      ...(by.doneBytes ? { doneBytes: sql`${storageMigrations.doneBytes} + ${by.doneBytes}` } : {}),
      ...(by.failedFiles
        ? { failedFiles: sql`${storageMigrations.failedFiles} + ${by.failedFiles}` }
        : {}),
      updatedAt: nowSeconds(ctx.clock),
    })
    .where(eq(storageMigrations.id, id))
    .run();
}

/** A target with a free-space limit (the local disk) must hold the file and the reserve. */
async function checkRoom(
  ctx: MigrationContext,
  target: StorageDriverKind,
  bytes: number,
): Promise<void> {
  const capacity = await ctx.storage.forFile(target).capacity();
  if (capacity && capacity.freeBytes - reserveBytes(ctx) < bytes) {
    throw new FatalMigrationError('INSUFFICIENT_DISK_SPACE');
  }
}

async function* readBlocks(reader: StorageReader): AsyncGenerator<Buffer> {
  let offset = 0;
  while (offset < reader.size) {
    const chunk = await reader.read(offset, Math.min(COPY_BLOCK_BYTES, reader.size - offset));
    if (chunk.length === 0) throw new Error('Stored object shorter than expected');
    offset += chunk.length;
    yield chunk;
  }
}

/** Size of an object on a driver, or null when it does not exist. */
async function sizeOnDriver(
  driver: ReturnType<MigrationContext['storage']['forFile']>,
  name: string,
): Promise<number | null> {
  let reader: StorageReader;
  try {
    reader = await driver.openReader(name);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) return null;
    throw error;
  }
  try {
    return reader.size;
  } finally {
    await reader.close();
  }
}

/**
 * Copies one file's ciphertext as it is (no decryption, keys unchanged), checks the size on the
 * target, then switches the row in a transaction. A row deleted (or already switched) while the
 * copy ran gets its fresh copy removed again. The source goes to the deletion queue with a grace
 * period. A copy left by an interrupted run is reused when its size is right, replaced otherwise.
 */
async function moveFile(
  ctx: MigrationContext,
  file: typeof transferFiles.$inferSelect,
  target: StorageDriverKind,
): Promise<void> {
  const source = ctx.storage.forFile(file.storage);
  const destination = ctx.storage.forFile(target);
  const name = file.storageName;

  const reader = await source.openReader(name);
  try {
    if (reader.size !== file.storedSizeBytes) throw new Error('Stored size mismatch');
    const present = await sizeOnDriver(destination, name);
    if (present !== null && present !== reader.size && !(await destination.delete(name))) {
      throw new AppError('STORAGE_UNAVAILABLE', 'Unable to replace a partial copy');
    }
    if (present !== reader.size) {
      await destination.put(
        name,
        Readable.from(readBlocks(reader), { objectMode: false }),
        reader.size,
      );
    }
  } finally {
    await reader.close();
  }

  if ((await sizeOnDriver(destination, name)) !== file.storedSizeBytes) {
    throw new Error('Stored size mismatch after copy');
  }

  const switched = ctx.db.transaction((tx) =>
    tx
      .update(transferFiles)
      .set({ storage: target })
      .where(and(eq(transferFiles.id, file.id), eq(transferFiles.storage, file.storage)))
      .run(),
  ).changes;
  const now = nowSeconds(ctx.clock);
  if (switched === 0) {
    // The file was deleted during the copy: nothing refers to the new object.
    if (!(await destination.delete(name))) enqueueDeletion(ctx.db, { storage: target, name }, now);
    return;
  }
  enqueueDeletion(ctx.db, { storage: file.storage, name }, now, now + SOURCE_GRACE_SECONDS);
}
