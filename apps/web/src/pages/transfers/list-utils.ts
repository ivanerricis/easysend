import { transferModeSchema, transferStatusSchema, type TransferSummary } from '@easysend/shared';

/** Reads the list filters from the URL, ignoring anything that is not valid. */
export function readListParams(params: URLSearchParams) {
  const status = transferStatusSchema.safeParse(params.get('status'));
  const mode = transferModeSchema.safeParse(params.get('mode'));
  const page = Number(params.get('page'));
  const q = params.get('q')?.trim().slice(0, 100) ?? '';
  return {
    status: status.success ? status.data : undefined,
    mode: mode.success ? mode.data : undefined,
    q,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Transfer title, or `fallback` when the sender did not set one. */
export function transferTitle(transfer: Pick<TransferSummary, 'title'>, fallback: string): string {
  return transfer.title?.trim() || fallback;
}

/** "3 / 10" with a limit, plain count without. */
export function downloadsText(
  transfer: Pick<TransferSummary, 'downloadCount' | 'maxDownloads'>,
): string {
  return transfer.maxDownloads === null
    ? String(transfer.downloadCount)
    : `${transfer.downloadCount} / ${transfer.maxDownloads}`;
}
