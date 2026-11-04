import { readFileSync } from 'node:fs';
import path from 'node:path';
import { s3ConfigSchema, type S3Config } from '@easysend/shared';
import { ConfigError, type AppConfig } from '../config.js';
import { sha256Hex } from '../crypto/hash.js';
import type { Logger } from '../logger.js';
import type { SettingsRepo, StorageSetting } from '../settings/repo.js';

/** Environment variable behind each field of the S3 configuration (for error messages). */
const VARIABLE_OF: Record<keyof S3Config, string> = {
  endpoint: 'S3_ENDPOINT',
  region: 'S3_REGION',
  bucket: 'S3_BUCKET',
  prefix: 'S3_PREFIX',
  forcePathStyle: 'S3_FORCE_PATH_STYLE',
  accessKeyId: 'S3_ACCESS_KEY_ID',
  secretAccessKey: 'S3_SECRET_ACCESS_KEY',
};

type StorageDeps = {
  config: Pick<AppConfig, 'storageEnv' | 'secretsDir'>;
  settings: Pick<SettingsRepo, 'get' | 'set' | 'has'>;
};

/** Reads the secret key from `S3_SECRET_ACCESS_KEY` or from the file named by `..._FILE`. */
function readSecret(
  config: Pick<AppConfig, 'storageEnv' | 'secretsDir'>,
  env: Record<string, string | undefined>,
): string | undefined {
  const direct = env['S3_SECRET_ACCESS_KEY']?.trim();
  if (direct) return direct;
  const file = config.storageEnv.secretAccessKeyFile;
  if (!file) return undefined;
  try {
    const content = readFileSync(path.resolve(config.secretsDir, file), 'utf8').trim();
    return content === '' ? undefined : content;
  } catch {
    // Unreadable: reported as an invalid S3_SECRET_ACCESS_KEY_FILE by the caller.
    throw new ConfigError(['S3_SECRET_ACCESS_KEY_FILE']);
  }
}

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return false;
  const v = value.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
};

/**
 * Storage configuration described by the environment (`STORAGE_DRIVER` and `S3_*`). Empty or
 * `local` means the local disk. `s3` needs endpoint, region, bucket, access key id and secret
 * key. Throws `ConfigError` naming the offending variables (never their values).
 */
export function readStorageEnv(
  config: Pick<AppConfig, 'storageEnv' | 'secretsDir'>,
  env: Record<string, string | undefined> = process.env,
): StorageSetting {
  const e = config.storageEnv;
  const driver = (e.driver ?? 'local').toLowerCase();
  if (driver === 'local') return { driver: 'local', source: 'env' };
  if (driver !== 's3') throw new ConfigError(['STORAGE_DRIVER']);

  const forcePathStyle = parseBoolean(e.forcePathStyle);
  const candidate = {
    endpoint: e.endpoint ?? '',
    region: e.region ?? '',
    bucket: e.bucket ?? '',
    prefix: e.prefix ?? '',
    forcePathStyle: forcePathStyle ?? false,
    accessKeyId: e.accessKeyId ?? '',
    secretAccessKey: readSecret(config, env) ?? '',
  };
  const invalid = new Set<string>();
  if (forcePathStyle === undefined) invalid.add('S3_FORCE_PATH_STYLE');
  const parsed = s3ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof S3Config | undefined;
      invalid.add(field ? VARIABLE_OF[field] : 'STORAGE_DRIVER');
    }
  }
  if (invalid.size > 0 || !parsed.success) throw new ConfigError([...invalid].sort());
  return { driver: 's3', s3: parsed.data, source: 'env' };
}

/** Comparable fingerprint of a storage configuration; only the active driver's data counts. */
function fingerprint(setting: Pick<StorageSetting, 'driver' | 's3'>): string {
  const s3 = setting.driver === 's3' ? setting.s3 : undefined;
  return sha256Hex(JSON.stringify([setting.driver, s3 ?? null]));
}

/**
 * First start only: when the `storage` setting does not exist yet, seeds it from the environment
 * (an empty environment means the local disk), encrypted, with `source: 'env'`. Afterwards the
 * database is the source of truth and the environment is ignored. An invalid S3 configuration
 * throws `ConfigError` (variable names only) so the start fails with a clear message. Returns
 * what happened.
 */
export function importStorageEnv(
  deps: StorageDeps & { logger?: Pick<Logger, 'info'> },
  env: Record<string, string | undefined> = process.env,
): 'imported' | 'skipped' {
  if (deps.settings.has('storage')) return 'skipped';
  const setting = readStorageEnv(deps.config, env);
  deps.settings.set('storage', setting);
  deps.logger?.info({ driver: setting.driver }, 'file storage configuration imported');
  return 'imported';
}

/**
 * True when the S3 configuration in the environment no longer matches the active one (the admin
 * changed it in the panel, or edited `.env` later). Boolean only: no value ever leaves here. An
 * environment that cannot be parsed counts as different; without a stored setting there is
 * nothing to differ from.
 */
export function storageEnvDiffers(
  deps: StorageDeps,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const active = deps.settings.get('storage');
  if (!active) return false;
  try {
    return fingerprint(readStorageEnv(deps.config, env)) !== fingerprint(active);
  } catch {
    return true;
  }
}
