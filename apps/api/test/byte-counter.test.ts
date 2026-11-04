import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { createByteCounter } from '../src/storage/byte-counter.js';

describe('createByteCounter', () => {
  it('counts the bytes and passes them through unchanged', async () => {
    const counter = createByteCounter();
    const chunks: Buffer[] = [];
    await pipeline(
      Readable.from([Buffer.from('abc'), Buffer.from('defgh')]),
      counter.stream,
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );
    expect(counter.bytes()).toBe(8);
    expect(Buffer.concat(chunks).toString()).toBe('abcdefgh');
  });
});
