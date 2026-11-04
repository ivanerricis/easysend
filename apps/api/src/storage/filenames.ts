import { FILE_PATH_MAX_DEPTH, FILE_PATH_MAX_LENGTH, FILENAME_MAX_LENGTH } from '@easysend/shared';
import { AppError } from '../http/errors.js';

/** Longest extension (with its dot) kept intact when a name has to be shortened. */
const MAX_EXTENSION_LENGTH = 16;
const FALLBACK_NAME = 'file';
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Controls (C0, DEL, C1) and bidirectional overrides that can disguise an extension (U+202E).
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Path separators plus the characters Windows refuses in a file name. */
const UNSAFE = /[/\\<>:"|?*]/g;

function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > MAX_EXTENSION_LENGTH) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Makes a client-supplied file name safe to show, to put in a zip and to use as a download
 * name: no path separators or control characters, no leading dots or spaces, no Windows reserved
 * names, at most `FILENAME_MAX_LENGTH` characters (the extension is preserved). Never empty.
 * Names are only metadata: files on disk are stored under a random UUID.
 */
export function sanitizeFileName(name: string): string {
  let clean = name
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(UNSAFE, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (clean === '') return FALLBACK_NAME;

  if (clean.length > FILENAME_MAX_LENGTH) {
    const { stem, ext } = splitExtension(clean);
    clean = `${stem.slice(0, FILENAME_MAX_LENGTH - ext.length).trimEnd()}${ext}`;
  }
  if (WINDOWS_RESERVED.test(splitExtension(clean).stem)) clean = `_${clean}`;
  return clean;
}

/** Percent-encoding for `filename*` (RFC 5987 `attr-char`): encodeURIComponent plus `'()*`. */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `Content-Disposition` for a download: `attachment` with an ASCII `filename` fallback for old
 * clients and the exact UTF-8 name in `filename*`. The name is sanitised first.
 */
export function contentDisposition(name: string): string {
  const safe = sanitizeFileName(name);
  const fallback = safe.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}

/**
 * Makes names unique (case-insensitive, as on Windows and macOS) by numbering repeats before the
 * extension: `a.txt`, `a (1).txt`, `a (2).txt`. Order is preserved; used for zip entries.
 */
export function dedupeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const { stem, ext } = splitExtension(name);
      let counter = 1;
      do {
        candidate = `${stem} (${counter})${ext}`;
        counter += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Cleans the relative folder a client sends for a file dropped from a folder (`a/b`, `a\b`):
 * splits on `/` and `\`, drops empty and `.` segments, refuses `..`, sanitises every segment like
 * a file name and enforces the depth and length limits. Returns '' for the root. The result is
 * metadata only (zip entry names and the download page): storage never uses it as a path.
 */
export function sanitizeRelativeDir(raw: string): string {
  const segments = raw
    .split(/[/\\]/)
    .filter((segment) => segment !== '' && segment !== '.')
    .map((segment) => {
      if (segment === '..') throw new AppError('VALIDATION_ERROR', 'Invalid folder path');
      return sanitizeFileName(segment);
    });
  if (segments.length > FILE_PATH_MAX_DEPTH) {
    throw new AppError('VALIDATION_ERROR', 'Folder path is too deep', {
      limit: FILE_PATH_MAX_DEPTH,
    });
  }
  const path = segments.join('/');
  if (path.length > FILE_PATH_MAX_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'Folder path is too long', {
      limit: FILE_PATH_MAX_LENGTH,
    });
  }
  return path;
}

/**
 * Zip entry names for files in folders: `path/name`, unique case-insensitively (numbering the
 * leaf before the extension, as `dedupeNames`) and never equal to a directory of another entry
 * (a file `a` next to `a/b.txt` becomes `a (1)`, so extraction cannot fail). Order is preserved.
 */
export function dedupeZipEntries(entries: readonly { path: string; name: string }[]): string[] {
  const full = (path: string, name: string): string => (path ? `${path}/${name}` : name);
  const dirs = new Set<string>();
  for (const { path } of entries) {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) dirs.add(parts.slice(0, i).join('/').toLowerCase());
  }
  const used = new Set<string>();
  const taken = (candidate: string): boolean =>
    used.has(candidate.toLowerCase()) || dirs.has(candidate.toLowerCase());
  return entries.map(({ path, name }) => {
    let candidate = full(path, name);
    if (taken(candidate)) {
      const { stem, ext } = splitExtension(name);
      let counter = 1;
      do {
        candidate = full(path, `${stem} (${counter})${ext}`);
        counter += 1;
      } while (taken(candidate));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
