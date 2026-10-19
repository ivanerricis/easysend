import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { downloadLogs, transferFiles, transfers } from '../src/db/schema/index.js';
import { storagePath } from '../src/storage/paths.js';
import { createTestApp, makeTempDir, type TestApp } from './helpers.js';
import {
  binaryErrorCode,
  binaryRequest,
  createTransferFixture,
  FIXTURE_SIZES,
  type TransferFixture,
} from './transfer-fixtures.js';

const setup = () => createTestApp({ env: { DATA_DIR: makeTempDir() } });
const fileUrl = (fx: TransferFixture, index: number) =>
  `/api/downloads/${fx.token}/files/${fx.files[index]!.id}`;
const indexOfSize = (size: number) => FIXTURE_SIZES.indexOf(size as (typeof FIXTURE_SIZES)[number]);

const countOf = (t: TestApp, id: string) =>
  t.ctx.db.select().from(transfers).where(eq(transfers.id, id)).get()!;
const logsOf = (t: TestApp, id: string) =>
  t.ctx.db.select().from(downloadLogs).where(eq(downloadLogs.transferId, id)).all();

describe('GET /api/downloads/:token/files/:fileId', () => {
  it('serves every fixture file decrypted and identical to the plaintext', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t);
    for (const [i, file] of fx.files.entries()) {
      const res = await binaryRequest(t.app, fileUrl(fx, i));
      expect(res.status, file.name).toBe(200);
      expect(res.body.equals(file.content), file.name).toBe(true);
      expect(res.headers['content-length']).toBe(String(file.content.length));
    }
  });

  it('sets the download headers (UTF-8 name, nosniff, no-store, ETag)', async () => {
    const t = await setup();
    const fx = await createTransferFixture(t, {
      files: [{ name: 'Relazione è finale.pdf', size: 100 }],
    });
    const res = await binaryRequest(t.app, fileUrl(fx, 0));
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('attachment;');
    expect(res.headers['content-disposition']).toContain(
      "filename*=UTF-8''Relazione%20%C3%A8%20finale.pdf",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/);
  });

  describe('Range', () => {
    const big = indexOfSize(200_000);
    const ranges: [string, number, number][] = [
      ['bytes=0-0', 0, 0],
      ['bytes=65530-65540', 65_530, 65_540],
      ['bytes=65535-65536', 65_535, 65_536],
      ['bytes=65536-131071', 65_536, 131_071],
      ['bytes=100000-199999', 100_000, 199_999],
      ['bytes=199990-999999', 199_990, 199_999],
      ['bytes=131072-', 131_072, 199_999],
    ];

    it.each(ranges)('answers 206 for %s', async (header, start, end) => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      const res = await binaryRequest(t.app, fileUrl(fx, big), { headers: { Range: header } });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes ${start}-${end}/200000`);
      expect(res.headers['content-length']).toBe(String(end - start + 1));
      expect(res.body.equals(fx.files[big]!.content.subarray(start, end + 1))).toBe(true);
    });

    it('supports suffix ranges', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      const res = await binaryRequest(t.app, fileUrl(fx, big), {
        headers: { Range: 'bytes=-70000' },
      });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 130000-199999/200000');
      expect(res.body.equals(fx.files[big]!.content.subarray(130_000))).toBe(true);
    });

    it('answers 416 with Content-Range */size when unsatisfiable', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      for (const header of ['bytes=200000-', 'bytes=999999-1000000', 'bytes=-0']) {
        const res = await binaryRequest(t.app, fileUrl(fx, big), { headers: { Range: header } });
        expect(res.status, header).toBe(416);
        expect(res.headers['content-range']).toBe('bytes */200000');
        expect(binaryErrorCode(res)).toBe('RANGE_NOT_SATISFIABLE');
      }
    });

    it('ignores multiple, malformed and inverted ranges (full 200)', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      for (const header of [
        'bytes=0-10,20-30',
        'bytes=abc',
        'items=0-5',
        'bytes=10-5',
        'bytes=-',
      ]) {
        const res = await binaryRequest(t.app, fileUrl(fx, big), { headers: { Range: header } });
        expect(res.status, header).toBe(200);
        expect(res.body.length).toBe(200_000);
      }
    });

    it('honors If-Range only with the matching ETag', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      const first = await binaryRequest(t.app, fileUrl(fx, big), { method: 'head' });
      const etag = String(first.headers['etag']);

      const match = await binaryRequest(t.app, fileUrl(fx, big), {
        headers: { Range: 'bytes=10-19', 'If-Range': etag },
      });
      expect(match.status).toBe(206);
      expect(match.body.length).toBe(10);

      const mismatch = await binaryRequest(t.app, fileUrl(fx, big), {
        headers: { Range: 'bytes=10-19', 'If-Range': '"other"' },
      });
      expect(mismatch.status).toBe(200);
      expect(mismatch.body.length).toBe(200_000);
    });

    it('answers 416 for any range on an empty file but 200 without Range', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, { files: [{ name: 'empty', size: 0 }] });
      expect(
        (await binaryRequest(t.app, fileUrl(fx, 0), { headers: { Range: 'bytes=0-' } })).status,
      ).toBe(416);
      const res = await binaryRequest(t.app, fileUrl(fx, 0));
      expect([res.status, res.body.length, res.headers['content-length']]).toEqual([200, 0, '0']);
    });
  });

  describe('errors', () => {
    it('answers 404 FILE_NOT_FOUND for a file of another transfer or an unknown id', async () => {
      const t = await setup();
      const a = await createTransferFixture(t, { files: [{ name: 'a', size: 3 }] });
      const b = await createTransferFixture(t, { files: [{ name: 'b', size: 3 }] });
      const other = await binaryRequest(t.app, `/api/downloads/${a.token}/files/${b.files[0]!.id}`);
      expect(other.status).toBe(404);
      expect(binaryErrorCode(other)).toBe('FILE_NOT_FOUND');
    });

    it('answers 401 PASSWORD_REQUIRED without the unlock cookie and serves with it', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, {
        files: [{ name: 'a', size: 30 }],
        password: 'secret-pass',
      });
      const denied = await binaryRequest(t.app, fileUrl(fx, 0));
      expect(denied.status).toBe(401);
      expect(binaryErrorCode(denied)).toBe('PASSWORD_REQUIRED');

      const c = t.client();
      await c.post(`/api/downloads/${fx.token}/unlock`, {
        body: { password: 'secret-pass' },
        csrf: false,
      });
      const ok = await binaryRequest(t.app, fileUrl(fx, 0), {
        cookie: `es_dl=${c.cookie('es_dl')}`,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.equals(fx.files[0]!.content)).toBe(true);
    });

    it('answers 410 for revoked and expired links and 404 for a draft', async () => {
      const t = await setup();
      const revoked = await createTransferFixture(t, {
        files: [{ name: 'a', size: 3 }],
        status: 'revoked',
      });
      expect((await binaryRequest(t.app, fileUrl(revoked, 0))).status).toBe(410);
      const draft = await createTransferFixture(t, {
        files: [{ name: 'a', size: 3 }],
        status: 'uploading',
      });
      expect((await binaryRequest(t.app, fileUrl(draft, 0))).status).toBe(404);
      const live = await createTransferFixture(t, {
        files: [{ name: 'a', size: 3 }],
        expiresInSeconds: 30,
      });
      expect((await binaryRequest(t.app, fileUrl(live, 0))).status).toBe(200);
      t.clock.advance(31);
      const res = await binaryRequest(t.app, fileUrl(live, 0));
      expect(res.status).toBe(410);
      expect(binaryErrorCode(res)).toBe('TRANSFER_EXPIRED');
    });
  });

  describe('counting and logs', () => {
    it('counts a full download and a Range from 0, not a Range from a later byte or HEAD', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      const url = fileUrl(fx, indexOfSize(200_000));

      await binaryRequest(t.app, url);
      expect(countOf(t, fx.id).downloadCount).toBe(1);
      await binaryRequest(t.app, url, { headers: { Range: 'bytes=0-99' } });
      expect(countOf(t, fx.id).downloadCount).toBe(2);
      await binaryRequest(t.app, url, { headers: { Range: 'bytes=100-199' } });
      await binaryRequest(t.app, url, { headers: { Range: 'bytes=-50' } });
      await binaryRequest(t.app, url, { method: 'head' });
      expect(countOf(t, fx.id).downloadCount).toBe(2);
      expect(countOf(t, fx.id).firstDownloadedAt).not.toBeNull();
    });

    it('refuses full and Range requests once the limit is reached', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, {
        files: [{ name: 'a', size: 1000 }],
        maxDownloads: 1,
      });
      expect((await binaryRequest(t.app, fileUrl(fx, 0))).status).toBe(200);
      for (const headers of [
        {} as Record<string, string>,
        { Range: 'bytes=0-9' },
        { Range: 'bytes=500-' },
      ]) {
        const res = await binaryRequest(t.app, fileUrl(fx, 0), { headers });
        expect(res.status).toBe(410);
        expect(binaryErrorCode(res)).toBe('DOWNLOAD_LIMIT_REACHED');
      }
      expect(countOf(t, fx.id).downloadCount).toBe(1);
    });

    it('lets only one of two parallel requests take the last download', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, {
        files: [{ name: 'a', size: 1000 }],
        maxDownloads: 1,
      });
      const results = await Promise.all([
        binaryRequest(t.app, fileUrl(fx, 0)),
        binaryRequest(t.app, fileUrl(fx, 0)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
      expect(countOf(t, fx.id).downloadCount).toBe(1);
    });

    it('emails the owner once on the first download', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, {
        files: [{ name: 'a', size: 50 }],
        title: 'Report',
      });
      await binaryRequest(t.app, fileUrl(fx, 0));
      await vi.waitFor(() => expect(t.mailbox.sent).toHaveLength(1));
      expect(t.mailbox.last()?.to).toBe(fx.owner.email);
      expect(countOf(t, fx.id).notifiedAt).not.toBeNull();

      await binaryRequest(t.app, fileUrl(fx, 0));
      await binaryRequest(t.app, fileUrl(fx, 0), { headers: { Range: 'bytes=0-4' } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(t.mailbox.sent).toHaveLength(1);
      expect(countOf(t, fx.id).downloadCount).toBe(3);
    });

    it('logs the bytes really sent, for full and partial requests, without the raw IP', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t);
      const i = indexOfSize(200_000);
      await binaryRequest(t.app, fileUrl(fx, i), { headers: { 'User-Agent': 'x'.repeat(600) } });
      await binaryRequest(t.app, fileUrl(fx, i), { headers: { Range: 'bytes=1000-1999' } });
      await binaryRequest(t.app, fileUrl(fx, i), { method: 'head' });

      await vi.waitFor(() => expect(logsOf(t, fx.id)).toHaveLength(2));
      const logs = logsOf(t, fx.id).sort((a, b) => b.bytesSent - a.bytesSent);
      expect(logs.map((l) => l.bytesSent)).toEqual([200_000, 1000]);
      expect(logs[0]!.fileId).toBe(fx.files[i]!.id);
      expect(logs[0]!.userAgent).toHaveLength(512);
      expect(logs[0]!.ipHash).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });
  });

  describe('damaged stored files', () => {
    it('aborts the response of a tampered file and keeps serving the others', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, {
        files: [
          { name: 'bad', size: 200_000 },
          { name: 'good', size: 1000 },
        ],
      });
      const row = t.ctx.db
        .select()
        .from(transferFiles)
        .where(eq(transferFiles.id, fx.files[0]!.id))
        .get()!;
      const stored = storagePath(t.config, row.storageName);
      const bytes = readFileSync(stored);
      bytes[150_000] = bytes[150_000]! ^ 0xff;
      writeFileSync(stored, bytes);

      const bad = await binaryRequest(t.app, fileUrl(fx, 0));
      expect(bad.complete).toBe(false);
      expect(bad.body.length).toBeLessThan(200_000);

      const good = await binaryRequest(t.app, fileUrl(fx, 1));
      expect(good.status).toBe(200);
      expect(good.body.equals(fx.files[1]!.content)).toBe(true);
    });

    it('aborts a file with trailing data even when the range avoids the damage', async () => {
      const t = await setup();
      const fx = await createTransferFixture(t, { files: [{ name: 'a', size: 70_000 }] });
      const row = t.ctx.db.select().from(transferFiles).get()!;
      appendFileSync(storagePath(t.config, row.storageName), Buffer.from('junk'));
      const res = await binaryRequest(t.app, fileUrl(fx, 0), { headers: { Range: 'bytes=0-9' } });
      expect(res.complete).toBe(false);
    });
  });
});
