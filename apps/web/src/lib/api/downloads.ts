import type { DownloadInfoResponse, UnlockRequest } from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi(['downloads.info', 'downloads.unlock'] as const);

export const USED_ENDPOINTS = api.ids;

// Binary endpoints (`downloads.file`, `downloads.zip`) are plain links: see the URL builders.
const flow = { skipAuthRedirect: true } as const;

/** Public transfer info. Without the unlock cookie a protected link answers PASSWORD_REQUIRED. */
export function getDownloadInfo(
  token: string,
  signal?: AbortSignal,
): Promise<DownloadInfoResponse> {
  return api.call('downloads.info', { ...flow, params: { token }, signal });
}

/** Unlocks a password-protected link (sets the `es_dl` cookie). */
export function unlockDownload(token: string, body: UnlockRequest): Promise<void> {
  return api.call('downloads.unlock', { ...flow, params: { token }, body });
}

/** URL of a single file download (use it as a link: the browser streams the file). */
export function downloadFileUrl(token: string, fileId: string): string {
  return `/api/downloads/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`;
}

/** URL of the zip stream; `fileIds` limits it to a subset of the files. */
export function downloadZipUrl(token: string, fileIds?: readonly string[]): string {
  const base = `/api/downloads/${encodeURIComponent(token)}/zip`;
  return fileIds && fileIds.length > 0
    ? `${base}?fileIds=${encodeURIComponent(fileIds.join(','))}`
    : base;
}
