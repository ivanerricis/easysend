import { Transform } from 'node:stream';

/** Pass-through stream that counts the bytes going through it (constant memory). */
export function createByteCounter(): { stream: Transform; bytes: () => number } {
  let total = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      done(null, chunk);
    },
  });
  return { stream, bytes: () => total };
}
