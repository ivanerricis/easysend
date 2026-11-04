import type { PickedFile } from './types';

/** Files the operating systems create on their own: never worth sending. */
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function isSystemFile(name: string): boolean {
  return SYSTEM_FILES.has(name.toLowerCase());
}

/** Folder part of a path that ends with the file name ("a/b/c.txt" gives "a/b", "c.txt" gives ""). */
export function folderOf(filePath: string): string {
  const segments = filePath.split('/').filter((segment) => segment !== '');
  segments.pop();
  return segments.join('/');
}

/** Folder of a file picked with `<input webkitdirectory>` (relative to the folder's parent). */
export function pathFromRelative(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  return folderOf(relative);
}

/** Files of `<input type="file">`, with their folder when picked as a directory. */
export function pickedFromInput(
  list: FileList | File[] | null,
  withFolders: boolean,
): PickedFile[] {
  return Array.from(list ?? [])
    .filter((file) => !isSystemFile(file.name))
    .map((file) => ({ file, path: withFolders ? pathFromRelative(file) : '' }));
}

/** Minimal shapes of the File and Directory Entries API (what the walk needs). */
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
export interface FileEntryLike extends EntryLike {
  file: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
}
export interface DirectoryEntryLike extends EntryLike {
  createReader: () => {
    readEntries: (
      success: (entries: EntryLike[]) => void,
      failure?: (error: unknown) => void,
    ) => void;
  };
}

function readFile(entry: FileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` returns small batches (about 100): call it until it returns an empty one. */
async function readAll(directory: DirectoryEntryLike): Promise<EntryLike[]> {
  const reader = directory.createReader();
  const all: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/**
 * Walks dropped entries recursively. Unreadable entries are skipped; system files are dropped.
 * The path of a file is its folder inside what was dropped (the dropped folder's own name is
 * the first segment), "" for loose files.
 */
export async function collectEntries(entries: EntryLike[]): Promise<PickedFile[]> {
  const result: PickedFile[] = [];
  const visit = async (entry: EntryLike): Promise<void> => {
    try {
      if (entry.isFile) {
        if (isSystemFile(entry.name)) return;
        const file = await readFile(entry as FileEntryLike);
        result.push({ file, path: folderOf(entry.fullPath) });
      } else if (entry.isDirectory) {
        for (const child of await readAll(entry as DirectoryEntryLike)) await visit(child);
      }
    } catch {
      // A file that disappeared or cannot be read is left out.
    }
  };
  for (const entry of entries) await visit(entry);
  return result;
}

/**
 * Files of a drop. Entries must be taken synchronously from the event (the item list is cleared
 * once the handler returns); browsers without the entries API fall back to the flat file list.
 */
export function startCollectDrop(data: DataTransfer): Promise<PickedFile[]> {
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file');
  const entries = items.map((item) =>
    typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
  );
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve(pickedFromInput(Array.from(data.files), false));
  }
  return collectEntries(entries as unknown as EntryLike[]);
}

/** Identity of a picked file inside a selection: same folder, name and size means a duplicate. */
export function pickedKey({ file, path }: PickedFile): string {
  return `${path}\u0000${file.name}\u0000${file.size}`;
}

/** First segment of a folder path ("" for loose files). */
export function topFolder(path: string): string {
  return path.split('/')[0] ?? '';
}

/** Path shown for a file: "folder/sub/name.ext", or just the name for loose files. */
export function displayPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name;
}
