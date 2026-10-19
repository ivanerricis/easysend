import { asc, eq } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { pipeline, type Readable, type Transform } from 'node:stream';
import { ZipFile } from 'yazl';
import type { DownloadInfoResponse, ZipQuery } from '@easysend/shared';
import type { AppContext } from '../context.js';
import { sha256Hex } from '../crypto/hash.js';
import { createDecryptStream } from '../crypto/segments.js';
import { transferFiles, users } from '../db/schema/index.js';
import {
  assertUnlocked,
  isUnlocked,
  resolveTransfer,
  setUnlockCookie,
} from '../downloads/access.js';
import { parseRange } from '../downloads/range.js';
import { claimDownload, logDownloadOnClose } from '../downloads/record.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited, limitedError } from '../http/rate-limit.js';
import { sendJson, validBody, validParams, validQuery } from '../http/validate.js';
import { contentDisposition, dedupeNames, sanitizeFileName } from '../storage/filenames.js';
import { storagePath } from '../storage/paths.js';
import type { TransferRow } from '../transfers/service.js';

type FileRow = typeof transferFiles.$inferSelect;

/**
 * Public download API (phase 3): `/downloads/:token` (info, unlock, file, zip). These endpoints
 * never need a session. Mounted under `/api` by `app.ts`.
 */
export function downloadsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, transferLimiters } = ctx;

  const filesOf = (transferId: string): FileRow[] =>
    db
      .select()
      .from(transferFiles)
      .where(eq(transferFiles.transferId, transferId))
      .orderBy(asc(transferFiles.originalName), asc(transferFiles.createdAt))
      .all();

  const decryptStream = (file: FileRow, range?: { start: number; end: number }): Readable =>
    createDecryptStream({
      path: storagePath(ctx.config, file.storageName),
      size: file.sizeBytes,
      wrappedKey: file.encKeyWrapped,
      fileKey: ctx.keys.file,
      noncePrefix: file.encNoncePrefix,
      segmentSize: file.encSegmentSize,
      ...range,
    });

  /** Sends `source` through the byte counter to `res`; a failure after the headers drops the connection. */
  function stream(
    source: Readable,
    res: Response,
    counter: Transform,
    ids: { transferId: string; fileId: string | null },
  ): void {
    pipeline(source, counter, res, (error) => {
      if (!error) return;
      const aborted = error.code === 'ERR_STREAM_PREMATURE_CLOSE';
      // Ids and the error name only: never paths or content.
      ctx.logger[aborted ? 'debug' : 'error'](
        { ...ids, errorName: error.name },
        aborted ? 'download aborted by the client' : 'download stream failed',
      );
      res.destroy();
    });
  }

  router.get(
    '/downloads/:token',
    ...endpointGuards(ctx.csrf, 'downloads.info'),
    async (req, res) => {
      const { token } = validParams<{ token: string }>(req);
      const { transfer, nowSec } = await resolveTransfer(ctx, req, res, token);
      if (!isUnlocked(ctx, req, transfer, nowSec)) {
        sendJson(res, 'downloads.info', 200, { locked: true, expiresAt: transfer.expiresAt });
        return;
      }
      const owner = db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, transfer.ownerId))
        .get();
      const files = filesOf(transfer.id);
      const info: DownloadInfoResponse = {
        locked: false,
        title: transfer.title,
        message: transfer.message,
        senderName: owner?.displayName ?? null,
        files: files.map((f) => ({ id: f.id, name: f.originalName, sizeBytes: f.sizeBytes })),
        totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
        expiresAt: transfer.expiresAt,
        downloadCount: transfer.downloadCount,
        maxDownloads: transfer.maxDownloads,
      };
      sendJson(res, 'downloads.info', 200, info);
    },
  );

  router.post(
    '/downloads/:token/unlock',
    ...endpointGuards(ctx.csrf, 'downloads.unlock'),
    async (req, res) => {
      const { token } = validParams<{ token: string }>(req);
      const { transfer, ipHash, nowSec } = await resolveTransfer(ctx, req, res, token);
      if (transfer.passwordHash === null) {
        res.status(204).end();
        return;
      }
      const { downloadPasswordToken, downloadPasswordIp } = transferLimiters;
      const ipKey = `${token}:${ipHash}`;
      assertNotLimited(res, await downloadPasswordToken.check(token));
      assertNotLimited(res, await downloadPasswordIp.check(ipKey));

      const { password } = validBody<{ password: string }>(req);
      if (!(await ctx.passwordHasher.verify(transfer.passwordHash, password))) {
        const [byToken, byIp] = await Promise.all([
          downloadPasswordToken.fail(token),
          downloadPasswordIp.fail(ipKey),
        ]);
        const limited = [byToken, byIp].filter((s) => s.limited);
        if (limited.length > 0) {
          throw limitedError(res, Math.max(...limited.map((s) => s.retryAfterSeconds)));
        }
        throw new AppError('PASSWORD_INCORRECT', 'Incorrect password');
      }
      await downloadPasswordIp.reset(ipKey);
      setUnlockCookie(ctx, res, transfer, nowSec);
      res.status(204).end();
    },
  );

  router.get(
    '/downloads/:token/files/:fileId',
    ...endpointGuards(ctx.csrf, 'downloads.file'),
    async (req, res) => {
      const { token, fileId } = validParams<{ token: string; fileId: string }>(req);
      const { transfer, ipHash, nowSec } = await resolveTransfer(ctx, req, res, token);
      assertUnlocked(ctx, req, transfer, nowSec);
      const file = filesOf(transfer.id).find((f) => f.id === fileId);
      if (!file) throw new AppError('FILE_NOT_FOUND', 'File not found');

      const etag = `"${(file.sha256 ?? sha256Hex(file.id)).slice(0, 32)}"`;
      const ifRange = req.get('if-range')?.trim();
      const parsed =
        ifRange !== undefined && ifRange !== etag
          ? ({ kind: 'ignore' } as const)
          : parseRange(req.get('range'), file.sizeBytes);
      if (parsed.kind === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${file.sizeBytes}`);
        throw new AppError('RANGE_NOT_SATISFIABLE', 'Range not satisfiable');
      }

      const partial = parsed.kind === 'range' ? parsed.range : undefined;
      const length = partial ? partial.end - partial.start + 1 : file.sizeBytes;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition(file.originalName));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(length));
      if (partial) {
        res.setHeader('Content-Range', `bytes ${partial.start}-${partial.end}/${file.sizeBytes}`);
        res.status(206);
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      // Built before counting (it is lazy, nothing is opened yet) so a failure does not cost a download.
      const source = decryptStream(file, partial);
      try {
        // Only a request that starts at byte 0 counts; resuming ranges are only logged.
        if (!partial || partial.start === 0) claimDownload(ctx, transfer);
      } catch (error) {
        source.destroy();
        throw error;
      }
      const counter = logDownloadOnClose(ctx, req, res, {
        transferId: transfer.id,
        fileId: file.id,
        ipHash,
      });
      stream(source, res, counter, { transferId: transfer.id, fileId: file.id });
    },
  );

  /** Files selected by `fileIds` (all when omitted); an id that is not in the transfer is a 404. */
  function selectFiles(transfer: TransferRow, query: ZipQuery): FileRow[] {
    const all = filesOf(transfer.id);
    if (query.fileIds === undefined) return all;
    const wanted = new Set(
      query.fileIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    );
    const known = new Set(all.map((f) => f.id));
    if (wanted.size === 0 || [...wanted].some((id) => !known.has(id))) {
      throw new AppError('FILE_NOT_FOUND', 'File not found');
    }
    return all.filter((f) => wanted.has(f.id));
  }

  /** Total zip size when every entry is stored with a known size (yazl calls back during `end`). */
  const zipSize = (zip: ZipFile): Promise<number> =>
    new Promise((resolve) => {
      // The @types/yazl signature omits the size argument of the callback and marks both options required.
      const callback = resolve as unknown as () => void;
      zip.end({ forceZip64Format: false, comment: '' }, callback);
    });

  router.get(
    '/downloads/:token/zip',
    ...endpointGuards(ctx.csrf, 'downloads.zip'),
    async (req, res) => {
      const { token } = validParams<{ token: string }>(req);
      const { transfer, ipHash, nowSec } = await resolveTransfer(ctx, req, res, token);
      assertUnlocked(ctx, req, transfer, nowSec);
      const files = selectFiles(transfer, validQuery<ZipQuery>(req));

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        contentDisposition(`${transfer.title?.trim() || 'easysend'}.zip`),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') {
        // The size would need the zip to be assembled: left out for HEAD.
        res.end();
        return;
      }

      claimDownload(ctx, transfer);
      const counter = logDownloadOnClose(ctx, req, res, {
        transferId: transfer.id,
        fileId: null,
        ipHash,
      });
      const zip = new ZipFile();
      // @types/yazl declares the legacy stream type; at runtime it is a PassThrough.
      const zipOutput = zip.outputStream as Readable;
      // yazl does not forward errors of the entry streams: they all end up here and drop the response.
      zip.on('error', (error) => zipOutput.destroy(error as Error));
      let current: Readable | undefined;
      res.once('close', () => current?.destroy());

      const names = dedupeNames(files.map((f) => sanitizeFileName(f.originalName)));
      files.forEach((file, index) => {
        // Lazy: a file is opened only when yazl reaches its entry, so one is open at a time.
        zip.addReadStreamLazy(
          names[index]!,
          { compress: false, size: file.sizeBytes, mtime: new Date(file.createdAt * 1000) },
          (callback) => {
            try {
              current = decryptStream(file);
              current.on('error', (error) => zip.emit('error', error));
              callback(null, current);
            } catch (error) {
              zip.emit('error', error);
            }
          },
        );
      });
      const total = await zipSize(zip);
      if (total >= 0) res.setHeader('Content-Length', String(total));
      stream(zipOutput, res, counter, { transferId: transfer.id, fileId: null });
    },
  );

  return router;
}
