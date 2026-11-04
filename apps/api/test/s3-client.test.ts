import { describe, expect, it } from 'vitest';
import type { S3Config, StorageTestReason } from '@easysend/shared';
import { AppError } from '../src/http/errors.js';
import { createS3Client, encodeKey, S3RequestError } from '../src/storage/s3/client.js';
import { StorageObjectNotFoundError } from '../src/storage/types.js';
import { createFakeS3, type FakeS3Mode } from './fake-s3.js';
import { memoryLogger, silentLogger } from './helpers.js';
import { TEST_S3_CONFIG } from './storage-helpers.js';

const config = (overrides: Partial<S3Config> = {}): S3Config => ({
  ...TEST_S3_CONFIG,
  ...overrides,
});

/** `fetch` that records the signed requests and answers 200 with an ETag. */
function recordingFetch() {
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(new Response(null, { status: 200, headers: { etag: '"x"' } }));
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('s3 client URLs and signing', () => {
  it('builds path-style URLs with an encoded key and a SigV4 header', async () => {
    const { calls, fetchFn } = recordingFetch();
    const client = createS3Client(config(), { fetch: fetchFn, logger: silentLogger });
    await client.putObject("a b+c(1)!'*.bin", Buffer.from('x'));
    expect(calls[0]!.url).toBe(
      'https://s3.example.test/easysend-test/files/a%20b%2Bc%281%29%21%27%2A.bin',
    );
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
    );
  });

  it('builds virtual-hosted URLs and keeps a path in the endpoint', async () => {
    const { calls, fetchFn } = recordingFetch();
    await createS3Client(config({ forcePathStyle: false }), {
      fetch: fetchFn,
      logger: silentLogger,
    }).putObject('n', Buffer.alloc(0));
    expect(calls[0]!.url).toBe('https://easysend-test.s3.example.test/files/n');

    await createS3Client(config({ endpoint: 'http://minio.local:9000/gw' }), {
      fetch: fetchFn,
      logger: silentLogger,
    }).putObject('n', Buffer.alloc(0));
    expect(calls[1]!.url).toBe('http://minio.local:9000/gw/easysend-test/files/n');
  });

  it('puts objects at the bucket root without a prefix and tolerates a trailing slash', () => {
    const { fetchFn } = recordingFetch();
    const opts = { fetch: fetchFn, logger: silentLogger };
    expect(createS3Client(config({ prefix: '' }), opts).keyOf('n')).toBe('n');
    expect(createS3Client(config({ prefix: 'a/b/' }), opts).keyOf('n')).toBe('a/b/n');
    expect(createS3Client(config({ prefix: 'a/b' }), opts).keyPrefix).toBe('a/b/');
    expect(encodeKey('dir/ü é')).toBe('dir/%C3%BC%20%C3%A9');
  });

  it('sends list queries with the prefix and works against the fake in both addressing modes', async () => {
    for (const forcePathStyle of [true, false]) {
      const fake = createFakeS3();
      const client = createS3Client(config({ forcePathStyle }), {
        fetch: fake.fetch,
        logger: silentLogger,
      });
      await client.putObject('one', Buffer.from('1'));
      fake.objects.set('other/two', { data: Buffer.from('2'), mtimeMs: 0 });
      const page = await client.listObjects();
      expect(page.objects.map((o) => o.key)).toEqual(['files/one']);
      expect(await client.headObject('one')).toBe(1);
      expect((await client.getRange('one', 0, 1)).toString()).toBe('1');
    }
  });

  it('parses XML entities in keys', async () => {
    const fake = createFakeS3();
    const client = createS3Client(config(), { fetch: fake.fetch, logger: silentLogger });
    fake.objects.set('files/a&b<c>.bin', { data: Buffer.from('x'), mtimeMs: 1_000_000 });
    const page = await client.listObjects();
    expect(page.objects).toEqual([{ key: 'files/a&b<c>.bin', mtimeSeconds: 1000 }]);
  });
});

describe('s3 client errors', () => {
  const cases: [FakeS3Mode, StorageTestReason, boolean][] = [
    ['forbidden', 'ACCESS_DENIED', false],
    ['invalid-key', 'ACCESS_DENIED', false],
    ['signature', 'SIGNATURE', false],
    ['no-bucket', 'NO_SUCH_BUCKET', false],
    ['network', 'NETWORK', true],
    ['dns', 'ENDPOINT', false],
    ['server-error', 'NETWORK', true],
  ];
  it.each(cases)('maps %s to %s (transient: %s)', async (mode, reason, transient) => {
    const fake = createFakeS3();
    fake.mode = mode;
    const client = createS3Client(config(), { fetch: fake.fetch, logger: silentLogger });
    const error = await client.putObject('n', Buffer.from('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(S3RequestError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      status: 503,
      details: { reason },
      transient,
    });
  });

  it('maps a request that never answers to TIMEOUT', async () => {
    const fake = createFakeS3();
    fake.mode = 'hang';
    const client = createS3Client(config(), {
      fetch: fake.fetch,
      logger: silentLogger,
      requestTimeoutMs: 20,
    });
    await expect(client.headObject('n')).rejects.toMatchObject({ details: { reason: 'TIMEOUT' } });
  });

  it('maps an invalid endpoint URL to ENDPOINT', async () => {
    const client = createS3Client(config({ endpoint: 'not a url' }), {
      fetch: createFakeS3().fetch,
      logger: silentLogger,
    });
    await expect(client.headObject('n')).rejects.toMatchObject({ details: { reason: 'ENDPOINT' } });
  });

  it('answers 404 of GET and HEAD with StorageObjectNotFoundError, but NoSuchBucket stays an error', async () => {
    const fake = createFakeS3();
    const client = createS3Client(config(), { fetch: fake.fetch, logger: silentLogger });
    await expect(client.getRange('missing', 0, 4)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
    await expect(client.headObject('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(client.deleteObject('missing')).resolves.toBeUndefined();

    const wrongBucket = createS3Client(config({ bucket: 'other-bucket' }), {
      fetch: fake.fetch,
      logger: silentLogger,
    });
    await expect(wrongBucket.getRange('n', 0, 4)).rejects.toMatchObject({
      details: { reason: 'NO_SUCH_BUCKET' },
    });
  });

  it('never logs keys, signatures or query strings, nor puts them in errors', async () => {
    const { lines, logger } = memoryLogger('trace');
    const fake = createFakeS3();
    const client = createS3Client(config(), { fetch: fake.fetch, logger });
    await client.putObject('n', Buffer.from('x'));
    await client.listObjects({ token: 'secret-token' });
    const uploadId = await client.createMultipartUpload('big');
    await client.abortMultipartUpload(client.keyOf('big'), uploadId);
    fake.mode = 'signature';
    const error = await client.putObject('n', Buffer.from('x')).catch((e: unknown) => e);

    const text =
      lines.join('\n') + JSON.stringify((error as AppError).details) + (error as Error).message;
    for (const needle of [
      TEST_S3_CONFIG.secretAccessKey,
      TEST_S3_CONFIG.accessKeyId,
      'AWS4-HMAC',
      'Signature=',
      'secret-token',
      uploadId,
      '?',
    ]) {
      expect(text).not.toContain(needle);
    }
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('s3 client list pagination', () => {
  it('pages ListObjectsV2 and ListMultipartUploads with continuation markers', async () => {
    const fake = createFakeS3({ pageSize: 2 });
    const client = createS3Client(config(), { fetch: fake.fetch, logger: silentLogger });
    for (const n of ['a', 'b', 'c', 'd', 'e']) await client.putObject(n, Buffer.from(n));
    const keys: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const page = await client.listObjects(token === undefined ? {} : { token });
      keys.push(...page.objects.map((o) => o.key));
      token = page.nextToken;
      pages += 1;
    } while (token);
    expect(keys).toEqual(['files/a', 'files/b', 'files/c', 'files/d', 'files/e']);
    expect(pages).toBe(3);

    for (const n of ['u1', 'u2', 'u3']) await client.createMultipartUpload(n);
    const seen: string[] = [];
    let next: { keyMarker: string; uploadIdMarker: string } | undefined;
    do {
      const page = await client.listMultipartUploads(next);
      seen.push(...page.uploads.map((u) => u.key));
      next = page.next;
    } while (next);
    expect(seen).toEqual(['files/u1', 'files/u2', 'files/u3']);
  });
});
