import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileStore } from '@tus/file-store';
import { ERRORS, EVENTS, Server, type ServerOptions } from '@tus/server';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  MAX_FILES_PER_TRANSFER,
  tusUploadMetadataSchema,
  tusUploadParamsSchema,
  type ErrorCode,
  type TusUploadMetadata,
} from '@easysend/shared';
import { TUS_BASE_PATH, TUS_VERSION } from '@easysend/shared/contract';
import { requireAuth } from '../auth/guards.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { transferFiles, transfers, uploads, users } from '../db/schema/index.js';
import { cookieParser } from '../http/cookies.js';
import { AppError } from '../http/errors.js';
import { getRequestId } from '../http/request-id.js';
import { reserveBytes } from '../storage/disk.js';
import { sanitizeFileName } from '../storage/filenames.js';

type TusRequest = Parameters<NonNullable<ServerOptions['onIncomingRequest']>>[0];
type ResponseMapping = { status_code: number; body: string };

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
/** Upload statuses that still hold space (counted against the quota and the file limit). */
const ACTIVE_UPLOAD_STATUSES = ['in_progress', 'processing'] as const;

/**
 * `FileStore` limited to the extensions the contract advertises (no deferred length) whose
 * `write` reports a full disk as `INSUFFICIENT_DISK_SPACE`: the stock one turns every failure
 * into a generic 500 and the bytes already written stay valid for the next resume.
 */
class DiskAwareFileStore extends FileStore {
  constructor(options: ConstructorParameters<typeof FileStore>[0]) {
    super(options);
    this.extensions = ['creation', 'termination', 'expiration'];
  }

  override async write(readable: Readable, fileId: string, offset: number): Promise<number> {
    const writable = createWriteStream(path.join(this.directory, fileId), {
      flags: 'r+',
      start: offset,
    });
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(readable, counter, writable);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new AppError('INSUFFICIENT_DISK_SPACE', 'Not enough free disk space');
      }
      // tus errors are plain `{ status_code, body }` objects by design.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw ERRORS.FILE_WRITE_ERROR;
    }
    return offset + received;
  }
}

/** The Express request behind a tus (srvx) request: it carries `auth` and the request id. */
function expressRequest(req: TusRequest): Request {
  const node = (req as unknown as { runtime?: { node?: { req?: Request } } }).runtime?.node;
  if (!node?.req) throw new Error('tus request without a Node request');
  return node.req;
}

function authOf(req: TusRequest) {
  const auth = expressRequest(req).auth;
  if (!auth || auth.level !== 'session') {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return auth;
}

/** Standard error code for an error raised by tus itself, from its HTTP status. */
function codeForStatus(status: number): ErrorCode {
  return STATUS_CODES[status as keyof typeof STATUS_CODES] ?? 'INTERNAL_ERROR';
}
const STATUS_CODES = {
  400: 'VALIDATION_ERROR',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'NOT_FOUND',
  412: 'VALIDATION_ERROR',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
} as const;

const errorBody = (
  req: TusRequest,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): string =>
  JSON.stringify({
    error: {
      code,
      message,
      requestId: getRequestId(expressRequest(req)),
      ...(details ? { details } : {}),
    },
  });

function uploadIdOf(req: Request): string | undefined {
  const last = req.path.split('/').filter(Boolean).pop();
  if (!last || last === 'uploads') return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return undefined;
  }
}

/**
 * Makes error responses of tus (plain text by default) declare `application/json`: our
 * `onResponseError` sets `res.locals.tusJsonError` for every error it turns into the standard
 * body. srvx writes the head with `writeHead(status, statusText, [name, value, ...])`.
 */
function declareJsonErrors(res: Response): void {
  const original = res.writeHead.bind(res) as (...args: unknown[]) => Response;
  res.writeHead = ((...args: unknown[]) => {
    const headers = args[args.length - 1];
    if (res.locals.tusJsonError === true && Array.isArray(headers)) {
      for (let i = 0; i < headers.length - 1; i += 2) {
        if (String(headers[i]).toLowerCase() === 'content-type') {
          headers[i + 1] = 'application/json; charset=utf-8';
        }
      }
    }
    return original(...args);
  }) as Response['writeHead'];
}

export function uploadsRouter(ctx: AppContext): Router {
  const { config, db } = ctx;
  const ttlSeconds = config.incompleteUploadTtlHours * 3600;

  // ---- Hook helpers ------------------------------------------------------------------------

  /** Draft owned by `userId` (admins do not upload into other people's drafts). */
  function uploadableDraft(
    reader: Pick<typeof db, 'select'>,
    userId: string,
    transferId: string,
  ): typeof transfers.$inferSelect {
    const row = reader.select().from(transfers).where(eq(transfers.id, transferId)).get();
    if (!row || row.ownerId !== userId) {
      throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found');
    }
    if (row.status !== 'uploading') {
      throw new AppError('TRANSFER_NOT_UPLOADABLE', 'The transfer no longer accepts files');
    }
    return row;
  }

  function parseMetadata(upload: { metadata?: Record<string, string | null | undefined> }) {
    const parsed = tusUploadMetadataSchema.safeParse(upload.metadata ?? {});
    if (!parsed.success) {
      throw new AppError('INVALID_UPLOAD_METADATA', 'Invalid upload metadata', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    return parsed.data;
  }

  /**
   * Checks the file limit and the quota and inserts the `uploads` row, synchronously in one
   * transaction: two creations racing each other cannot both pass the checks.
   */
  function registerUpload(
    userId: string,
    uploadId: string,
    size: number,
    metadata: TusUploadMetadata,
  ): void {
    const now = nowSeconds(ctx.clock);
    db.transaction((tx) => {
      uploadableDraft(tx, userId, metadata.transferId);
      const files = tx
        .select({ n: count() })
        .from(transferFiles)
        .where(eq(transferFiles.transferId, metadata.transferId))
        .get()!.n;
      const pending = tx
        .select({ n: count() })
        .from(uploads)
        .where(
          and(
            eq(uploads.transferId, metadata.transferId),
            inArray(uploads.status, ACTIVE_UPLOAD_STATUSES),
          ),
        )
        .get()!.n;
      if (files + pending >= MAX_FILES_PER_TRANSFER) {
        throw new AppError('VALIDATION_ERROR', 'Too many files in this transfer', {
          limit: MAX_FILES_PER_TRANSFER,
        });
      }

      const user = tx.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
      if (user.quotaBytes !== null) {
        const inFlight =
          tx
            .select({ total: sql<number>`coalesce(sum(${uploads.totalSize}), 0)` })
            .from(uploads)
            .where(
              and(eq(uploads.ownerId, userId), inArray(uploads.status, ACTIVE_UPLOAD_STATUSES)),
            )
            .get()?.total ?? 0;
        if (user.usedBytes + inFlight + size > user.quotaBytes) {
          throw new AppError('QUOTA_EXCEEDED', 'Storage quota exceeded', {
            quotaBytes: user.quotaBytes,
            usedBytes: user.usedBytes,
          });
        }
      }

      tx.insert(uploads)
        .values({
          id: uploadId,
          ownerId: userId,
          transferId: metadata.transferId,
          fileName: sanitizeFileName(metadata.filename),
          totalSize: size,
          status: 'in_progress',
          createdAt: now,
          lastActivityAt: now,
          expiresAt: now + ttlSeconds,
        })
        .run();
    });
  }

  // ---- tus server --------------------------------------------------------------------------

  const tus = new Server({
    path: TUS_BASE_PATH,
    datastore: new DiskAwareFileStore({
      directory: config.tmpUploadDir,
      expirationPeriodInMilliseconds: ttlSeconds * 1000,
    }),
    relativeLocation: true,
    namingFunction: () => randomUUID(),
    disableTerminationForFinishedUploads: true,
    // Same-origin app: no wildcard CORS header (an empty list never allows an origin).
    allowedOrigins: [],

    onIncomingRequest(req, uploadId) {
      // A creation has no row yet: `onUploadCreate` checks and inserts it.
      if (req.method === 'POST') return Promise.resolve();
      const userId = authOf(req).user.id;
      // Validate the id (contract schema) before any DB access; invalid reads as "not found".
      if (!tusUploadParamsSchema.safeParse({ id: uploadId }).success) {
        throw new AppError('NOT_FOUND', 'Upload not found');
      }
      const row = db
        .select()
        .from(uploads)
        .where(and(eq(uploads.id, uploadId), eq(uploads.ownerId, userId)))
        .get();
      if (!row || row.status === 'aborted') throw new AppError('NOT_FOUND', 'Upload not found');
      if (req.method === 'PATCH' || req.method === 'DELETE') {
        if (row.status !== 'in_progress') {
          throw new AppError('CONFLICT', 'The upload is already complete');
        }
      }
      if (req.method === 'PATCH') {
        db.update(uploads)
          .set({ lastActivityAt: nowSeconds(ctx.clock) })
          .where(eq(uploads.id, uploadId))
          .run();
      }
      return Promise.resolve();
    },

    async onUploadCreate(req, upload) {
      const userId = authOf(req).user.id;
      const metadata = parseMetadata(upload);
      if (upload.size === undefined) {
        throw new AppError('VALIDATION_ERROR', 'Upload-Length is required');
      }
      uploadableDraft(db, userId, metadata.transferId);

      const { freeBytes } = await ctx.diskSpace(config.storageDir);
      if (freeBytes - reserveBytes(ctx) < 2 * upload.size) {
        throw new AppError('INSUFFICIENT_DISK_SPACE', 'Not enough free disk space');
      }
      registerUpload(userId, upload.id, upload.size, metadata);
      return {};
    },

    onUploadFinish(_req, upload) {
      const now = nowSeconds(ctx.clock);
      const changed = db
        .update(uploads)
        .set({ status: 'processing', lastActivityAt: now })
        .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'in_progress')))
        .run().changes;
      if (changed > 0) ctx.uploadWorker.enqueue(upload.id);
      return Promise.resolve({});
    },

    onResponseError(req, error): ResponseMapping {
      const failure = error as Partial<ResponseMapping> & Error;
      let status: number;
      let body: string;
      if (error instanceof AppError) {
        status = error.status;
        body = errorBody(req, error.code, error.message, error.details);
      } else if (
        typeof failure.status_code === 'number' &&
        (failure.status_code < 500 || failure.status_code === 501)
      ) {
        // 501: an unsupported tus extension (deferred length) is a client error for us.
        status = failure.status_code === 501 ? 400 : failure.status_code;
        const message = String(failure.body ?? '').trim() || 'Upload error';
        body = errorBody(req, codeForStatus(status), message);
      } else {
        // 5xx from tus or a bug: the log keeps the cause, the client gets a generic message.
        ctx.logger.error({ err: error, requestId: getRequestId(expressRequest(req)) }, 'tus error');
        status = 500;
        body = errorBody(req, 'INTERNAL_ERROR', 'Internal server error');
      }
      expressRequest(req).res!.locals.tusJsonError = true;
      return { status_code: status, body };
    },
  });

  // Termination: tus removed the files, now the row goes too.
  tus.on(EVENTS.POST_TERMINATE, (_req: unknown, _res: unknown, id: string) => {
    db.delete(uploads).where(eq(uploads.id, id)).run();
  });

  // ---- Express chain -----------------------------------------------------------------------

  const requireCsrfWhenUnsafe: RequestHandler = (req, res, next) =>
    UNSAFE_METHODS.has(req.method) ? ctx.csrf.requireCsrf(req, res, next) : next();

  /**
   * `HEAD` of an upload that tus no longer has (the worker removes its files) but whose row is
   * `processing` or `completed`: answer "complete" so clients do not start it again.
   */
  const headShortcut: RequestHandler = (req, res, next) => {
    if (req.method !== 'HEAD') return next();
    const id = uploadIdOf(req);
    // An invalid id never reaches the DB: tus rejects it in `onIncomingRequest`.
    const row =
      id && tusUploadParamsSchema.safeParse({ id }).success
        ? db
            .select()
            .from(uploads)
            .where(and(eq(uploads.id, id), eq(uploads.ownerId, req.auth!.user.id)))
            .get()
        : undefined;
    if (!row || (row.status !== 'processing' && row.status !== 'completed')) return next();
    res
      .status(200)
      .set({
        'Tus-Resumable': TUS_VERSION,
        'Cache-Control': 'no-store',
        'Upload-Offset': String(row.totalSize),
        'Upload-Length': String(row.totalSize),
      })
      .end();
  };

  const handleTus = (req: Request, res: Response, next: NextFunction): void => {
    declareJsonErrors(res);
    tus.handle(req, res).catch(next);
  };

  const router = Router();
  // Absolute paths: `handle()` reads the raw URL, so the router is mounted at the root.
  router.all(
    [TUS_BASE_PATH, `${TUS_BASE_PATH}/*splat`],
    cookieParser,
    ctx.csrf.rejectCrossSite,
    ctx.sessions.loadSession,
    requireAuth('session'),
    requireCsrfWhenUnsafe,
    headShortcut,
    handleTus,
  );
  return router;
}
