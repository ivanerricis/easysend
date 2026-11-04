import { MAX_FILES_PER_TRANSFER_DEFAULT } from '@easysend/shared';
import type { AppContext } from '../context.js';

/** Files allowed in one transfer: the general setting, else `MAX_FILES_PER_TRANSFER_DEFAULT`. */
export function maxFilesPerTransfer(ctx: Pick<AppContext, 'settings'>): number {
  return ctx.settings.get('general')?.maxFilesPerTransfer ?? MAX_FILES_PER_TRANSFER_DEFAULT;
}
