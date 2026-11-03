import { z } from 'zod';
import type { CreateSubmissionRequest, CreateSubmissionResponse } from '@easysend/shared';
import {
  SUBMISSION_TOKEN_HEADER,
  cancelSubmission,
  createSubmission,
  finalizeSubmission,
  getSubmission,
} from '@/lib/api/submissions';
import { readStorage, removeStorage, writeStorage } from '@/lib/storage';
import type { RunnerDeps } from './runner';
import { createFileUpload } from './tus-file';

/** Chunk size of public uploads: `GET /api/config` needs a login, so the default is used. */
export const PUBLIC_CHUNK_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Binds the runner to one upload request: the same sequencing as a normal transfer (draft, tus
 * one file at a time, wait for encryption, finalize) with the submission endpoints, and the
 * `X-Submission-Token` header on status, finalize, cancel and every tus request.
 * `tokenRef` holds the submission token: it is set when the draft is created, or by the page when
 * a stored draft is resumed.
 */
export function createSubmissionDeps(requestToken: string): {
  deps: RunnerDeps<CreateSubmissionRequest>;
  tokenRef: { current: CreateSubmissionResponse | null };
} {
  const tokenRef: { current: CreateSubmissionResponse | null } = { current: null };
  const current = () => {
    if (!tokenRef.current) throw new Error('Missing submission token');
    return tokenRef.current;
  };
  const deps: RunnerDeps<CreateSubmissionRequest> = {
    createTransfer: async (body) => {
      const created = await createSubmission(requestToken, body);
      tokenRef.current = created;
      return { id: created.transferId };
    },
    getTransfer: (id) => getSubmission(requestToken, id, current().submissionToken),
    finalizeTransfer: (id) => finalizeSubmission(requestToken, id, current().submissionToken),
    deleteTransfer: (id) => cancelSubmission(requestToken, id, current().submissionToken),
    createUpload: (options) =>
      createFileUpload({
        ...options,
        headers: { [SUBMISSION_TOKEN_HEADER]: current().submissionToken },
      }),
  };
  return { deps, tokenRef };
}

// ---- Interrupted submission, kept per request link ----------------------------
const submissionDraftSchema = z.object({
  transferId: z.string().min(1),
  submissionToken: z.string().min(1),
  /** Unix seconds; an expired token can no longer be used. */
  submissionTokenExpiresAt: z.number(),
  files: z.array(z.object({ name: z.string(), size: z.number(), lastModified: z.number() })),
  createdAt: z.number(),
});

export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;

export const submissionDraftKey = (requestToken: string) => `easysend-submission-${requestToken}`;

/** The stored draft of a request link, or null when missing, invalid or past its token expiry. */
export function loadSubmissionDraft(
  requestToken: string,
  nowMs = Date.now(),
): SubmissionDraft | null {
  const raw = readStorage(submissionDraftKey(requestToken));
  if (!raw) return null;
  try {
    const parsed = submissionDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.submissionTokenExpiresAt * 1000 <= nowMs) {
      removeStorage(submissionDraftKey(requestToken));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveSubmissionDraft(requestToken: string, draft: SubmissionDraft): void {
  writeStorage(submissionDraftKey(requestToken), JSON.stringify(draft));
}

export function clearSubmissionDraft(requestToken: string): void {
  removeStorage(submissionDraftKey(requestToken));
}
