import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import type { S3Config, StorageTestReason } from '@easysend/shared';
import { AppError } from '../../http/errors.js';
import type { Logger } from '../../logger.js';
import { StorageObjectNotFoundError } from '../types.js';

/** Timeout of metadata calls (HEAD, DELETE, LIST, multipart control). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Timeout of calls that move a whole part (PUT of a part, GET of a range). */
const TRANSFER_TIMEOUT_MS = 300_000;

export interface S3ClientDeps {
  fetch: typeof fetch;
  logger: Logger;
  requestTimeoutMs?: number;
  transferTimeoutMs?: number;
}

/**
 * A failed S3 call. `details.reason` is one of the safe `STORAGE_TEST_REASONS` (the only thing
 * that may reach an admin); `transient` says whether retrying the same call can help.
 */
export class S3RequestError extends AppError {
  readonly transient: boolean;
  constructor(reason: StorageTestReason, transient: boolean) {
    super('STORAGE_UNAVAILABLE', MESSAGES[reason], { reason });
    this.name = 'S3RequestError';
    this.transient = transient;
  }
}

const MESSAGES: Record<StorageTestReason, string> = {
  ACCESS_DENIED: 'The storage refused the credentials or the operation',
  NO_SUCH_BUCKET: 'The storage bucket does not exist',
  SIGNATURE: 'The storage rejected the request signature (check the keys and the server clock)',
  TIMEOUT: 'The storage did not answer in time',
  NETWORK: 'The storage could not be reached',
  ENDPOINT: 'The storage endpoint is not valid or not reachable',
};

// ---- Tiny XML reading (the few S3 responses we use have a flat, predictable shape) -----------
const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    switch (entity.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = entity.startsWith('#x')
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      }
    }
  });

const blocksOf = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1] ?? '');

const fieldOf = (xml: string, tag: string): string | undefined => {
  const value = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
  return value === undefined ? undefined : decodeEntities(value);
};

const timestampSchema = z
  .string()
  .transform((value) => Date.parse(value))
  .refine((value) => Number.isFinite(value));

const listPageSchema = z.object({
  objects: z.array(z.object({ key: z.string().min(1), modified: timestampSchema })),
  truncated: z.boolean(),
  next: z.string().optional(),
});
const uploadsPageSchema = z.object({
  uploads: z.array(
    z.object({ key: z.string().min(1), uploadId: z.string().min(1), initiated: timestampSchema }),
  ),
  truncated: z.boolean(),
  nextKey: z.string().optional(),
  nextUploadId: z.string().optional(),
});
const uploadIdSchema = z.string().min(1);

export interface S3ListedObject {
  key: string;
  mtimeSeconds: number;
}
export interface S3ListPage {
  objects: S3ListedObject[];
  nextToken: string | undefined;
}
export interface S3PendingUpload {
  key: string;
  uploadId: string;
  initiatedMs: number;
}
export interface S3UploadsPage {
  uploads: S3PendingUpload[];
  next: { keyMarker: string; uploadIdMarker: string } | undefined;
}

export interface S3Client {
  /** Object key for a name (prefix applied). */
  keyOf(name: string): string;
  /** Prefix of every key of this storage including the trailing slash ('' for the bucket root). */
  readonly keyPrefix: string;
  putObject(name: string, body: Buffer): Promise<void>;
  createMultipartUpload(name: string): Promise<string>;
  uploadPart(name: string, uploadId: string, partNumber: number, body: Buffer): Promise<string>;
  completeMultipartUpload(
    name: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** Reads `length` bytes from `offset` (inclusive range). Throws `StorageObjectNotFoundError`. */
  getRange(name: string, offset: number, length: number): Promise<Buffer>;
  /** Size of an object. Throws `StorageObjectNotFoundError`. */
  headObject(name: string): Promise<number>;
  /** Deletes an object; a missing object is success. */
  deleteObject(name: string): Promise<void>;
  listObjects(options?: { token?: string; maxKeys?: number }): Promise<S3ListPage>;
  listMultipartUploads(options?: {
    keyMarker?: string;
    uploadIdMarker?: string;
  }): Promise<S3UploadsPage>;
}

/** Encodes an object key for the URL path: each segment percent-encoded, slashes kept. */
export const encodeKey = (key: string): string =>
  key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');

const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

/** Maps an S3 error answer to a safe reason; undefined when it is not one we know. */
function reasonOfResponse(
  status: number,
  code: string | undefined,
): { reason: StorageTestReason; transient: boolean } {
  switch (code) {
    case 'NoSuchBucket':
      return { reason: 'NO_SUCH_BUCKET', transient: false };
    case 'SignatureDoesNotMatch':
    case 'RequestTimeTooSkewed':
    case 'InvalidSignatureException':
    case 'AuthorizationQueryParametersError':
      return { reason: 'SIGNATURE', transient: false };
    case 'AccessDenied':
    case 'InvalidAccessKeyId':
    case 'AllAccessDisabled':
    case 'AccountProblem':
    case 'ExpiredToken':
      return { reason: 'ACCESS_DENIED', transient: false };
    case 'PermanentRedirect':
    case 'AuthorizationHeaderMalformed':
    case 'InvalidRegion':
    case 'IllegalLocationConstraintException':
      return { reason: 'ENDPOINT', transient: false };
    default:
  }
  if (status === 401 || status === 403) return { reason: 'ACCESS_DENIED', transient: false };
  if (status === 301 || status === 307 || status === 400 || status === 404) {
    return { reason: 'ENDPOINT', transient: false };
  }
  return { reason: 'NETWORK', transient: status >= 500 || status === 429 };
}

/** Maps an exception thrown by `fetch` to a safe reason. */
function reasonOfFailure(error: unknown): { reason: StorageTestReason; transient: boolean } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError')
    return { reason: 'TIMEOUT', transient: true };
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (
    error instanceof TypeError &&
    (/invalid url/i.test(error.message) || code === 'ERR_INVALID_URL')
  ) {
    return { reason: 'ENDPOINT', transient: false };
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code.startsWith('ERR_TLS') ||
    code.startsWith('CERT_') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER'
  ) {
    return { reason: 'ENDPOINT', transient: false };
  }
  return { reason: 'NETWORK', transient: true };
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

/**
 * Thin S3 client on `aws4fetch` (SigV4 only; no SDK). Keys and signatures only go into the
 * Authorization header: they never reach a log line, an error or a detail. Logs carry the
 * operation, the object name (a UUID), the status and the reason, never the URL or its query.
 */
export function createS3Client(config: S3Config, deps: S3ClientDeps): S3Client {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const transferTimeoutMs = deps.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS;
  const keyPrefix = config.prefix ? `${config.prefix.replace(/\/+$/, '')}/` : '';
  const keyOf = (name: string): string => `${keyPrefix}${name}`;

  /** URL of a bucket-level (`key` undefined) or object request. */
  function urlOf(key: string | undefined, query: Record<string, string | undefined>): string {
    let base: URL;
    try {
      base = new URL(config.endpoint);
    } catch {
      throw new S3RequestError('ENDPOINT', false);
    }
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new S3RequestError('ENDPOINT', false);
    }
    const suffix = key === undefined ? '' : `/${encodeKey(key)}`;
    let origin: string;
    let path: string;
    if (config.forcePathStyle) {
      origin = base.origin;
      path = `${base.pathname.replace(/\/+$/, '')}/${config.bucket}${suffix}`;
    } else {
      origin = `${base.protocol}//${config.bucket}.${base.host}`;
      path = `${base.pathname.replace(/\/+$/, '')}${suffix}` || '/';
    }
    const search = Object.entries(query)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([k, v]) =>
        v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
      )
      .join('&');
    return `${origin}${path || '/'}${search ? `?${search}` : ''}`;
  }

  async function send(
    op: string,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD',
    key: string | undefined,
    options: {
      query?: Record<string, string | undefined>;
      headers?: Record<string, string>;
      body?: Buffer | string;
      transfer?: boolean;
      /** Statuses handed back to the caller instead of being treated as failures. */
      accept?: number[];
    } = {},
  ): Promise<RawResponse> {
    const url = urlOf(key, options.query ?? {});
    const body = options.body === undefined ? undefined : options.body;
    const headers: Record<string, string> = {
      ...options.headers,
      'X-Amz-Content-Sha256': sha256Hex(body ?? ''),
    };
    const logContext = { op, name: key === undefined ? undefined : key.slice(keyPrefix.length) };
    let response: Response;
    try {
      const signed = await aws.sign(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      response = await deps.fetch(signed.url, {
        method,
        headers: signed.headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        signal: AbortSignal.timeout(options.transfer ? transferTimeoutMs : requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof S3RequestError) throw error;
      const { reason, transient } = reasonOfFailure(error);
      deps.logger.warn({ ...logContext, reason }, 's3 request failed');
      throw new S3RequestError(reason, transient);
    }

    let payload: Buffer;
    try {
      payload = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      const { reason, transient } = reasonOfFailure(error);
      deps.logger.warn({ ...logContext, reason }, 's3 response read failed');
      throw new S3RequestError(reason, transient);
    }
    deps.logger.debug({ ...logContext, status: response.status }, 's3 response');

    if (response.ok || options.accept?.includes(response.status)) {
      return { status: response.status, headers: response.headers, body: payload };
    }
    const code = fieldOf(payload.toString('utf8'), 'Code');
    const { reason, transient } = reasonOfResponse(response.status, code);
    deps.logger.warn(
      { ...logContext, status: response.status, code, reason },
      's3 request refused',
    );
    throw new S3RequestError(reason, transient);
  }

  const text = (raw: RawResponse): string => raw.body.toString('utf8');
  const malformed = (): S3RequestError => new S3RequestError('ENDPOINT', false);

  return {
    keyOf,
    keyPrefix,

    async putObject(name, body) {
      await send('put', 'PUT', keyOf(name), {
        body,
        transfer: true,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    },

    async createMultipartUpload(name) {
      const raw = await send('create-multipart', 'POST', keyOf(name), {
        query: { uploads: '' },
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const id = uploadIdSchema.safeParse(fieldOf(text(raw), 'UploadId'));
      if (!id.success) throw malformed();
      return id.data;
    },

    async uploadPart(name, uploadId, partNumber, body) {
      const raw = await send('upload-part', 'PUT', keyOf(name), {
        query: { partNumber: String(partNumber), uploadId },
        body,
        transfer: true,
      });
      const etag = raw.headers.get('etag');
      if (!etag) throw malformed();
      return etag;
    },

    async completeMultipartUpload(name, uploadId, parts) {
      const xml =
        '<CompleteMultipartUpload>' +
        parts
          .map(
            (p) =>
              `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`,
          )
          .join('') +
        '</CompleteMultipartUpload>';
      const raw = await send('complete-multipart', 'POST', keyOf(name), {
        query: { uploadId },
        body: xml,
        headers: { 'Content-Type': 'application/xml' },
      });
      // S3 may answer 200 with an <Error> document when the completion fails after the headers.
      if (/<Error>/.test(text(raw))) {
        const { reason, transient } = reasonOfResponse(500, fieldOf(text(raw), 'Code'));
        throw new S3RequestError(reason, transient);
      }
    },

    async abortMultipartUpload(key, uploadId) {
      await send('abort-multipart', 'DELETE', key, { query: { uploadId }, accept: [404] });
    },

    async getRange(name, offset, length) {
      const raw = await send('get', 'GET', keyOf(name), {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        transfer: true,
        accept: [404, 416],
      });
      if (raw.status === 404) {
        // A missing bucket also answers 404: tell the two apart by the error code.
        const code = fieldOf(text(raw), 'Code');
        if (code === 'NoSuchBucket') throw new S3RequestError('NO_SUCH_BUCKET', false);
        throw new StorageObjectNotFoundError();
      }
      if (raw.status === 416) return Buffer.alloc(0);
      return raw.body;
    },

    async headObject(name) {
      const raw = await send('head', 'HEAD', keyOf(name), { accept: [404] });
      if (raw.status === 404) throw new StorageObjectNotFoundError();
      const size = Number(raw.headers.get('content-length'));
      if (!Number.isSafeInteger(size) || size < 0) throw malformed();
      return size;
    },

    async deleteObject(name) {
      await send('delete', 'DELETE', keyOf(name), { accept: [404] });
    },

    async listObjects(options = {}) {
      const raw = await send('list', 'GET', undefined, {
        query: {
          'list-type': '2',
          prefix: keyPrefix,
          'max-keys': options.maxKeys === undefined ? undefined : String(options.maxKeys),
          'continuation-token': options.token,
        },
      });
      const xml = text(raw);
      const parsed = listPageSchema.safeParse({
        objects: blocksOf(xml, 'Contents').map((block) => ({
          key: fieldOf(block, 'Key'),
          modified: fieldOf(block, 'LastModified'),
        })),
        truncated: fieldOf(xml, 'IsTruncated') === 'true',
        next: fieldOf(xml, 'NextContinuationToken'),
      });
      if (!parsed.success) throw malformed();
      const { objects, truncated, next } = parsed.data;
      return {
        objects: objects.map((o) => ({ key: o.key, mtimeSeconds: Math.floor(o.modified / 1000) })),
        nextToken: truncated && next ? next : undefined,
      };
    },

    async listMultipartUploads(options = {}) {
      const raw = await send('list-multipart', 'GET', undefined, {
        query: {
          uploads: '',
          prefix: keyPrefix,
          'key-marker': options.keyMarker,
          'upload-id-marker': options.uploadIdMarker,
        },
      });
      const xml = text(raw);
      const parsed = uploadsPageSchema.safeParse({
        uploads: blocksOf(xml, 'Upload').map((block) => ({
          key: fieldOf(block, 'Key'),
          uploadId: fieldOf(block, 'UploadId'),
          initiated: fieldOf(block, 'Initiated'),
        })),
        truncated: fieldOf(xml, 'IsTruncated') === 'true',
        nextKey: fieldOf(xml, 'NextKeyMarker'),
        nextUploadId: fieldOf(xml, 'NextUploadIdMarker'),
      });
      if (!parsed.success) throw malformed();
      const { uploads, truncated, nextKey, nextUploadId } = parsed.data;
      return {
        uploads: uploads.map((u) => ({
          key: u.key,
          uploadId: u.uploadId,
          initiatedMs: u.initiated,
        })),
        next:
          truncated && nextKey !== undefined && nextUploadId !== undefined
            ? { keyMarker: nextKey, uploadIdMarker: nextUploadId }
            : undefined,
      };
    },
  };
}
