import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { TransferStatus, UploadStatus } from '@easysend/shared';
import { encryptFile } from '../src/crypto/segments.js';
import { transferFiles, transfers, uploads, users } from '../src/db/schema/index.js';
import { storagePath, tusFilePaths } from '../src/storage/paths.js';
import { createTestApp, makeTempDir, type TestApp } from './helpers.js';

/** Test app whose DATA_DIR is a temp dir with the storage and tmp directories created. */
export async function createCleanupApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dir = makeTempDir();
  const t = await createTestApp({ env: { DATA_DIR: dir, ...env } });
  mkdirSync(t.config.storageDir, { recursive: true });
  mkdirSync(t.config.tmpUploadDir, { recursive: true });
  return t;
}

const nowSec = (t: TestApp) => Math.floor(t.clock() / 1000);

export function insertTransfer(
  t: TestApp,
  input: {
    ownerId: string;
    status: TransferStatus;
    /** Seconds from the test clock's now. Default: one hour in the future. */
    expiresIn?: number;
    createdAgo?: number;
  },
): string {
  const now = nowSec(t);
  return t.db.db
    .insert(transfers)
    .values({
      ownerId: input.ownerId,
      token: randomUUID(),
      mode: 'link',
      status: input.status,
      expiresAt: now + (input.expiresIn ?? 3600),
      createdAt: now - (input.createdAgo ?? 0),
    })
    .returning({ id: transfers.id })
    .get().id;
}

/** Encrypts a small real file into STORAGE_DIR and records it (and the owner's used bytes). */
export async function insertStoredFile(
  t: TestApp,
  transferId: string,
  ownerId: string,
  content = 'hello cleanup',
): Promise<{ storageName: string; fileId: string; path: string }> {
  const src = path.join(makeTempDir(), 'plain.bin');
  writeFileSync(src, content);
  const size = Buffer.byteLength(content);
  const storageName = randomUUID();
  const dst = storagePath(t.config, storageName);
  const enc = await encryptFile({ srcPath: src, dstPath: dst, size, fileKey: t.ctx.keys.file });
  const row = t.db.db
    .insert(transferFiles)
    .values({
      transferId,
      originalName: 'f.txt',
      storageName,
      sizeBytes: size,
      storedSizeBytes: enc.storedSize,
      sha256: enc.sha256,
      encKeyWrapped: enc.wrappedKey,
      encNoncePrefix: enc.noncePrefix,
      encSegmentSize: enc.segmentSize,
      encVersion: enc.version,
    })
    .returning({ id: transferFiles.id })
    .get();
  t.db.db
    .update(users)
    .set({ usedBytes: sql`${users.usedBytes} + ${size}` })
    .where(eq(users.id, ownerId))
    .run();
  return { storageName, fileId: row.id, path: dst };
}

/** An upload row plus its tus data and metadata files. Times are seconds relative to now. */
export function insertUpload(
  t: TestApp,
  input: {
    ownerId: string;
    status: UploadStatus;
    transferId?: string;
    activityAgo?: number;
    expiresIn?: number;
  },
): { id: string; data: string; info: string } {
  const id = randomUUID();
  const now = nowSec(t);
  t.db.db
    .insert(uploads)
    .values({
      id,
      ownerId: input.ownerId,
      transferId: input.transferId ?? null,
      fileName: 'f.bin',
      totalSize: 4,
      status: input.status,
      lastActivityAt: now - (input.activityAgo ?? 0),
      expiresAt: now + (input.expiresIn ?? 3600),
    })
    .run();
  const { data, info } = tusFilePaths(t.config, id);
  writeFileSync(data, 'data');
  writeFileSync(info, '{}');
  return { id, data, info };
}

/** Sets a file's mtime `secondsAgo` seconds before the test clock's now. */
export function ageFile(t: TestApp, file: string, secondsAgo: number): void {
  const when = nowSec(t) - secondsAgo;
  utimesSync(file, when, when);
}

export const exists = (file: string): boolean => existsSync(file);
