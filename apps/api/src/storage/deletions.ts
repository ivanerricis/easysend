import type { StorageDriverKind } from '@easysend/shared';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import type { Db } from '../db/client.js';
import { storageDeletions } from '../db/schema/index.js';
import { isStorageName } from './paths.js';

/** An encrypted object: which driver holds it and its name (`transfer_files.storage_name`). */
export interface StoredObjectRef {
  storage: StorageDriverKind;
  name: string;
}

/** Queues an object for deletion, not before `deleteAfter` (Unix seconds). */
export function enqueueDeletion(
  db: Db,
  ref: StoredObjectRef,
  now: number,
  deleteAfter: number = now,
): void {
  db.insert(storageDeletions)
    .values({ storage: ref.storage, name: ref.name, deleteAfter, createdAt: now })
    .run();
}

/**
 * Deletes encrypted objects through their drivers, after the database rows are gone. A delete
 * that fails (or a driver that cannot be built, e.g. S3 unreachable) goes into the
 * `storage_deletions` queue, which the cleanup job retries; nothing here throws. Returns how many
 * objects could not be deleted right away.
 */
export async function deleteStoredObjects(
  ctx: Pick<AppContext, 'db' | 'storage' | 'clock' | 'logger'>,
  refs: readonly StoredObjectRef[],
): Promise<number> {
  let failures = 0;
  for (const ref of refs) {
    if (!isStorageName(ref.name)) continue;
    let ok: boolean;
    try {
      ok = await ctx.storage.forFile(ref.storage).delete(ref.name);
    } catch {
      ok = false;
    }
    if (!ok) {
      failures += 1;
      try {
        enqueueDeletion(ctx.db, ref, nowSeconds(ctx.clock));
      } catch {
        ctx.logger.warn({ storage: ref.storage }, 'unable to queue a storage deletion');
      }
    }
  }
  return failures;
}
