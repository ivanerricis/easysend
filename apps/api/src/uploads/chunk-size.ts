import { BYTES_PER_MB, CHUNK_SIZE_MB } from '@easysend/shared';
import type { AppContext } from '../context.js';

/** tus chunk size for the browser: the general setting, else `DEFAULT_CHUNK_SIZE_MB`, capped. */
export function chunkSizeBytes(ctx: AppContext): number {
  const mb = Math.min(
    ctx.settings.get('general')?.chunkSizeMb ?? ctx.config.defaultChunkSizeMb,
    CHUNK_SIZE_MB.max,
  );
  return mb * BYTES_PER_MB;
}
