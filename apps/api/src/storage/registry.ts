import { type S3Config, type StorageDriverKind } from '@easysend/shared';
import { AppError } from '../http/errors.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { SettingsRepo } from '../settings/repo.js';
import type { DiskSpace } from './disk.js';
import { createLocalDriver } from './local.js';
import type { StorageDriver } from './types.js';

/**
 * Resolves the driver for new files (`current`) and for an existing file (`forFile`, from its
 * `transfer_files.storage` column). The `storage` setting is read on every call, so a change
 * made in the panel or wizard applies at once, without restart.
 */
export interface StorageRegistry {
  /** Kind of the driver used for NEW files: the `storage` setting, `local` when it is unset. */
  currentKind(): StorageDriverKind;
  /** Driver for new files. */
  current(): StorageDriver;
  /**
   * Driver that holds a file stored with `kind`. Throws `AppError('STORAGE_UNAVAILABLE')` when
   * that driver cannot be built (S3 without a saved configuration, or not available).
   */
  forFile(kind: StorageDriverKind): StorageDriver;
}

export interface StorageRegistryDeps {
  config: Pick<AppConfig, 'storageDir'>;
  settings: Pick<SettingsRepo, 'get'>;
  logger: Logger;
  diskSpace: DiskSpace;
  /**
   * Builds the S3 driver for a configuration. The registry caches the result and builds a new
   * driver when the configuration changes. Without it `s3` is unavailable (placeholder until the
   * S3 driver is wired in).
   */
  s3Factory?: (config: S3Config) => StorageDriver;
  /** Ready-made drivers that win over the built ones (tests inject fakes here). */
  overrides?: Partial<Record<StorageDriverKind, StorageDriver>>;
}

export function createStorageRegistry(deps: StorageRegistryDeps): StorageRegistry {
  const local = createLocalDriver({
    storageDir: deps.config.storageDir,
    diskSpace: deps.diskSpace,
    logger: deps.logger,
  });
  let s3Cache: { key: string; driver: StorageDriver } | undefined;

  const forFile = (kind: StorageDriverKind): StorageDriver => {
    const override = deps.overrides?.[kind];
    if (override) return override;
    if (kind === 'local') return local;

    const s3 = deps.settings.get('storage')?.s3;
    if (!s3) throw new AppError('STORAGE_UNAVAILABLE', 'S3 storage is not configured');
    if (!deps.s3Factory) throw new AppError('STORAGE_UNAVAILABLE', 'S3 storage is not available');
    const key = JSON.stringify(s3);
    if (s3Cache?.key !== key) s3Cache = { key, driver: deps.s3Factory(s3) };
    return s3Cache.driver;
  };

  const currentKind = (): StorageDriverKind => deps.settings.get('storage')?.driver ?? 'local';
  return { currentKind, current: () => forFile(currentKind()), forFile };
}
