import type { TransferDetail } from '@easysend/shared';
import type { CreateTransferInput } from '@/lib/api/transfers';
import { hasErrorCode } from '@/lib/errors';
import { UploadCancelledError, isCancelled } from './errors';
import { SpeedTracker } from './metrics';
import type { FileUploadHandle, FileUploadOptions } from './tus-file';
import type { RunnerEvent } from './types';

export interface RunnerDeps {
  createTransfer: (body: CreateTransferInput) => Promise<TransferDetail>;
  getTransfer: (id: string) => Promise<TransferDetail>;
  finalizeTransfer: (id: string) => Promise<TransferDetail>;
  deleteTransfer: (id: string) => Promise<void>;
  createUpload: (options: FileUploadOptions) => FileUploadHandle;
  now?: () => number;
  /** Delay between polls of the draft while the server encrypts (default 1500 ms). */
  pollIntervalMs?: number;
  /** Minimum interval between progress events (default 100 ms). */
  progressIntervalMs?: number;
}

/** A file of the transfer: `file` is null when the server already has it (resumed drafts). */
export interface UploadItem {
  name: string;
  size: number;
  file: File | null;
}

export interface RunParams {
  /** Draft to continue; when missing a new draft is created with `create`. */
  transferId?: string | undefined;
  create?: CreateTransferInput | undefined;
  /** Every file of the transfer, in order; items with `file: null` are skipped. */
  files: UploadItem[];
  chunkSize: number;
}

const MAX_FINALIZE_ATTEMPTS = 20;

function isBusy(detail: TransferDetail): boolean {
  return detail.uploads.some((u) => u.status === 'in_progress' || u.status === 'processing');
}

/**
 * Sequential upload orchestration: create the draft, send every file with tus, wait until the
 * server finished encrypting, finalize. Emits `RunnerEvent`s consumed by `sessionReducer`.
 * Framework independent so it can be unit tested with fake dependencies.
 */
export class TransferRunner {
  private current: FileUploadHandle | null = null;
  private paused = false;
  private cancelled = false;
  private gate: { promise: Promise<void>; open: () => void } | null = null;
  private transferId: string | null = null;
  private readonly tracker = new SpeedTracker();
  private readonly deps: RunnerDeps;
  private readonly emit: (event: RunnerEvent) => void;

  constructor(deps: RunnerDeps, emit: (event: RunnerEvent) => void) {
    this.deps = deps;
    this.emit = emit;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (this.paused || this.cancelled) return;
    this.paused = true;
    this.current?.pause();
    this.tracker.reset();
    this.emit({ type: 'phase', phase: 'paused' });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit({ type: 'phase', phase: 'uploading' });
    this.current?.resume();
    this.gate?.open();
    this.gate = null;
  }

  /** Cancels the running upload and deletes the draft (best effort). */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.paused = false;
    this.gate?.open();
    this.gate = null;
    await this.current?.cancel();
    if (this.transferId) {
      try {
        await this.deps.deleteTransfer(this.transferId);
      } catch {
        // The cleanup job removes abandoned drafts.
      }
    }
  }

  async run(params: RunParams): Promise<void> {
    try {
      await this.execute(params);
    } catch (error) {
      if (this.cancelled || isCancelled(error)) return;
      this.emit({ type: 'error', error });
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.cancelled) {
      if (!this.gate) {
        let open!: () => void;
        const promise = new Promise<void>((resolve) => {
          open = resolve;
        });
        this.gate = { promise, open };
      }
      await this.gate.promise;
    }
  }

  private async execute(params: RunParams): Promise<void> {
    const { files, chunkSize } = params;
    this.emit({
      type: 'files',
      files: files.map((item) => ({ name: item.name, size: item.size })),
    });
    for (const [index, item] of files.entries()) {
      if (!item.file) this.emit({ type: 'fileStatus', index, status: 'uploaded' });
    }

    this.transferId = params.transferId ?? null;
    if (!this.transferId) {
      if (!params.create) throw new Error('Missing transfer options');
      this.emit({ type: 'phase', phase: 'creating' });
      const draft = await this.deps.createTransfer(params.create);
      this.transferId = draft.id;
    }
    const transferId = this.transferId;
    if (this.cancelled) {
      await this.cancel();
      return;
    }
    this.emit({ type: 'transfer', transferId });
    this.emit({ type: 'phase', phase: 'uploading' });

    const completed = files.map((item) => (item.file ? 0 : item.size));
    let lastEmit = Number.NEGATIVE_INFINITY;

    for (const [index, item] of files.entries()) {
      const file = item.file;
      if (!file) continue;
      await this.waitWhilePaused();
      if (this.cancelled) throw new UploadCancelledError();

      this.emit({ type: 'fileStatus', index, status: 'uploading' });
      const handle = this.deps.createUpload({
        file,
        transferId,
        chunkSize,
        onProgress: (sent) => {
          completed[index] = sent;
          const now = this.now();
          const speed = this.tracker.add(
            now,
            completed.reduce((a, b) => a + b, 0),
          );
          if (now - lastEmit >= (this.deps.progressIntervalMs ?? 100) || sent >= file.size) {
            lastEmit = now;
            this.emit({ type: 'progress', index, sent, speed });
          }
        },
      });
      this.current = handle;
      if (this.paused) handle.pause();
      try {
        await handle.promise;
      } catch (error) {
        if (!isCancelled(error)) this.emit({ type: 'error', error, index });
        throw error;
      } finally {
        this.current = null;
      }
      completed[index] = file.size;
      this.emit({ type: 'fileStatus', index, status: 'uploaded' });
    }

    // The server encrypts one file at a time after the last byte: wait for it.
    this.emit({ type: 'phase', phase: 'processing' });
    const interval = this.deps.pollIntervalMs ?? 1500;
    for (;;) {
      const detail = await this.deps.getTransfer(transferId);
      if (this.cancelled) return;
      if (!isBusy(detail)) break;
      await this.sleep(interval);
    }

    this.emit({ type: 'phase', phase: 'finalizing' });
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await this.deps.finalizeTransfer(transferId);
        this.emit({ type: 'done', result });
        return;
      } catch (error) {
        if (hasErrorCode(error, 'UPLOAD_INCOMPLETE') && attempt < MAX_FINALIZE_ATTEMPTS) {
          await this.sleep(interval);
          continue;
        }
        throw error;
      }
    }
  }
}
