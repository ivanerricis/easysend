import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  releaseVersionSchema,
  unixSecondsSchema,
  updateRunStatusSchema,
  type UpdateRunStatus,
} from '@easysend/shared';
import type { Logger } from '../logger.js';

/** File protocol shared with the host update runner (see `admin.updateRun` in the contract). */
export const RUNNER_FILE = 'runner.json';
export const REQUEST_FILE = 'request';
export const STATUS_FILE = 'status.json';

/** Largest file the API is willing to read from the update folder. */
const MAX_FILE_BYTES = 4096;

/** A request older than this with no status of the same id is "stale": nobody is picking it up. */
export const STALE_REQUEST_SECONDS = 120;
/** A `running` status not updated for this long is considered dead and no longer blocks a new update. */
export const RUNNING_TIMEOUT_SECONDS = 45 * 60;

const runnerSchema = z.object({ version: z.literal(1), installedAt: unixSecondsSchema });

const REQUEST_PATTERN =
  /^id=([0-9a-f]{32})\nversion=(\d{1,9}\.\d{1,9}\.\d{1,9})\nrequestedAt=(\d{1,12})\n$/;

export interface UpdateRequest {
  id: string;
  version: string;
  requestedAt: number;
}

/** Exact content of the request file. */
export function formatRequest(request: UpdateRequest): string {
  return `id=${request.id}\nversion=${request.version}\nrequestedAt=${request.requestedAt}\n`;
}

export function parseRequest(text: string): UpdateRequest | null {
  const match = REQUEST_PATTERN.exec(text);
  if (!match) return null;
  const version = releaseVersionSchema.safeParse(match[2]);
  if (!version.success) return null;
  return { id: match[1]!, version: version.data, requestedAt: Number(match[3]) };
}

/**
 * Reads a small text file of the update folder. Missing, too large or unreadable files give null
 * (only the error code is logged, never a path or content). Never throws.
 */
async function readSmallFile(dir: string, name: string, logger: Logger): Promise<string | null> {
  let handle;
  try {
    handle = await open(path.join(dir, name), 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn({ file: name, code }, 'update file unreadable');
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readRunnerInstalled(dir: string, logger: Logger): Promise<boolean> {
  const text = await readSmallFile(dir, RUNNER_FILE, logger);
  if (text === null) return false;
  try {
    return runnerSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

export async function readPendingRequest(
  dir: string,
  logger: Logger,
): Promise<UpdateRequest | null> {
  const text = await readSmallFile(dir, REQUEST_FILE, logger);
  return text === null ? null : parseRequest(text);
}

export async function readRunStatus(dir: string, logger: Logger): Promise<UpdateRunStatus | null> {
  const text = await readSmallFile(dir, STATUS_FILE, logger);
  if (text === null) return null;
  try {
    const parsed = updateRunStatusSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
