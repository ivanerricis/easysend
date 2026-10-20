import { Upload, type DetailedError } from 'tus-js-client';
import { ensureCsrfToken, setCsrfToken } from '@/lib/api/client';
import { UploadCancelledError, isRetryableStatus, mapTusError, parseTusResponse } from './errors';

export const TUS_ENDPOINT = '/api/uploads';
export const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000];

export interface FileUploadOptions {
  file: File;
  transferId: string;
  chunkSize: number;
  onProgress: (bytesSent: number, bytesTotal: number) => void;
}

/** Control surface of one file upload. `promise` settles when the file is fully received. */
export interface FileUploadHandle {
  promise: Promise<void>;
  /** Stops sending; the server keeps the offset so `resume` continues from it. */
  pause: () => void;
  resume: () => void;
  /** Aborts and asks the server to delete the partial upload (tus termination). */
  cancel: () => Promise<void>;
}

/** Fingerprint bound to the draft: a file resumes only into the transfer it was started for. */
export function uploadFingerprint(file: File, transferId: string): string {
  return ['easysend', transferId, file.name, file.type, file.size, file.lastModified].join('-');
}

/** Starts a resumable tus upload of `file` into the draft transfer `transferId`. */
export function createFileUpload(options: FileUploadOptions): FileUploadHandle {
  const { file, transferId, chunkSize, onProgress } = options;
  let cancelled = false;
  let settled = false;
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const upload = new Upload(file, {
    endpoint: TUS_ENDPOINT,
    chunkSize,
    retryDelays: RETRY_DELAYS,
    metadata: { transferId, filename: file.name, filetype: file.type },
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    fingerprint: (f) => Promise.resolve(uploadFingerprint(f, transferId)),
    onBeforeRequest: async (request) => {
      request.setHeader('X-CSRF-Token', await ensureCsrfToken());
    },
    onShouldRetry: (error: DetailedError, retryAttempt) => {
      const response = error.originalResponse;
      const status = response ? response.getStatus() : 0;
      if (status === 403 && response && parseTusResponse(response).code === 'CSRF_INVALID') {
        // The token is stale: drop it so the next request fetches a fresh one, and retry once.
        setCsrfToken(null);
        return retryAttempt < 1;
      }
      return isRetryableStatus(status);
    },
    onProgress: (sent, total) => onProgress(sent, total),
    onSuccess: () => {
      settled = true;
      resolvePromise();
    },
    onError: (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(cancelled ? new UploadCancelledError() : mapTusError(error));
    },
  });

  void (async () => {
    try {
      const previous = await upload.findPreviousUploads();
      const latest = previous[0];
      if (latest) upload.resumeFromPreviousUpload(latest);
    } catch {
      // Storage unavailable: start from scratch.
    }
    if (!cancelled) upload.start();
  })();

  return {
    promise,
    pause: () => {
      void upload.abort(false);
    },
    resume: () => {
      if (!cancelled) upload.start();
    },
    cancel: async () => {
      cancelled = true;
      try {
        await upload.abort(true);
      } catch {
        // Termination is best effort: the cleanup job removes what is left.
      }
      if (!settled) {
        settled = true;
        rejectPromise(new UploadCancelledError());
      }
    },
  };
}
