import path from 'node:path';
import type { AppConfig } from '../config.js';

/** Storage names are random UUIDs (see `transfer_files.storage_name`): nothing else gets a path. */
const STORAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Suffix of a file still being written; the cleanup sweep and startup recovery recognise it. */
export const PART_SUFFIX = '.part';

export const isStorageName = (name: string): boolean => STORAGE_NAME.test(name);

function assertStorageName(name: string): void {
  if (!isStorageName(name)) throw new Error('Invalid storage name');
}

/** Final path of an encrypted file inside `STORAGE_DIR`. Throws unless `storageName` is a UUID. */
export function storagePath(config: Pick<AppConfig, 'storageDir'>, storageName: string): string {
  assertStorageName(storageName);
  return path.join(config.storageDir, storageName);
}

/** Temporary path used while encrypting; renamed to `storagePath` when complete. */
export function storagePartPath(
  config: Pick<AppConfig, 'storageDir'>,
  storageName: string,
): string {
  return `${storagePath(config, storageName)}${PART_SUFFIX}`;
}

/** True for `<uuid>` and `<uuid>.part`, the only names the app creates in `STORAGE_DIR`. */
export function isStorageEntry(fileName: string): boolean {
  return isStorageName(
    fileName.endsWith(PART_SUFFIX) ? fileName.slice(0, -PART_SUFFIX.length) : fileName,
  );
}

/**
 * Files @tus/file-store keeps in `TMP_UPLOAD_DIR` for an upload: the data (`<id>`) and its
 * metadata (`<id>.json`). Throws unless `uploadId` is a UUID (it is also used as a file name).
 */
export function tusFilePaths(
  config: Pick<AppConfig, 'tmpUploadDir'>,
  uploadId: string,
): { data: string; info: string } {
  assertStorageName(uploadId);
  const data = path.join(config.tmpUploadDir, uploadId);
  return { data, info: `${data}.json` };
}
