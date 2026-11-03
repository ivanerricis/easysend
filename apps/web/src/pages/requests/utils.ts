import { uploadRequestEffectiveStatusSchema, type UploadRequestSummary } from '@easysend/shared';
import { formatBytes } from '@/lib/format';

/** Reads the list filters from the URL, ignoring anything that is not valid. */
export function readRequestParams(params: URLSearchParams) {
  const status = uploadRequestEffectiveStatusSchema.safeParse(params.get('status'));
  return {
    status: status.success ? status.data : undefined,
    q: params.get('q')?.trim().slice(0, 100) ?? '',
  };
}

/** "3 / 10" with a limit, plain count without. */
export function submissionsText(
  request: Pick<UploadRequestSummary, 'submissionCount' | 'maxSubmissions'>,
): string {
  return request.maxSubmissions === null
    ? String(request.submissionCount)
    : `${request.submissionCount} / ${request.maxSubmissions}`;
}

/** "1.2 GB / 5 GB" with a limit, the received size alone without. */
export function receivedText(
  request: Pick<UploadRequestSummary, 'receivedBytes' | 'maxTotalBytes'>,
  locale: string,
): string {
  const received = formatBytes(request.receivedBytes, locale);
  return request.maxTotalBytes === null
    ? received
    : `${received} / ${formatBytes(request.maxTotalBytes, locale)}`;
}
