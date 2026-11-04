import { createWriteStream } from 'node:fs';
import { access, mkdir, open, opendir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import type { DiskSpace } from './disk.js';
import {
  PART_SUFFIX,
  isStorageEntry,
  isStorageName,
  storagePartPath,
  storagePath,
} from './paths.js';
import { removeFileQuietly } from './remove.js';
import {
  StorageObjectNotFoundError,
  type StorageDriver,
  type StorageReader,
  type StoredObject,
} from './types.js';

export interface LocalDriverDeps {
  /** `STORAGE_DIR`. */
  storageDir: string;
  /** Free-space probe (injectable so tests can fake a full disk). */
  diskSpace: DiskSpace;
  logger: Logger;
}

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

class StoredSizeError extends Error {
  constructor() {
    super('Stored size mismatch');
    this.name = 'StoredSizeError';
  }
}

/** Counts the bytes going through and fails the stream when they exceed `size`. */
function sizeGuard(size: number): { stream: Transform; bytes: () => number } {
  let total = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      done(total > size ? new StoredSizeError() : null, chunk);
    },
  });
  return { stream, bytes: () => total };
}

/** Encrypted files on the server disk, in `STORAGE_DIR` (the behaviour of phases 3 to 8). */
export function createLocalDriver(deps: LocalDriverDeps): StorageDriver {
  const { storageDir, logger } = deps;
  const config = { storageDir };

  async function* list(): AsyncGenerator<StoredObject> {
    let dir;
    try {
      dir = await opendir(storageDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for await (const entry of dir) {
      if (!entry.isFile()) continue;
      try {
        const info = await stat(path.join(storageDir, entry.name));
        yield { name: entry.name, mtimeSeconds: Math.floor(info.mtimeMs / 1000) };
      } catch {
        // Vanished between listing and stat: nothing to report.
      }
    }
  }

  return {
    kind: 'local',
    list,

    async put(name, source, size) {
      const finalPath = storagePath(config, name);
      const partPath = storagePartPath(config, name);
      await mkdir(storageDir, { recursive: true });
      // Never overwrite an existing object (names are random UUIDs: this is a bug guard).
      if (await exists(finalPath))
        throw Object.assign(new Error('Object exists'), { code: 'EEXIST' });
      const guard = sizeGuard(size);
      try {
        // Flag `wx`: exclusive creation, an existing temporary file is never overwritten.
        await pipeline(source, guard.stream, createWriteStream(partPath, { flags: 'wx' }));
        if (guard.bytes() !== size) throw new StoredSizeError();
        const out = await open(partPath, 'r+');
        try {
          await out.sync();
        } finally {
          await out.close();
        }
        await rename(partPath, finalPath);
      } catch (error) {
        // An existing temporary file is not ours: leave it alone. Anything else is a partial output.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          await removeFileQuietly(partPath, logger);
        }
        throw error;
      }
    },

    async openReader(name): Promise<StorageReader> {
      const file = storagePath(config, name);
      let handle;
      try {
        handle = await open(file, 'r');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new StorageObjectNotFoundError();
        }
        throw new AppError('STORAGE_UNAVAILABLE', 'Unable to open the stored file');
      }
      const opened = handle;
      let size: number;
      try {
        size = (await opened.stat()).size;
      } catch {
        await opened.close().catch(() => undefined);
        throw new AppError('STORAGE_UNAVAILABLE', 'Unable to read the stored file');
      }
      return {
        size,
        async read(offset, length) {
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await opened.read(buffer, 0, length, offset);
          return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        },
        async close() {
          await opened.close().catch(() => undefined);
        },
      };
    },

    delete(name) {
      // Names that are not UUIDs never existed here (and must never be turned into a path).
      if (!isStorageName(name)) return Promise.resolve(true);
      return removeFileQuietly(storagePath(config, name), logger);
    },

    async recover() {
      for await (const { name } of list()) {
        if (name.endsWith(PART_SUFFIX) && isStorageEntry(name)) {
          await removeFileQuietly(path.join(storageDir, name), logger);
        }
      }
    },

    async capacity() {
      const { freeBytes } = await deps.diskSpace(storageDir);
      return { freeBytes };
    },
  };
}
