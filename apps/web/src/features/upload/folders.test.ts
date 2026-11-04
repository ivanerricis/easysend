import { describe, expect, it } from 'vitest';
import {
  collectEntries,
  displayPath,
  folderOf,
  isSystemFile,
  pickedFromInput,
  pickedKey,
  startCollectDrop,
  topFolder,
  type DirectoryEntryLike,
  type EntryLike,
  type FileEntryLike,
} from './folders';

function fileEntry(fullPath: string, content = 'x'): FileEntryLike {
  const name = fullPath.split('/').pop()!;
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (success) => success(new File([content], name)),
  };
}

/** A directory whose `readEntries` hands out `batchSize` entries per call, then an empty batch. */
function dirEntry(fullPath: string, children: EntryLike[], batchSize = 100): DirectoryEntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').pop()!,
    fullPath,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (success) => {
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          success(batch);
        },
      };
    },
  };
}

describe('path helpers', () => {
  it('splits the folder from the file name', () => {
    expect(folderOf('/photos/2030/a.jpg')).toBe('photos/2030');
    expect(folderOf('a.jpg')).toBe('');
    expect(folderOf('/a.jpg')).toBe('');
  });

  it('knows the first segment and the display path', () => {
    expect(topFolder('photos/2030')).toBe('photos');
    expect(topFolder('')).toBe('');
    expect(displayPath('a/b', 'c.txt')).toBe('a/b/c.txt');
    expect(displayPath('', 'c.txt')).toBe('c.txt');
  });

  it('flags system files in any case', () => {
    expect(isSystemFile('.DS_Store')).toBe(true);
    expect(isSystemFile('thumbs.db')).toBe(true);
    expect(isSystemFile('Desktop.ini')).toBe(true);
    expect(isSystemFile('notes.txt')).toBe(false);
  });

  it('identifies a file by path, name and size', () => {
    const file = new File(['abc'], 'a.txt');
    expect(pickedKey({ file, path: 'x' })).not.toBe(pickedKey({ file, path: 'y' }));
    expect(pickedKey({ file, path: 'x' })).toBe(pickedKey({ file, path: 'x' }));
  });
});

describe('pickedFromInput', () => {
  it('reads the folder from webkitRelativePath and skips system files', () => {
    const inFolder = new File(['a'], 'a.jpg');
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: 'photos/2030/a.jpg' });
    const junk = new File([''], '.DS_Store');
    Object.defineProperty(junk, 'webkitRelativePath', { value: 'photos/.DS_Store' });
    const loose = new File(['b'], 'b.txt');
    expect(pickedFromInput([inFolder, junk, loose], true)).toEqual([
      { file: inFolder, path: 'photos/2030' },
      { file: loose, path: '' },
    ]);
  });

  it('ignores the relative path of a plain file input', () => {
    const file = new File(['a'], 'a.jpg');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'x/a.jpg' });
    expect(pickedFromInput([file], false)).toEqual([{ file, path: '' }]);
  });
});

describe('collectEntries', () => {
  it('walks nested folders and keeps loose files at the root', async () => {
    const entries = [
      fileEntry('/loose.txt'),
      dirEntry('/photos', [
        fileEntry('/photos/a.jpg'),
        dirEntry('/photos/2030', [fileEntry('/photos/2030/b.jpg')]),
      ]),
    ];
    const picked = await collectEntries(entries);
    expect(picked.map((p) => [p.path, p.file.name])).toEqual([
      ['', 'loose.txt'],
      ['photos', 'a.jpg'],
      ['photos/2030', 'b.jpg'],
    ]);
  });

  it('keeps reading until readEntries returns an empty batch', async () => {
    const children = Array.from({ length: 250 }, (_, i) => fileEntry(`/big/f${i}.txt`));
    const picked = await collectEntries([dirEntry('/big', children, 100)]);
    expect(picked).toHaveLength(250);
    expect(new Set(picked.map((p) => p.file.name)).size).toBe(250);
  });

  it('skips system files and unreadable entries', async () => {
    const broken: FileEntryLike = {
      ...fileEntry('/d/broken.txt'),
      file: (_success, failure) => failure?.(new Error('gone')),
    };
    const picked = await collectEntries([
      dirEntry('/d', [
        fileEntry('/d/.DS_Store'),
        fileEntry('/d/Thumbs.db'),
        broken,
        fileEntry('/d/ok.txt'),
      ]),
    ]);
    expect(picked.map((p) => p.file.name)).toEqual(['ok.txt']);
  });
});

describe('startCollectDrop', () => {
  it('uses the entries of the dropped items', async () => {
    const entry = dirEntry('/docs', [fileEntry('/docs/a.txt')]);
    const data = {
      items: [{ kind: 'file', webkitGetAsEntry: () => entry }],
      files: [],
    } as unknown as DataTransfer;
    const picked = await startCollectDrop(data);
    expect(picked.map((p) => [p.path, p.file.name])).toEqual([['docs', 'a.txt']]);
  });

  it('falls back to the flat file list without the entries API', async () => {
    const file = new File(['a'], 'a.txt');
    const data = { items: [{ kind: 'file' }], files: [file] } as unknown as DataTransfer;
    expect(await startCollectDrop(data)).toEqual([{ file, path: '' }]);
  });
});
