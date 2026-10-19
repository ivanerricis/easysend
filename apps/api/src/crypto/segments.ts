import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decryptSecret, encryptSecret } from './aead.js';

/**
 * Segmented file encryption (SPEC 4, `enc_version` 1), a STREAM-style AES-256-GCM construction.
 *
 * The plaintext is cut into segments of `SEGMENT_SIZE` bytes (the last one may be shorter, an
 * empty file has one empty segment). Each segment is stored as a record `ciphertext || tag(16)`,
 * so a record is at most `SEGMENT_SIZE + 16` bytes and any range can be decrypted by reading only
 * the records it touches. The 12-byte nonce of a segment is
 * `noncePrefix(7, random per file) || index(uint32 BE) || finalFlag(1)`: the index stops
 * reordering and swapping, the final flag stops truncation (a file cut after a complete record
 * would have no record flagged as final). The AAD is a constant label.
 */
export const SEGMENT_SIZE = 65_536;
export const ENC_VERSION = 1;
const TAG_BYTES = 16;
const NONCE_PREFIX_BYTES = 7;
const DATA_KEY_BYTES = 32;
const AAD = Buffer.from('easysend/v1/file-segment');
/** Records read from disk at once when decrypting (about 1 MiB with the default segment size). */
const READ_BATCH_RECORDS = 16;

/** Authentication failure, malformed stored file or I/O shortfall while decrypting. */
export class SegmentDecryptError extends Error {
  constructor(reason = 'Unable to decrypt file') {
    super(reason);
    this.name = 'SegmentDecryptError';
  }
}

/** Thrown by `encryptFile` when the source does not have exactly the declared size. */
export class SourceSizeError extends Error {
  constructor() {
    super('Source file size differs from the declared size');
    this.name = 'SourceSizeError';
  }
}

/** Number of segments for a plaintext of `size` bytes (at least one). */
export function segmentCount(size: number, segmentSize = SEGMENT_SIZE): number {
  return Math.max(1, Math.ceil(size / segmentSize));
}

/** Size on disk of the encrypted file: plaintext plus one tag per segment. */
export function storedSizeOf(size: number, segmentSize = SEGMENT_SIZE): number {
  return size + TAG_BYTES * segmentCount(size, segmentSize);
}

/** Wraps a per-file data key with the master `file` key. The result goes to `enc_key_wrapped`. */
export function wrapDataKey(fileKey: Uint8Array, dataKey: Uint8Array): string {
  return encryptSecret(fileKey, 'file', Buffer.from(dataKey).toString('base64url'));
}

/** Inverse of `wrapDataKey`. Throws `DecryptError` for a wrong master key or a damaged value. */
export function unwrapDataKey(fileKey: Uint8Array, wrapped: string): Buffer {
  const key = Buffer.from(decryptSecret(fileKey, 'file', wrapped), 'base64url');
  if (key.length !== DATA_KEY_BYTES) throw new SegmentDecryptError('Invalid data key');
  return key;
}

function nonceFor(prefix: Buffer, index: number, isFinal: boolean): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, NONCE_PREFIX_BYTES);
  nonce[11] = isFinal ? 1 : 0;
  return nonce;
}

function parsePrefix(noncePrefix: string): Buffer {
  const prefix = Buffer.from(noncePrefix, 'base64url');
  if (prefix.length !== NONCE_PREFIX_BYTES) throw new SegmentDecryptError('Invalid nonce prefix');
  return prefix;
}

export interface EncryptFileInput {
  srcPath: string;
  /** Created exclusively (fails when it exists). The caller picks a temporary name and renames it. */
  dstPath: string;
  /** Exact plaintext size of the source. */
  size: number;
  /** The derived master `file` key that wraps the new data key. */
  fileKey: Uint8Array;
}

export interface EncryptFileResult {
  /** Hex SHA-256 of the plaintext. */
  sha256: string;
  storedSize: number;
  /** For `transfer_files.enc_key_wrapped`. */
  wrappedKey: string;
  /** Base64url, for `transfer_files.enc_nonce_prefix`. */
  noncePrefix: string;
  segmentSize: number;
  version: number;
}

/** Cuts the plaintext into segments, hashes it and emits the encrypted records. */
class SegmentEncryptor extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private received = 0;
  private index = 0;
  private readonly total: number;
  private readonly hash = createHash('sha256');
  private readonly size: number;
  private readonly dataKey: Buffer;
  private readonly prefix: Buffer;
  private readonly segmentSize: number;

  constructor(size: number, dataKey: Buffer, prefix: Buffer, segmentSize: number) {
    super();
    this.size = size;
    this.dataKey = dataKey;
    this.prefix = prefix;
    this.segmentSize = segmentSize;
    this.total = segmentCount(size, segmentSize);
  }

  digest(): string {
    return this.hash.digest('hex');
  }

  private seal(plain: Buffer): Buffer {
    const isFinal = this.index === this.total - 1;
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.dataKey,
      nonceFor(this.prefix, this.index, isFinal),
    );
    cipher.setAAD(AAD);
    const record = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    this.index += 1;
    return record;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.size) return done(new SourceSizeError());
    this.hash.update(chunk);
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= this.segmentSize) {
      this.push(this.seal(this.pending.subarray(0, this.segmentSize)));
      this.pending = this.pending.subarray(this.segmentSize);
    }
    done();
  }

  override _flush(done: TransformCallback): void {
    if (this.received !== this.size) return done(new SourceSizeError());
    // The last segment is still pending unless the size is a non-zero multiple of the segment size.
    if (this.index < this.total) this.push(this.seal(this.pending));
    done();
  }
}

/**
 * Encrypts `srcPath` into `dstPath` in one streaming pass (read, SHA-256 of the plaintext,
 * encrypt, write), with memory bounded by a couple of segments. The destination is flushed to
 * disk before resolving. Errors (including a source of the wrong size) remove the partial
 * destination. Writing to a temporary name and renaming on success is the caller's job.
 */
export async function encryptFile(input: EncryptFileInput): Promise<EncryptFileResult> {
  const { srcPath, dstPath, size, fileKey } = input;
  const segmentSize = SEGMENT_SIZE;
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const prefix = randomBytes(NONCE_PREFIX_BYTES);
  const encryptor = new SegmentEncryptor(size, dataKey, prefix, segmentSize);

  try {
    // Flag `wx`: exclusive creation, an existing destination is never overwritten.
    await pipeline(
      createReadStream(srcPath, { highWaterMark: segmentSize }),
      encryptor,
      createWriteStream(dstPath, { flags: 'wx' }),
    );
    const out = await open(dstPath, 'r+');
    try {
      await out.sync();
    } finally {
      await out.close();
    }
  } catch (error) {
    // An existing destination is not ours: leave it alone. Anything else is a partial output.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(dstPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }

  return {
    sha256: encryptor.digest(),
    storedSize: storedSizeOf(size, segmentSize),
    wrappedKey: wrapDataKey(fileKey, dataKey),
    noncePrefix: prefix.toString('base64url'),
    segmentSize,
    version: ENC_VERSION,
  };
}

export type DecryptStreamInput = {
  /** Encrypted file on disk. */
  path: string;
  /** Plaintext size (`transfer_files.size_bytes`). */
  size: number;
  /** Base64url, `transfer_files.enc_nonce_prefix`. */
  noncePrefix: string;
  /** `transfer_files.enc_segment_size`. Default `SEGMENT_SIZE`. */
  segmentSize?: number;
  /** First plaintext byte (inclusive). Default 0. */
  start?: number;
  /** Last plaintext byte (inclusive). Default `size - 1`. */
  end?: number;
} & ({ dataKey: Uint8Array } | { wrappedKey: string; fileKey: Uint8Array });

async function* decryptRecords(
  input: DecryptStreamInput,
  dataKey: Buffer,
  prefix: Buffer,
  range: { start: number; end: number },
): AsyncGenerator<Buffer> {
  const { path, size } = input;
  const segmentSize = input.segmentSize ?? SEGMENT_SIZE;
  const total = segmentCount(size, segmentSize);
  const recordSize = segmentSize + TAG_BYTES;
  const storedSize = storedSizeOf(size, segmentSize);
  const first = size === 0 ? 0 : Math.floor(range.start / segmentSize);
  const last = size === 0 ? 0 : Math.floor(range.end / segmentSize);

  const handle = await open(path, 'r');
  try {
    // Catches truncation and trailing data even when the requested range does not reach them.
    if ((await handle.stat()).size !== storedSize) {
      throw new SegmentDecryptError('Stored size mismatch');
    }
    const batch = Buffer.allocUnsafe(recordSize * READ_BATCH_RECORDS);
    for (let index = first; index <= last; index += READ_BATCH_RECORDS) {
      const count = Math.min(READ_BATCH_RECORDS, last - index + 1);
      const batchEnd = Math.min((index + count) * recordSize, storedSize);
      const bytes = batchEnd - index * recordSize;
      const { bytesRead } = await handle.read(batch, 0, bytes, index * recordSize);
      if (bytesRead !== bytes) throw new SegmentDecryptError('Unexpected end of file');

      for (let i = 0; i < count; i += 1) {
        const segment = index + i;
        const isFinal = segment === total - 1;
        const offset = i * recordSize;
        const record = batch.subarray(offset, Math.min(offset + recordSize, bytes));
        let plain: Buffer;
        try {
          const decipher = createDecipheriv(
            'aes-256-gcm',
            dataKey,
            nonceFor(prefix, segment, isFinal),
          );
          decipher.setAAD(AAD);
          decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
          plain = Buffer.concat([
            decipher.update(record.subarray(0, record.length - TAG_BYTES)),
            decipher.final(),
          ]);
        } catch {
          throw new SegmentDecryptError();
        }
        // Only the first and last segments of the range are cut; the others pass through whole.
        const from = Math.max(range.start - segment * segmentSize, 0);
        const to = Math.min(range.end - segment * segmentSize + 1, plain.length);
        if (to > from) yield from === 0 && to === plain.length ? plain : plain.subarray(from, to);
      }
    }
  } finally {
    await handle.close();
  }
}

/**
 * Readable of the plaintext bytes `[start, end]` (inclusive) of an encrypted file. Only the
 * records covering the range are read, one batch at a time (constant memory, backpressure from
 * the consumer). Any authentication failure, short file or trailing data makes the stream emit
 * `SegmentDecryptError`; no plaintext of a segment is released before its tag is verified.
 * Throws synchronously for an invalid range, a malformed nonce prefix or a wrong master key.
 * Without a range the whole file is returned (an empty file yields no bytes but is verified).
 */
export function createDecryptStream(input: DecryptStreamInput): Readable {
  const { size } = input;
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid size');
  const whole = input.start === undefined && input.end === undefined;
  const start = input.start ?? 0;
  const end = input.end ?? size - 1;
  if (!(whole && size === 0)) {
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end))) {
      throw new RangeError('Invalid range');
    }
    if (!(start >= 0 && start <= end && end < size)) throw new RangeError('Range out of bounds');
  }
  const dataKey =
    'dataKey' in input
      ? Buffer.from(input.dataKey)
      : unwrapDataKey(input.fileKey, input.wrappedKey);
  const prefix = parsePrefix(input.noncePrefix);
  return Readable.from(decryptRecords(input, dataKey, prefix, { start, end }), {
    objectMode: false,
  });
}
