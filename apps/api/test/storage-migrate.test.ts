import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { StorageMigration } from '@easysend/shared';
import { runStorageMigrate, CliError } from '../src/cli/storage-migrate.js';
import {
  auditLog,
  storageDeletions,
  storageMigrations,
  transferFiles,
} from '../src/db/schema/index.js';
import { runCleanup } from '../src/jobs/cleanup.js';
import {
  MAX_CONSECUTIVE_UNAVAILABLE,
  SOURCE_GRACE_SECONDS,
  cancelMigration,
  latestMigration,
  resumeMigration,
  startMigration,
  waitForMigration,
} from '../src/storage/migrate.js';
import { storagePath } from '../src/storage/paths.js';
import { bodyAs, errorCode, type TestApp } from './helpers.js';
import { loginAs } from './session-helpers.js';
import { createFakeS3App } from './storage-helpers.js';
import { binaryRequest, createTransferFixture, type TransferFixture } from './transfer-fixtures.js';

const SPECS = [
  { name: 'a.bin', size: 1000 },
  { name: 'b.bin', size: 70_000 },
  { name: 'c.bin', size: 0 },
];

const rows = (t: TestApp) => t.ctx.db.select().from(transferFiles).all();
const actions = (t: TestApp) =>
  t.ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .all()
    .map((r) => r.action);
const downloadOk = async (t: TestApp, fx: TransferFixture) => {
  for (const file of fx.files) {
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/files/${file.id}`);
    expect(res.status).toBe(200);
    expect(res.body.equals(file.content)).toBe(true);
  }
};
/** Inserts a `running` row by hand, as a restart would leave it. */
const insertRow = (t: TestApp, status: StorageMigration['status'], target: 's3' | 'local' = 's3') =>
  t.ctx.db
    .insert(storageMigrations)
    .values({ target, status, totalFiles: 3, totalBytes: 100 })
    .returning()
    .get();

describe('storage migration service', () => {
  it('moves local files to S3 as ciphertext, keeps them downloadable and cleans the source later', async () => {
    const { t, fake } = await createFakeS3App({}, { active: false });
    const fx = await createTransferFixture(t, { files: SPECS });
    const names = rows(t).map((r) => r.storageName);
    const stored = rows(t).reduce((n, r) => n + r.storedSizeBytes, 0);

    const { migration, done } = await startMigration(t.ctx, { target: 's3', startedBy: null });
    expect(migration).toMatchObject({ status: 'running', totalFiles: 3, totalBytes: stored });
    await done;

    const final = latestMigration(t.ctx)!;
    expect(final).toMatchObject({
      status: 'done',
      doneFiles: 3,
      doneBytes: stored,
      failedFiles: 0,
      errorCode: null,
    });
    expect(final.finishedAt).not.toBeNull();
    expect(rows(t).every((r) => r.storage === 's3')).toBe(true);
    expect([...fake.objects.keys()].sort()).toEqual([...names].sort());
    await downloadOk(t, fx);
    expect(actions(t)).toEqual(
      expect.arrayContaining(['storage.migration_started', 'storage.migration_finished']),
    );

    // Sources wait one hour in the deletion queue, then the cleanup job removes them.
    const queue = t.ctx.db.select().from(storageDeletions).all();
    expect(queue).toHaveLength(3);
    expect(queue.every((q) => q.storage === 'local')).toBe(true);
    const path = storagePath(t.ctx.config, names[0]!);
    expect(existsSync(path)).toBe(true);
    await runCleanup(t.ctx);
    expect(existsSync(path)).toBe(true);
    t.clock.advance(SOURCE_GRACE_SECONDS + 5);
    const report = await runCleanup(t.ctx);
    expect(report.deletedQueued).toBe(3);
    expect(existsSync(path)).toBe(false);
  });

  it('moves S3 files back to the local disk', async () => {
    const { t, fake } = await createFakeS3App();
    const fx = await createTransferFixture(t, { storage: 's3', files: SPECS });
    const handle = await startMigration(t.ctx, { target: 'local', startedBy: null });
    await handle.done;
    expect(latestMigration(t.ctx)).toMatchObject({ status: 'done', doneFiles: 3 });
    expect(rows(t).every((r) => r.storage === 'local')).toBe(true);
    for (const r of rows(t))
      expect(existsSync(storagePath(t.ctx.config, r.storageName))).toBe(true);
    // Source objects are queued, not deleted yet.
    expect(fake.objects.size).toBe(3);
    expect(
      t.ctx.db
        .select()
        .from(storageDeletions)
        .all()
        .every((q) => q.storage === 's3'),
    ).toBe(true);
    await downloadOk(t, fx);
    t.clock.advance(SOURCE_GRACE_SECONDS + 5);
    await runCleanup(t.ctx);
    expect(fake.objects.size).toBe(0);
  });

  it('finishes at once when there is nothing to move', async () => {
    const { t } = await createFakeS3App();
    const { done } = await startMigration(t.ctx, { target: 's3', startedBy: null });
    await done;
    expect(latestMigration(t.ctx)).toMatchObject({ status: 'done', totalFiles: 0, doneFiles: 0 });
  });

  it('target s3 needs a saved configuration', async () => {
    const { t } = await createFakeS3App();
    t.ctx.settings.delete('storage');
    await expect(startMigration(t.ctx, { target: 's3', startedBy: null })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses a second migration while one is running or cancelling (MIGRATION_RUNNING)', async () => {
    const { t } = await createFakeS3App();
    for (const status of ['running', 'cancelling'] as const) {
      const row = insertRow(t, status);
      await expect(
        startMigration(t.ctx, { target: 'local', startedBy: null }),
      ).rejects.toMatchObject({ code: 'MIGRATION_RUNNING' });
      t.ctx.db.delete(storageMigrations).where(eq(storageMigrations.id, row.id)).run();
    }
  });

  it('stops between two files when cancelled and audits both events', async () => {
    const { t } = await createFakeS3App({}, { active: false });
    await createTransferFixture(t, { files: SPECS });
    const { done } = await startMigration(t.ctx, { target: 's3', startedBy: null });
    expect(cancelMigration(t.ctx, { actorId: null }).status).toBe('cancelling');
    await done;
    const final = latestMigration(t.ctx)!;
    expect(final.status).toBe('cancelled');
    expect(final.doneFiles).toBeLessThan(3);
    expect(rows(t).filter((r) => r.storage === 's3')).toHaveLength(final.doneFiles);
    expect(actions(t)).toEqual(
      expect.arrayContaining(['storage.migration_cancelled', 'storage.migration_finished']),
    );
    expect(() => cancelMigration(t.ctx, { actorId: null })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  it('resumes a running migration after a restart without redoing moved files', async () => {
    const { t, fake } = await createFakeS3App({}, { active: false });
    const fx = await createTransferFixture(t, { files: SPECS });
    // First run moved one file, then the process died.
    const first = await startMigration(t.ctx, { target: 's3', startedBy: null });
    await first.done;
    const moved = rows(t)[0]!;
    t.ctx.db
      .update(transferFiles)
      .set({ storage: 'local' })
      .where(eq(transferFiles.id, moved.id))
      .run();
    t.ctx.db.update(transferFiles).set({ storage: 'local' }).run();
    fake.objects.clear();
    t.ctx.db
      .update(transferFiles)
      .set({ storage: 's3' })
      .where(eq(transferFiles.id, moved.id))
      .run();
    // The moved file lives on S3 only; the others are local. Row left running by the "crash".
    const [one] = rows(t).filter((r) => r.id === moved.id);
    expect(one?.storage).toBe('s3');
    await fakePutBack(t, fake, moved.storageName);
    t.ctx.db
      .update(storageMigrations)
      .set({ status: 'running', finishedAt: null, doneFiles: 1, doneBytes: moved.storedSizeBytes })
      .run();

    const promise = resumeMigration(t.ctx);
    expect(promise).toBeDefined();
    await promise;
    expect(latestMigration(t.ctx)).toMatchObject({ status: 'done', doneFiles: 3 });
    expect(rows(t).every((r) => r.storage === 's3')).toBe(true);
    await downloadOk(t, fx);
  });

  it('closes a cancelling migration found at startup and ignores a finished one', async () => {
    const { t } = await createFakeS3App();
    expect(resumeMigration(t.ctx)).toBeUndefined();
    insertRow(t, 'cancelling');
    await resumeMigration(t.ctx);
    expect(latestMigration(t.ctx)?.status).toBe('cancelled');
    expect(resumeMigration(t.ctx)).toBeUndefined();
  });

  it('removes the fresh copy when the file row is deleted during the copy', async () => {
    const { t, fake } = await createFakeS3App({}, { active: false });
    await createTransferFixture(t, { files: [{ name: 'a.bin', size: 5000 }] });
    const realPut = fake.put.bind(fake);
    fake.put = async (name, source, size) => {
      await realPut(name, source, size);
      t.ctx.db.delete(transferFiles).run(); // the transfer is deleted while its file is copied
    };
    const { done } = await startMigration(t.ctx, { target: 's3', startedBy: null });
    await done;
    expect(latestMigration(t.ctx)?.status).toBe('done');
    expect(fake.objects.size).toBe(0);
    expect(t.ctx.db.select().from(storageDeletions).all()).toHaveLength(0);
  });

  it('refuses to start when the local disk cannot hold the files (INSUFFICIENT_DISK_SPACE)', async () => {
    const { t } = await createFakeS3App({
      deps: { diskSpace: () => Promise.resolve({ totalBytes: 10, freeBytes: 10 }) },
    });
    await createTransferFixture(t, { storage: 's3', files: SPECS });
    await expect(startMigration(t.ctx, { target: 'local', startedBy: null })).rejects.toMatchObject(
      {
        code: 'INSUFFICIENT_DISK_SPACE',
      },
    );
    expect(latestMigration(t.ctx)).toBeNull();
  });

  it('fails the job when the disk fills up during the run', async () => {
    let free = 1e12;
    const { t } = await createFakeS3App({
      deps: { diskSpace: () => Promise.resolve({ totalBytes: 1e12, freeBytes: free }) },
    });
    await createTransferFixture(t, { storage: 's3', files: SPECS });
    const { done } = await startMigration(t.ctx, { target: 'local', startedBy: null });
    free = 10; // the first per-file check now fails
    await done;
    expect(latestMigration(t.ctx)).toMatchObject({
      status: 'failed',
      errorCode: 'INSUFFICIENT_DISK_SPACE',
    });
  });

  it('counts a file that cannot be copied and carries on with the others', async () => {
    const { t, fake } = await createFakeS3App();
    await createTransferFixture(t, { storage: 's3', files: SPECS });
    const victim = rows(t)[0]!;
    fake.objects.delete(victim.storageName); // damaged: the source object is gone
    const { done } = await startMigration(t.ctx, { target: 'local', startedBy: null });
    await done;
    expect(latestMigration(t.ctx)).toMatchObject({ status: 'done', doneFiles: 2, failedFiles: 1 });
    expect(rows(t).filter((r) => r.storage === 's3')).toHaveLength(1);
  });

  it('gives up with STORAGE_UNAVAILABLE when the target keeps failing', async () => {
    const { t, fake } = await createFakeS3App({}, { active: false });
    const specs = Array.from({ length: MAX_CONSECUTIVE_UNAVAILABLE + 2 }, (_, i) => ({
      name: `f${i}.bin`,
      size: 100,
    }));
    await createTransferFixture(t, { files: specs });
    fake.failPut = true;
    const { done } = await startMigration(t.ctx, { target: 's3', startedBy: null });
    await done;
    expect(latestMigration(t.ctx)).toMatchObject({
      status: 'failed',
      errorCode: 'STORAGE_UNAVAILABLE',
      failedFiles: MAX_CONSECUTIVE_UNAVAILABLE,
    });
    expect(rows(t).every((r) => r.storage === 'local')).toBe(true);
    expect(JSON.stringify(t.ctx.db.select().from(auditLog).all())).not.toContain('secret');
  });
});

/** Puts the ciphertext of a local file into the fake (as an earlier run would have). */
async function fakePutBack(t: TestApp, fake: { objects: Map<string, unknown> }, name: string) {
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(storagePath(t.ctx.config, name));
  fake.objects.set(name, { data, mtimeSeconds: 1 });
}

describe('storage migration routes', () => {
  it('reports, starts and cancels as admin, and answers MIGRATION_RUNNING / 403', async () => {
    const { t } = await createFakeS3App({}, { active: false });
    const admin = await t.createUser({ role: 'admin' });
    const user = await t.createUser();
    const client = loginAs(t, admin);
    await createTransferFixture(t, { files: SPECS });

    expect(
      bodyAs<{ migration: unknown }>(await client.get('/api/admin/storage/migration')).migration,
    ).toBeNull();
    expect((await client.post('/api/admin/storage/migration/cancel')).status).toBe(409);

    const started = await client.post('/api/admin/storage/migration', { body: { target: 's3' } });
    expect(started.status).toBe(202);
    expect(bodyAs<{ migration: StorageMigration }>(started).migration).toMatchObject({
      target: 's3',
      status: 'running',
    });
    const again = await client.post('/api/admin/storage/migration', { body: { target: 'local' } });
    if (again.status !== 409) expect(latestMigration(t.ctx)?.status).not.toBe('running');
    else expect(errorCode(again)).toBe('MIGRATION_RUNNING');
    await waitForMigration(t.ctx);

    const status = await client.get('/api/admin/storage/migration');
    expect(bodyAs<{ migration: StorageMigration }>(status).migration.status).toBe('done');
    expect(actions(t)).toContain('storage.migration_started');

    const row = insertRow(t, 'running', 'local');
    const second = await client.post('/api/admin/storage/migration', { body: { target: 's3' } });
    expect(errorCode(second)).toBe('MIGRATION_RUNNING');
    expect(second.status).toBe(409);
    const cancel = await client.post('/api/admin/storage/migration/cancel');
    expect(cancel.status).toBe(200);
    expect(bodyAs<{ migration: StorageMigration }>(cancel).migration).toMatchObject({
      id: row.id,
      status: 'cancelling',
    });
    expect(actions(t)).toContain('storage.migration_cancelled');

    const normal = loginAs(t, user);
    expect((await normal.get('/api/admin/storage/migration')).status).toBe(403);
    expect(
      (await normal.post('/api/admin/storage/migration', { body: { target: 's3' } })).status,
    ).toBe(403);
  });

  it('answers 507 when the local target has no room', async () => {
    const { t } = await createFakeS3App({
      deps: { diskSpace: () => Promise.resolve({ totalBytes: 1, freeBytes: 1 }) },
    });
    const admin = await t.createUser({ role: 'admin' });
    await createTransferFixture(t, { storage: 's3', files: SPECS });
    const res = await loginAs(t, admin).post('/api/admin/storage/migration', {
      body: { target: 'local' },
    });
    expect(res.status).toBe(507);
    expect(errorCode(res)).toBe('INSUFFICIENT_DISK_SPACE');
  });
});

describe('storage:migrate CLI', () => {
  const io = () => {
    const lines: string[] = [];
    return { lines, io: { log: (m: string) => lines.push(m) } };
  };

  it('--dry-run prints counts and bytes and changes nothing', async () => {
    const { t } = await createFakeS3App({}, { active: false });
    await createTransferFixture(t, { files: SPECS });
    const out = io();
    const result = await runStorageMigrate({
      argv: ['--', '--to', 's3', '--dry-run'],
      env: {},
      io: out.io,
      ctx: t.ctx,
    });
    expect(result).toBeNull();
    expect(out.lines[0]).toMatch(/Would move 3 file\(s\)/);
    expect(latestMigration(t.ctx)).toBeNull();
    expect(rows(t).every((r) => r.storage === 'local')).toBe(true);
  });

  it('runs the migration in the foreground and shares the lock with the panel', async () => {
    const { t } = await createFakeS3App({}, { active: false });
    await createTransferFixture(t, { files: SPECS });
    const out = io();
    const final = await runStorageMigrate({
      argv: ['--to', 's3'],
      env: {},
      io: out.io,
      ctx: t.ctx,
      progressIntervalMs: 5,
    });
    expect(final).toMatchObject({ status: 'done', doneFiles: 3 });
    expect(out.lines.at(-1)).toMatch(/Migration done: 3\/3 files/);
    expect(rows(t).every((r) => r.storage === 's3')).toBe(true);

    insertRow(t, 'running');
    await expect(
      runStorageMigrate({ argv: ['--to', 'local'], env: {}, io: out.io, ctx: t.ctx }),
    ).rejects.toThrow(/MIGRATION_RUNNING/);
  });

  it('rejects a missing or wrong target', async () => {
    const { t } = await createFakeS3App();
    for (const argv of [[], ['--to', 'ftp']]) {
      await expect(runStorageMigrate({ argv, env: {}, ctx: t.ctx })).rejects.toBeInstanceOf(
        CliError,
      );
    }
  });
});
