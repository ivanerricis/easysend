import type { TransferDetail } from '@easysend/shared';

export type UploadPhase =
  'idle' | 'creating' | 'uploading' | 'paused' | 'processing' | 'finalizing' | 'done' | 'error';

export type FileStatus = 'queued' | 'uploading' | 'uploaded' | 'ready' | 'error';

export interface UploadFileState {
  /** Stable key within the session (index + name + size). */
  key: string;
  name: string;
  size: number;
  sent: number;
  status: FileStatus;
}

export interface UploadSessionState {
  phase: UploadPhase;
  transferId: string | null;
  files: UploadFileState[];
  /** Bytes per second, moving average (0 while unknown). */
  speed: number;
  error: unknown;
  /** Phase the session was in when the error happened (to decide what a retry does). */
  failedPhase: UploadPhase | null;
  result: TransferDetail | null;
}

export type RunnerEvent =
  | { type: 'phase'; phase: UploadPhase }
  | { type: 'transfer'; transferId: string }
  | { type: 'files'; files: { name: string; size: number }[] }
  | { type: 'fileStatus'; index: number; status: FileStatus }
  | { type: 'progress'; index: number; sent: number; speed: number }
  | { type: 'done'; result: TransferDetail }
  | { type: 'error'; error: unknown; index?: number }
  | { type: 'reset' };

export const initialSessionState: UploadSessionState = {
  phase: 'idle',
  transferId: null,
  files: [],
  speed: 0,
  error: null,
  failedPhase: null,
  result: null,
};

export function totalBytes(state: Pick<UploadSessionState, 'files'>): number {
  return state.files.reduce((sum, file) => sum + file.size, 0);
}

export function sentBytes(state: Pick<UploadSessionState, 'files'>): number {
  return state.files.reduce(
    (sum, file) => sum + (file.status === 'queued' ? 0 : Math.min(file.sent, file.size)),
    0,
  );
}

/** Reducer of the session state machine (pure, driven by runner events). */
export function sessionReducer(state: UploadSessionState, event: RunnerEvent): UploadSessionState {
  switch (event.type) {
    case 'reset':
      return initialSessionState;
    case 'phase':
      return {
        ...state,
        phase: event.phase,
        speed: event.phase === 'uploading' ? state.speed : 0,
        error: event.phase === 'error' ? state.error : null,
      };
    case 'transfer':
      return { ...state, transferId: event.transferId };
    case 'files':
      return {
        ...state,
        files: event.files.map((file, index) => ({
          key: `${index}-${file.name}-${file.size}`,
          name: file.name,
          size: file.size,
          sent: 0,
          status: 'queued',
        })),
      };
    case 'fileStatus':
      return {
        ...state,
        files: state.files.map((file, index) =>
          index === event.index
            ? {
                ...file,
                status: event.status,
                sent:
                  event.status === 'uploaded' || event.status === 'ready' ? file.size : file.sent,
              }
            : file,
        ),
      };
    case 'progress':
      return {
        ...state,
        speed: event.speed,
        files: state.files.map((file, index) =>
          index === event.index ? { ...file, sent: event.sent } : file,
        ),
      };
    case 'done':
      return {
        ...state,
        phase: 'done',
        speed: 0,
        result: event.result,
        error: null,
        files: state.files.map((file) => ({ ...file, status: 'ready', sent: file.size })),
      };
    case 'error':
      return {
        ...state,
        phase: 'error',
        speed: 0,
        error: event.error,
        failedPhase: state.phase === 'error' ? state.failedPhase : state.phase,
        files:
          event.index === undefined
            ? state.files
            : state.files.map((file, index) =>
                index === event.index ? { ...file, status: 'error' } : file,
              ),
      };
  }
}
