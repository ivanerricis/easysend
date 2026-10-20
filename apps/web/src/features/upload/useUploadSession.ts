import { useCallback, useEffect, useReducer, useRef } from 'react';
import { deleteTransfer, finalizeTransfer, getTransfer, createTransfer } from '@/lib/api/transfers';
import { TransferRunner, type RunParams, type RunnerDeps, type UploadItem } from './runner';
import { createFileUpload } from './tus-file';
import { initialSessionState, sessionReducer, type RunnerEvent } from './types';

const defaultDeps: RunnerDeps = {
  createTransfer,
  getTransfer,
  finalizeTransfer,
  deleteTransfer,
  createUpload: createFileUpload,
};

const ACTIVE_PHASES = new Set(['creating', 'uploading', 'paused', 'processing', 'finalizing']);

interface Options {
  /** Receives every runner event (the page persists the draft on `transfer`). */
  onEvent?: (event: RunnerEvent) => void;
  /** Replaces the real API / tus (tests). */
  deps?: Partial<RunnerDeps>;
}

/**
 * Upload session: state machine idle → creating → uploading ⇄ paused → processing →
 * finalizing → done / error, driven by a `TransferRunner`.
 */
export function useUploadSession(options: Options = {}) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const stateRef = useRef(state);
  const runnerRef = useRef<TransferRunner | null>(null);
  const paramsRef = useRef<RunParams | null>(null);
  const optionsRef = useRef(options);

  // Refs follow the latest render; they are only read from callbacks, never during render.
  useEffect(() => {
    stateRef.current = state;
    optionsRef.current = options;
  });

  const launch = useCallback((params: RunParams) => {
    paramsRef.current = params;
    const runner = new TransferRunner(
      { ...defaultDeps, ...optionsRef.current.deps },
      (event: RunnerEvent) => {
        if (runnerRef.current !== runner) return;
        dispatch(event);
        optionsRef.current.onEvent?.(event);
      },
    );
    runnerRef.current = runner;
    void runner.run(params);
  }, []);

  const start = useCallback((params: RunParams) => launch(params), [launch]);

  const pause = useCallback(() => runnerRef.current?.pause(), []);
  const resume = useCallback(() => runnerRef.current?.resume(), []);

  const reset = useCallback(() => {
    runnerRef.current = null;
    paramsRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const cancel = useCallback(async () => {
    const runner = runnerRef.current;
    runnerRef.current = null;
    paramsRef.current = null;
    dispatch({ type: 'reset' });
    await runner?.cancel();
  }, []);

  /** Continues after an error: files already received are skipped, the draft is reused. */
  const retry = useCallback(() => {
    const params = paramsRef.current;
    if (!params) return;
    const current = stateRef.current;
    const items: UploadItem[] = params.files.map((item, index) => {
      const status = current.files[index]?.status;
      return status === 'uploaded' || status === 'ready' ? { ...item, file: null } : item;
    });
    launch({ ...params, transferId: current.transferId ?? params.transferId, files: items });
  }, [launch]);

  // Warn before closing the tab while a transfer is in progress.
  const active = ACTIVE_PHASES.has(state.phase);
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  return { state, start, pause, resume, cancel, retry, reset };
}
