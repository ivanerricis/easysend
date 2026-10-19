import type { AppContext } from '../context.js';

/** Counters of one cleanup run, one entry per step (all zero for the placeholder). */
export interface CleanupReport {
  deletedTransfers: number;
  abortedUploads: number;
  orphanFiles: number;
  purgedLogRows: number;
  usedBytesFixed: number;
}

/**
 * One pass of the periodic cleanup (phase 3, WP4): expired and revoked transfers, abandoned
 * drafts, expired uploads, orphan files, old logs, `used_bytes` realignment. Each step is
 * isolated so one failure does not stop the others.
 */
export function runCleanup(_ctx: AppContext): Promise<CleanupReport> {
  return Promise.resolve({
    deletedTransfers: 0,
    abortedUploads: 0,
    orphanFiles: 0,
    purgedLogRows: 0,
    usedBytesFixed: 0,
  });
}

/** Schedules `runCleanup` with `CLEANUP_CRON` (WP4). The placeholder schedules nothing. */
export function scheduleCleanup(_ctx: AppContext): { stop(): void } {
  return { stop: () => undefined };
}
