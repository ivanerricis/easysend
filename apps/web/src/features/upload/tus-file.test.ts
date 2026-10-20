import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getCsrfToken, setCsrfToken } from '@/lib/api/client';
import { UploadCancelledError } from './errors';

type Options = Record<string, (...args: never[]) => unknown> & {
  endpoint: string;
  chunkSize: number;
  retryDelays: number[];
  metadata: Record<string, string>;
  storeFingerprintForResuming: boolean;
  removeFingerprintOnSuccess: boolean;
  fingerprint: (file: File) => Promise<string>;
  onBeforeRequest: (request: { setHeader: (name: string, value: string) => void }) => Promise<void>;
  onShouldRetry: (error: unknown, attempt: number) => boolean;
  onProgress: (sent: number, total: number) => void;
  onSuccess: () => void;
  onError: (error: unknown) => void;
};

const tus = vi.hoisted(() => {
  const instances: {
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
  }[] = [];
  const state = { previous: [] as unknown[] };
  class Upload {
    options: unknown;
    start = vi.fn();
    abort = vi.fn(() => Promise.resolve());
    resumeFromPreviousUpload = vi.fn();
    findPreviousUploads = vi.fn(() => Promise.resolve(state.previous));
    constructor(_file: File, options: unknown) {
      this.options = options;
      instances.push(this);
    }
  }
  return { instances, state, Upload };
});
vi.mock('tus-js-client', () => ({ Upload: tus.Upload }));

import { createFileUpload } from './tus-file';

function fakeResponse(status: number, body: unknown) {
  return {
    getStatus: () => status,
    getBody: () => JSON.stringify(body),
    getHeader: () => undefined,
  };
}

function tusError(status: number, code: string) {
  return {
    originalResponse: fakeResponse(status, { error: { code, message: code, requestId: 'r1' } }),
  };
}

const file = new File(['hello'], 'hello.txt', { type: 'text/plain', lastModified: 123 });

function start(onProgress = vi.fn()) {
  const handle = createFileUpload({ file, transferId: 'tr1', chunkSize: 5_000_000, onProgress });
  const instance = tus.instances[tus.instances.length - 1]!;
  return { handle, instance, options: instance.options as Options };
}

beforeEach(() => {
  tus.instances.length = 0;
  tus.state.previous = [];
  setCsrfToken('csrf-1');
});

describe('createFileUpload', () => {
  it('configures tus for the draft transfer', async () => {
    const { options, instance } = start();
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalled());
    expect(options.endpoint).toBe('/api/uploads');
    expect(options.chunkSize).toBe(5_000_000);
    expect(options.metadata).toEqual({
      transferId: 'tr1',
      filename: 'hello.txt',
      filetype: 'text/plain',
    });
    expect(options.retryDelays).toEqual([0, 1000, 3000, 5000, 10000, 20000]);
    expect(options.storeFingerprintForResuming).toBe(true);
    expect(options.removeFingerprintOnSuccess).toBe(true);
  });

  it('binds the fingerprint to the transfer', async () => {
    const { options } = start();
    const a = await options.fingerprint(file);
    expect(a).toContain('tr1');
    expect(a).toContain('hello.txt');
    const other = createFileUpload({ file, transferId: 'tr2', chunkSize: 1, onProgress: vi.fn() });
    void other;
    const b = await (tus.instances[tus.instances.length - 1]!.options as Options).fingerprint(file);
    expect(b).not.toBe(a);
  });

  it('sends the current CSRF token on every request', async () => {
    const { options } = start();
    const setHeader = vi.fn();
    await options.onBeforeRequest({ setHeader });
    expect(setHeader).toHaveBeenCalledWith('X-CSRF-Token', 'csrf-1');
  });

  it('retries once on CSRF_INVALID after dropping the token', () => {
    const { options } = start();
    expect(options.onShouldRetry(tusError(403, 'CSRF_INVALID'), 0)).toBe(true);
    expect(getCsrfToken()).toBeNull();
    expect(options.onShouldRetry(tusError(403, 'CSRF_INVALID'), 1)).toBe(false);
  });

  it('does not retry final client errors but retries server errors and offset conflicts', () => {
    const { options } = start();
    expect(options.onShouldRetry(tusError(413, 'QUOTA_EXCEEDED'), 0)).toBe(false);
    expect(options.onShouldRetry(tusError(404, 'TRANSFER_NOT_FOUND'), 0)).toBe(false);
    expect(options.onShouldRetry(tusError(409, 'CONFLICT'), 0)).toBe(true);
    expect(options.onShouldRetry(tusError(503, 'SERVICE_UNAVAILABLE'), 0)).toBe(true);
    expect(options.onShouldRetry({ originalResponse: null }, 0)).toBe(true);
  });

  it('reports progress and resolves on success', async () => {
    const onProgress = vi.fn();
    const { handle, options } = start(onProgress);
    options.onProgress(2, 5);
    options.onSuccess();
    await expect(handle.promise).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith(2, 5);
  });

  it.each([
    [413, 'QUOTA_EXCEEDED'],
    [507, 'INSUFFICIENT_DISK_SPACE'],
    [409, 'TRANSFER_NOT_UPLOADABLE'],
    [400, 'INVALID_UPLOAD_METADATA'],
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHENTICATED'],
  ] as const)('maps %i %s to an ApiError', async (status, code) => {
    const { handle, options } = start();
    options.onError(tusError(status, code));
    const error = await handle.promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).status).toBe(status);
  });

  it('maps a request without response to SERVICE_UNAVAILABLE', async () => {
    const { handle, options } = start();
    options.onError(new Error('network'));
    await expect(handle.promise).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 0 });
  });

  it('resumes from a previous upload of the same draft', async () => {
    tus.state.previous = [{ urlStorageKey: 'k', uploadUrl: '/api/uploads/u1' }];
    const { instance } = start();
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalled());
    expect(instance.resumeFromPreviousUpload).toHaveBeenCalledWith(tus.state.previous[0]);
  });

  it('pauses without terminating and resumes with start', async () => {
    const { handle, instance } = start();
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalledTimes(1));
    handle.pause();
    expect(instance.abort).toHaveBeenCalledWith(false);
    handle.resume();
    expect(instance.start).toHaveBeenCalledTimes(2);
  });

  it('cancel terminates the upload and rejects', async () => {
    const { handle, instance } = start();
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalled());
    await handle.cancel();
    expect(instance.abort).toHaveBeenCalledWith(true);
    await expect(handle.promise).rejects.toBeInstanceOf(UploadCancelledError);
  });
});
