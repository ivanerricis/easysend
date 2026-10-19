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
