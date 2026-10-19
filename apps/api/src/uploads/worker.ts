import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { encryptFile } from '../crypto/segments.js';
import { transferFiles, transfers, uploads, users } from '../db/schema/index.js';
import { sanitizeFileName } from '../storage/filenames.js';
import {
  PART_SUFFIX,
  isStorageEntry,
  storagePartPath,
  storagePath,
  tusFilePaths,
} from '../storage/paths.js';
import { removeFileQuietly } from '../storage/remove.js';

/**
 * Background queue that hashes and encrypts finished tus uploads (phase 3, WP2). One job at a
 * time keeps CPU and disk use predictable on a small machine.
 */
export interface UploadWorker {
  /** Queues an upload (status `processing`). Returns immediately. */
  enqueue(uploadId: string): void;
  /** Resolves when the queue is empty and nothing is running (tests, graceful shutdown). */
  idle(): Promise<void>;
  /** At startup: removes leftover `*.part` files and queues the uploads still `processing`. */
  recover(): Promise<void>;
  /** Stops taking new jobs. */
  stop(): void;
}

type JobOutcome = 'done' | 'stale';

/** `filetype` from the tus info file (`<id>.json`), null when absent or unreadable. */
async function readMimeType(infoPath: string): Promise<string | null> {
  try {
    const info = JSON.parse(await readFile(infoPath, 'utf8')) as {
      metadata?: { filetype?: unknown };
    };
    const filetype = info.metadata?.filetype;
    return typeof filetype === 'string' && filetype !== '' ? filetype.slice(0, 255) : null;
  } catch {
    return null;
  }
}

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException).code ?? (error as Error).name ?? 'unknown';

/**
 * Builds the worker. `ctx` is attached to the object after creation (see `createContext`), so
 * its fields are only read when a job runs.
 */
export function createUploadWorker(ctx: AppContext): UploadWorker {
  const queue: string[] = [];
  let currentId: string | null = null;
  let running = false;
  let stopped = false;
  let waiters: (() => void)[] = [];

  const settle = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  /** Moves the file to its final name and records it, all or nothing. */
  async function encryptAndRecord(uploadId: string): Promise<JobOutcome> {
    const { db, config, logger } = ctx;
    const row = db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
    if (!row || row.status !== 'processing' || row.transferId === null) return 'stale';

    const tus = tusFilePaths(config, uploadId);
    await stat(tus.data); // ENOENT here aborts the upload (caught by the caller)
    const mimeType = await readMimeType(tus.info);

    await mkdir(config.storageDir, { recursive: true });
    const storageName = randomUUID();
    const finalPath = storagePath(config, storageName);
    const partPath = storagePartPath(config, storageName);
    let encrypted: Awaited<ReturnType<typeof encryptFile>>;
    try {
      encrypted = await encryptFile({
        srcPath: tus.data,
        dstPath: partPath,
        size: row.totalSize,
        fileKey: ctx.keys.file,
      });
      await rename(partPath, finalPath);
    } catch (error) {
      await removeFileQuietly(partPath, logger);
      throw error;
    }

    const transferId = row.transferId;
    const outcome = db.transaction((tx): JobOutcome => {
      const current = tx.select().from(uploads).where(eq(uploads.id, uploadId)).get();
      const transfer = tx.select().from(transfers).where(eq(transfers.id, transferId)).get();
      if (!current || current.status !== 'processing' || transfer?.status !== 'uploading') {
        return 'stale';
      }
      tx.insert(transferFiles)
        .values({
          transferId,
          originalName: sanitizeFileName(row.fileName),
          storageName,
          sizeBytes: row.totalSize,
          storedSizeBytes: encrypted.storedSize,
          mimeType,
          sha256: encrypted.sha256,
          encKeyWrapped: encrypted.wrappedKey,
          encNoncePrefix: encrypted.noncePrefix,
          encSegmentSize: encrypted.segmentSize,
          encVersion: encrypted.version,
          createdAt: nowSeconds(ctx.clock),
        })
        .run();
      tx.update(uploads).set({ status: 'completed' }).where(eq(uploads.id, uploadId)).run();
      tx.update(transfers)
        .set({ totalBytes: sql`${transfers.totalBytes} + ${row.totalSize}` })
        .where(eq(transfers.id, transferId))
        .run();
      tx.update(users)
        .set({ usedBytes: sql`${users.usedBytes} + ${row.totalSize}` })
        .where(eq(users.id, transfer.ownerId))
        .run();
      return 'done';
    });

    if (outcome === 'stale') {
      // The transfer or the upload disappeared while encrypting: nothing references the file.
      await removeFileQuietly(finalPath, logger);
      const stale = db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
      if (stale?.status === 'processing') {
        db.update(uploads).set({ status: 'aborted' }).where(eq(uploads.id, uploadId)).run();
      }
    }
    return outcome;
  }

  async function processUpload(uploadId: string): Promise<void> {
    const { db, config, logger } = ctx;
    const tus = tusFilePaths(config, uploadId);
    try {
      await encryptAndRecord(uploadId);
    } catch (error) {
      logger.error({ uploadId, code: errorCode(error) }, 'upload processing failed');
      db.update(uploads).set({ status: 'aborted' }).where(eq(uploads.id, uploadId)).run();
    }
    // Plaintext copy: gone in every case (success, stale, failure).
    await removeFileQuietly(tus.data, logger);
    await removeFileQuietly(tus.info, logger);
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!stopped && queue.length > 0) {
        currentId = queue.shift() ?? null;
        if (currentId === null) break;
        try {
          await processUpload(currentId);
        } catch (error) {
          ctx.logger.error({ uploadId: currentId, code: errorCode(error) }, 'upload worker error');
        }
        currentId = null;
      }
    } finally {
      running = false;
      if (stopped || queue.length === 0) settle();
    }
  }

  function enqueue(uploadId: string): void {
    if (stopped || uploadId === currentId || queue.includes(uploadId)) return;
    queue.push(uploadId);
    void pump();
  }

  return {
    enqueue,

    idle() {
      if (!running && (stopped || queue.length === 0)) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    async recover() {
      const { db, config, logger } = ctx;
      let entries: string[] = [];
      try {
        entries = await readdir(config.storageDir);
      } catch {
        // No storage directory yet: nothing to sweep.
      }
      for (const name of entries) {
        if (name.endsWith(PART_SUFFIX) && isStorageEntry(name)) {
          await removeFileQuietly(path.join(config.storageDir, name), logger);
        }
      }
      const pending = db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.status, 'processing'))
        .all();
      for (const { id } of pending) enqueue(id);
    },

    stop() {
      stopped = true;
      settle();
    },
  };
}
