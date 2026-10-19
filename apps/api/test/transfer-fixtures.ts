import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Express } from 'express';
import type { TransferStatus } from '@easysend/shared';
import { nowSeconds } from '../src/clock.js';
import { randomToken } from '../src/crypto/hash.js';
import { encryptFile } from '../src/crypto/segments.js';
import { transferFiles, transfers } from '../src/db/schema/index.js';
import { storagePath } from '../src/storage/paths.js';
import { makeTempDir, type TestApp, type TestUser } from './helpers.js';

/** Plaintext sizes around the 64 KiB segment boundary, plus empty and tiny files. */
export const FIXTURE_SIZES = [0, 1, 65_535, 65_536, 65_537, 200_000] as const;

export interface FixtureFile {
  id: string;
  name: string;
  content: Buffer;
}

export interface TransferFixtureOptions {
  owner?: TestUser;
  /** Default: one file per `FIXTURE_SIZES` entry, named `file-<size>.bin`. */
  files?: { name: string; size: number }[];
  /** Plain link password (hashed with the app's hasher). */
  password?: string;
  maxDownloads?: number | null;
  /** Seconds from the test clock's now. Default 1 hour. */
  expiresInSeconds?: number;
  status?: TransferStatus;
  title?: string | null;
  message?: string | null;
}

export interface TransferFixture {
  owner: TestUser;
  id: string;
  token: string;
  files: FixtureFile[];
}

/**
 * Inserts an owner's transfer with really encrypted files (via `encryptFile`, into the app's
 * `STORAGE_DIR`) directly in the database, so download tests do not depend on the upload code.
 */
export async function createTransferFixture(
  t: TestApp,
  options: TransferFixtureOptions = {},
): Promise<TransferFixture> {
  const owner = options.owner ?? (await t.createUser());
  const specs = options.files ?? FIXTURE_SIZES.map((size) => ({ name: `file-${size}.bin`, size }));
  const { ctx } = t;
  mkdirSync(ctx.config.storageDir, { recursive: true });
  const scratch = makeTempDir();
  const now = nowSeconds(ctx.clock);

  const transfer = ctx.db
    .insert(transfers)
    .values({
      ownerId: owner.id,
      token: randomToken(32),
      title: options.title ?? null,
      message: options.message ?? null,
      mode: 'link',
      expiresAt: now + (options.expiresInSeconds ?? 3600),
      passwordHash: options.password ? await ctx.passwordHasher.hash(options.password) : null,
      maxDownloads: options.maxDownloads ?? null,
      totalBytes: specs.reduce((sum, f) => sum + f.size, 0),
      status: options.status ?? 'active',
    })
    .returning({ id: transfers.id, token: transfers.token })
    .get();

  const files: FixtureFile[] = [];
  for (const [index, spec] of specs.entries()) {
    const content = randomBytes(spec.size);
    const srcPath = path.join(scratch, `src-${index}`);
    writeFileSync(srcPath, content);
    const storageName = randomUUID();
    const enc = await encryptFile({
      srcPath,
      dstPath: storagePath(ctx.config, storageName),
      size: spec.size,
      fileKey: ctx.keys.file,
    });
    const row = ctx.db
      .insert(transferFiles)
      .values({
        transferId: transfer.id,
        originalName: spec.name,
        storageName,
        sizeBytes: spec.size,
        storedSizeBytes: enc.storedSize,
        sha256: enc.sha256,
        encKeyWrapped: enc.wrappedKey,
        encNoncePrefix: enc.noncePrefix,
        encSegmentSize: enc.segmentSize,
        encVersion: enc.version,
      })
      .returning({ id: transferFiles.id })
      .get();
    files.push({ id: row.id, name: spec.name, content });
  }
  return { owner, id: transfer.id, token: transfer.token, files };
}

// ---- Binary downloads -------------------------------------------------------------------

export interface BinaryResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** False when the connection broke before the body was complete. */
  complete: boolean;
}

/**
 * GET (or HEAD) over a real socket that keeps the raw body as a Buffer. A broken connection
 * (tampered file) does not throw: it returns what arrived with `complete: false`.
 */
export async function binaryRequest(
  app: Express,
  url: string,
  options: { method?: 'get' | 'head'; headers?: Record<string, string>; cookie?: string } = {},
): Promise<BinaryResponse> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const headers = { ...options.headers, ...(options.cookie ? { Cookie: options.cookie } : {}) };
  try {
    return await new Promise<BinaryResponse>((resolve) => {
      const method = (options.method ?? 'get').toUpperCase();
      const req = request({ host: '127.0.0.1', port, path: url, method, headers, agent: false });
      req.on('error', () =>
        resolve({ status: 0, headers: {}, body: Buffer.alloc(0), complete: false }),
      );
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        let broken = false;
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', () => {
          broken = true;
        });
        res.on('close', () => {
          const body = Buffer.concat(chunks);
          const declared = Number(res.headers['content-length'] ?? body.length);
          const complete =
            !broken && res.complete && (method === 'HEAD' || body.length === declared);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, complete });
        });
      });
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Error code of a standard JSON error body received through `binaryRequest`. */
export function binaryErrorCode(res: BinaryResponse): string {
  const body = JSON.parse(res.body.toString()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}
