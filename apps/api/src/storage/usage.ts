import { count, sql } from 'drizzle-orm';
import { STORAGE_DRIVERS, type StorageDriverKind } from '@easysend/shared';
import type { Db } from '../db/client.js';
import { transferFiles } from '../db/schema/index.js';

export interface DriverUsage {
  files: number;
  /** Size of the stored (encrypted) objects, `transfer_files.stored_size_bytes`. */
  bytes: number;
}

/** Stored files and bytes per driver (rows of `transfer_files` by their `storage` column). */
export function storageUsageByDriver(db: Db): Record<StorageDriverKind, DriverUsage> {
  const usage = Object.fromEntries(
    STORAGE_DRIVERS.map((kind) => [kind, { files: 0, bytes: 0 }]),
  ) as Record<StorageDriverKind, DriverUsage>;
  const rows = db
    .select({
      storage: transferFiles.storage,
      files: count(),
      bytes: sql<number>`coalesce(sum(${transferFiles.storedSizeBytes}), 0)`,
    })
    .from(transferFiles)
    .groupBy(transferFiles.storage)
    .all();
  for (const row of rows) usage[row.storage] = { files: row.files, bytes: row.bytes };
  return usage;
}
