import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { nowSeconds } from '../src/clock.js';
import { transfers, uploads, users } from '../src/db/schema/index.js';
import { storagePartPath, tusFilePaths } from '../src/storage/paths.js';
import type { TestApp } from './helpers.js';
import {
  createDraft,
  createUploadApp,
  filesOf,
  readStoredFile,
  sha256,
  tmpFilesExist,
  uploadRow,
  userWithClient,
} from './upload-helpers.js';

/** A `processing` upload as left behind by a finished tus transfer; `data` null = no tus file. */
async function seedProcessing(
  t: TestApp,
  ownerId: string,
  transferId: string,
  data: Buffer | null,
  declaredSize = data?.length ?? 0,
): Promise<string> {
  const id = randomUUID();
  const now = nowSeconds(t.clock);
  t.db.db
    .insert(uploads)
    .values({
      id,
      ownerId,
      transferId,
      fileName: 'seeded.bin',
      totalSize: declaredSize,
      status: 'processing',
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + 3600,
    })
    .run();
  if (data) {
    const { data: dataPath, info } = tusFilePaths(t.config, id);
    await writeFile(dataPath, data);
    await writeFile(
      info,
      JSON.stringify({ id, size: data.length, metadata: { filetype: 'text/x-test' } }),
    );
  }
  return id;
}

describe('upload worker', () => {
  it('recover() sweeps .part files and queues the uploads still processing', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const data = randomBytes(70_000);
    const id = await seedProcessing(t, user.id, draft.id, data);
    const leftover = storagePartPath(t.config, randomUUID());
    await writeFile(leftover, 'half written');

    await t.ctx.uploadWorker.recover();
    await t.ctx.uploadWorker.idle();

    expect(existsSync(leftover)).toBe(false);
    expect(uploadRow(t, id)?.status).toBe('completed');
    const [file] = filesOf(t, draft.id);
    expect(file).toMatchObject({ sha256: sha256(data), mimeType: 'text/x-test' });
    expect(await readStoredFile(t, file!)).toEqual(data);
    expect(tmpFilesExist(t, id)).toBe(false);
    expect((await readdir(t.config.storageDir)).filter((n) => n.endsWith('.part'))).toEqual([]);
  });

  it('aborts an upload whose tus file is missing', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const id = await seedProcessing(t, user.id, draft.id, null, 500);

    t.ctx.uploadWorker.enqueue(id);
    await t.ctx.uploadWorker.idle();

    expect(uploadRow(t, id)?.status).toBe('aborted');
    expect(filesOf(t, draft.id)).toHaveLength(0);
    const owner = t.db.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(owner?.usedBytes).toBe(0);
  });

  it('aborts when the source does not have the declared size, leaving nothing behind', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const id = await seedProcessing(t, user.id, draft.id, randomBytes(100), 200);

    t.ctx.uploadWorker.enqueue(id);
    await t.ctx.uploadWorker.idle();

    expect(uploadRow(t, id)?.status).toBe('aborted');
    expect(tmpFilesExist(t, id)).toBe(false);
    expect(await readdir(t.config.storageDir)).toEqual([]);
    // The aborted upload shows in the draft until it is finalized or deleted.
    const detail = await client.get(`/api/transfers/${draft.id}`);
    expect(JSON.stringify(detail.body)).toContain('"aborted"');
  });

  it('drops the encrypted file when the transfer is no longer a draft', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const id = await seedProcessing(t, user.id, draft.id, randomBytes(1000));
    t.db.db.update(transfers).set({ status: 'revoked' }).where(eq(transfers.id, draft.id)).run();

    t.ctx.uploadWorker.enqueue(id);
    await t.ctx.uploadWorker.idle();

    expect(uploadRow(t, id)?.status).toBe('aborted');
    expect(filesOf(t, draft.id)).toHaveLength(0);
    expect(await readdir(t.config.storageDir)).toEqual([]);
    expect(tmpFilesExist(t, id)).toBe(false);
  });

  it('ignores uploads that are not processing and unknown ids', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const id = await seedProcessing(t, user.id, draft.id, randomBytes(10));
    t.db.db.update(uploads).set({ status: 'in_progress' }).where(eq(uploads.id, id)).run();

    t.ctx.uploadWorker.enqueue(id);
    t.ctx.uploadWorker.enqueue(randomUUID());
    await t.ctx.uploadWorker.idle();

    expect(uploadRow(t, id)?.status).toBe('in_progress');
    expect(filesOf(t, draft.id)).toHaveLength(0);
  });

  it('processes jobs one at a time and idle() waits for all of them', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await createDraft(client);
    const ids = await Promise.all(
      [1, 2, 3].map((n) => seedProcessing(t, user.id, draft.id, randomBytes(1000 * n))),
    );
    for (const id of ids) t.ctx.uploadWorker.enqueue(id);
    await t.ctx.uploadWorker.idle();

    expect(ids.map((id) => uploadRow(t, id)?.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(filesOf(t, draft.id)).toHaveLength(3);
    const transfer = t.db.db.select().from(transfers).where(eq(transfers.id, draft.id)).get();
    expect(transfer?.totalBytes).toBe(6000);
  });
});
