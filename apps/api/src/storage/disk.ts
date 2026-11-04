import { statfs } from 'node:fs/promises';
import { BYTES_PER_MB } from '@easysend/shared';
import type { AppContext } from '../context.js';

export interface DiskSpaceInfo {
  totalBytes: number;
  /** Space available to unprivileged processes (`bavail`), not the raw free blocks. */
  freeBytes: number;
}

/** Reads the capacity of the filesystem holding `dir`. Injectable so tests can fake a full disk. */
export type DiskSpace = (dir: string) => Promise<DiskSpaceInfo>;

export const statfsDiskSpace: DiskSpace = async (dir) => {
  const stats = await statfs(dir);
  return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
};

/** Bytes that must stay free: `general.diskReserveMb` setting or the `DEFAULT_DISK_RESERVE_MB` default. */
export function reserveBytes(ctx: Pick<AppContext, 'settings' | 'config'>): number {
  const megabytes = ctx.settings.get('general')?.diskReserveMb ?? ctx.config.defaultDiskReserveMb;
  return megabytes * BYTES_PER_MB;
}

/**
 * Whether an upload of `size` plaintext bytes fits. With the local driver the encrypted copy is
 * written next to the tus file, so both must fit: `free(STORAGE_DIR) - reserve >= 2 x size`. With
 * any other driver the ciphertext leaves the server and only the tus file stays on disk:
 * `free(TMP_UPLOAD_DIR) - reserve >= 1 x size`.
 */
export async function uploadFits(
  ctx: Pick<AppContext, 'settings' | 'config' | 'storage' | 'diskSpace'>,
  size: number,
): Promise<boolean> {
  const driver = ctx.storage.current();
  const capacity = driver.kind === 'local' ? await driver.capacity() : null;
  if (capacity) return capacity.freeBytes - reserveBytes(ctx) >= 2 * size;
  const { freeBytes } = await ctx.diskSpace(ctx.config.tmpUploadDir);
  return freeBytes - reserveBytes(ctx) >= size;
}

/** Directory whose free space the admin storage page shows: the one uploads actually consume. */
export function spaceProbeDir(ctx: Pick<AppContext, 'config' | 'storage'>): string {
  return ctx.storage.currentKind() === 'local' ? ctx.config.storageDir : ctx.config.tmpUploadDir;
}
