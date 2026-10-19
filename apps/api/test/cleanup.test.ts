import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  auditLog,
  downloadLogs,
  passwordResetTokens,
  transferFiles,
  transfers,
  uploads,
  users,
} from '../src/db/schema/index.js';
import { runCleanup, scheduleCleanup } from '../src/jobs/cleanup.js';
import {
  ageFile,
  createCleanupApp,
  exists,
  insertStoredFile,
  insertTransfer,
  insertUpload,
} from './cleanup-fixtures.js';
import type { TestApp } from './helpers.js';

const HOUR = 3600;
const DAY = 86_400;

async function setup(env: Record<string, string> = {}) {
  const t = await createCleanupApp(env);
  const owner = await t.createUser();
  return { t, owner };
}

const transferRow = (t: TestApp, id: string) =>
  t.db.db.select().from(transfers).where(eq(transfers.id, id)).get();

describe('cleanup: transfers', () => {
  it('deletes an expired active transfer with its rows and files once the clock passes expiry', async () => {
    const { t, owner } = await setup();
    const id = insertTransfer(t, { ownerId: owner.id, status: 'active', expiresIn: HOUR });
    const file = await insertStoredFile(t, id, owner.id);

    expect((await runCleanup(t.ctx)).deletedTransfers).toBe(0);
    expect(transferRow(t, id)).toBeDefined();
    expect(exists(file.path)).toBe(true);

    t.clock.advance(HOUR + 1);
    const report = await runCleanup(t.ctx);
    expect(report.deletedTransfers).toBe(1);
    expect(transferRow(t, id)).toBeUndefined();
    expect(t.db.db.select().from(transferFiles).all()).toHaveLength(0);
    expect(exists(file.path)).toBe(false);
    expect(t.db.db.select().from(users).where(eq(users.id, owner.id)).get()!.usedBytes).toBe(0);
  });

  it('deletes revoked transfers and keeps active ones that have not expired', async () => {
    const { t, owner } = await setup();
    const revoked = insertTransfer(t, { ownerId: owner.id, status: 'revoked' });
    const alive = insertTransfer(t, { ownerId: owner.id, status: 'active' });
    const aliveFile = await insertStoredFile(t, alive, owner.id);

    expect((await runCleanup(t.ctx)).deletedTransfers).toBe(1);
    expect(transferRow(t, revoked)).toBeUndefined();
    expect(transferRow(t, alive)).toBeDefined();
    expect(exists(aliveFile.path)).toBe(true);
  });

  it('deletes drafts idle beyond the TTL but keeps recent ones and those being processed', async () => {
    const { t, owner } = await setup({ INCOMPLETE_UPLOAD_TTL_HOURS: '24' });
    const draft = { ownerId: owner.id, status: 'uploading', createdAgo: 30 * HOUR } as const;
    const old = insertTransfer(t, draft);
    const oldUpload = insertUpload(t, {
      ownerId: owner.id,
      transferId: old,
      status: 'aborted',
      activityAgo: 30 * HOUR,
    });
    const active = insertTransfer(t, draft);
    insertUpload(t, {
      ownerId: owner.id,
      transferId: active,
      status: 'in_progress',
      activityAgo: HOUR,
    });
    const processing = insertTransfer(t, draft);
    const processingUpload = insertUpload(t, {
      ownerId: owner.id,
      transferId: processing,
      status: 'processing',
      activityAgo: 30 * HOUR,
    });
    const fresh = insertTransfer(t, { ...draft, createdAgo: HOUR });

    expect((await runCleanup(t.ctx)).deletedTransfers).toBe(1);
    expect(transferRow(t, old)).toBeUndefined();
    expect(exists(oldUpload.data)).toBe(false);
    for (const id of [active, processing, fresh]) expect(transferRow(t, id)).toBeDefined();
    expect(exists(processingUpload.data)).toBe(true);
  });
});

describe('cleanup: uploads and orphan files', () => {
  it('removes expired in_progress uploads (row and tus files) but never processing ones', async () => {
    const { t, owner } = await setup();
    const expired = insertUpload(t, { ownerId: owner.id, status: 'in_progress', expiresIn: HOUR });
    const processing = insertUpload(t, {
      ownerId: owner.id,
      status: 'processing',
      expiresIn: HOUR,
    });
    const valid = insertUpload(t, { ownerId: owner.id, status: 'in_progress', expiresIn: 5 * DAY });

    t.clock.advance(2 * HOUR);
    expect((await runCleanup(t.ctx)).abortedUploads).toBe(1);
    const ids = t.db.db
      .select()
      .from(uploads)
      .all()
      .map((u) => u.id);
    expect(ids).toContain(processing.id);
    expect(ids).toContain(valid.id);
    expect(ids).not.toContain(expired.id);
    expect(exists(expired.data) || exists(expired.info)).toBe(false);
    expect(exists(processing.data) && exists(processing.info)).toBe(true);
  });

  it('removes old aborted uploads only after the TTL', async () => {
    const { t, owner } = await setup({ INCOMPLETE_UPLOAD_TTL_HOURS: '24' });
    const aborted = insertUpload(t, { ownerId: owner.id, status: 'aborted', expiresIn: 9 * DAY });
    expect((await runCleanup(t.ctx)).abortedUploads).toBe(0);
    t.clock.advance(25 * HOUR);
    expect((await runCleanup(t.ctx)).abortedUploads).toBe(1);
    expect(exists(aborted.data)).toBe(false);
  });

  it('sweeps tus files with no upload row once older than the TTL', async () => {
    const { t } = await setup({ INCOMPLETE_UPLOAD_TTL_HOURS: '24' });
    const data = path.join(t.config.tmpUploadDir, randomUUID());
    writeFileSync(data, 'x');
    writeFileSync(`${data}.json`, '{}');
    const other = path.join(t.config.tmpUploadDir, 'notes.txt');
    writeFileSync(other, 'x');

    expect((await runCleanup(t.ctx)).orphanTmpFiles).toBe(0);
    t.clock.advance(25 * HOUR);
    expect((await runCleanup(t.ctx)).orphanTmpFiles).toBe(2);
    expect(exists(data) || exists(`${data}.json`)).toBe(false);
    expect(exists(other)).toBe(true);
  });

  it('removes unreferenced storage files, keeps referenced, .part, young and non-UUID ones', async () => {
    const { t, owner } = await setup();
    const id = insertTransfer(t, { ownerId: owner.id, status: 'active' });
    const kept = await insertStoredFile(t, id, owner.id);
    const orphan = path.join(t.config.storageDir, randomUUID());
    const part = path.join(t.config.storageDir, `${randomUUID()}.part`);
    const foreign = path.join(t.config.storageDir, 'readme.txt');
    const young = path.join(t.config.storageDir, randomUUID());
    for (const f of [orphan, part, foreign, young]) writeFileSync(f, 'x');
    for (const f of [orphan, part, foreign]) ageFile(t, f, 2 * HOUR);

    expect((await runCleanup(t.ctx)).orphanFiles).toBe(1);
    expect(exists(orphan)).toBe(false);
    for (const f of [kept.path, part, foreign, young]) expect(exists(f)).toBe(true);
  });

  it('treats missing directories as empty', async () => {
    const { t } = await setup();
    const missing = path.join(t.config.dataDir, 'nowhere');
    const ctx = { ...t.ctx, config: { ...t.config, storageDir: missing, tmpUploadDir: missing } };
    expect((await runCleanup(ctx)).failedSteps).toEqual([]);
  });
});

describe('cleanup: retention and bookkeeping', () => {
  it('purges logs past LOG_RETENTION_DAYS and keeps recent ones', async () => {
    const { t, owner } = await setup({ LOG_RETENTION_DAYS: '90' });
    const id = insertTransfer(t, { ownerId: owner.id, status: 'active', expiresIn: 365 * DAY });
    const now = Math.floor(t.clock() / 1000);
    t.db.db
      .insert(downloadLogs)
      .values([
        { transferId: id, createdAt: now - 91 * DAY },
        { transferId: id, createdAt: now - 10 * DAY },
      ])
      .run();
    t.db.db
      .insert(auditLog)
      .values([
        { action: 'auth.login', createdAt: now - 91 * DAY },
        { action: 'auth.login', createdAt: now - 1 * DAY },
      ])
      .run();

    expect((await runCleanup(t.ctx)).purgedLogRows).toBe(2);
    expect(t.db.db.select().from(downloadLogs).all()).toHaveLength(1);
    expect(t.db.db.select().from(auditLog).all()).toHaveLength(1);
  });

  it('purges expired and used reset tokens, keeps valid ones', async () => {
    const { t, owner } = await setup();
    const now = Math.floor(t.clock() / 1000);
    t.db.db
      .insert(passwordResetTokens)
      .values([
        { userId: owner.id, tokenHash: 'expired', expiresAt: now - 5 },
        { userId: owner.id, tokenHash: 'used', expiresAt: now + 500, usedAt: now - 1 },
        { userId: owner.id, tokenHash: 'valid', expiresAt: now + 500 },
      ])
      .run();
    expect((await runCleanup(t.ctx)).purgedAuthRows).toBe(2);
    expect(
      t.db.db
        .select()
        .from(passwordResetTokens)
        .all()
        .map((r) => r.tokenHash),
    ).toEqual(['valid']);
  });

  it('realigns used_bytes and reports how many users changed', async () => {
    const { t, owner } = await setup();
    const id = insertTransfer(t, { ownerId: owner.id, status: 'active' });
    await insertStoredFile(t, id, owner.id, 'abcde');
    t.db.db.update(users).set({ usedBytes: 999 }).where(eq(users.id, owner.id)).run();
    expect((await runCleanup(t.ctx)).usedBytesFixed).toBe(1);
    expect(t.db.db.select().from(users).where(eq(users.id, owner.id)).get()!.usedBytes).toBe(5);
    expect((await runCleanup(t.ctx)).usedBytesFixed).toBe(0);
  });

  it('keeps running the other steps when one fails', async () => {
    const { t, owner } = await setup();
    // A regular file where the storage directory should be makes that step fail (ENOTDIR).
    const notADir = path.join(t.config.dataDir, 'file-not-dir');
    writeFileSync(notADir, 'x');
    const ctx = { ...t.ctx, config: { ...t.config, storageDir: notADir } };
    const revoked = insertTransfer(t, { ownerId: owner.id, status: 'revoked' });
    t.db.db.update(users).set({ usedBytes: 7 }).where(eq(users.id, owner.id)).run();

    const report = await runCleanup(ctx);
    expect(report.failedSteps).toEqual(['storage-orphans']);
    expect(report.usedBytesFixed).toBe(1);
    expect(transferRow(t, revoked)).toBeUndefined();
  });
});

describe('scheduleCleanup', () => {
  it('runs once at startup and stop() ends it', async () => {
    const { t, owner } = await setup();
    const revoked = insertTransfer(t, { ownerId: owner.id, status: 'revoked' });
    const task = scheduleCleanup(t.ctx);
    await task.initialRun;
    expect(transferRow(t, revoked)).toBeUndefined();
    expect(() => task.stop()).not.toThrow();
  });

  it('fails fast on an invalid cron expression', async () => {
    const { t } = await setup({ CLEANUP_CRON: 'not a cron' });
    expect(() => scheduleCleanup(t.ctx)).toThrow(/CLEANUP_CRON/);
  });
});
