import type { Readable } from 'node:stream';
import type { StorageDriverKind } from '@easysend/shared';
import { AppError } from '../src/http/errors.js';
import {
  StorageObjectNotFoundError,
  type StorageDriver,
  type StorageReader,
  type StoredObject,
} from '../src/storage/types.js';

/**
 * In-memory `StorageDriver` for tests (reused by the S3 and migration work packages). Objects
 * live in `objects`; the `fail*` switches and counters let a test simulate an unreachable backend
 * and check what the code under test did. Inject it with
 * `createTestApp({ deps: { storageDrivers: { s3: fake } } })` plus a `storage` setting whose
 * driver is `s3` (see `useFakeS3` in `storage-driver.test.ts` for the setting).
 */
export interface FakeStorage extends StorageDriver {
  /** Stored bytes and modification time (Unix seconds) by object name. */
  readonly objects: Map<string, { data: Buffer; mtimeSeconds: number }>;
  /** Makes every `put` fail with `STORAGE_UNAVAILABLE` after consuming the source. */
  failPut: boolean;
  /** Makes every `openReader` fail with `STORAGE_UNAVAILABLE`. */
  failOpen: boolean;
  /** Makes every `delete` report failure (`false`) without removing anything. */
  failDelete: boolean;
  /** Makes `list` throw `STORAGE_UNAVAILABLE`. */
  failList: boolean;
  /** Free space reported by `capacity()`; null (default) means "no limit", like S3. */
  freeBytes: number | null;
  /** Times `recover()` was called. */
  recoverCalls: number;
  /** Names passed to `delete`, in order (the failed ones too). */
  readonly deleteCalls: string[];
  /** Contents of an object, undefined when absent. */
  bytesOf(name: string): Buffer | undefined;
  /** Ages an object (the orphan sweep ignores young ones). */
  setMtime(name: string, mtimeSeconds: number): void;
}

const unavailable = (): AppError => new AppError('STORAGE_UNAVAILABLE', 'fake storage failure');

export function createFakeStorage(
  kind: StorageDriverKind = 's3',
  now: () => number = () => Math.floor(Date.now() / 1000),
): FakeStorage {
  const objects = new Map<string, { data: Buffer; mtimeSeconds: number }>();
  const fake: FakeStorage = {
    kind,
    objects,
    failPut: false,
    failOpen: false,
    failDelete: false,
    failList: false,
    freeBytes: null,
    recoverCalls: 0,
    deleteCalls: [],

    async put(name: string, source: Readable, size: number): Promise<void> {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of source) {
        const buffer = chunk as Buffer;
        total += buffer.length;
        chunks.push(buffer);
      }
      if (fake.failPut) throw unavailable();
      if (total !== size) throw new Error('Stored size mismatch');
      if (objects.has(name)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      objects.set(name, { data: Buffer.concat(chunks), mtimeSeconds: now() });
    },

    openReader(name: string): Promise<StorageReader> {
      if (fake.failOpen) return Promise.reject(unavailable());
      const object = objects.get(name);
      if (!object) return Promise.reject(new StorageObjectNotFoundError());
      const { data } = object;
      return Promise.resolve({
        size: data.length,
        read: (offset: number, length: number) =>
          Promise.resolve(data.subarray(offset, offset + length)),
        close: () => Promise.resolve(),
      });
    },

    delete(name: string): Promise<boolean> {
      fake.deleteCalls.push(name);
      if (fake.failDelete) return Promise.resolve(false);
      objects.delete(name);
      return Promise.resolve(true);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async *list(): AsyncGenerator<StoredObject> {
      if (fake.failList) throw unavailable();
      for (const [name, { mtimeSeconds }] of [...objects]) yield { name, mtimeSeconds };
    },

    recover(): Promise<void> {
      fake.recoverCalls += 1;
      return Promise.resolve();
    },

    capacity(): Promise<{ freeBytes: number } | null> {
      return Promise.resolve(fake.freeBytes === null ? null : { freeBytes: fake.freeBytes });
    },

    bytesOf: (name) => objects.get(name)?.data,
    setMtime(name, mtimeSeconds) {
      const object = objects.get(name);
      if (object) object.mtimeSeconds = mtimeSeconds;
    },
  };
  return fake;
}
