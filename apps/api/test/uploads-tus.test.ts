import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { TransferDetail } from '@easysend/shared';
import { transferFiles, transfers, uploads, users } from '../src/db/schema/index.js';
import { storagePath } from '../src/storage/paths.js';
import { bodyAs, errorCode } from './helpers.js';
import {
  createDraft,
  createUploadApp,
  filesOf,
  readStoredFile,
  settle,
  sha256,
  tmpFilesExist,
  tusCreate,
  tusHead,
  tusPatch,
  tusRequest,
  uploadBytes,
  uploadRow,
  userWithClient,
} from './upload-helpers.js';

const MB = 1024 * 1024;

describe('tus upload flow', () => {
  it('resumes after an interruption, then encrypts and records the file', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(150_000);

    const created = await tusCreate(t, client, {
      transferId: draft.id,
      filename: 'photo.jpg',
      filetype: 'image/jpeg',
      size: data.length,
    });
    expect(created.status).toBe(201);
    expect(created.headers['tus-resumable']).toBe('1.0.0');
    expect(created.headers['upload-expires']).toBeTruthy();
    expect(created.headers['access-control-allow-origin']).toBeUndefined();
    const location = String(created.headers.location);
    expect(location).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}$/);
    const id = location.split('/').pop()!;
    expect(uploadRow(t, id)?.status).toBe('in_progress');

    const first = await tusPatch(t, client, location, 0, data.subarray(0, 60_000));
    expect(first.status).toBe(204);
    expect(first.headers['upload-offset']).toBe('60000');

    // "Reconnect": the offset is read again and the rest is sent from there.
    const head = await tusHead(t, client, location);
    expect(head.status).toBe(200);
    expect(head.headers['upload-offset']).toBe('60000');
    expect(head.headers['upload-length']).toBe(String(data.length));
    expect(head.headers['cache-control']).toBe('no-store');

    const last = await tusPatch(t, client, location, 60_000, data.subarray(60_000));
    expect(last.status).toBe(204);
    expect(uploadRow(t, id)?.status).toBe('processing');
    const detail = await client.get(`/api/transfers/${draft.id}`);
    expect(bodyAs<TransferDetail>(detail).uploads).toHaveLength(1);

    await settle(t);

    const row = uploadRow(t, id)!;
    expect(row.status).toBe('completed');
    const [file] = filesOf(t, draft.id);
    expect(file).toMatchObject({
      originalName: 'photo.jpg',
      sizeBytes: data.length,
      mimeType: 'image/jpeg',
      sha256: sha256(data),
    });
    expect(file!.storedSizeBytes).toBeGreaterThan(data.length);
    expect(existsSync(storagePath(t.config, file!.storageName))).toBe(true);
    expect(tmpFilesExist(t, id)).toBe(false);
    expect(await readStoredFile(t, file!)).toEqual(data);

    const transfer = t.db.db.select().from(transfers).where(eq(transfers.id, draft.id)).get();
    expect(transfer?.totalBytes).toBe(data.length);
    const owner = t.db.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(owner?.usedBytes).toBe(data.length);

    const after = bodyAs<TransferDetail>(await client.get(`/api/transfers/${draft.id}`));
    expect(after.files.map((f) => f.name)).toEqual(['photo.jpg']);
    expect(after.uploads).toHaveLength(0);

    // HEAD after completion: the tus files are gone but the client still sees a finished upload.
    const done = await tusHead(t, client, location);
    expect(done.status).toBe(200);
    expect(done.headers['upload-offset']).toBe(String(data.length));
    expect(done.headers['upload-length']).toBe(String(data.length));
  });

  it('accepts an empty file', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);

    const created = await tusCreate(t, client, { transferId: draft.id, size: 0 });
    expect(created.status).toBe(201);
    const id = String(created.headers.location).split('/').pop()!;
    expect(uploadRow(t, id)?.status).toBe('processing');
    await settle(t);

    const [file] = filesOf(t, draft.id);
    expect(file?.sizeBytes).toBe(0);
    expect(file?.sha256).toBe(sha256(Buffer.alloc(0)));
    expect(await readStoredFile(t, file!)).toHaveLength(0);
  });

  it('answers 409 in the standard error shape for a wrong offset', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const created = await tusCreate(t, client, { transferId: draft.id, size: 100 });
    const location = String(created.headers.location);

    const res = await tusPatch(t, client, location, 10, randomBytes(10));
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/json');
    expect(errorCode(res)).toBe('CONFLICT');
    expect(bodyAs<{ error: { requestId: string } }>(res).error.requestId).toBeTruthy();
  });

  it('refuses more data once the upload is complete', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const { location } = await uploadBytes(t, client, {
      transferId: draft.id,
      data: randomBytes(1000),
    });
    const res = await tusPatch(t, client, location, 1000, randomBytes(5));
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CONFLICT');
    await settle(t);
  });

  it('terminates an upload: files and row are removed', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const created = await tusCreate(t, client, { transferId: draft.id, size: 5000 });
    const location = String(created.headers.location);
    const id = location.split('/').pop()!;
    await tusPatch(t, client, location, 0, randomBytes(100));
    expect(tmpFilesExist(t, id)).toBe(true);

    const res = await tusRequest(t, client, 'delete', location);
    expect(res.status).toBe(204);
    expect(uploadRow(t, id)).toBeUndefined();
    expect(tmpFilesExist(t, id)).toBe(false);
    expect((await tusHead(t, client, location)).status).toBe(404);
  });

  it('does not terminate an upload that is already complete', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const { location } = await uploadBytes(t, client, {
      transferId: draft.id,
      data: randomBytes(300),
    });
    const res = await tusRequest(t, client, 'delete', location);
    expect(res.status).toBe(409);
    await settle(t);
    expect(filesOf(t, draft.id)).toHaveLength(1);
  });

  it('advertises only the supported extensions', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await tusRequest(t, client, 'options', '/api/uploads');
    expect(res.status).toBe(204);
    expect(res.headers['tus-extension']).toBe('creation,termination,expiration');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('tus metadata and ownership', () => {
  it('rejects invalid metadata with details', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await tusRequest(t, client, 'post', '/api/uploads', {
      headers: { 'Upload-Length': '10', 'Upload-Metadata': 'filename YS50eHQ=' },
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_UPLOAD_METADATA');
    expect(res.headers['content-type']).toContain('application/json');
    expect(bodyAs<{ error: { details?: unknown } }>(res).error.details).toBeDefined();
  });

  it('accepts a metadata key without a value (file of unknown type)', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const res = await tusRequest(t, client, 'post', '/api/uploads', {
      headers: {
        'Upload-Length': '10',
        'Upload-Metadata': `transferId ${Buffer.from(draft.id).toString('base64')},filename YS5pc28=,filetype`,
      },
    });
    expect(res.status).toBe(201);
  });

  it('rejects a deferred length', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const res = await tusRequest(t, client, 'post', '/api/uploads', {
      headers: {
        'Upload-Defer-Length': '1',
        'Upload-Metadata': `transferId ${Buffer.from(draft.id).toString('base64')},filename YS50eHQ=`,
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('answers TRANSFER_NOT_FOUND for an unknown transfer', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await tusCreate(t, client, { transferId: 'missing', size: 10 });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('TRANSFER_NOT_FOUND');
  });

  it("does not let anyone, admins included, upload into someone else's draft", async () => {
    const t = await createUploadApp();
    const { client: owner } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const { client: admin } = await userWithClient(t, { role: 'admin' });
    const draft = await createDraft(owner);

    for (const intruder of [other, admin]) {
      const res = await tusCreate(t, intruder, { transferId: draft.id, size: 10 });
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('TRANSFER_NOT_FOUND');
    }
  });

  it('answers TRANSFER_NOT_UPLOADABLE once the transfer is active', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    await uploadBytes(t, client, { transferId: draft.id, data: randomBytes(10) });
    await settle(t);
    expect((await client.post(`/api/transfers/${draft.id}/finalize`)).status).toBe(200);

    const res = await tusCreate(t, client, { transferId: draft.id, size: 10 });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('TRANSFER_NOT_UPLOADABLE');
  });

  it("answers 404 to other users' HEAD, PATCH and DELETE", async () => {
    const t = await createUploadApp();
    const { client: owner } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const draft = await createDraft(owner);
    const created = await tusCreate(t, owner, { transferId: draft.id, size: 100 });
    const location = String(created.headers.location);

    expect((await tusHead(t, other, location)).status).toBe(404);
    const patch = await tusPatch(t, other, location, 0, randomBytes(10));
    expect(patch.status).toBe(404);
    expect(errorCode(patch)).toBe('NOT_FOUND');
    expect((await tusRequest(t, other, 'delete', location)).status).toBe(404);
    // The owner's upload is untouched.
    expect((await tusHead(t, owner, location)).headers['upload-offset']).toBe('0');
  });

  it('answers 404 to upload ids that fail the contract schema, before any DB lookup', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const location = `/api/uploads/${'x'.repeat(65)}`;

    const head = await tusHead(t, client, location);
    expect(head.status).toBe(404);
    const patch = await tusPatch(t, client, location, 0, randomBytes(10));
    expect(patch.status).toBe(404);
    expect(errorCode(patch)).toBe('NOT_FOUND');
    const del = await tusRequest(t, client, 'delete', location);
    expect(del.status).toBe(404);
    expect(errorCode(del)).toBe('NOT_FOUND');
  });

  it('answers 404 for an unknown upload id', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await tusHead(t, client, '/api/uploads/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('tus authentication and CSRF', () => {
  it('requires a session', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await tusCreate(t, client, { transferId: 'x', size: 1 }, { anonymous: true });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
    expect(
      (await tusRequest(t, client, 'head', '/api/uploads/x', { anonymous: true })).status,
    ).toBe(401);
  });

  it('requires the CSRF header on POST, PATCH and DELETE', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);

    const post = await tusCreate(t, client, { transferId: draft.id, size: 10 }, { csrf: false });
    expect(post.status).toBe(403);
    expect(errorCode(post)).toBe('CSRF_INVALID');

    const created = await tusCreate(t, client, { transferId: draft.id, size: 10 });
    const location = String(created.headers.location);
    const patch = await tusPatch(t, client, location, 0, randomBytes(5), { csrf: false });
    expect(patch.status).toBe(403);
    expect(errorCode(patch)).toBe('CSRF_INVALID');
    const wrong = await tusPatch(t, client, location, 0, randomBytes(5), { csrf: 'nope' });
    expect(errorCode(wrong)).toBe('CSRF_INVALID');
    const del = await tusRequest(t, client, 'delete', location, { csrf: false });
    expect(errorCode(del)).toBe('CSRF_INVALID');
    // HEAD is a safe method: no token needed.
    expect((await tusRequest(t, client, 'head', location, { csrf: false })).status).toBe(200);
  });

  it('rejects a cross-site Origin', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const res = await tusCreate(
      t,
      client,
      { transferId: draft.id, size: 10 },
      { headers: { Origin: 'https://evil.example' } },
    );
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('CSRF_INVALID');
  });
});

describe('tus limits', () => {
  it('enforces the quota, counting uploads still in flight', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    t.db.db
      .update(users)
      .set({ quotaBytes: 1000, usedBytes: 300 })
      .where(eq(users.id, user.id))
      .run();
    const draft = await createDraft(client);

    const first = await tusCreate(t, client, { transferId: draft.id, size: 400 });
    expect(first.status).toBe(201);
    // 300 used + 400 in flight + 301 > 1000
    const over = await tusCreate(t, client, { transferId: draft.id, size: 301 });
    expect(over.status).toBe(413);
    expect(errorCode(over)).toBe('QUOTA_EXCEEDED');
    const exact = await tusCreate(t, client, { transferId: draft.id, size: 300 });
    expect(exact.status).toBe(201);
    expect(t.db.db.select().from(uploads).all()).toHaveLength(2);
  });

  it('lets two parallel creations pass the quota only once', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    t.db.db.update(users).set({ quotaBytes: 1000 }).where(eq(users.id, user.id)).run();
    const draft = await createDraft(client);

    const results = await Promise.all([
      tusCreate(t, client, { transferId: draft.id, size: 600 }),
      tusCreate(t, client, { transferId: draft.id, size: 600 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 413]);
  });

  it('treats a null quota as unlimited', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    expect((await tusCreate(t, client, { transferId: draft.id, size: 10 * MB })).status).toBe(201);
  });

  it('refuses when free space minus the reserve is below twice the size', async () => {
    const reserve = 10 * MB;
    const t = await createUploadApp({
      deps: {
        diskSpace: () => Promise.resolve({ totalBytes: 100 * MB, freeBytes: reserve + 2 * MB }),
      },
    });
    t.ctx.settings.set('general', { defaultLocale: 'it', diskReserveMb: 10, chunkSizeMb: 25 });
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);

    const tooBig = await tusCreate(t, client, { transferId: draft.id, size: MB + 1 });
    expect(tooBig.status).toBe(507);
    expect(errorCode(tooBig)).toBe('INSUFFICIENT_DISK_SPACE');
    expect(t.db.db.select().from(uploads).all()).toHaveLength(0);
    expect((await tusCreate(t, client, { transferId: draft.id, size: MB })).status).toBe(201);
  });

  it('limits the number of files per transfer', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    for (let i = 0; i < 100; i += 1) {
      t.db.db
        .insert(transferFiles)
        .values({
          transferId: draft.id,
          originalName: `f${i}`,
          storageName: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          sizeBytes: 1,
          storedSizeBytes: 17,
          encKeyWrapped: 'k',
          encNoncePrefix: 'n',
          encSegmentSize: 65536,
        })
        .run();
    }
    const res = await tusCreate(t, client, { transferId: draft.id, size: 10 });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(bodyAs<{ error: { details: { limit: number } } }>(res).error.details.limit).toBe(100);
  });
});
