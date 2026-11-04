import type { Readable } from 'node:stream';
import type { StorageDriverKind } from '@easysend/shared';

/**
 * Random access to one stored object (the encrypted bytes of a file). Obtained with
 * `StorageDriver.openReader`; the caller must `close()` it (the decrypt stream does).
 */
export interface StorageReader {
  /** Exact size in bytes of the stored object. */
  readonly size: number;
  /**
   * Reads up to `length` bytes starting at `offset`. Returns fewer bytes only at the end of the
   * object (callers compare against the size they expect and treat a shortfall as damage).
   * Throws `AppError('STORAGE_UNAVAILABLE')` when the backend fails.
   */
  read(offset: number, length: number): Promise<Buffer>;
  close(): Promise<void>;
}

/** An object found by `StorageDriver.list`. */
export interface StoredObject {
  /** Object name: `transfer_files.storage_name` (a UUID) or a leftover (`<uuid>.part`, foreign files). */
  name: string;
  /** Last modification time, Unix seconds. */
  mtimeSeconds: number;
}

/** The named object does not exist (distinct from a backend failure). */
export class StorageObjectNotFoundError extends Error {
  constructor() {
    super('Stored object not found');
    this.name = 'StorageObjectNotFoundError';
  }
}

/**
 * Where the encrypted files live. Drivers are driver-agnostic about content: they store and
 * return opaque bytes under a name (a UUID, `transfer_files.storage_name`); encryption happens
 * above them (`crypto/segments.ts`) and the plaintext never reaches a driver.
 */
export interface StorageDriver {
  readonly kind: StorageDriverKind;

  /**
   * Stores exactly `size` bytes read from `source` under `name`, in streaming with constant
   * memory. All or nothing: the object becomes visible only when complete (local: write to
   * `<name>.part`, fsync, atomic rename; S3: multipart upload completed). Fails (and leaves
   * nothing behind) if the stream errors or yields a number of bytes different from `size`.
   * An existing object with that name is never overwritten. Backend failures other than a bad
   * source are `AppError('STORAGE_UNAVAILABLE')`.
   */
  put(name: string, source: Readable, size: number): Promise<void>;

  /** Opens an object for ranged reads. Throws `StorageObjectNotFoundError` when it does not exist. */
  openReader(name: string): Promise<StorageReader>;

  /**
   * Deletes an object. Never throws: a missing object counts as success (`true`); any other
   * failure is logged (name only, no secrets) and reported as `false`, so the caller can queue a
   * retry in `storage_deletions` or leave it to the orphan sweep.
   */
  delete(name: string): Promise<boolean>;

  /** Lazily lists every object of the storage (paged on S3). A missing location is an empty list. */
  list(): AsyncIterable<StoredObject>;

  /**
   * Startup housekeeping for leftovers of interrupted writes (local: `*.part` files; S3: stale
   * multipart uploads). Safe to call repeatedly.
   */
  recover(): Promise<void>;

  /** Free space that new uploads must fit in, or null when the backend has no such limit (S3). */
  capacity(): Promise<{ freeBytes: number } | null>;
}
