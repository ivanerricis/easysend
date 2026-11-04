import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { S3Config, StorageTestReason } from '@easysend/shared';
import { runCleanup } from '../src/jobs/cleanup.js';
import { createS3Client } from '../src/storage/s3/client.js';
import { createS3Driver, probeS3, PROBE_PREFIX } from '../src/storage/s3/driver.js';
import { StorageObjectNotFoundError } from '../src/storage/types.js';
import { createFakeS3, type FakeS3, type FakeS3Mode } from './fake-s3.js';
import { createTestClock, silentLogger, type TestApp } from './helpers.js';
import {
  createUploadApp,
  filesOf,
  readStoredFile,
  settle,
  uploadBytes,
  userWithClient,
  createDraft,
} from './upload-helpers.js';
import { TEST_S3_CONFIG } from './storage-helpers.js';
import { binaryRequest, createTransferFixture } from './transfer-fixtures.js';

const PART = 1000;
const HOUR_MS = 3_600_000;

function setup(options: { pageSize?: number; fetchFn?: typeof fetch; now?: () => number } = {}) {
  const fake = createFakeS3({
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
    ...(options.now ? { now: options.now } : {}),
  });
  const driver = createS3Driver(TEST_S3_CONFIG, {
    fetch: options.fetchFn ?? fake.fetch,
    logger: silentLogger,
    partSize: PART,
    retryDelayMs: 0,
    ...(options.now ? { now: options.now } : {}),
  });
  return { fake, driver };
}

const source = (data: Buffer, chunk = 300): Readable =>
  Readable.from(
    (function* () {
      for (let i = 0; i < data.length; i += chunk) yield data.subarray(i, i + chunk);
    })(),
  );

/** `fetch` that fails the first `failures[method]` calls of that method with a 500. */
function flaky(fake: FakeS3, failures: Record<string, number>): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if ((failures[method] ?? 0) > 0) {
      failures[method] = (failures[method] ?? 0) - 1;
      return Promise.resolve(
        new Response('<Error><Code>InternalError</Code></Error>', { status: 500 }),
      );
    }
    return fake.fetch(input, init);
  };
}

const keyOf = (name: string) => `files/${name}`;

describe('s3 driver put', () => {
  it('stores small objects with one PutObject and exact bytes, including empty ones', async () => {
    const { fake, driver } = setup();
    for (const size of [0, 1, PART - 1, PART]) {
      const name = randomUUID();
      const data = randomBytes(size);
      await driver.put(name, source(data), size);
      expect(fake.objects.get(keyOf(name))?.data.equals(data)).toBe(true);
    }
    expect(fake.requests.every((r) => r.method === 'PUT' && !('uploadId' in r.query))).toBe(true);
    expect(fake.uploads.size).toBe(0);
  });

  it('uses multipart for larger objects, with full parts and a shorter last one', async () => {
    const { fake, driver } = setup();
    for (const size of [PART + 1, 3 * PART, 3 * PART + 123]) {
      fake.requests.length = 0;
      const name = randomUUID();
      const data = randomBytes(size);
      await driver.put(name, source(data), size);
      expect(fake.objects.get(keyOf(name))?.data.equals(data)).toBe(true);
      const parts = fake.requests.filter((r) => r.query['partNumber']);
      expect(parts.length).toBe(Math.ceil(size / PART));
      expect(parts.slice(0, -1).every((r) => r.bodyBytes === PART)).toBe(true);
      expect(fake.uploads.size).toBe(0);
    }
  });

  it('retries a failed part and succeeds', async () => {
    const { fake, driver } = setup();
    fake.failPartNumber = 2;
    fake.failPartTimes = 1;
    const data = randomBytes(3 * PART);
    const name = randomUUID();
    await driver.put(name, source(data), data.length);
    expect(fake.objects.get(keyOf(name))?.data.equals(data)).toBe(true);
    expect(fake.requests.filter((r) => r.query['partNumber'] === '2').length).toBe(2);
  });

  it('aborts the multipart upload when a part keeps failing', async () => {
    const { fake, driver } = setup();
    fake.failPartNumber = 2;
    fake.failPartTimes = 3;
    const name = randomUUID();
    await expect(driver.put(name, source(randomBytes(3 * PART)), 3 * PART)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(fake.uploads.size).toBe(0);
    expect(fake.objects.size).toBe(0);
    expect(fake.requests.some((r) => r.method === 'DELETE' && r.query['uploadId'])).toBe(true);
  });

  it('aborts when completing fails, and does not retry non-transient errors', async () => {
    const { fake, driver } = setup();
    fake.failComplete = true;
    await expect(
      driver.put(randomUUID(), source(randomBytes(2 * PART)), 2 * PART),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(fake.uploads.size).toBe(0);
    expect(fake.objects.size).toBe(0);

    fake.mode = 'forbidden';
    fake.requests.length = 0;
    await expect(driver.put(randomUUID(), source(randomBytes(10)), 10)).rejects.toMatchObject({
      details: { reason: 'ACCESS_DENIED' },
    });
    expect(fake.requests.length).toBe(1);
  });

  it.each([
    ['multipart too short', 3 * PART, 3 * PART - 1],
    ['multipart too long', 3 * PART, 3 * PART + 1],
    ['single too short', 500, 499],
    ['single too long', 500, 501],
  ])(
    'refuses a stream of the wrong size (%s) and leaves nothing behind',
    async (_label, size, actual) => {
      const { fake, driver } = setup();
      await expect(driver.put(randomUUID(), source(randomBytes(actual)), size)).rejects.toThrow(
        'Stored size mismatch',
      );
      expect(fake.objects.size).toBe(0);
      expect(fake.uploads.size).toBe(0);
    },
  );

  it('aborts when the source stream fails midway', async () => {
    const { fake, driver } = setup();
    const failing = new Readable({
      read() {
        this.push(randomBytes(700));
        this.destroy(new Error('source broke'));
      },
    });
    await expect(driver.put(randomUUID(), failing, 5 * PART)).rejects.toThrow('source broke');
    expect(fake.uploads.size).toBe(0);
    expect(fake.objects.size).toBe(0);
  });

  it('buffers at most one part: respects backpressure and request bodies stay within a part', async () => {
    const { fake, driver } = setup();
    const CHUNK = 100;
    const total = 20 * PART;
    let produced = 0;
    let received = 0;
    let maxAhead = 0;
    fake.onBody = (request) => {
      if (request.query['partNumber']) received += request.bodyBytes;
    };
    const stream = Readable.from(
      (function* () {
        while (produced < total) {
          produced += CHUNK;
          maxAhead = Math.max(maxAhead, produced - received);
          yield randomBytes(CHUNK);
        }
      })(),
    );
    await driver.put(randomUUID(), stream, total);
    expect(received).toBe(total);
    expect(fake.maxBodyBytes).toBeLessThanOrEqual(PART);
    // One part being filled plus the stream's own read-ahead, never the whole object.
    expect(maxAhead).toBeLessThanOrEqual(PART + 3 * CHUNK);
  });
});

describe('s3 driver reads', () => {
  it('reads ranges, returns short reads at the end and closes idempotently', async () => {
    const { driver } = setup();
    const name = randomUUID();
    const data = randomBytes(2500);
    await driver.put(name, source(data), data.length);
    const reader = await driver.openReader(name);
    expect(reader.size).toBe(2500);
    expect((await reader.read(100, 50)).equals(data.subarray(100, 150))).toBe(true);
    expect((await reader.read(2490, 100)).equals(data.subarray(2490))).toBe(true);
    expect((await reader.read(2500, 10)).length).toBe(0);
    expect((await reader.read(0, 2500)).equals(data)).toBe(true);
    await reader.close();
    await expect(reader.close()).resolves.toBeUndefined();
  });

  it('throws StorageObjectNotFoundError for a missing object', async () => {
    const { driver } = setup();
    await expect(driver.openReader(randomUUID())).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('retries transient failures of HEAD and ranged GET, then gives up', async () => {
    const fake = createFakeS3();
    const failures: Record<string, number> = {};
    const shared = createS3Driver(TEST_S3_CONFIG, {
      fetch: flaky(fake, failures),
      logger: silentLogger,
      partSize: PART,
      retryDelayMs: 0,
    });
    const name = randomUUID();
    const data = randomBytes(300);
    await shared.put(name, source(data), 300);

    failures['HEAD'] = 2;
    const reader = await shared.openReader(name);
    failures['GET'] = 2;
    expect((await reader.read(10, 20)).equals(data.subarray(10, 30))).toBe(true);
    failures['GET'] = 3;
    await expect(reader.read(10, 20)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('turns an object that vanished mid-read into STORAGE_UNAVAILABLE', async () => {
    const { fake, driver } = setup();
    const name = randomUUID();
    await driver.put(name, source(randomBytes(100)), 100);
    const reader = await driver.openReader(name);
    fake.objects.clear();
    await expect(reader.read(0, 10)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});

describe('s3 driver delete, list, recover, capacity', () => {
  it('delete never throws: missing and existing are true, a refusal is false', async () => {
    const { fake, driver } = setup();
    const name = randomUUID();
    await driver.put(name, source(randomBytes(10)), 10);
    expect(await driver.delete(name)).toBe(true);
    expect(fake.objects.size).toBe(0);
    expect(await driver.delete(name)).toBe(true);
    fake.mode = 'forbidden';
    expect(await driver.delete(name)).toBe(false);
    fake.mode = 'network';
    expect(await driver.delete(name)).toBe(false);
  });

  it('lists the prefix across pages, without nested keys, probes or foreign prefixes', async () => {
    const { fake, driver } = setup({ pageSize: 2 });
    const names = Array.from({ length: 5 }, () => randomUUID());
    for (const name of names) await driver.put(name, source(randomBytes(5)), 5);
    fake.objects.set('files/sub/nested', { data: Buffer.from('x'), mtimeMs: 0 });
    fake.objects.set(`files/${PROBE_PREFIX}abc`, { data: Buffer.from('x'), mtimeMs: 0 });
    fake.objects.set('other/foreign', { data: Buffer.from('x'), mtimeMs: 0 });
    fake.requests.length = 0;

    const listed: { name: string; mtimeSeconds: number }[] = [];
    for await (const object of driver.list()) listed.push(object);
    expect(listed.map((o) => o.name).sort()).toEqual([...names].sort());
    expect(listed.every((o) => o.mtimeSeconds > 1_000_000_000)).toBe(true);
    expect(fake.requests.filter((r) => r.method === 'GET').length).toBeGreaterThanOrEqual(4);
  });

  it('lists an empty bucket and reports no capacity limit', async () => {
    const { driver } = setup();
    const listed: unknown[] = [];
    for await (const object of driver.list()) listed.push(object);
    expect(listed).toEqual([]);
    expect(await driver.capacity()).toBeNull();
    expect(driver.kind).toBe('s3');
  });

  it('recover aborts only multipart uploads older than 24 hours under the prefix', async () => {
    const clock = createTestClock();
    const { fake, driver } = setup({ now: clock, pageSize: 1 });
    const client = createS3Client(TEST_S3_CONFIG, { fetch: fake.fetch, logger: silentLogger });
    const foreign = createS3Client(
      { ...TEST_S3_CONFIG, prefix: 'other' },
      { fetch: fake.fetch, logger: silentLogger },
    );

    const oldId = await client.createMultipartUpload('old');
    const oldId2 = await client.createMultipartUpload('old2');
    const foreignOld = await foreign.createMultipartUpload('old');
    fake.uploads.get(oldId)!.initiatedMs = clock() - 25 * HOUR_MS;
    fake.uploads.get(oldId2)!.initiatedMs = clock() - 30 * HOUR_MS;
    fake.uploads.get(foreignOld)!.initiatedMs = clock() - 30 * HOUR_MS;
    const recentId = await client.createMultipartUpload('recent');
    fake.uploads.get(recentId)!.initiatedMs = clock() - 23 * HOUR_MS;

    await driver.recover();
    expect([...fake.uploads.keys()].sort()).toEqual([recentId, foreignOld].sort());
    await driver.recover(); // repeatable
    expect(fake.uploads.size).toBe(2);
  });

  it('recover swallows storage failures', async () => {
    const { fake, driver } = setup();
    fake.mode = 'forbidden';
    await expect(driver.recover()).resolves.toBeUndefined();
  });
});

describe('s3 probe', () => {
  const deps = (fake: FakeS3, extra = {}) => ({
    fetch: fake.fetch,
    logger: silentLogger,
    ...extra,
  });

  it('writes, reads a slice, deletes and lists, leaving nothing behind', async () => {
    const fake = createFakeS3();
    await expect(probeS3(TEST_S3_CONFIG, deps(fake))).resolves.toBeUndefined();
    expect(fake.objects.size).toBe(0);
    const put = fake.requests.find((r) => r.method === 'PUT')!;
    expect(put.key.startsWith(`files/${PROBE_PREFIX}`)).toBe(true);
    expect(fake.requests.some((r) => r.method === 'GET' && r.key === put.key)).toBe(true);
    expect(fake.requests.some((r) => r.method === 'DELETE' && r.key === put.key)).toBe(true);
  });

  const cases: [FakeS3Mode, StorageTestReason][] = [
    ['forbidden', 'ACCESS_DENIED'],
    ['invalid-key', 'ACCESS_DENIED'],
    ['signature', 'SIGNATURE'],
    ['no-bucket', 'NO_SUCH_BUCKET'],
    ['network', 'NETWORK'],
    ['dns', 'ENDPOINT'],
  ];
  it.each(cases)('reports %s as %s', async (mode, reason) => {
    const fake = createFakeS3();
    fake.mode = mode;
    await expect(probeS3(TEST_S3_CONFIG, deps(fake))).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      details: { reason },
    });
  });

  it('reports TIMEOUT, a wrong bucket and a bad endpoint', async () => {
    const fake = createFakeS3();
    fake.mode = 'hang';
    await expect(
      probeS3(TEST_S3_CONFIG, deps(fake, { requestTimeoutMs: 20, transferTimeoutMs: 20 })),
    ).rejects.toMatchObject({
      details: { reason: 'TIMEOUT' },
    });
    fake.mode = 'ok';
    await expect(
      probeS3({ ...TEST_S3_CONFIG, bucket: 'missing-bucket' }, deps(fake)),
    ).rejects.toMatchObject({
      details: { reason: 'NO_SUCH_BUCKET' },
    });
    await expect(
      probeS3({ ...TEST_S3_CONFIG, endpoint: 'ftp://nope' }, deps(fake)),
    ).rejects.toMatchObject({
      details: { reason: 'ENDPOINT' },
    });
  });

  it('fails with ACCESS_DENIED when only the delete is refused, and cleans up', async () => {
    const fake = createFakeS3();
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'DELETE'
        ? Promise.resolve(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
        : fake.fetch(input, init)) as typeof fetch;
    await expect(
      probeS3(TEST_S3_CONFIG, { fetch: fetchFn, logger: silentLogger }),
    ).rejects.toMatchObject({ details: { reason: 'ACCESS_DENIED' } });
  });
});

// ---- Through the application: registry, upload, download, cleanup ------------------------------

async function s3App(): Promise<{
  t: TestApp;
  fake: FakeS3;
  clock: ReturnType<typeof createTestClock>;
}> {
  const clock = createTestClock();
  const fake = createFakeS3({ now: clock, pageSize: 2 });
  const t = await createUploadApp({
    clock,
    deps: { storageFetch: fake.fetch, storagePartSizeBytes: 50_000, storageRetryDelayMs: 0 },
  });
  const config: S3Config = TEST_S3_CONFIG;
  t.ctx.settings.set('storage', { driver: 's3', s3: config, source: 'panel' });
  return { t, fake, clock };
}

describe('app with the real S3 driver on the fake server', () => {
  it('registry builds an S3 driver and ctx.storageProbe uses the injected fetch', async () => {
    const { t, fake } = await s3App();
    expect(t.ctx.storage.current().kind).toBe('s3');
    await expect(t.ctx.storageProbe(TEST_S3_CONFIG)).resolves.toBeUndefined();
    fake.mode = 'forbidden';
    await expect(t.ctx.storageProbe(TEST_S3_CONFIG)).rejects.toMatchObject({
      details: { reason: 'ACCESS_DENIED' },
    });
    const probe = vi.fn(() => Promise.resolve());
    const custom = await createUploadApp({ deps: { storageProbe: probe } });
    await custom.ctx.storageProbe(TEST_S3_CONFIG);
    expect(probe).toHaveBeenCalledWith(TEST_S3_CONFIG);
  });

  it('uploads (multipart, encrypted), downloads with ranges and zips from S3', async () => {
    const { t, fake } = await s3App();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(130_000);
    await uploadBytes(t, client, { transferId: draft.id, data });
    await settle(t);

    const [file] = filesOf(t, draft.id);
    expect(file?.storage).toBe('s3');
    const stored = fake.objects.get(`files/${file!.storageName}`);
    expect(stored).toBeDefined();
    expect(stored!.data.equals(data)).toBe(false); // encrypted at rest
    expect(fake.requests.some((r) => r.query['partNumber'] === '3')).toBe(true); // multipart
    expect(fake.maxBodyBytes).toBeLessThanOrEqual(50_000);
    expect(fake.uploads.size).toBe(0);
    expect(await readStoredFile(t, file!)).toEqual(data);

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

  it('answers 503 when the bucket refuses reads', async () => {
    const { t, fake } = await s3App();
    const fx = await createTransferFixture(t, { storage: 's3', files: [{ name: 'a', size: 100 }] });
    fake.mode = 'forbidden';
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`);
    expect(res.status).toBe(503);
  });

  it('cleanup sweeps S3 orphans (old, unreferenced) and aborts stale multipart uploads', async () => {
    const { t, fake, clock } = await s3App();
    const fx = await createTransferFixture(t, { storage: 's3', files: [{ name: 'k', size: 50 }] });
    const kept = filesOfFixture(t, fx.id);
    const orphan = randomUUID();
    const young = randomUUID();
    const old = clock() - 5 * HOUR_MS;
    for (const name of [orphan, young, 'foreign.txt']) {
      fake.objects.set(`files/${name}`, { data: Buffer.from('x'), mtimeMs: old });
    }
    fake.objects.set(`files/${young}`, { data: Buffer.from('x'), mtimeMs: clock() });
    fake.objects.set('outside/prefix', { data: Buffer.from('x'), mtimeMs: old });
    fake.uploads.set('stale', {
      key: 'files/x',
      initiatedMs: clock() - 30 * HOUR_MS,
      parts: new Map(),
    });

    const report = await runCleanup(t.ctx);
    expect(report.failedSteps).toEqual([]);
    expect([...fake.objects.keys()].sort()).toEqual(
      [`files/${kept}`, `files/${young}`, 'files/foreign.txt', 'outside/prefix'].sort(),
    );
    expect(fake.uploads.size).toBe(0);
  });
});

function filesOfFixture(t: TestApp, transferId: string): string {
  return filesOf(t, transferId)[0]!.storageName;
}
