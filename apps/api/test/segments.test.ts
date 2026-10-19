import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DecryptError } from '../src/crypto/aead.js';
import {
  createDecryptStream,
  encryptFile,
  SEGMENT_SIZE,
  SegmentDecryptError,
  SourceSizeError,
  storedSizeOf,
  unwrapDataKey,
  wrapDataKey,
  type EncryptFileResult,
} from '../src/crypto/segments.js';
import { makeTempDir } from './helpers.js';

const S = SEGMENT_SIZE;
const RECORD = S + 16;
const FILE_KEY = Buffer.alloc(32, 0x42);

interface Fixture {
  dir: string;
  plain: Buffer;
  enc: string;
  result: EncryptFileResult;
}

async function encryptBuffer(plain: Buffer, fileKey: Buffer = FILE_KEY): Promise<Fixture> {
  const dir = makeTempDir();
  const src = path.join(dir, 'plain.bin');
  const enc = path.join(dir, 'file.enc');
  await writeFile(src, plain);
  const result = await encryptFile({ srcPath: src, dstPath: enc, size: plain.length, fileKey });
  return { dir, plain, enc, result };
}

async function decryptWith(
  fx: Fixture,
  options: { start?: number; end?: number; noncePrefix?: string; fileKey?: Buffer } = {},
): Promise<Buffer> {
  const stream = createDecryptStream({
    path: fx.enc,
    size: fx.plain.length,
    wrappedKey: fx.result.wrappedKey,
    fileKey: options.fileKey ?? FILE_KEY,
    noncePrefix: options.noncePrefix ?? fx.result.noncePrefix,
    segmentSize: fx.result.segmentSize,
    ...(options.start !== undefined ? { start: options.start } : {}),
    ...(options.end !== undefined ? { end: options.end } : {}),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('segmented encryption', () => {
  it.each([0, 1, S - 1, S, S + 1, 3 * S + 5])('round-trips %i bytes', async (size) => {
    const fx = await encryptBuffer(randomBytes(size));
    expect(fx.result.storedSize).toBe(storedSizeOf(size));
    expect((await stat(fx.enc)).size).toBe(fx.result.storedSize);
    expect(fx.result.sha256).toBe(sha256(fx.plain));
    expect(fx.result.version).toBe(1);
    expect(fx.result.segmentSize).toBe(S);
    expect((await decryptWith(fx)).equals(fx.plain)).toBe(true);
  });

  it('round-trips a multi-megabyte file with random content', async () => {
    const fx = await encryptBuffer(randomBytes(5 * 1024 * 1024 + 123));
    expect((await decryptWith(fx)).equals(fx.plain)).toBe(true);
    expect(fx.result.sha256).toBe(sha256(fx.plain));
  });

  it('computes the stored size as size + 16 per segment', () => {
    expect(storedSizeOf(0)).toBe(16);
    expect(storedSizeOf(1)).toBe(17);
    expect(storedSizeOf(S)).toBe(S + 16);
    expect(storedSizeOf(S + 1)).toBe(S + 1 + 32);
    expect(storedSizeOf(3 * S + 5)).toBe(3 * S + 5 + 64);
  });

  it('stores an empty file as a single record holding only the tag', async () => {
    const fx = await encryptBuffer(Buffer.alloc(0));
    expect((await stat(fx.enc)).size).toBe(16);
    expect(fx.result.sha256).toBe(sha256(Buffer.alloc(0)));
    expect((await decryptWith(fx)).length).toBe(0);
  });

  it('never stores the plaintext and uses a fresh key and prefix per file', async () => {
    const plain = Buffer.alloc(2 * S, 0x61);
    const a = await encryptBuffer(plain);
    const b = await encryptBuffer(plain);
    expect(a.result.wrappedKey).not.toBe(b.result.wrappedKey);
    expect(a.result.noncePrefix).not.toBe(b.result.noncePrefix);
    const raw = await readFile(a.enc);
    expect(raw.includes(Buffer.alloc(64, 0x61))).toBe(false);
  });

  it('serves ranges that cross segment boundaries', async () => {
    const size = 3 * S + 5;
    const fx = await encryptBuffer(randomBytes(size));
    const edges = [0, 1, S - 1, S, S + 1, 2 * S - 1, 2 * S, 3 * S - 1, 3 * S, 3 * S + 4];
    for (const start of edges) {
      for (const end of edges) {
        if (end < start) continue;
        const part = await decryptWith(fx, { start, end });
        expect(part.equals(fx.plain.subarray(start, end + 1)), `bytes ${start}-${end}`).toBe(true);
      }
    }
  });

  it('serves ranges of a file larger than one read batch', async () => {
    const size = 40 * S + 17;
    const fx = await encryptBuffer(randomBytes(size));
    for (const [start, end] of [
      [0, size - 1],
      [S * 15 + 3, S * 33 + 9],
      [size - 1, size - 1],
      [S * 16 - 1, S * 16],
    ] as const) {
      const part = await decryptWith(fx, { start, end });
      expect(part.equals(fx.plain.subarray(start, end + 1)), `bytes ${start}-${end}`).toBe(true);
    }
  });

  it('rejects invalid ranges', async () => {
    const fx = await encryptBuffer(randomBytes(100));
    const open = (start: number, end: number) => () =>
      createDecryptStream({
        path: fx.enc,
        size: 100,
        wrappedKey: fx.result.wrappedKey,
        fileKey: FILE_KEY,
        noncePrefix: fx.result.noncePrefix,
        start,
        end,
      });
    expect(open(-1, 5)).toThrow(RangeError);
    expect(open(10, 5)).toThrow(RangeError);
    expect(open(0, 100)).toThrow(RangeError);
    expect(open(0.5, 5)).toThrow(RangeError);
  });

  it('detects an altered byte in a middle segment, only when that segment is read', async () => {
    const fx = await encryptBuffer(randomBytes(3 * S + 5));
    const raw = await readFile(fx.enc);
    raw.writeUInt8(raw.readUInt8(RECORD + 100) ^ 0x01, RECORD + 100);
    await writeFile(fx.enc, raw);
    await expect(decryptWith(fx)).rejects.toBeInstanceOf(SegmentDecryptError);
    await expect(decryptWith(fx, { start: S, end: S + 10 })).rejects.toBeInstanceOf(
      SegmentDecryptError,
    );
    // Segment 0 and the last one are intact and still readable.
    expect((await decryptWith(fx, { start: 0, end: 99 })).equals(fx.plain.subarray(0, 100))).toBe(
      true,
    );
  });

  it('detects an altered tag', async () => {
    const fx = await encryptBuffer(randomBytes(S + 10));
    const raw = await readFile(fx.enc);
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0x80, raw.length - 1);
    await writeFile(fx.enc, raw);
    await expect(decryptWith(fx)).rejects.toBeInstanceOf(SegmentDecryptError);
  });

  it('detects a truncated file (last record removed)', async () => {
    const fx = await encryptBuffer(randomBytes(3 * S + 5));
    const raw = await readFile(fx.enc);
    await writeFile(fx.enc, raw.subarray(0, 3 * RECORD));
    await expect(decryptWith(fx)).rejects.toBeInstanceOf(SegmentDecryptError);
    await expect(decryptWith(fx, { start: 0, end: 10 })).rejects.toBeInstanceOf(
      SegmentDecryptError,
    );
  });

  it('detects a truncation that makes a shorter file look complete', async () => {
    const plain = randomBytes(3 * S);
    const fx = await encryptBuffer(plain);
    const raw = await readFile(fx.enc);
    // Keep two full records and declare the file as 2 segments long: the second record was not
    // sealed as the final one, so the final flag in its nonce does not match.
    await writeFile(fx.enc, raw.subarray(0, 2 * RECORD));
    const shorter: Fixture = { ...fx, plain: plain.subarray(0, 2 * S) };
    await expect(decryptWith(shorter)).rejects.toBeInstanceOf(SegmentDecryptError);
  });

  it('detects extra data appended to the file', async () => {
    const fx = await encryptBuffer(randomBytes(S + 10));
    const raw = await readFile(fx.enc);
    await writeFile(fx.enc, Buffer.concat([raw, randomBytes(16)]));
    await expect(decryptWith(fx)).rejects.toBeInstanceOf(SegmentDecryptError);
    await expect(decryptWith(fx, { start: 0, end: 5 })).rejects.toBeInstanceOf(SegmentDecryptError);
  });

  it('detects two swapped records', async () => {
    const fx = await encryptBuffer(randomBytes(3 * S + 5));
    const raw = await readFile(fx.enc);
    const swapped = Buffer.from(raw);
    raw.copy(swapped, 0, RECORD, 2 * RECORD);
    raw.copy(swapped, RECORD, 0, RECORD);
    await writeFile(fx.enc, swapped);
    await expect(decryptWith(fx)).rejects.toBeInstanceOf(SegmentDecryptError);
  });

  it('fails with a wrong master key', async () => {
    const fx = await encryptBuffer(randomBytes(S + 1));
    expect(() => unwrapDataKey(Buffer.alloc(32, 0x43), fx.result.wrappedKey)).toThrow(DecryptError);
    await expect(decryptWith(fx, { fileKey: Buffer.alloc(32, 0x43) })).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it('fails with a wrong data key', async () => {
    const fx = await encryptBuffer(randomBytes(S + 1));
    const stream = createDecryptStream({
      path: fx.enc,
      size: fx.plain.length,
      dataKey: randomBytes(32),
      noncePrefix: fx.result.noncePrefix,
    });
    await expect(stream.toArray()).rejects.toBeInstanceOf(SegmentDecryptError);
  });

  it('fails with a wrong nonce prefix', async () => {
    const fx = await encryptBuffer(randomBytes(S + 1));
    await expect(
      decryptWith(fx, { noncePrefix: randomBytes(7).toString('base64url') }),
    ).rejects.toBeInstanceOf(SegmentDecryptError);
    await expect(decryptWith(fx, { noncePrefix: 'AAAA' })).rejects.toBeInstanceOf(
      SegmentDecryptError,
    );
  });

  it('wraps and unwraps a data key', () => {
    const dataKey = randomBytes(32);
    const wrapped = wrapDataKey(FILE_KEY, dataKey);
    expect(wrapped.startsWith('v1:')).toBe(true);
    expect(unwrapDataKey(FILE_KEY, wrapped).equals(dataKey)).toBe(true);
  });

  it('refuses a source whose size differs from the declared one and leaves no output', async () => {
    const dir = makeTempDir();
    const src = path.join(dir, 'plain.bin');
    await writeFile(src, randomBytes(S + 10));
    for (const declared of [S + 9, S + 11]) {
      const dst = path.join(dir, `out-${declared}.enc`);
      await expect(
        encryptFile({ srcPath: src, dstPath: dst, size: declared, fileKey: FILE_KEY }),
      ).rejects.toBeInstanceOf(SourceSizeError);
      await expect(stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('refuses to overwrite an existing destination', async () => {
    const dir = makeTempDir();
    const src = path.join(dir, 'plain.bin');
    const dst = path.join(dir, 'out.enc');
    await writeFile(src, randomBytes(10));
    await writeFile(dst, 'keep me');
    await expect(
      encryptFile({ srcPath: src, dstPath: dst, size: 10, fileKey: FILE_KEY }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
