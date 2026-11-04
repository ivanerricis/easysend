import { describe, expect, it } from 'vitest';
import {
  DRAFT_STORAGE_KEY,
  clearDraft,
  loadDraft,
  matchPickedFiles,
  saveDraft,
  splitDraftFiles,
  type DraftRecord,
} from './draft';

const draft: DraftRecord = {
  transferId: 't1',
  values: {
    mode: 'email',
    title: 'Hi',
    message: '',
    recipients: ['a@example.com'],
    expiresIn: '1w',
    maxDownloads: '',
  },
  files: [{ name: 'a.txt', size: 3, lastModified: 1, path: '' }],
  createdAt: 1,
};

describe('draft storage', () => {
  it('round-trips and clears', () => {
    saveDraft(draft);
    expect(loadDraft()).toEqual(draft);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('ignores corrupt data', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '{not json');
    expect(loadDraft()).toBeNull();
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ transferId: 1 }));
    expect(loadDraft()).toBeNull();
  });

  it('never stores a password field', () => {
    saveDraft(draft);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toContain('password');
  });
});

describe('draft files without a path', () => {
  it('reads an old draft as root files', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, files: [{ name: 'a.txt', size: 3, lastModified: 1 }] }),
    );
    expect(loadDraft()?.files).toEqual([{ name: 'a.txt', size: 3, lastModified: 1, path: '' }]);
    clearDraft();
  });
});

describe('splitDraftFiles', () => {
  it('uses each server file once', () => {
    const rows = splitDraftFiles(
      [
        { name: 'a', size: 1 },
        { name: 'a', size: 1 },
        { name: 'b', size: 2 },
      ],
      [{ name: 'a', size: 1 }],
    );
    expect(rows.map((r) => r.done)).toEqual([true, false, false]);
  });

  it('tells apart the same name in different folders', () => {
    const rows = splitDraftFiles(
      [
        { name: 'a.txt', size: 1, path: 'x' },
        { name: 'a.txt', size: 1, path: 'y' },
      ],
      [{ name: 'a.txt', size: 1, path: 'y' }],
    );
    expect(rows.map((r) => r.done)).toEqual([false, true]);
  });
});

describe('matchPickedFiles', () => {
  it('matches by path, name and size and lists what is missing', () => {
    const a = { file: new File(['abc'], 'a.txt'), path: '' };
    const other = { file: new File(['xx'], 'a.txt'), path: '' };
    const { matches, missing } = matchPickedFiles(
      [
        { name: 'a.txt', size: 3 },
        { name: 'b.txt', size: 1 },
      ],
      [other, a],
    );
    expect(matches[0]).toBe(a);
    expect(matches[1]).toBeNull();
    expect(missing).toEqual([{ name: 'b.txt', size: 1 }]);
  });

  it('does not match a file picked from another folder', () => {
    const elsewhere = { file: new File(['abc'], 'a.txt'), path: 'other' };
    const inside = { file: new File(['abc'], 'a.txt'), path: 'photos/2030' };
    const { matches } = matchPickedFiles(
      [{ name: 'a.txt', size: 3, path: 'photos/2030' }],
      [elsewhere, inside],
    );
    expect(matches[0]).toBe(inside);
  });
});
