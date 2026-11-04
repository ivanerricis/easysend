import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-memory S3 server for tests. `fake.fetch` is an injectable `fetch` (`storageFetch` of the app,
 * `fetch` of the S3 client/driver); `fake.listen()` also exposes it on a real local port, like
 * `fake-cloudflare.ts`, for E2E reuse. Supports path-style and virtual-hosted addressing, PutObject,
 * the multipart lifecycle, ranged GET, HEAD, DELETE, ListObjectsV2 and ListMultipartUploads (both
 * paginated), and checks that every request carries a SigV4 `Authorization` header and a correct
 * `x-amz-content-sha256` (the signature itself is not verified).
 */
export interface FakeS3Options {
  bucket?: string;
  /** Host of the endpoint: virtual-hosted requests go to `<bucket>.<endpointHost>`. */
  endpointHost?: string;
  /** Maximum number of entries per list page (also capped by the request's `max-keys`). */
  pageSize?: number;
  now?: () => number;
}

export type FakeS3Mode =
  | 'ok'
  /** 403 AccessDenied on every call. */
  | 'forbidden'
  /** 403 InvalidAccessKeyId. */
  | 'invalid-key'
  /** 403 SignatureDoesNotMatch. */
  | 'signature'
  /** 404 NoSuchBucket on every call. */
  | 'no-bucket'
  /** The request never completes until its AbortSignal fires. */
  | 'hang'
  /** `fetch` rejects like an unreachable host. */
  | 'network'
  /** `fetch` rejects with an ENOTFOUND cause (bad endpoint host). */
  | 'dns'
  /** 500 InternalError on every call. */
  | 'server-error';

export interface FakeS3Request {
  method: string;
  /** Decoded object key ('' for bucket-level calls). Never includes the query string. */
  key: string;
  query: Record<string, string>;
  bodyBytes: number;
}

interface FakeUpload {
  key: string;
  initiatedMs: number;
  parts: Map<number, { data: Buffer; etag: string }>;
}

export interface FakeS3 {
  readonly fetch: typeof fetch;
  readonly bucket: string;
  /** Objects by full key. */
  readonly objects: Map<string, { data: Buffer; mtimeMs: number }>;
  /** Open multipart uploads by upload id. */
  readonly uploads: Map<string, FakeUpload>;
  readonly requests: FakeS3Request[];
  mode: FakeS3Mode;
  pageSize: number;
  /** Largest PUT body received so far (bytes): the memory-bound tests read it. */
  maxBodyBytes: number;
  /** UploadPart of this part number answers 500 this many times (then works). */
  failPartNumber: number | undefined;
  failPartTimes: number;
  /** Next CompleteMultipartUpload answers 500 once. */
  failComplete: boolean;
  /** Callback after every received body (flow-control assertions). */
  onBody: ((request: FakeS3Request) => void) | undefined;
  /** Starts a real HTTP server on 127.0.0.1 (path-style endpoint `http://127.0.0.1:<port>`). */
  listen(port?: number): Promise<{ url: string; close(): Promise<void> }>;
}

const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const md5Hex = (data: Buffer): string => createHash('md5').update(data).digest('hex');
const xmlEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const xml = (status: number, body: string): Response =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status,
    headers: { 'content-type': 'application/xml' },
  });
const errorXml = (status: number, code: string): Response =>
  xml(status, `<Error><Code>${code}</Code><Message>${code}</Message></Error>`);

export function createFakeS3(options: FakeS3Options = {}): FakeS3 {
  const bucket = options.bucket ?? 'easysend-test';
  const endpointHost = options.endpointHost ?? 's3.example.test';
  const now = options.now ?? Date.now;
  const objects = new Map<string, { data: Buffer; mtimeMs: number }>();
  const uploads = new Map<string, FakeUpload>();
  const requests: FakeS3Request[] = [];

  const fake: FakeS3 = {
    bucket,
    objects,
    uploads,
    requests,
    mode: 'ok',
    pageSize: options.pageSize ?? 1000,
    maxBodyBytes: 0,
    failPartNumber: undefined,
    failPartTimes: 0,
    failComplete: false,
    onBody: undefined,
    fetch: undefined as unknown as typeof fetch,
    listen: undefined as unknown as FakeS3['listen'],
  };

  const parseRange = (
    header: string | null,
    size: number,
  ): { start: number; end: number } | 'bad' | null => {
    if (!header) return null;
    const match = /^bytes=(\d+)-(\d*)$/.exec(header);
    if (!match) return 'bad';
    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
    return start >= size || end < start ? 'bad' : { start, end };
  };

  function listObjects(query: Record<string, string>): Response {
    const prefix = query['prefix'] ?? '';
    const limit = Math.min(fake.pageSize, Number(query['max-keys'] ?? fake.pageSize));
    const after = query['continuation-token']
      ? Buffer.from(query['continuation-token'], 'base64url').toString()
      : '';
    const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
    const page = keys.slice(0, limit);
    const truncated = keys.length > page.length;
    const contents = page
      .map((key) => {
        const object = objects.get(key)!;
        return `<Contents><Key>${xmlEscape(key)}</Key><LastModified>${new Date(object.mtimeMs).toISOString()}</LastModified><Size>${object.data.length}</Size></Contents>`;
      })
      .join('');
    const next = truncated
      ? `<NextContinuationToken>${Buffer.from(page[page.length - 1]!).toString('base64url')}</NextContinuationToken>`
      : '';
    return xml(
      200,
      `<ListBucketResult><Name>${bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${limit}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`,
    );
  }

  function listUploads(query: Record<string, string>): Response {
    const prefix = query['prefix'] ?? '';
    const entries = [...uploads.entries()]
      .filter(([, u]) => u.key.startsWith(prefix))
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => (a.key === b.key ? a.id.localeCompare(b.id) : a.key.localeCompare(b.key)));
    const keyMarker = query['key-marker'];
    const idMarker = query['upload-id-marker'] ?? '';
    const startIndex =
      keyMarker === undefined
        ? 0
        : entries.findIndex(
            (e) => e.key > keyMarker || (e.key === keyMarker && e.id.localeCompare(idMarker) > 0),
          );
    const rest = startIndex < 0 ? [] : entries.slice(startIndex);
    const page = rest.slice(0, fake.pageSize);
    const truncated = rest.length > page.length;
    const last = page[page.length - 1];
    const body = page
      .map(
        (u) =>
          `<Upload><Key>${xmlEscape(u.key)}</Key><UploadId>${u.id}</UploadId><Initiated>${new Date(u.initiatedMs).toISOString()}</Initiated></Upload>`,
      )
      .join('');
    const next =
      truncated && last
        ? `<NextKeyMarker>${xmlEscape(last.key)}</NextKeyMarker><NextUploadIdMarker>${last.id}</NextUploadIdMarker>`
        : '';
    return xml(
      200,
      `<ListMultipartUploadsResult><Bucket>${bucket}</Bucket><IsTruncated>${truncated}</IsTruncated>${next}${body}</ListMultipartUploadsResult>`,
    );
  }

  function handle(
    method: string,
    key: string,
    query: Record<string, string>,
    headers: Headers,
    body: Buffer,
  ): Response {
    const bucketLevel = key === '';
    if (bucketLevel && method === 'GET') {
      if ('uploads' in query) return listUploads(query);
      if (query['list-type'] === '2') return listObjects(query);
      return errorXml(400, 'InvalidRequest');
    }
    if (bucketLevel) return errorXml(405, 'MethodNotAllowed');

    if (method === 'POST' && 'uploads' in query) {
      const id = randomUUID();
      uploads.set(id, { key, initiatedMs: now(), parts: new Map() });
      return xml(
        200,
        `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    if (method === 'PUT' && query['uploadId'] && query['partNumber']) {
      const upload = uploads.get(query['uploadId']);
      if (!upload) return errorXml(404, 'NoSuchUpload');
      const partNumber = Number(query['partNumber']);
      if (fake.failPartNumber === partNumber && fake.failPartTimes > 0) {
        fake.failPartTimes -= 1;
        return errorXml(500, 'InternalError');
      }
      const etag = `"${md5Hex(body)}"`;
      upload.parts.set(partNumber, { data: body, etag });
      return new Response(null, { status: 200, headers: { etag } });
    }
    if (method === 'POST' && query['uploadId']) {
      const upload = uploads.get(query['uploadId']);
      if (!upload) return errorXml(404, 'NoSuchUpload');
      if (fake.failComplete) {
        fake.failComplete = false;
        return errorXml(500, 'InternalError');
      }
      const listed = [
        ...body
          .toString()
          .matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag><\/Part>/g),
      ].map((m) => ({ n: Number(m[1]), etag: (m[2] ?? '').replace(/&amp;/g, '&') }));
      const chunks: Buffer[] = [];
      for (const [index, part] of listed.entries()) {
        const stored = upload.parts.get(part.n);
        if (!stored || stored.etag !== part.etag || (index > 0 && part.n <= listed[index - 1]!.n)) {
          return errorXml(400, 'InvalidPart');
        }
        chunks.push(stored.data);
      }
      objects.set(upload.key, { data: Buffer.concat(chunks), mtimeMs: now() });
      uploads.delete(query['uploadId']);
      return xml(
        200,
        `<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEscape(upload.key)}</Key></CompleteMultipartUploadResult>`,
      );
    }
    if (method === 'DELETE' && query['uploadId']) {
      return uploads.delete(query['uploadId'])
        ? new Response(null, { status: 204 })
        : errorXml(404, 'NoSuchUpload');
    }
    if (method === 'PUT') {
      objects.set(key, { data: body, mtimeMs: now() });
      return new Response(null, { status: 200, headers: { etag: `"${md5Hex(body)}"` } });
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' || method === 'HEAD') {
      const object = objects.get(key);
      if (!object) {
        return method === 'HEAD' ? new Response(null, { status: 404 }) : errorXml(404, 'NoSuchKey');
      }
      const size = object.data.length;
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': String(size) } });
      }
      const range = parseRange(headers.get('range'), size);
      if (range === 'bad') return errorXml(416, 'InvalidRange');
      if (range === null) return new Response(new Uint8Array(object.data), { status: 200 });
      return new Response(new Uint8Array(object.data.subarray(range.start, range.end + 1)), {
        status: 206,
        headers: { 'content-range': `bytes ${range.start}-${range.end}/${size}` },
      });
    }
    return errorXml(405, 'MethodNotAllowed');
  }

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const raw = init?.body;
    const body =
      raw === undefined || raw === null
        ? Buffer.alloc(0)
        : typeof raw === 'string'
          ? Buffer.from(raw)
          : Buffer.from(raw as Uint8Array);

    if (fake.mode === 'network') throw new TypeError('fetch failed');
    if (fake.mode === 'dns') {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
      });
    }
    if (fake.mode === 'hang') {
      await new Promise<void>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const fail = (): void => reject(signal.reason as Error);
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    }

    // Addressing: virtual-hosted (`<bucket>.<host>`) or path-style (`/<bucket>/<key>`).
    const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
    let addressedBucket: string;
    let key: string;
    if (url.hostname === `${bucket}.${endpointHost}`) {
      addressedBucket = bucket;
      key = segments.join('/');
    } else {
      addressedBucket = segments[0] ?? '';
      key = segments.slice(1).join('/');
    }
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    const record: FakeS3Request = { method, key, query, bodyBytes: body.length };
    requests.push(record);
    if (method === 'PUT') fake.maxBodyBytes = Math.max(fake.maxBodyBytes, body.length);
    fake.onBody?.(record);

    if (
      !/^AWS4-HMAC-SHA256 Credential=[^,]+, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/.test(
        headers.get('authorization') ?? '',
      )
    ) {
      return errorXml(403, 'AccessDenied');
    }
    if (headers.get('x-amz-content-sha256') !== sha256Hex(body))
      return errorXml(400, 'XAmzContentSHA256Mismatch');
    if (fake.mode === 'forbidden') return errorXml(403, 'AccessDenied');
    if (fake.mode === 'invalid-key') return errorXml(403, 'InvalidAccessKeyId');
    if (fake.mode === 'signature') return errorXml(403, 'SignatureDoesNotMatch');
    if (fake.mode === 'server-error') return errorXml(500, 'InternalError');
    if (fake.mode === 'no-bucket' || addressedBucket !== bucket)
      return errorXml(404, 'NoSuchBucket');

    return handle(method, key, query, headers, body);
  };
  (fake as { fetch: typeof fetch }).fetch = fakeFetch;

  fake.listen = async (port = 0) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const url = `http://${req.headers.host ?? '127.0.0.1'}${req.url ?? '/'}`;
        const hasBody = chunks.length > 0;
        fakeFetch(url, {
          method: req.method ?? 'GET',
          headers: req.headers as Record<string, string>,
          ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
        })
          .then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
          })
          .catch(() => {
            res.writeHead(500).end();
          });
      });
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  };
  return fake;
}
