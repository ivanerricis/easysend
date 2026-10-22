import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes a file for another container or the host to read, atomically: a temporary file in the
 * same directory (given mode), then a rename, so a reader never sees a half-written file.
 */
export async function writeFileAtomic(
  dir: string,
  name: string,
  content: string,
  mode: number,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, content, { mode });
    await rename(tmp, path.join(dir, name));
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
