import { expiryKeySchema, transferModeSchema } from '@easysend/shared';
import { z } from 'zod';
import { readStorage, removeStorage, writeStorage } from '@/lib/storage';

/** Browser storage key of the interrupted-upload draft. */
export const DRAFT_STORAGE_KEY = 'easysend-draft';

const draftSchema = z.object({
  transferId: z.string().min(1),
  /** Form values without the password (never stored). */
  values: z.object({
    mode: transferModeSchema,
    title: z.string(),
    message: z.string(),
    recipients: z.array(z.string()),
    expiresIn: expiryKeySchema,
    maxDownloads: z.string(),
  }),
  files: z.array(z.object({ name: z.string(), size: z.number(), lastModified: z.number() })),
  createdAt: z.number(),
});

export type DraftRecord = z.infer<typeof draftSchema>;
export type DraftFile = DraftRecord['files'][number];

export function loadDraft(): DraftRecord | null {
  const raw = readStorage(DRAFT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: DraftRecord): void {
  writeStorage(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  removeStorage(DRAFT_STORAGE_KEY);
}

export interface FileRef {
  name: string;
  size: number;
}

/**
 * Splits the files of a draft into the ones the server already holds (matched by name and size,
 * each server file used once) and the ones still to send.
 */
export function splitDraftFiles<T extends FileRef>(
  draftFiles: T[],
  serverFiles: FileRef[],
): { item: T; done: boolean }[] {
  const pool = [...serverFiles];
  return draftFiles.map((item) => {
    const at = pool.findIndex((f) => f.name === item.name && f.size === item.size);
    if (at === -1) return { item, done: false };
    pool.splice(at, 1);
    return { item, done: true };
  });
}

/** Finds, for every wanted file, a picked `File` with the same name and size (used once). */
export function matchPickedFiles(
  wanted: FileRef[],
  picked: File[],
): { matches: (File | null)[]; missing: FileRef[] } {
  const pool = [...picked];
  const matches = wanted.map((ref) => {
    const at = pool.findIndex((f) => f.name === ref.name && f.size === ref.size);
    if (at === -1) return null;
    return pool.splice(at, 1)[0] ?? null;
  });
  return { matches, missing: wanted.filter((_, index) => matches[index] === null) };
}
