import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import type { TransferDetail } from '@easysend/shared';
import { createDecryptStream } from '../src/crypto/segments.js';
import { transferFiles, uploads } from '../src/db/schema/index.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';
import { tusFilePaths } from '../src/storage/paths.js';
import { storagePath } from '../src/storage/paths.js';
import {
  bodyAs,
  createTestApp,
  makeTempDir,
  type TestApp,
  type TestAppOverrides,
  type TestClient,
  type TestResponse,
  type TestUser,
} from './helpers.js';
import { loginAs } from './session-helpers.js';

export const TUS_HEADERS = { 'Tus-Resumable': '1.0.0' } as const;

/** App with its own data directories (storage and tus temp dir live under a temp DATA_DIR). */
export async function createUploadApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const t = await createTestApp({
    ...overrides,
    env: { DATA_DIR: makeTempDir(), ...overrides.env },
  });
  // `index.ts` creates these at startup.
  mkdirSync(t.config.storageDir, { recursive: true });
  mkdirSync(t.config.tmpUploadDir, { recursive: true });
  return t;
}

export async function userWithClient(
  t: TestApp,
  input: Parameters<TestApp['createUser']>[0] = {},
): Promise<{ user: TestUser; client: TestClient }> {
  const user = await t.createUser(input);
  return { user, client: loginAs(t, user) };
}

type TusMethod = 'post' | 'patch' | 'head' | 'delete' | 'options';

export interface TusRequestOptions {
  headers?: Record<string, string>;
  body?: Buffer;
  /** `false` omits the CSRF header; a string sends that value. */
  csrf?: boolean | string;
  /** Skips the session cookie. */
  anonymous?: boolean;
}

/** One raw tus request with the client's session cookie and CSRF token. */
export async function tusRequest(
  t: TestApp,
  client: TestClient,
  method: TusMethod,
  url: string,
  options: TusRequestOptions = {},
): Promise<TestResponse> {
  const req = supertest(t.app)[method](url);
  const session = client.cookie(SESSION_COOKIE);
  if (session && !options.anonymous) req.set('Cookie', `${SESSION_COOKIE}=${session}`);
  const csrf = options.csrf ?? true;
  const token = typeof csrf === 'string' ? csrf : csrf ? client.csrfToken : undefined;
  if (token) req.set('X-CSRF-Token', token);
  for (const [name, value] of Object.entries({ ...TUS_HEADERS, ...options.headers })) {
    req.set(name, value);
  }
  if (options.body) req.send(options.body);
  const res: TestResponse = await req;
  return res;
}

const b64 = (value: string): string => Buffer.from(value).toString('base64');

export function uploadMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => `${key} ${b64(value)}`)
    .join(',');
}

export async function createDraft(
  client: TestClient,
  body: Record<string, unknown> = {},
): Promise<TransferDetail> {
  const res = await client.post('/api/transfers', {
    body: { mode: 'link', expiresIn: '1w', ...body },
  });
  if (res.status !== 201) throw new Error(`draft not created: ${res.status}`);
  return bodyAs<TransferDetail>(res);
}

export interface TusCreateInput {
  transferId: string;
  filename?: string;
  filetype?: string;
  size: number;
}

export function tusCreate(
  t: TestApp,
  client: TestClient,
  input: TusCreateInput,
  options: TusRequestOptions = {},
): Promise<TestResponse> {
  return tusRequest(t, client, 'post', '/api/uploads', {
    ...options,
    headers: {
      'Upload-Length': String(input.size),
      'Upload-Metadata': uploadMetadata({
        transferId: input.transferId,
        filename: input.filename ?? 'file.bin',
        ...(input.filetype ? { filetype: input.filetype } : {}),
      }),
      ...options.headers,
    },
  });
}

export function tusPatch(
  t: TestApp,
  client: TestClient,
  location: string,
  offset: number,
  chunk: Buffer,
  options: TusRequestOptions = {},
): Promise<TestResponse> {
  return tusRequest(t, client, 'patch', location, {
    ...options,
    body: chunk,
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
      ...options.headers,
    },
  });
}

export const tusHead = (t: TestApp, client: TestClient, location: string) =>
  tusRequest(t, client, 'head', location);

export interface UploadedFile {
  id: string;
  location: string;
}

/** Creates the upload and sends all bytes in chunks. Returns after the last PATCH answered. */
export async function uploadBytes(
  t: TestApp,
  client: TestClient,
  input: Omit<TusCreateInput, 'size'> & { data: Buffer; chunkSize?: number },
): Promise<UploadedFile> {
  const created = await tusCreate(t, client, { ...input, size: input.data.length });
  if (created.status !== 201) throw new Error(`upload not created: ${created.status}`);
  const location = String(created.headers.location);
  const chunk = input.chunkSize ?? Math.max(1, input.data.length);
  for (let offset = 0; offset < input.data.length; offset += chunk) {
    const res = await tusPatch(
      t,
      client,
      location,
      offset,
      input.data.subarray(offset, offset + chunk),
    );
    if (res.status !== 204) throw new Error(`chunk rejected: ${res.status}`);
  }
  return { id: location.split('/').pop()!, location };
}

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Waits for the worker, then returns the stored file row of the transfer by index. */
export async function settle(t: TestApp): Promise<void> {
  await t.ctx.uploadWorker.idle();
}

export function filesOf(t: TestApp, transferId: string) {
  return t.db.db.select().from(transferFiles).where(eq(transferFiles.transferId, transferId)).all();
}

export function uploadRow(t: TestApp, id: string) {
  return t.db.db.select().from(uploads).where(eq(uploads.id, id)).get();
}

export function tmpFilesExist(t: TestApp, id: string): boolean {
  const { data, info } = tusFilePaths(t.config, id);
  return existsSync(data) || existsSync(info);
}

/** Decrypts a stored file back to bytes with the app's master key. */
export async function readStoredFile(
  t: TestApp,
  file: ReturnType<typeof filesOf>[number],
): Promise<Buffer> {
  const stream = createDecryptStream({
    path: storagePath(t.config, file.storageName),
    size: file.sizeBytes,
    noncePrefix: file.encNoncePrefix,
    segmentSize: file.encSegmentSize,
    wrappedKey: file.encKeyWrapped,
    fileKey: t.ctx.keys.file,
  });
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}
