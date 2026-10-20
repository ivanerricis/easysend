// Deterministic test files: the same name and size always give the same bytes, SHA-256 and
// modification time, so a file selected again after a page reload is recognised as the same one
// (tus fingerprints include `lastModified`).
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { outputDir } from './paths.ts';

export const filesDir = join(outputDir, 'files');
const FIXED_TIME = new Date('2024-01-15T10:00:00Z');

export interface TestFile {
  name: string;
  path: string;
  size: number;
  sha256: string;
}

/** Pseudo-random but reproducible bytes: SHA-256 blocks chained from the seed. */
function deterministicBytes(seed: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  let block = createHash('sha256').update(seed).digest();
  for (let offset = 0; offset < size; offset += block.length) {
    block.copy(out, offset, 0, Math.min(block.length, size - offset));
    block = createHash('sha256').update(block).digest();
  }
  return out;
}

export function sha256Of(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function createTestFile(name: string, size: number): TestFile {
  mkdirSync(filesDir, { recursive: true });
  const path = join(filesDir, name);
  const content = deterministicBytes(`${name}:${size}`, size);
  let current = -1;
  try {
    current = statSync(path).size;
  } catch {
    // not created yet
  }
  if (current !== size) writeFileSync(path, content);
  utimesSync(path, FIXED_TIME, FIXED_TIME);
  return { name, path, size, sha256: sha256Of(content) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A valid solid-colour RGB PNG, for the branding upload. */
export function createPng(
  name: string,
  width: number,
  height: number,
  rgb: [number, number, number],
): { name: string; path: string; size: number } {
  mkdirSync(filesDir, { recursive: true });
  const path = join(filesDir, name);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return { name, path, size: png.length };
}
