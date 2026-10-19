import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FILENAME_MAX_LENGTH } from '@easysend/shared';
import { reserveBytes, statfsDiskSpace } from '../src/storage/disk.js';
import { contentDisposition, dedupeNames, sanitizeFileName } from '../src/storage/filenames.js';
import {
  isStorageEntry,
  storagePartPath,
  storagePath,
  tusFilePaths,
} from '../src/storage/paths.js';
import { removeFileQuietly } from '../src/storage/remove.js';
import { createTestApp, makeTempDir, silentLogger, testConfig } from './helpers.js';

const UUID = '0b8f5c2e-4f61-4a47-9c1d-7e2a3b5c6d7e';

describe('sanitizeFileName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeFileName('report 2024.pdf')).toBe('report 2024.pdf');
    expect(sanitizeFileName('città è già.txt')).toBe('città è già.txt');
  });

  it('neutralises path separators and traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('a\\b/c.txt')).toBe('a_b_c.txt');
    expect(sanitizeFileName('..')).toBe('file');
  });

  it('removes control and bidirectional characters', () => {
    expect(sanitizeFileName('a\u0000b\nc\u202Etxt.exe')).toBe('abctxt.exe');
  });

  it('strips leading dots and spaces and trailing dots and spaces', () => {
    expect(sanitizeFileName('  ..hidden.txt. ')).toBe('hidden.txt');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('nul.txt')).toBe('_nul.txt');
    expect(sanitizeFileName('lpt1.log')).toBe('_lpt1.log');
    expect(sanitizeFileName('console.txt')).toBe('console.txt');
  });

  it('falls back to "file" when nothing is left', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('\u0001\u0002')).toBe('file');
  });

  it('shortens long names keeping the extension', () => {
    const result = sanitizeFileName(`${'a'.repeat(400)}.tar.gz`);
    expect(result).toHaveLength(FILENAME_MAX_LENGTH);
    expect(result.endsWith('.gz')).toBe(true);
    expect(sanitizeFileName('b'.repeat(400))).toHaveLength(FILENAME_MAX_LENGTH);
  });
});

describe('contentDisposition', () => {
  it('gives an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('Relazione città.pdf')).toBe(
      `attachment; filename="Relazione citt_.pdf"; filename*=UTF-8''Relazione%20citt%C3%A0.pdf`,
    );
  });

  it('cannot break out of the quoted string or the header', () => {
    const header = contentDisposition(`a"b%c\r\nSet-Cookie: x=1'(*).txt`);
    expect(header).not.toMatch(/[\r\n]/);
    const quoted = /filename="([^"]*)"/.exec(header)?.[1] ?? '';
    expect(quoted).not.toMatch(/["\\%]/);
    expect(header).toContain('%27%28');
  });
});

describe('dedupeNames', () => {
  it('numbers repeats before the extension, case-insensitively', () => {
    expect(dedupeNames(['a.txt', 'a.txt', 'A.TXT', 'b.txt', 'a.txt'])).toEqual([
      'a.txt',
      'a (1).txt',
      'A (2).TXT',
      'b.txt',
      'a (3).txt',
    ]);
  });

  it('handles names without extension and already numbered names', () => {
    expect(dedupeNames(['x', 'x', 'x (1)'])).toEqual(['x', 'x (1)', 'x (1) (1)']);
  });
});

describe('storage paths', () => {
  const config = testConfig({ DATA_DIR: path.join(makeTempDir()) });

  it('builds paths only for UUID names', () => {
    expect(storagePath(config, UUID)).toBe(path.join(config.storageDir, UUID));
    expect(storagePartPath(config, UUID)).toBe(`${path.join(config.storageDir, UUID)}.part`);
    expect(() => storagePath(config, '../x')).toThrow();
    expect(() => storagePath(config, `${UUID}/..`)).toThrow();
    expect(() => tusFilePaths(config, 'abc')).toThrow();
  });

  it('knows the files of the tus store', () => {
    const { data, info } = tusFilePaths(config, UUID);
    expect(data).toBe(path.join(config.tmpUploadDir, UUID));
    expect(info).toBe(`${data}.json`);
  });

  it('recognises the entries the app creates in the storage directory', () => {
    expect(isStorageEntry(UUID)).toBe(true);
    expect(isStorageEntry(`${UUID}.part`)).toBe(true);
    expect(isStorageEntry('notes.txt')).toBe(false);
    expect(isStorageEntry(`${UUID}.json`)).toBe(false);
  });
});

describe('disk space', () => {
  it('reads the real filesystem', async () => {
    const info = await statfsDiskSpace(makeTempDir());
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.freeBytes).toBeGreaterThanOrEqual(0);
    expect(info.freeBytes).toBeLessThanOrEqual(info.totalBytes);
  });

  it('uses the setting for the reserve, falling back to the config default', async () => {
    const app = await createTestApp({ env: { DEFAULT_DISK_RESERVE_MB: '7' } });
    expect(reserveBytes(app.ctx)).toBe(7 * 1024 * 1024);
    app.ctx.settings.set('general', { defaultLocale: 'it', diskReserveMb: 3, chunkSizeMb: 25 });
    expect(reserveBytes(app.ctx)).toBe(3 * 1024 * 1024);
  });
});

describe('removeFileQuietly', () => {
  it('removes a file and tolerates a missing one', async () => {
    const file = path.join(makeTempDir(), 'x');
    await writeFile(file, 'data');
    expect(await removeFileQuietly(file, silentLogger)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(await removeFileQuietly(file, silentLogger)).toBe(true);
  });

  it('logs the file name only and returns false on other errors', async () => {
    const dir = makeTempDir();
    const target = path.join(dir, 'a-directory');
    await mkdir(target);
    const warn = vi.fn();
    const logger = { warn } as unknown as typeof silentLogger;
    // Removing a directory is refused (EISDIR), which is not an "already gone" case.
    expect(await removeFileQuietly(target, logger)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(dir.replaceAll('\\', '\\\\'));
    expect(JSON.stringify(warn.mock.calls)).toContain('a-directory');
  });
});
