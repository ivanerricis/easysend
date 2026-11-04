import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { statfsDiskSpace } from '../src/storage/disk.js';
import { createLocalDriver } from '../src/storage/local.js';
import type { StorageDriver } from '../src/storage/types.js';
import { encryptToDriver, type EncryptResult } from '../src/crypto/segments.js';
import type { S3Config } from '@easysend/shared';
import { createFakeStorage, type FakeStorage } from './fake-storage.js';
import { silentLogger, type TestApp, type TestAppOverrides } from './helpers.js';
import { createUploadApp } from './upload-helpers.js';

/** Local driver on a directory (the production implementation, no app needed). */
export function localDriverAt(storageDir: string): StorageDriver {
  return createLocalDriver({ storageDir, diskSpace: statfsDiskSpace, logger: silentLogger });
}

/** A valid S3 configuration for the `storage` setting (never contacted: tests use a fake driver). */
export const TEST_S3_CONFIG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'auto',
  bucket: 'easysend-test',
  prefix: 'files',
  forcePathStyle: true,
  accessKeyId: 'AKIATESTKEY',
  secretAccessKey: 'test-secret-access-key',
};

/**
 * App whose active storage driver is an in-memory fake registered as `s3`: the `storage` setting
 * says `s3` and the fake is injected through `deps.storageDrivers`. `fake` is the driver, so a
 * test can inspect `fake.objects` and switch its failure flags.
 */
export async function createFakeS3App(
  overrides: TestAppOverrides = {},
  options: { active?: boolean } = {},
): Promise<{ t: TestApp; fake: FakeStorage }> {
  const fake = createFakeStorage('s3');
  const t = await createUploadApp({
    ...overrides,
    deps: { ...overrides.deps, storageDrivers: { s3: fake } },
  });
  t.ctx.settings.set('storage', {
    driver: options.active === false ? 'local' : 's3',
    s3: TEST_S3_CONFIG,
    source: 'panel',
  });
  return { t, fake };
}

/** Encrypts `content` into `driver` under a fresh UUID name (or the given one). */
export async function encryptContentToDriver(
  driver: StorageDriver,
  content: Buffer | string,
  fileKey: Uint8Array,
  name: string = randomUUID(),
): Promise<EncryptResult & { name: string; size: number }> {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  const result = await encryptToDriver({
    source: Readable.from([buffer]),
    driver,
    name,
    size: buffer.length,
    fileKey,
  });
  return { ...result, name, size: buffer.length };
}
