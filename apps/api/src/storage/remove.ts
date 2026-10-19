import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';

/**
 * Deletes a file, treating "already gone" as success. Other failures are logged with the file
 * name only (never the directory or any content) and reported as `false`, so callers can leave
 * the file to the cleanup job's orphan sweep.
 */
export async function removeFileQuietly(filePath: string, logger: Logger): Promise<boolean> {
  try {
    await rm(filePath, { force: true });
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    logger.warn({ file: path.basename(filePath), code }, 'unable to remove file');
    return false;
  }
}
