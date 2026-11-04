import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { S3_PART_SIZE_BYTES, type S3Config } from '@easysend/shared';
import { AppError } from '../../http/errors.js';
import type { Logger } from '../../logger.js';
import {
  StorageObjectNotFoundError,
  type StorageDriver,
  type StorageReader,
  type StoredObject,
} from '../types.js';
import { createS3Client, S3RequestError, type S3Client } from './client.js';

/** Multipart uploads older than this are leftovers of an interrupted write. */
const STALE_UPLOAD_MS = 24 * 3600 * 1000;
const PUT_ATTEMPTS = 3;
const READ_ATTEMPTS = 3;
/** Name prefix of the objects written by the connection test (never reported by `list`). */
export const PROBE_PREFIX = '.easysend-probe-';

export interface S3DriverDeps {
  fetch: typeof fetch;
  logger: Logger;
  /** Size of one multipart part. Default `S3_PART_SIZE_BYTES`; tests use small ones. */
  partSize?: number;
  /** Base of the linear backoff between attempts, ms. Default 250; tests use 0. */
  retryDelayMs?: number;
  /** Clock in ms. Default `Date.now`. */
  now?: () => number;
  requestTimeoutMs?: number;
  transferTimeoutMs?: number;
}

class StoredSizeError extends Error {
  constructor() {
    super('Stored size mismatch');
    this.name = 'StoredSizeError';
  }
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** Runs `fn`, retrying transient S3 failures up to `attempts` times with a linear backoff. */
async function withRetry<T>(attempts: number, delayMs: number, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !(error instanceof S3RequestError) || !error.transient)
        throw error;
      await sleep(delayMs * attempt);
    }
  }
}

/**
 * Cuts `source` into parts of `partSize` bytes (the last one shorter) and checks the total against
 * `size`. ONE buffer is reused for every part: a part is valid only until the consumer asks for the
 * next one, and the stream is not read while the consumer is busy uploading (backpressure), so
 * memory stays at one part plus one stream chunk. Throws `StoredSizeError` on a stream that is
 * shorter or longer than `size`, before the consumer is handed anything past the mismatch.
 */
async function* readParts(
  source: Readable,
  size: number,
  partSize: number,
): AsyncGenerator<Buffer> {
  const buffer = Buffer.allocUnsafe(Math.min(size, partSize));
  let filled = 0;
  let total = 0;
  for await (const raw of source) {
    let chunk = raw as Buffer;
    total += chunk.length;
    if (total > size) throw new StoredSizeError();
    while (chunk.length > 0) {
      const taken = Math.min(chunk.length, buffer.length - filled);
      chunk.copy(buffer, filled, 0, taken);
      filled += taken;
      chunk = chunk.subarray(taken);
      if (filled === buffer.length) {
        yield buffer.subarray(0, filled);
        filled = 0;
      }
    }
  }
  if (total !== size) throw new StoredSizeError();
  if (filled > 0) yield buffer.subarray(0, filled);
}

/** Encrypted files in an S3-compatible bucket, under the configured key prefix. */
export function createS3Driver(config: S3Config, deps: S3DriverDeps): StorageDriver {
  const client = createS3Client(config, {
    fetch: deps.fetch,
    logger: deps.logger,
    ...(deps.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: deps.requestTimeoutMs }),
    ...(deps.transferTimeoutMs === undefined ? {} : { transferTimeoutMs: deps.transferTimeoutMs }),
  });
  const { logger } = deps;
  const partSize = deps.partSize ?? S3_PART_SIZE_BYTES;
  const delayMs = deps.retryDelayMs ?? 250;
  const now = deps.now ?? Date.now;

  async function putSingle(name: string, source: Readable, size: number): Promise<void> {
    let body: Buffer = Buffer.alloc(0);
    for await (const part of readParts(source, size, Math.max(size, 1))) body = part;
    await withRetry(PUT_ATTEMPTS, delayMs, () => client.putObject(name, body));
  }

  async function putMultipart(name: string, source: Readable, size: number): Promise<void> {
    const uploadId = await withRetry(PUT_ATTEMPTS, delayMs, () =>
      client.createMultipartUpload(name),
    );
    try {
      const parts: { partNumber: number; etag: string }[] = [];
      for await (const part of readParts(source, size, partSize)) {
        const partNumber = parts.length + 1;
        const etag = await withRetry(PUT_ATTEMPTS, delayMs, () =>
          client.uploadPart(name, uploadId, partNumber, part),
        );
        parts.push({ partNumber, etag });
      }
      await client.completeMultipartUpload(name, uploadId, parts);
    } catch (error) {
      await client.abortMultipartUpload(client.keyOf(name), uploadId).catch(() => {
        logger.warn({ name }, 's3 multipart abort failed; the stale-upload sweep will remove it');
      });
      throw error;
    }
  }

  async function* list(): AsyncGenerator<StoredObject> {
    let token: string | undefined;
    do {
      const page = await client.listObjects(token === undefined ? {} : { token });
      for (const { key, mtimeSeconds } of page.objects) {
        const name = key.slice(client.keyPrefix.length);
        if (!name || name.includes('/') || name.startsWith(PROBE_PREFIX)) continue;
        yield { name, mtimeSeconds };
      }
      token = page.nextToken;
    } while (token !== undefined);
  }

  return {
    kind: 's3',
    list,

    async put(name, source, size) {
      if (size <= partSize) await putSingle(name, source, size);
      else await putMultipart(name, source, size);
    },

    async openReader(name): Promise<StorageReader> {
      const size = await withRetry(READ_ATTEMPTS, delayMs, () => client.headObject(name));
      let closed = false;
      return {
        size,
        async read(offset, length) {
          if (closed) throw new AppError('STORAGE_UNAVAILABLE', 'The stored file reader is closed');
          const expected = Math.max(0, Math.min(length, size - offset));
          if (expected === 0) return Buffer.alloc(0);
          let data: Buffer;
          try {
            data = await withRetry(READ_ATTEMPTS, delayMs, () =>
              client.getRange(name, offset, expected),
            );
          } catch (error) {
            if (error instanceof StorageObjectNotFoundError) {
              throw new AppError('STORAGE_UNAVAILABLE', 'The stored file disappeared');
            }
            throw error;
          }
          if (data.length !== expected) {
            throw new AppError('STORAGE_UNAVAILABLE', 'The storage returned a short read');
          }
          return data;
        },
        // Nothing to release (every read is a stateless request); idempotent by construction.
        close() {
          closed = true;
          return Promise.resolve();
        },
      };
    },

    async delete(name) {
      try {
        await client.deleteObject(name);
        return true;
      } catch {
        // The client already logged the reason; the caller queues a retry.
        logger.warn({ name }, 's3 delete failed');
        return false;
      }
    },

    async recover() {
      try {
        const limit = now() - STALE_UPLOAD_MS;
        let aborted = 0;
        let next: { keyMarker: string; uploadIdMarker: string } | undefined;
        do {
          const page = await client.listMultipartUploads(next);
          for (const upload of page.uploads) {
            if (upload.initiatedMs > limit) continue;
            await client.abortMultipartUpload(upload.key, upload.uploadId);
            aborted += 1;
          }
          next = page.next;
        } while (next);
        if (aborted > 0) logger.info({ aborted }, 'aborted stale s3 multipart uploads');
      } catch {
        // A storage that does not answer must not break the cleanup run; try again next time.
        logger.warn('s3 stale multipart sweep failed');
      }
    },

    capacity: () => Promise.resolve(null),
  };
}

/**
 * Connection test: writes a few bytes under `<prefix>/.easysend-probe-<uuid>`, reads a slice back
 * with a ranged GET, compares, deletes the object and lists one key (the cleanup needs it).
 * Throws `AppError('STORAGE_UNAVAILABLE', ..., { reason })` with a safe reason.
 */
export async function probeS3(
  config: S3Config,
  deps: Pick<S3DriverDeps, 'fetch' | 'logger' | 'requestTimeoutMs' | 'transferTimeoutMs'>,
): Promise<void> {
  const client: S3Client = createS3Client(config, deps);
  const name = `${PROBE_PREFIX}${randomUUID()}`;
  const payload = randomBytes(16);
  try {
    await client.putObject(name, payload);
    const slice = await client.getRange(name, 4, 8);
    if (!slice.equals(payload.subarray(4, 12))) {
      throw new AppError('STORAGE_UNAVAILABLE', 'The storage returned different data', {
        reason: 'ENDPOINT',
      });
    }
    await client.deleteObject(name);
    await client.listObjects({ maxKeys: 1 });
  } catch (error) {
    await client.deleteObject(name).catch(() => undefined);
    if (error instanceof AppError) throw error;
    if (error instanceof StorageObjectNotFoundError) {
      throw new AppError('STORAGE_UNAVAILABLE', 'The storage lost the test object', {
        reason: 'ENDPOINT',
      });
    }
    throw error;
  }
}
