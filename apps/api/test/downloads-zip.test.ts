import { readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { downloadLogs, transferFiles, transfers } from '../src/db/schema/index.js';
import { storagePath } from '../src/storage/paths.js';
import { createTestApp, makeTempDir, type TestApp } from './helpers.js';
import { binaryErrorCode, binaryRequest, createTransferFixture } from './transfer-fixtures.js';

const setup = () => createTestApp({ env: { DATA_DIR: makeTempDir() } });

/** Reads every entry of a zip held in memory: name to content. */
function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

const downloadCount = (t: TestApp, id: string) =>
  t.ctx.db.select().from(transfers).where(eq(transfers.id, id)).get()!.downloadCount;

describe('GET /api/downloads/:token/zip', () => {
  it('streams a valid stored zip with every file and an exact Content-Length', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { title: 'Holiday: 2030' });
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('Holiday_ 2030.zip');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-length']).toBe(String(res.body.length));

    const entries = await readZip(res.body);
    expect([...entries.keys()].sort()).toEqual(fx.files.map((f) => f.name).sort());
    for (const file of fx.files) expect(entries.get(file.name)!.equals(file.content)).toBe(true);
  });

  it('dedupes names, honours fileIds and counts once', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [
        { name: 'a.txt', size: 100 },
        { name: 'A.txt', size: 200 },
        { name: 'b.txt', size: 300 },
      ],
    });
    const all = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect([...(await readZip(all.body)).keys()].sort()).toEqual(['A.txt', 'a (1).txt', 'b.txt']);
    expect(downloadCount(t, fx.id)).toBe(1);

    const ids = `${fx.files[2]!.id}, ${fx.files[0]!.id},${fx.files[2]!.id}`;
    const some = await binaryRequest(
      t.app,
      `/api/downloads/${fx.token}/zip?fileIds=${encodeURIComponent(ids)}`,
    );
    const entries = await readZip(some.body);
    expect([...entries.keys()].sort()).toEqual(['a.txt', 'b.txt']);
    expect(entries.get('b.txt')!.equals(fx.files[2]!.content)).toBe(true);
    expect(downloadCount(t, fx.id)).toBe(2);
  });

  it('answers 404 FILE_NOT_FOUND for an unknown id and does not count', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: [{ name: 'a', size: 5 }] });
    const res = await binaryRequest(
      t.app,
      `/api/downloads/${fx.token}/zip?fileIds=${fx.files[0]!.id},nope`,
    );
    expect(res.status).toBe(404);
    expect(binaryErrorCode(res)).toBe('FILE_NOT_FOUND');
    expect(downloadCount(t, fx.id)).toBe(0);
  });

  it('needs the unlock cookie, applies the limit and does not count HEAD', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [{ name: 'a', size: 5 }],
      password: 'secret-pass',
      maxDownloads: 1,
    });
    expect((await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`)).status).toBe(401);
    const c = t.client();
    await c.post(`/api/downloads/${fx.token}/unlock`, {
      body: { password: 'secret-pass' },
      csrf: false,
    });
    const cookie = `es_dl=${c.cookie('es_dl')}`;

    const head = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`, {
      method: 'head',
      cookie,
    });
    expect(head.status).toBe(200);
    expect(downloadCount(t, fx.id)).toBe(0);

    expect((await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`, { cookie })).status).toBe(
      200,
    );
    expect((await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`, { cookie })).status).toBe(
      410,
    );
  });

  it('logs one row without file id and emails the owner once', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, { files: [{ name: 'a', size: 5000 }] });
    const res = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    await vi.waitFor(() => {
      const logs = t.ctx.db
        .select()
        .from(downloadLogs)
        .where(eq(downloadLogs.transferId, fx.id))
        .all();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.fileId).toBeNull();
      expect(logs[0]!.bytesSent).toBe(res.body.length);
    });
    await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(1));
  });

  it('aborts when a stored file is damaged, and keeps serving', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [
        { name: 'a', size: 100_000 },
        { name: 'b', size: 10 },
      ],
    });
    const row = t.ctx.db
      .select()
      .from(transferFiles)
      .where(eq(transferFiles.id, fx.files[1]!.id))
      .get()!;
    const stored = storagePath(t.config, row.storageName);
    const bytes = readFileSync(stored);
    bytes[0] = bytes[0]! ^ 0xff;
    writeFileSync(stored, bytes);

    const bad = await binaryRequest(t.app, `/api/downloads/${fx.token}/zip`);
    expect(bad.complete).toBe(false);
    const info = await t.client().get(`/api/downloads/${fx.token}`);
    expect(info.status).toBe(200);
  });
});
