import type {
  CreateSubmissionRequest,
  CreateSubmissionResponse,
  FinalizeSubmissionResponse,
  RequestInfoResponse,
  SubmissionStatusResponse,
  UnlockRequest,
} from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi([
  'submissions.info',
  'submissions.unlock',
  'submissions.create',
  'submissions.get',
  'submissions.finalize',
  'submissions.cancel',
] as const);

export const USED_ENDPOINTS = api.ids;

const flow = { skipAuthRedirect: true } as const;

/** Header that authorizes status, finalize, cancel and every tus request of one submission. */
export const SUBMISSION_TOKEN_HEADER = 'X-Submission-Token';

function authorized(submissionToken: string) {
  return { ...flow, headers: { [SUBMISSION_TOKEN_HEADER]: submissionToken } };
}

/** Public view of an upload request; a protected one answers `locked: true` until unlocked. */
export function getRequestInfo(token: string, signal?: AbortSignal): Promise<RequestInfoResponse> {
  return api.call('submissions.info', { ...flow, params: { token }, signal });
}

/** Unlocks a password-protected request (sets the `es_ru` cookie). */
export function unlockRequest(token: string, body: UnlockRequest): Promise<void> {
  return api.call('submissions.unlock', { ...flow, params: { token }, body });
}

/** Starts a submission: creates the draft transfer and returns the submission token. */
export function createSubmission(
  token: string,
  body: CreateSubmissionRequest,
): Promise<CreateSubmissionResponse> {
  return api.call('submissions.create', { ...flow, params: { token }, body });
}

export function getSubmission(
  token: string,
  id: string,
  submissionToken: string,
): Promise<SubmissionStatusResponse> {
  return api.call('submissions.get', {
    ...authorized(submissionToken),
    params: { token, id },
  });
}

export function finalizeSubmission(
  token: string,
  id: string,
  submissionToken: string,
): Promise<FinalizeSubmissionResponse> {
  return api.call('submissions.finalize', {
    ...authorized(submissionToken),
    params: { token, id },
  });
}

export function cancelSubmission(
  token: string,
  id: string,
  submissionToken: string,
): Promise<void> {
  return api.call('submissions.cancel', {
    ...authorized(submissionToken),
    params: { token, id },
  });
}
