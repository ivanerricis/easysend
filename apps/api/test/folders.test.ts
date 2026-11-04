import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FILE_PATH_MAX_DEPTH,
  FILE_PATH_MAX_LENGTH,
  type DownloadInfoResponse,
  type TransferDetail,
} from '@easysend/shared';
import { dedupeZipEntries, sanitizeRelativeDir } from '../src/storage/filenames.js';
import { bodyAs, createTestApp, errorCode, makeTempDir } from './helpers.js';
import { loginAs } from './session-helpers.js';
import { binaryRequest, createTransferFixture, readZip } from './transfer-fixtures.js';
import {
  createDraft,
  createUploadApp,
  filesOf,
  readStoredFile,
  settle,
  tusCreate,
  uploadBytes,
  uploadRow,
  userWithClient,
} from './upload-helpers.js';

describe('sanitizeRelativeDir', () => {
  it('returns an empty string for the root', () => {
    for (const raw of ['', '.', './', '/', '//', '\\', './.']) {
      expect(sanitizeRelativeDir(raw), raw).toBe('');
    }
  });

  it('normalises separators and drops empty and "." segments', () => {
    expect(sanitizeRelativeDir('a/b/c')).toBe('a/b/c');
    expect(sanitizeRelativeDir('a\\b\\c')).toBe('a/b/c');
    expect(sanitizeRelativeDir('/a//b/./c/')).toBe('a/b/c');
    expect(sanitizeRelativeDir('a/b\\c')).toBe('a/b/c');
  });

  it('refuses parent traversal in any position and with any separator', () => {
    for (const raw of ['..', '../a', 'a/..', 'a/../b', 'a\\..\\b', '/../etc']) {
      expect(() => sanitizeRelativeDir(raw), raw).toThrowError(/Invalid folder path/);
    }
  });

  it('sanitises every segment like a file name', () => {
    expect(sanitizeRelativeDir('con/photos')).toBe('_con/photos');
    expect(sanitizeRelativeDir('a:b/c*d')).toBe('a_b/c_d');
    expect(sanitizeRelativeDir('.hidden/ spaced ')).toBe('hidden/spaced');
    expect(sanitizeRelativeDir('x‮evil/y\u0000z')).toBe('xevil/yz');
    expect(sanitizeRelativeDir('...')).toBe('file');
  });

  it('keeps unicode and normalises it to NFC', () => {
    expect(sanitizeRelativeDir('Fotos/日本語/emoji 🎉')).toBe('Fotos/日本語/emoji 🎉');
    expect(sanitizeRelativeDir('café/ño')).toBe('café/ño');
  });

  it('enforces the depth limit', () => {
    const ok = Array.from({ length: FILE_PATH_MAX_DEPTH }, () => 'd').join('/');
    expect(sanitizeRelativeDir(ok)).toBe(ok);
    expect(() => sanitizeRelativeDir(`${ok}/d`)).toThrowError(/too deep/);
  });

  it('enforces the length limit', () => {
    const segment = 'x'.repeat(100);
    const fits = Array.from({ length: 10 }, () => segment).join('/'); // 1009 characters
    expect(fits.length).toBeLessThanOrEqual(FILE_PATH_MAX_LENGTH);
    expect(sanitizeRelativeDir(fits)).toBe(fits);
    const tooLong = Array.from({ length: 11 }, () => segment).join('/');
    expect(() => sanitizeRelativeDir(tooLong)).toThrowError(/too long/);
  });
});

describe('dedupeZipEntries', () => {
  const entry = (path: string, name: string) => ({ path, name });

  it('joins path and name and leaves unique entries alone', () => {
    expect(
      dedupeZipEntries([entry('', 'a.txt'), entry('docs', 'a.txt'), entry('docs/x', 'b.txt')]),
    ).toEqual(['a.txt', 'docs/a.txt', 'docs/x/b.txt']);
  });

  it('numbers case-insensitive duplicates of the full path before the extension', () => {
    expect(
      dedupeZipEntries([
        entry('Docs', 'a.txt'),
        entry('docs', 'A.txt'),
        entry('DOCS', 'a.txt'),
        entry('other', 'a.txt'),
      ]),
    ).toEqual(['Docs/a.txt', 'docs/A (1).txt', 'DOCS/a (2).txt', 'other/a.txt']);
  });

  it('renames a file whose path equals a directory of another entry', () => {
    expect(dedupeZipEntries([entry('', 'a'), entry('a', 'b.txt')])).toEqual(['a (1)', 'a/b.txt']);
    // The directory is listed first, and the check is case-insensitive and applies to nested dirs.
    expect(dedupeZipEntries([entry('x/y', 'f'), entry('x', 'Y'), entry('', 'X')])).toEqual([
      'x/y/f',
      'x/Y (1)',
      'X (1)',
    ]);
  });

  it('skips candidates that are taken too when renaming', () => {
    expect(dedupeZipEntries([entry('', 'a'), entry('', 'a (1)'), entry('a', 'b')])).toEqual([
      'a (1)',
      'a (1) (1)',
      'a/b',
    ]);
  });
});

describe('folders through tus', () => {
  it('stores the sanitised relativePath, shows it while uploading and keeps it on the file', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(2000);

    const created = await tusCreate(t, client, {
      transferId: draft.id,
      filename: 'a.txt',
      relativePath: 'photos\\2030/./trip',
      size: data.length,
    });
    expect(created.status).toBe(201);
    const uploadId = String(created.headers.location).split('/').pop()!;
    expect(uploadRow(t, uploadId)?.path).toBe('photos/2030/trip');

    const pending = bodyAs<TransferDetail>(await client.get(`/api/transfers/${draft.id}`));
    expect(pending.uploads.map((u) => u.path)).toEqual(['photos/2030/trip']);

    const rootFile = await uploadBytes(t, client, {
      transferId: draft.id,
      filename: 'root.txt',
      data,
    });
    expect(rootFile.id).not.toBe(uploadId);
    await settle(t);

    const rows = filesOf(t, draft.id);
    expect(rows.map((f) => [f.originalName, f.path]).sort()).toEqual([['root.txt', '']]);
  });

  it('copies the path to the transfer file and returns it in the detail', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(3000);
    await uploadBytes(t, client, {
      transferId: draft.id,
      filename: 'deep.bin',
      relativePath: 'one/two',
      data,
    });
    await settle(t);

    const [row] = filesOf(t, draft.id);
    expect(row).toMatchObject({ originalName: 'deep.bin', path: 'one/two' });
    expect((await readStoredFile(t, row!)).equals(data)).toBe(true);
    const detail = bodyAs<TransferDetail>(await client.get(`/api/transfers/${draft.id}`));
    expect(detail.files).toMatchObject([{ name: 'deep.bin', path: 'one/two' }]);
  });

  it('treats a missing relativePath as the root', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const created = await tusCreate(t, client, { transferId: draft.id, size: 10 });
    expect(created.status).toBe(201);
    expect(uploadRow(t, String(created.headers.location).split('/').pop()!)?.path).toBe('');
  });

  it('refuses traversal and over-limit paths with VALIDATION_ERROR', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const tooDeep = Array.from({ length: FILE_PATH_MAX_DEPTH + 1 }, () => 'd').join('/');
    const tooLong = 'x'.repeat(FILE_PATH_MAX_LENGTH + 1);
    for (const relativePath of ['../secret', 'a/../../b', tooDeep]) {
      const res = await tusCreate(t, client, { transferId: draft.id, size: 10, relativePath });
      expect(res.status, relativePath.slice(0, 20)).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    }
    // Beyond the schema limit the metadata itself is rejected.
    const huge = await tusCreate(t, client, {
      transferId: draft.id,
      size: 10,
      relativePath: tooLong,
    });
    expect(huge.status).toBe(400);
    expect(errorCode(huge)).toBe('INVALID_UPLOAD_METADATA');
  });
});

describe('folders in downloads', () => {
  const setup = () => createTestApp({ env: { DATA_DIR: makeTempDir() } });

  it('lists the path of every file on the public page', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [
        { name: 'z.txt', size: 5 },
        { name: 'a.txt', size: 5, path: 'docs' },
      ],
    });
    const info = bodyAs<DownloadInfoResponse>(await t.client().get(`/api/downloads/${fx.token}`));
    if (info.locked) throw new Error('unexpected lock');
    expect(info.files.map((f) => [f.path, f.name])).toEqual([
      ['', 'z.txt'],
      ['docs', 'a.txt'],
    ]);
  });

  it('recreates the folder structure in the zip', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [
        { name: 'root.txt', size: 10 },
        { name: 'a.txt', size: 70_000, path: 'docs' },
        { name: 'b.txt', size: 5, path: 'docs/sub/deeper' },
        { name: 'A.TXT', size: 7, path: 'Docs' },
      ],
    });
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(res.body.length));
    const entries = await readZip(res.body);
    expect([...entries.keys()].sort()).toEqual([
      'Docs/A.TXT',
      'docs/a (1).txt',
      'docs/sub/deeper/b.txt',
      'root.txt',
    ]);
    expect(entries.get('root.txt')!.equals(fx.files[0]!.content)).toBe(true);
    expect(entries.get('docs/a (1).txt')!.equals(fx.files[1]!.content)).toBe(true);
    expect(entries.get('docs/sub/deeper/b.txt')!.equals(fx.files[2]!.content)).toBe(true);
    expect(entries.get('Docs/A.TXT')!.equals(fx.files[3]!.content)).toBe(true);
  });

  it('renames a file that collides with a folder in the zip', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [
        { name: 'docs', size: 4 },
        { name: 'a.txt', size: 4, path: 'docs' },
      ],
    });
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect([...(await readZip(res.body)).keys()].sort()).toEqual(['docs (1)', 'docs/a.txt']);
  });

  it('downloads a single file under its leaf name', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [{ name: 'a.txt', size: 4, path: 'docs/sub' }],
    });
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('filename="a.txt"');
    expect(String(res.headers['content-disposition'])).not.toContain('docs');
  });

  it('lists paths in the owner detail too', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [{ name: 'a.txt', size: 4, path: 'docs' }],
    });
    const owner = loginAs(t, fx.owner);
    const detail = bodyAs<TransferDetail>(await owner.get(`/api/transfers/${fx.id}`));
    expect(detail.files).toMatchObject([{ name: 'a.txt', path: 'docs' }]);
  });
});
