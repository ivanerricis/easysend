import type { StorageDriverKind, StorageMigrationResponse } from '@easysend/shared';
import { createApi } from './endpoint';

const api = createApi([
  'storage.migration',
  'storage.migrationStart',
  'storage.migrationCancel',
] as const);

export const USED_ENDPOINTS = api.ids;

/** The latest migration of the files between the disk and S3 (null when none ever ran). */
export function getStorageMigration(): Promise<StorageMigrationResponse> {
  return api.call('storage.migration');
}

/** Starts moving the files that are on the other storage to `target` (202, runs in background). */
export function startStorageMigration(
  target: StorageDriverKind,
): Promise<StorageMigrationResponse> {
  return api.call('storage.migrationStart', { body: { target } });
}

/** Asks the running migration to stop after the file in progress. */
export function cancelStorageMigration(): Promise<StorageMigrationResponse> {
  return api.call('storage.migrationCancel');
}
