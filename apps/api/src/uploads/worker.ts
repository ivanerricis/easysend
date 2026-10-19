import type { AppContext } from '../context.js';

/**
 * Background queue that hashes and encrypts finished tus uploads (phase 3, WP2). One job at a
 * time keeps CPU and disk use predictable on a small machine.
 */
export interface UploadWorker {
  /** Queues an upload (status `processing`). Returns immediately. */
  enqueue(uploadId: string): void;
  /** Resolves when the queue is empty and nothing is running (tests, graceful shutdown). */
  idle(): Promise<void>;
  /** At startup: removes leftover `*.part` files and queues the uploads still `processing`. */
  recover(): Promise<void>;
  /** Stops taking new jobs. */
  stop(): void;
}

/** Placeholder: accepts calls and does nothing, WP2 replaces it with the real queue. */
export function createUploadWorker(_ctx: AppContext): UploadWorker {
  return {
    enqueue: () => undefined,
    idle: () => Promise.resolve(),
    recover: () => Promise.resolve(),
    stop: () => undefined,
  };
}
