import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context.js';

/**
 * PNG logo embedded in emails, from the `emailLogo` entry of the `branding_assets` setting and
 * the file `brandingDir/<fileName>`. Null when it is not set or the file is missing/unreadable.
 */
export async function readEmailLogo(
  ctx: Pick<AppContext, 'settings' | 'config'>,
): Promise<{ content: Buffer; contentType: 'image/png' } | null> {
  const entry = ctx.settings.get('branding_assets')?.emailLogo;
  if (!entry) return null;
  // The name comes from our own setting, but never let it leave the branding directory.
  if (path.basename(entry.fileName) !== entry.fileName) return null;
  try {
    const content = await readFile(path.join(ctx.config.brandingDir, entry.fileName));
    return { content, contentType: 'image/png' };
  } catch {
    return null;
  }
}
