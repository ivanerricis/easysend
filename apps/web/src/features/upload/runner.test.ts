import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { makeTransferDetail } from './fixtures';
import { TransferRunner, type RunnerDeps } from './runner';
import type { FileUploadHandle, FileUploadOptions } from './tus-file';
import {
  initialSessionState,
  sentBytes,
  sessionReducer,
  totalBytes,
  type RunnerEvent,
} from './types';

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

interface Harness {
  deps: RunnerDeps;
  events: RunnerEvent[];
  uploads: { options: FileUploadOptions; handle: FileUploadHandle; finish: () => void }[];
  runner: TransferRunner;
}

function setup(overrides: Partial<RunnerDeps> = {}, autoFinish = true): Harness {
  const events: RunnerEvent[] = [];
  const uploads: Harness['uploads'] = [];
  const deps: RunnerDeps = {
    createTransfer: vi.fn(() =>
      Promise.resolve(makeTransferDetail({ id: 'draft1', status: 'uploading' })),
    ),
    getTransfer: vi.fn(() => Promise.resolve(makeTransferDetail({ status: 'uploading' }))),
    finalizeTransfer: vi.fn(() => Promise.resolve(makeTransferDetail({ id: 'draft1' }))),
    deleteTransfer: vi.fn(() => Promise.resolve()),
    createUpload: vi.fn((options: FileUploadOptions) => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      const handle: FileUploadHandle = {
        promise,
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(() => Promise.resolve()),
      };
      const finish = () => {
        options.onProgress(options.file.size, options.file.size);
        resolve();
      };
      uploads.push({ options, handle, finish });
      if (autoFinish) queueMicrotask(finish);
      return handle;
    }),
    pollIntervalMs: 0,
    progressIntervalMs: 0,
    ...overrides,
  };
  const runner = new TransferRunner(deps, (event) => events.push(event));
  return { deps, events, uploads, runner };
}

const create = { mode: 'link', expiresIn: '1w' } as const;

describe('TransferRunner', () => {
  it('creates the draft, uploads the files in order, waits for encryption and finalizes', async () => {
    const getTransfer = vi
      .fn()
      .mockResolvedValueOnce(
        makeTransferDetail({
          status: 'uploading',
          uploads: [
            {
              id: 'u1',
              fileName: 'a',
              totalSize: 1,
              status: 'processing',
              expiresAt: 4_100_000_000,
            },
          ],
        }),
      )
      .mockResolvedValue(makeTransferDetail({ status: 'uploading' }));
    const h = setup({ getTransfer });
    await h.runner.run({
      create,
      chunkSize: 1000,
      files: [
        { name: 'a.txt', size: 3, file: makeFile('a.txt', 3) },
        { name: 'b.txt', size: 5, file: makeFile('b.txt', 5) },
      ],
    });

    expect(h.deps.createTransfer).toHaveBeenCalledWith(create);
    expect(h.uploads.map((u) => u.options.file.name)).toEqual(['a.txt', 'b.txt']);
    expect(h.uploads.every((u) => u.options.transferId === 'draft1')).toBe(true);
    expect(h.uploads[0]?.options.chunkSize).toBe(1000);
    expect(getTransfer).toHaveBeenCalledTimes(2); // one still processing, then clear
    expect(h.deps.finalizeTransfer).toHaveBeenCalledWith('draft1');

    const phases = h.events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []));
    expect(phases).toEqual(['creating', 'uploading', 'processing', 'finalizing']);
    expect(h.events.at(-1)?.type).toBe('done');
  });

  it('reduces to the final state', async () => {
    const h = setup();
    await h.runner.run({
      create,
      chunkSize: 1,
      files: [{ name: 'a.txt', size: 4, file: makeFile('a.txt', 4) }],
    });
    const state = h.events.reduce(sessionReducer, initialSessionState);
    expect(state.phase).toBe('done');
    expect(state.transferId).toBe('draft1');
    expect(state.files[0]?.status).toBe('ready');
    expect(state.result?.id).toBe('draft1');
  });

  it('skips files the server already has when continuing a draft', async () => {
    const h = setup();
    await h.runner.run({
      transferId: 'draft9',
      chunkSize: 1,
      files: [
        { name: 'done.txt', size: 4, file: null },
        { name: 'todo.txt', size: 2, file: makeFile('todo.txt', 2) },
      ],
    });
    expect(h.deps.createTransfer).not.toHaveBeenCalled();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]?.options.transferId).toBe('draft9');
    const state = h.events.reduce(sessionReducer, initialSessionState);
    expect(state.files.map((f) => f.status)).toEqual(['ready', 'ready']);
  });

  it('stops at the first failing file and reports the error', async () => {
    const error = new ApiError({ status: 413, code: 'QUOTA_EXCEEDED', message: 'no space' });
    const h = setup(
      {
        createUpload: vi.fn(() => ({
          promise: Promise.reject(error),
          pause: vi.fn(),
          resume: vi.fn(),
          cancel: vi.fn(() => Promise.resolve()),
        })),
      },
      false,
    );
    await h.runner.run({
      create,
      chunkSize: 1,
      files: [
        { name: 'a.txt', size: 1, file: makeFile('a.txt', 1) },
        { name: 'b.txt', size: 1, file: makeFile('b.txt', 1) },
      ],
    });
    expect(h.deps.createUpload).toHaveBeenCalledTimes(1);
    const state = h.events.reduce(sessionReducer, initialSessionState);
    expect(state.phase).toBe('error');
    expect(state.failedPhase).toBe('uploading');
    expect(state.files[0]?.status).toBe('error');
    expect((state.error as ApiError).code).toBe('QUOTA_EXCEEDED');
    expect(h.deps.finalizeTransfer).not.toHaveBeenCalled();
  });

  it('keeps polling finalize while UPLOAD_INCOMPLETE', async () => {
    const incomplete = new ApiError({ status: 409, code: 'UPLOAD_INCOMPLETE', message: 'wait' });
    const finalizeTransfer = vi
      .fn()
      .mockRejectedValueOnce(incomplete)
      .mockRejectedValueOnce(incomplete)
      .mockResolvedValue(makeTransferDetail());
    const h = setup({ finalizeTransfer });
    await h.runner.run({
      create,
      chunkSize: 1,
      files: [{ name: 'a.txt', size: 1, file: makeFile('a.txt', 1) }],
    });
    expect(finalizeTransfer).toHaveBeenCalledTimes(3);
    expect(h.events.at(-1)?.type).toBe('done');
  });

  it('reports a failing creation as an error without a transfer', async () => {
    const limited = new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'slow down' });
    const h = setup({ createTransfer: vi.fn(() => Promise.reject(limited)) });
    await h.runner.run({
      create,
      chunkSize: 1,
      files: [{ name: 'a.txt', size: 1, file: makeFile('a.txt', 1) }],
    });
    const state = h.events.reduce(sessionReducer, initialSessionState);
    expect(state.phase).toBe('error');
    expect(state.failedPhase).toBe('creating');
    expect(state.transferId).toBeNull();
  });

  it('pauses between and during files and resumes', async () => {
    const h = setup({}, false);
    const run = h.runner.run({
      create,
      chunkSize: 1,
      files: [
        { name: 'a.txt', size: 2, file: makeFile('a.txt', 2) },
        { name: 'b.txt', size: 2, file: makeFile('b.txt', 2) },
      ],
    });
    await vi.waitFor(() => expect(h.uploads).toHaveLength(1));
    h.runner.pause();
    expect(h.uploads[0]?.handle.pause).toHaveBeenCalled();
    h.uploads[0]?.finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.uploads).toHaveLength(1); // the next file waits while paused
    h.runner.resume();
    await vi.waitFor(() => expect(h.uploads).toHaveLength(2));
    h.uploads[1]?.finish();
    await run;
    const phases = h.events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []));
    expect(phases).toContain('paused');
    expect(h.events.at(-1)?.type).toBe('done');
  });

  it('cancel aborts the current upload and deletes the draft', async () => {
    const h = setup({}, false);
    const run = h.runner.run({
      create,
      chunkSize: 1,
      files: [{ name: 'a.txt', size: 2, file: makeFile('a.txt', 2) }],
    });
    await vi.waitFor(() => expect(h.uploads).toHaveLength(1));
    const cancelHandle = h.uploads[0]?.handle.cancel;
    await h.runner.cancel();
    expect(cancelHandle).toHaveBeenCalled();
    expect(h.deps.deleteTransfer).toHaveBeenCalledWith('draft1');
    h.uploads[0]?.finish(); // let the pending run settle
    await run;
    expect(h.events.some((e) => e.type === 'error')).toBe(false);
  });
});

describe('sessionReducer helpers', () => {
  it('sums sent and total bytes', () => {
    const events: RunnerEvent[] = [
      {
        type: 'files',
        files: [
          { name: 'a', size: 10 },
          { name: 'b', size: 30 },
        ],
      },
      { type: 'fileStatus', index: 0, status: 'uploaded' },
      { type: 'fileStatus', index: 1, status: 'uploading' },
      { type: 'progress', index: 1, sent: 15, speed: 5 },
    ];
    const state = events.reduce(sessionReducer, initialSessionState);
    expect(totalBytes(state)).toBe(40);
    expect(sentBytes(state)).toBe(25);
    expect(state.speed).toBe(5);
  });
});
