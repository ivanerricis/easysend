import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { transferDetailSchema, transferSummarySchema } from '@easysend/shared';
import {
  auditLog,
  downloadLogs,
  transferFiles,
  transferRecipients,
  transfers,
  uploads,
  users,
} from '../src/db/schema/index.js';
import { storagePath, tusFilePaths } from '../src/storage/paths.js';
import {
  deleteTransfer,
  deleteTransferFile,
  effectiveStatus,
  generateTransferToken,
  loadTransferForUser,
  recomputeUsedBytes,
  toTransferDetail,
  toTransferSummary,
} from '../src/transfers/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const NOW = 1_800_000_000;

describe('effectiveStatus', () => {
  it('turns an active transfer past its expiry into expired', () => {
    expect(effectiveStatus({ status: 'active', expiresAt: NOW + 1 }, NOW)).toBe('active');
    expect(effectiveStatus({ status: 'active', expiresAt: NOW }, NOW)).toBe('expired');
    expect(effectiveStatus({ status: 'active', expiresAt: NOW - 100 }, NOW)).toBe('expired');
  });

  it('leaves the other statuses alone', () => {
    for (const status of ['uploading', 'revoked', 'expired', 'deleted'] as const) {
      expect(effectiveStatus({ status, expiresAt: NOW - 100 }, NOW)).toBe(status);
    }
  });
});

describe('generateTransferToken', () => {
  it('is 43 url-safe characters and unique', () => {
    const a = generateTransferToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateTransferToken()).not.toBe(a);
  });
});

interface Seeded {
  transferId: string;
  token: string;
  files: { id: string; storageName: string; sizeBytes: number; path: string }[];
}

/** Inserts a transfer with files (and their encrypted stand-ins on disk) for `ownerId`. */
async function seedTransfer(
  app: TestApp,
  ownerId: string,
  options: {
    sizes?: number[];
    status?: 'uploading' | 'active' | 'revoked';
    expiresAt?: number;
  } = {},
): Promise<Seeded> {
  const { ctx } = app;
  const sizes = options.sizes ?? [100, 250];
  await mkdir(ctx.config.storageDir, { recursive: true });
  const token = generateTransferToken();
  const row = ctx.db
    .insert(transfers)
    .values({
      ownerId,
      token,
      title: 'Holiday photos',
      message: 'Enjoy',
      mode: 'email',
      expiresAt: options.expiresAt ?? NOW + 1000,
      totalBytes: sizes.reduce((a, b) => a + b, 0),
      status: options.status ?? 'active',
      passwordHash: 'x',
    })
    .returning()
    .get();
  const files: Seeded['files'] = [];
  for (const [index, sizeBytes] of sizes.entries()) {
    const storageName = randomUUID();
    const file = ctx.db
      .insert(transferFiles)
      .values({
        transferId: row.id,
        originalName: `file-${sizes.length - index}.bin`,
        storageName,
        sizeBytes,
        storedSizeBytes: sizeBytes + 16,
        sha256: 'a'.repeat(64),
        encKeyWrapped: 'v1:x:y:z',
        encNoncePrefix: 'AAAAAAAAAAA',
        encSegmentSize: 65_536,
      })
      .returning()
      .get();
    const filePath = storagePath(ctx.config, storageName);
    await writeFile(filePath, 'encrypted');
    files.push({ id: file.id, storageName, sizeBytes, path: filePath });
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  ctx.db.update(users).set({ usedBytes: total }).where(eq(users.id, ownerId)).run();
  return { transferId: row.id, token, files };
}

describe('loadTransferForUser', () => {
  it('lets the owner and admins in, and hides the transfer from everyone else', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const other = await app.createUser();
    const admin = await app.createUser({ role: 'admin' });
    const { transferId } = await seedTransfer(app, owner.id);

    expect(loadTransferForUser(app.ctx, transferId, { user: owner }).id).toBe(transferId);
    expect(loadTransferForUser(app.ctx, transferId, { user: admin }).id).toBe(transferId);
    for (const [id, user] of [
      [transferId, other],
      [randomUUID(), owner],
    ] as const) {
      expect(() => loadTransferForUser(app.ctx, id, { user })).toThrowError(
        expect.objectContaining({ code: 'TRANSFER_NOT_FOUND', status: 404 }) as Error,
      );
    }
  });
});

describe('transfer mappers', () => {
  it('toTransferDetail and toTransferSummary match the shared schemas', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const { transferId } = await seedTransfer(app, owner.id, { sizes: [30, 10] });
    app.ctx.db.insert(transferRecipients).values({ transferId, email: 'b@example.com' }).run();
    app.ctx.db.insert(transferRecipients).values({ transferId, email: 'a@example.com' }).run();
    for (const status of ['in_progress', 'processing', 'aborted', 'completed'] as const) {
      app.ctx.db
        .insert(uploads)
        .values({
          id: randomUUID(),
          ownerId: owner.id,
          transferId,
          fileName: `${status}.bin`,
          totalSize: 5,
          status,
          lastActivityAt: NOW,
          expiresAt: NOW + 10,
        })
        .run();
    }
    const row = app.ctx.db.select().from(transfers).where(eq(transfers.id, transferId)).get()!;

    const detail = toTransferDetail(app.ctx, row, NOW);
    expect(transferDetailSchema.parse(detail)).toEqual(detail);
    expect(detail.ownerEmail).toBe(owner.email);
    expect(detail.fileCount).toBe(2);
    expect(detail.recipientCount).toBe(2);
    expect(detail.hasPassword).toBe(true);
    expect(detail.totalBytes).toBe(40);
    expect(detail.status).toBe('active');
    expect(detail.files.map((f) => f.name)).toEqual(['file-1.bin', 'file-2.bin']);
    expect(detail.recipients.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(detail.uploads.map((u) => u.status).sort()).toEqual([
      'aborted',
      'in_progress',
      'processing',
    ]);
    expect(detail.shareUrl).toBe(`http://localhost:8080/d/${row.token}`);

    const summary = toTransferSummary(app.ctx, row, NOW);
    expect(transferSummarySchema.parse(summary)).toEqual(summary);
    expect(toTransferSummary(app.ctx, row, NOW + 5000).status).toBe('expired');
  });

  it('has no share URL for a draft', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const { transferId } = await seedTransfer(app, owner.id, { status: 'uploading' });
    const row = app.ctx.db.select().from(transfers).where(eq(transfers.id, transferId)).get()!;
    expect(toTransferDetail(app.ctx, row, NOW).shareUrl).toBeNull();
  });
});

describe('deleteTransfer', () => {
  it('removes rows and files and releases the quota in one go', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const other = await app.createUser();
    const seeded = await seedTransfer(app, owner.id);
    const untouched = await seedTransfer(app, other.id, { sizes: [7] });
    app.ctx.db
      .update(users)
      .set({ usedBytes: 350 + 40 })
      .where(eq(users.id, owner.id))
      .run();
    app.ctx.db.insert(downloadLogs).values({ transferId: seeded.transferId }).run();
    app.ctx.db
      .insert(transferRecipients)
      .values({ transferId: seeded.transferId, email: 'x@y.zz' })
      .run();
    const uploadId = randomUUID();
    app.ctx.db
      .insert(uploads)
      .values({
        id: uploadId,
        ownerId: owner.id,
        transferId: seeded.transferId,
        fileName: 'pending.bin',
        totalSize: 10,
        lastActivityAt: NOW,
        expiresAt: NOW + 10,
      })
      .run();
    const tus = tusFilePaths(app.ctx.config, uploadId);
    await mkdir(app.ctx.config.tmpUploadDir, { recursive: true });
    await writeFile(tus.data, 'partial');
    await writeFile(tus.info, '{}');

    const result = await deleteTransfer(app.ctx, seeded.transferId, {
      actorId: owner.id,
      ipHash: 'hash',
      reason: 'user',
    });

    expect(result).toMatchObject({
      ownerId: owner.id,
      fileCount: 2,
      freedBytes: 350,
      unlinkFailures: 0,
    });
    for (const file of seeded.files) expect(existsSync(file.path)).toBe(false);
    expect(existsSync(tus.data)).toBe(false);
    expect(existsSync(tus.info)).toBe(false);
    expect(
      app.ctx.db.select().from(transfers).where(eq(transfers.id, seeded.transferId)).all(),
    ).toHaveLength(0);
    expect(
      app.ctx.db
        .select()
        .from(transferFiles)
        .where(eq(transferFiles.transferId, seeded.transferId))
        .all(),
    ).toHaveLength(0);
    expect(app.ctx.db.select().from(transferRecipients).all()).toHaveLength(0);
    expect(app.ctx.db.select().from(downloadLogs).all()).toHaveLength(0);
    expect(app.ctx.db.select().from(uploads).all()).toHaveLength(0);
    const usedOf = (id: string) =>
      app.ctx.db.select({ n: users.usedBytes }).from(users).where(eq(users.id, id)).get()!.n;
    expect(usedOf(owner.id)).toBe(40);
    expect(usedOf(other.id)).toBe(7);
    expect(existsSync(untouched.files[0]!.path)).toBe(true);

    const entries = app.ctx.db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'transfer.deleted',
      targetType: 'transfer',
      targetId: seeded.transferId,
      actorId: owner.id,
      metadata: null,
    });
  });

  it('never drives used_bytes below zero and records admin deletions', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const admin = await app.createUser({ role: 'admin' });
    const seeded = await seedTransfer(app, owner.id);
    app.ctx.db.update(users).set({ usedBytes: 10 }).where(eq(users.id, owner.id)).run();

    await deleteTransfer(app.ctx, seeded.transferId, { actorId: admin.id, reason: 'admin' });

    expect(app.ctx.db.select().from(users).where(eq(users.id, owner.id)).get()!.usedBytes).toBe(0);
    expect(app.ctx.db.select().from(auditLog).get()!.metadata).toEqual({ byAdmin: true });
  });

  it('tolerates files that are already gone and writes no audit row without an actor', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const seeded = await seedTransfer(app, owner.id);
    const { rm } = await import('node:fs/promises');
    await rm(seeded.files[0]!.path);

    const result = await deleteTransfer(app.ctx, seeded.transferId, {
      actorId: null,
      reason: 'expired',
    });

    expect(result).toMatchObject({ fileCount: 2, unlinkFailures: 0 });
    expect(existsSync(seeded.files[1]!.path)).toBe(false);
    expect(app.ctx.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it('returns null for an unknown transfer', async () => {
    const app = await createTestApp();
    expect(await deleteTransfer(app.ctx, randomUUID(), { actorId: null, reason: 'x' })).toBeNull();
  });
});

describe('deleteTransferFile', () => {
  it('removes one file and adjusts totals and quota', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const seeded = await seedTransfer(app, owner.id, { status: 'uploading' });
    const [first, second] = seeded.files as [Seeded['files'][number], Seeded['files'][number]];

    expect(
      await deleteTransferFile(app.ctx, seeded.transferId, first.id, { actorId: owner.id }),
    ).toBe(true);

    expect(existsSync(first.path)).toBe(false);
    expect(existsSync(second.path)).toBe(true);
    const row = app.ctx.db
      .select()
      .from(transfers)
      .where(eq(transfers.id, seeded.transferId))
      .get()!;
    expect(row.totalBytes).toBe(350 - first.sizeBytes);
    expect(app.ctx.db.select().from(users).where(eq(users.id, owner.id)).get()!.usedBytes).toBe(
      350 - first.sizeBytes,
    );
    expect(app.ctx.db.select().from(auditLog).get()).toMatchObject({
      action: 'transfer.file_deleted',
      targetId: seeded.transferId,
    });
  });

  it('refuses a file of another transfer', async () => {
    const app = await createTestApp();
    const owner = await app.createUser();
    const a = await seedTransfer(app, owner.id);
    const b = await seedTransfer(app, owner.id);
    expect(
      await deleteTransferFile(app.ctx, a.transferId, b.files[0]!.id, { actorId: owner.id }),
    ).toBe(false);
    expect(existsSync(b.files[0]!.path)).toBe(true);
  });
});

describe('recomputeUsedBytes', () => {
  it('sets used_bytes to the sum of each user file sizes and reports the fixes', async () => {
    const app = await createTestApp();
    const a = await app.createUser();
    const b = await app.createUser();
    const c = await app.createUser();
    await seedTransfer(app, a.id, { sizes: [10, 20] });
    await seedTransfer(app, a.id, { sizes: [5], status: 'revoked' });
    await seedTransfer(app, b.id, { sizes: [100] });
    app.ctx.db.update(users).set({ usedBytes: 9999 }).where(eq(users.id, a.id)).run();
    app.ctx.db.update(users).set({ usedBytes: 100 }).where(eq(users.id, b.id)).run();
    app.ctx.db.update(users).set({ usedBytes: 42 }).where(eq(users.id, c.id)).run();

    expect(recomputeUsedBytes(app.ctx.db)).toBe(2);

    const used = (id: string) =>
      app.ctx.db.select({ n: users.usedBytes }).from(users).where(eq(users.id, id)).get()!.n;
    expect(used(a.id)).toBe(35);
    expect(used(b.id)).toBe(100);
    expect(used(c.id)).toBe(0);
    expect(recomputeUsedBytes(app.ctx.db)).toBe(0);
  });
});
