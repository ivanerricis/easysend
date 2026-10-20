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
  files: [{ name: 'a.txt', size: 3, lastModified: 1 }],
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
});

describe('matchPickedFiles', () => {
  it('matches by name and size and lists what is missing', () => {
    const a = new File(['abc'], 'a.txt');
    const other = new File(['xx'], 'a.txt');
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
});
