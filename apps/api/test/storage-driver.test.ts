import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { StorageResponse } from '@easysend/shared';
import { MAX_DELETION_ATTEMPTS, runCleanup } from '../src/jobs/cleanup.js';
import { storageDeletions, transferFiles, transfers } from '../src/db/schema/index.js';
import { reserveBytes, uploadFits } from '../src/storage/disk.js';
import { createStorageRegistry } from '../src/storage/registry.js';
import { StorageObjectNotFoundError, type StorageDriver } from '../src/storage/types.js';
import { deleteTransfer } from '../src/transfers/service.js';
import { createFakeStorage } from './fake-storage.js';
import { bodyAs, createTestApp, makeTempDir, silentLogger } from './helpers.js';
import { createCleanupApp, insertTransfer } from './cleanup-fixtures.js';
import {
  createFakeS3App,
  encryptContentToDriver,
  localDriverAt,
  TEST_S3_CONFIG,
} from './storage-helpers.js';
import { binaryErrorCode, binaryRequest, createTransferFixture } from './transfer-fixtures.js';
import {
  createDraft,
  filesOf,
  readStoredFile,
  settle,
  uploadBytes,
  userWithClient,
} from './upload-helpers.js';

const HOUR = 3600;
const nowSec = (t: { clock: () => number }) => Math.floor(t.clock() / 1000);

describe('local driver', () => {
  it('stores, reads ranges, lists, deletes and reports capacity', async () => {
    const dir = path.join(makeTempDir(), 'storage'); // created on first put
    const driver = localDriverAt(dir);
    const name = randomUUID();
    const data = randomBytes(5000);
    await driver.put(name, Readable.from([data]), data.length);

    expect(await readdir(dir)).toEqual([name]); // no `.part` left behind
    const reader = await driver.openReader(name);
    expect(reader.size).toBe(5000);
    expect((await reader.read(100, 50)).equals(data.subarray(100, 150))).toBe(true);
    expect((await reader.read(4990, 100)).length).toBe(10); // short read at the end
    await reader.close();

    const listed: { name: string; mtimeSeconds: number }[] = [];
    for await (const object of driver.list()) listed.push(object);
    expect(listed.map((o) => o.name)).toEqual([name]);
    expect(Math.abs(listed[0]!.mtimeSeconds - Math.floor(Date.now() / 1000))).toBeLessThan(5);

    expect((await driver.capacity())?.freeBytes).toBeGreaterThan(0);
    expect(await driver.delete(name)).toBe(true);
    expect(await driver.delete(name)).toBe(true); // missing counts as success
    expect(await driver.delete('../etc/passwd')).toBe(true); // never becomes a path
    await expect(driver.openReader(name)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('refuses a stream of the wrong size and an existing object, leaving nothing behind', async () => {
    const dir = makeTempDir();
    const driver = localDriverAt(dir);
    for (const size of [99, 101]) {
      await expect(
        driver.put(randomUUID(), Readable.from([randomBytes(100)]), size),
      ).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    }
    const name = randomUUID();
    writeFileSync(path.join(dir, name), 'keep');
    await expect(driver.put(name, Readable.from([Buffer.from('x')]), 1)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readdir(dir)).toEqual([name]);
  });

  it('treats a missing directory as empty and recover() removes only leftover .part files', async () => {
    const dir = path.join(makeTempDir(), 'nowhere');
    const driver = localDriverAt(dir);
    const empty: unknown[] = [];
    for await (const object of driver.list()) empty.push(object);
    expect(empty).toEqual([]);
    await driver.recover(); // nothing to do, does not throw

    mkdirSync(dir, { recursive: true });
    const part = path.join(dir, `${randomUUID()}.part`);
    const keep = path.join(dir, randomUUID());
    const foreign = path.join(dir, 'readme.txt.part');
    for (const f of [part, keep, foreign]) writeFileSync(f, 'x');
    await driver.recover();
    expect(existsSync(part)).toBe(false);
    expect(existsSync(keep)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });
});

describe('storage registry', () => {
  const build = (
    setting: unknown,
    extra: Partial<Parameters<typeof createStorageRegistry>[0]> = {},
  ) =>
    createStorageRegistry({
      config: { storageDir: makeTempDir() },
      settings: { get: () => setting as never },
      logger: silentLogger,
      diskSpace: () => Promise.resolve({ totalBytes: 1, freeBytes: 1 }),
      ...extra,
    });

  it('defaults to the local driver when the setting is missing', () => {
    const registry = build(undefined);
    expect(registry.currentKind()).toBe('local');
    expect(registry.current().kind).toBe('local');
    expect(registry.forFile('local')).toBe(registry.current());
  });

  it('keeps S3 unavailable (STORAGE_UNAVAILABLE) until a factory exists or without a configuration', () => {
    const noFactory = build({ driver: 's3', s3: TEST_S3_CONFIG, source: 'panel' });
    expect(() => noFactory.current()).toThrowError(
      expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }),
    );
    const noConfig = build(
      { driver: 'local', source: 'env' },
      { s3Factory: () => createFakeStorage() },
    );
    expect(() => noConfig.forFile('s3')).toThrowError(
      expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }),
    );
  });

  it('builds the S3 driver from the setting, caches it and rebuilds it when the setting changes', () => {
    let setting: unknown = { driver: 's3', s3: TEST_S3_CONFIG, source: 'panel' };
    const factory = vi.fn((): StorageDriver => createFakeStorage());
    const registry = createStorageRegistry({
      config: { storageDir: makeTempDir() },
      settings: { get: () => setting as never },
      logger: silentLogger,
      diskSpace: () => Promise.resolve({ totalBytes: 1, freeBytes: 1 }),
      s3Factory: factory,
    });
    const first = registry.current();
    expect(registry.forFile('s3')).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);

    setting = { driver: 's3', s3: { ...TEST_S3_CONFIG, bucket: 'other-bucket' }, source: 'panel' };
    expect(registry.current()).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);

    // Back to local: new files go to the disk, old S3 files stay reachable.
    setting = {
      driver: 'local',
      s3: { ...TEST_S3_CONFIG, bucket: 'other-bucket' },
      source: 'panel',
    };
    expect(registry.current().kind).toBe('local');
    expect(registry.forFile('s3').kind).toBe('s3');
  });

  it('lets injected drivers win', () => {
    const fake = createFakeStorage('local');
    expect(build(undefined, { overrides: { local: fake } }).current()).toBe(fake);
  });
});

describe('uploads and downloads on a non-local driver', () => {
  it('writes new uploads to the active driver and records it on the file row', async () => {
    const { t, fake } = await createFakeS3App();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(70_000);
    await uploadBytes(t, client, { transferId: draft.id, data });
    await settle(t);

    const [file] = filesOf(t, draft.id);
    expect(file?.storage).toBe('s3');
    expect(fake.objects.has(file!.storageName)).toBe(true);
    expect(await readdir(t.config.storageDir)).toEqual([]);
    expect(await readStoredFile(t, file!)).toEqual(data);
  });

  it('keeps old files readable from the local disk after switching the driver', async () => {
    const { t } = await createFakeS3App({}, { active: false });
    const fx = await createTransferFixture(t, { files: [{ name: 'old.bin', size: 1000 }] });
    t.ctx.settings.set('storage', { driver: 's3', s3: TEST_S3_CONFIG, source: 'panel' });
    expect(t.ctx.storage.currentKind()).toBe('s3');

    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.equals(fx.files[0]!.content)).toBe(true);
  });

  it('serves files and the zip from an S3-style driver, with ranges', async () => {
    const { t } = await createFakeS3App();
    const fx = await createTransferFixture(t, {
      storage: 's3',
      files: [
        { name: 'a.bin', size: 200_000 },
        { name: 'b.bin', size: 10 },
      ],
    });
    const url = `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`;
    const whole = await binaryRequest(t.app, url);
    expect(whole.status).toBe(200);
    expect(whole.body.equals(fx.files[0]!.content)).toBe(true);

    const ranged = await binaryRequest(t.app, url, { headers: { Range: 'bytes=70000-70099' } });
    expect(ranged.status).toBe(206);
    expect(ranged.body.equals(fx.files[0]!.content.subarray(70_000, 70_100))).toBe(true);

    const zip = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect(zip.status).toBe(200);
    expect(zip.complete).toBe(true);
    expect(zip.body.length).toBe(Number(zip.headers['content-length']));
  });

  it('answers 503 STORAGE_UNAVAILABLE without counting the download when the storage is down', async () => {
    const { t, fake } = await createFakeS3App();
    const fx = await createTransferFixture(t, { storage: 's3', files: [{ name: 'a', size: 100 }] });
    fake.failOpen = true;
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`);
    expect(res.status).toBe(503);
    expect(binaryErrorCode(res)).toBe('STORAGE_UNAVAILABLE');
    expect(res.headers['content-length']).not.toBe('100');
    expect(
      t.db.db.select().from(transfers).where(eq(transfers.id, fx.id)).get()?.downloadCount,
    ).toBe(0);
  });

  it('checks 1x the tmp disk with a non-local driver and 2x the storage disk with the local one', async () => {
    const MB = 1024 * 1024;
    const probes: string[] = [];
    const diskSpace = (dir: string) => {
      probes.push(dir);
      return Promise.resolve({ totalBytes: 10_000 * MB, freeBytes: 50 * MB });
    };
    const { t } = await createFakeS3App({ deps: { diskSpace } });
    t.ctx.settings.set('general', { defaultLocale: 'it', diskReserveMb: 10, chunkSizeMb: 25 });
    const reserve = reserveBytes(t.ctx);
    // Free space left for uploads: 50 MB - reserve; pick sizes around it.
    const usable = 50 * MB - reserve;
    expect(usable).toBeGreaterThan(0);

    expect(await uploadFits(t.ctx, usable)).toBe(true); // 1x
    expect(await uploadFits(t.ctx, usable + 1)).toBe(false);
    expect(new Set(probes)).toEqual(new Set([t.config.tmpUploadDir]));

    probes.length = 0;
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'panel' });
    expect(await uploadFits(t.ctx, Math.floor(usable / 2))).toBe(true); // 2x
    expect(await uploadFits(t.ctx, Math.floor(usable / 2) + 1)).toBe(false);
    expect(new Set(probes)).toEqual(new Set([t.config.storageDir]));
  });

  it('shows the driver and the usage per driver on the admin storage page', async () => {
    const { t } = await createFakeS3App();
    await createTransferFixture(t, { files: [{ name: 'l', size: 500 }] });
    await createTransferFixture(t, { storage: 's3', files: [{ name: 's', size: 700 }] });
    const { client } = await userWithClient(t, { role: 'admin' });
    const body = bodyAs<StorageResponse>(await client.get('/api/admin/storage'));
    expect(body.driver).toBe('s3');
    expect(body.usageByDriver.local).toEqual({ files: 1, bytes: 500 + 16 });
    expect(body.usageByDriver.s3).toEqual({ files: 1, bytes: 700 + 16 });
    expect(body.totalFiles).toBe(2);
  });
});

describe('deleting stored files through the drivers', () => {
  it('deleteTransfer removes S3 objects and queues the ones that fail', async () => {
    const { t, fake } = await createFakeS3App();
    const fx = await createTransferFixture(t, {
      storage: 's3',
      files: [
        { name: 'a', size: 10 },
        { name: 'b', size: 20 },
      ],
    });
    const names = t.db.db
      .select()
      .from(transferFiles)
      .all()
      .map((f) => f.storageName);
    expect(fake.objects.size).toBe(2);

    fake.failDelete = true;
    const result = await deleteTransfer(t.ctx, fx.id, { actorId: null, reason: 'expired' });
    expect(result?.unlinkFailures).toBe(2);
    expect(fake.objects.size).toBe(2);
    const queued = t.db.db.select().from(storageDeletions).all();
    expect(queued.map((q) => q.name).sort()).toEqual([...names].sort());
    expect(queued.every((q) => q.storage === 's3' && q.attempts === 0)).toBe(true);

    fake.failDelete = false;
    const report = await runCleanup(t.ctx);
    expect(report.deletedQueued).toBe(2);
    expect(fake.objects.size).toBe(0);
    expect(t.db.db.select().from(storageDeletions).all()).toHaveLength(0);
  });

  it('deleteTransfer deletes local and S3 files of one transfer through their own drivers', async () => {
    const { t, fake } = await createFakeS3App();
    const fx = await createTransferFixture(t, { files: [{ name: 'a', size: 10 }] });
    const s3Fx = await createTransferFixture(t, {
      storage: 's3',
      files: [{ name: 'b', size: 10 }],
    });
    const localName = t.db.db
      .select()
      .from(transferFiles)
      .where(eq(transferFiles.transferId, fx.id))
      .get()!.storageName;
    await deleteTransfer(t.ctx, fx.id, { actorId: null, reason: 'expired' });
    expect(existsSync(path.join(t.config.storageDir, localName))).toBe(false);
    expect(fake.objects.size).toBe(1); // the other transfer is untouched
    await deleteTransfer(t.ctx, s3Fx.id, { actorId: null, reason: 'expired' });
    expect(fake.objects.size).toBe(0);
  });
});

describe('cleanup per driver and the deletion queue', () => {
  it('sweeps orphans of every driver, keeping referenced, young, queued and foreign objects', async () => {
    const { t, fake } = await createFakeS3App();
    const owner = await t.createUser();
    const transferId = insertTransfer(t, {
      ownerId: owner.id,
      status: 'active',
      expiresIn: 30 * 24 * HOUR,
    });
    const now = nowSec(t);
    const kept = await encryptContentToDriver(fake, 'kept', t.ctx.keys.file);
    t.db.db
      .insert(transferFiles)
      .values({
        transferId,
        originalName: 'k',
        storageName: kept.name,
        storage: 's3',
        sizeBytes: kept.size,
        storedSizeBytes: kept.storedSize,
        encKeyWrapped: kept.wrappedKey,
        encNoncePrefix: kept.noncePrefix,
        encSegmentSize: kept.segmentSize,
      })
      .run();
    const orphan = randomUUID();
    const young = randomUUID();
    const queued = randomUUID();
    for (const name of [orphan, young, queued, 'foreign.txt']) {
      fake.objects.set(name, { data: Buffer.from('x'), mtimeSeconds: now - 5 * HOUR });
    }
    fake.setMtime(young, now);
    t.db.db
      .insert(storageDeletions)
      .values({ storage: 's3', name: queued, deleteAfter: now + HOUR, createdAt: now })
      .run();
    const localOrphan = path.join(t.config.storageDir, randomUUID());
    writeFileSync(localOrphan, 'x');
    const old = new Date((now - 5 * HOUR) * 1000);
    utimesSync(localOrphan, old, old);

    const report = await runCleanup(t.ctx);
    expect(report.orphanFiles).toBe(2); // one S3, one local
    expect(report.failedSteps).toEqual([]);
    expect([...fake.objects.keys()].sort()).toEqual(
      [kept.name, young, queued, 'foreign.txt'].sort(),
    );
    expect(existsSync(localOrphan)).toBe(false);
  });

  it('skips an unreachable remote driver without failing the step, but fails on a broken local disk', async () => {
    const { t, fake } = await createFakeS3App();
    fake.failList = true;
    expect((await runCleanup(t.ctx)).failedSteps).toEqual([]);

    const notADir = path.join(t.config.dataDir, 'file-not-dir');
    writeFileSync(notADir, 'x');
    const broken = createStorageRegistry({
      config: { storageDir: notADir },
      settings: t.ctx.settings,
      logger: silentLogger,
      diskSpace: t.ctx.diskSpace,
      overrides: { s3: fake },
    });
    const report = await runCleanup({ ...t.ctx, storage: broken });
    expect(report.failedSteps).toEqual(['storage-orphans']);
  });

  it('is fine when S3 was never configured (nothing to sweep, nothing failed)', async () => {
    const t = await createCleanupApp();
    expect((await runCleanup(t.ctx)).failedSteps).toEqual([]);
  });

  it('processes only due deletions, retries failures and gives up after too many attempts', async () => {
    const { t, fake } = await createFakeS3App();
    const now = nowSec(t);
    const due = randomUUID();
    const later = randomUUID();
    const stuck = randomUUID();
    for (const name of [due, later]) {
      fake.objects.set(name, { data: Buffer.from('x'), mtimeSeconds: now });
    }
    const insert = (name: string, deleteAfter: number, attempts = 0) =>
      t.db.db
        .insert(storageDeletions)
        .values({ storage: 's3', name, deleteAfter, attempts, createdAt: now })
        .run();
    insert(due, now - 1);
    insert(later, now + HOUR);

    const first = await runCleanup(t.ctx);
    expect(first.deletedQueued).toBe(1);
    expect(fake.objects.has(due)).toBe(false);
    expect(fake.objects.has(later)).toBe(true);
    expect(
      t.db.db
        .select()
        .from(storageDeletions)
        .all()
        .map((r) => r.name),
    ).toEqual([later]);

    // After the grace period it goes too.
    t.clock.advance(HOUR + 1);
    expect((await runCleanup(t.ctx)).deletedQueued).toBe(1);
    expect(fake.objects.has(later)).toBe(false);

    // A failing backend: attempts go up, the row stays, then it is dropped.
    fake.failDelete = true;
    fake.objects.set(stuck, { data: Buffer.from('x'), mtimeSeconds: nowSec(t) });
    insert(stuck, 0);
    const retry = await runCleanup(t.ctx);
    expect(retry.retriedDeletions).toBe(1);
    expect(t.db.db.select().from(storageDeletions).get()?.attempts).toBe(1);

    t.db.db
      .update(storageDeletions)
      .set({ attempts: MAX_DELETION_ATTEMPTS - 1 })
      .run();
    const drop = await runCleanup(t.ctx);
    expect(drop.droppedDeletions).toBe(1);
    expect(t.db.db.select().from(storageDeletions).all()).toHaveLength(0);
    expect(fake.objects.has(stuck)).toBe(true); // the orphan sweep will catch it once it is old
  });

  it('asks remote drivers to recover, never the local one (its recover is startup-only)', async () => {
    const { t, fake } = await createFakeS3App();
    const part = path.join(t.config.storageDir, `${randomUUID()}.part`);
    writeFileSync(part, 'being written');
    await runCleanup(t.ctx);
    expect(fake.recoverCalls).toBe(1);
    expect(existsSync(part)).toBe(true);
  });
});

describe('plain app without any storage setting', () => {
  it('behaves as the local driver', async () => {
    const t = await createTestApp({ env: { DATA_DIR: makeTempDir() } });
    expect(t.ctx.storage.currentKind()).toBe('local');
    expect(t.ctx.settings.has('storage')).toBe(false);
  });
});
