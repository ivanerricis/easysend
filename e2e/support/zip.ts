import { createHash } from 'node:crypto';
import yauzl from 'yauzl';

export interface ZipEntry {
  name: string;
  size: number;
  sha256: string;
}

/** Opens a zip on disk with yauzl and returns every file entry with its size and SHA-256. */
export function readZip(path: string): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Cannot open the zip'));
        return;
      }
      const entries: ZipEntry[] = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error('Cannot read a zip entry'));
            return;
          }
          const hash = createHash('sha256');
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            hash.update(chunk);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            entries.push({ name: entry.fileName, size, sha256: hash.digest('hex') });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
