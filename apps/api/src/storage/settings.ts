import { count, eq, inArray } from 'drizzle-orm';
import {
  STORAGE_LOCKABLE_FIELDS,
  STORAGE_TEST_REASONS,
  type S3Config,
  type S3Input,
  type S3Public,
  type StorageSettingsResponse,
  type StorageTestReason,
  type StorageUpdateRequest,
} from '@easysend/shared';
import type { AppContext } from '../context.js';
import { storageMigrations, transferFiles } from '../db/schema/index.js';
import { AppError } from '../http/errors.js';
import { storageEnvDiffers } from './env.js';
import { storageUsageByDriver } from './usage.js';

type SettingsContext = Pick<
  AppContext,
  'db' | 'config' | 'settings' | 'storageProbe' | 'storageVerification'
>;

/** Public view of an S3 configuration: never the secret key, only whether one is stored. */
export function toS3Public(config: S3Config): S3Public {
  const { secretAccessKey: _secret, ...rest } = config;
  return { ...rest, hasSecret: true };
}

/**
 * The configuration a test or save really uses: an omitted secret key means "keep the stored
 * one". Without either there is nothing to authenticate with, which is a validation problem.
 */
export function effectiveS3Config(ctx: Pick<AppContext, 'settings'>, input: S3Input): S3Config {
  const secretAccessKey = input.secretAccessKey ?? ctx.settings.get('storage')?.s3?.secretAccessKey;
  if (!secretAccessKey) {
    throw new AppError('VALIDATION_ERROR', 'The secret access key is required', {
      fields: ['s3.secretAccessKey'],
    });
  }
  return { ...input, secretAccessKey };
}

/** True when a migration is running or being cancelled (its files move between configurations). */
export function migrationActive(ctx: Pick<AppContext, 'db'>): boolean {
  return (
    (ctx.db
      .select({ n: count() })
      .from(storageMigrations)
      .where(inArray(storageMigrations.status, ['running', 'cancelling']))
      .get()?.n ?? 0) > 0
  );
}

function s3HasFiles(ctx: Pick<AppContext, 'db'>): boolean {
  return (
    (ctx.db.select({ n: count() }).from(transferFiles).where(eq(transferFiles.storage, 's3')).get()
      ?.n ?? 0) > 0
  );
}

/** Storage configuration as shown in the panel and the wizard (never the secret key). */
export function storageSettingsView(ctx: SettingsContext): StorageSettingsResponse {
  const stored = ctx.settings.get('storage');
  const locked = s3HasFiles(ctx);
  return {
    driver: stored?.driver ?? 'local',
    s3: stored?.s3 ? toS3Public(stored.s3) : null,
    source: stored?.source ?? 'env',
    envDiffers: storageEnvDiffers({ config: ctx.config, settings: ctx.settings }),
    usage: storageUsageByDriver(ctx.db),
    locked: {
      fields: locked ? [...STORAGE_LOCKABLE_FIELDS] : [],
      reason: locked ? 's3_has_files' : null,
    },
  };
}

const isTestReason = (value: unknown): value is StorageTestReason =>
  (STORAGE_TEST_REASONS as readonly unknown[]).includes(value);

/**
 * Runs the connection test with the effective configuration. A failure is always reported as
 * `STORAGE_TEST_FAILED` with a safe `details.reason` (never the provider's message); on success
 * the exact configuration is remembered as verified for 30 minutes. Rate limiting: the caller.
 */
export async function testStorageConfig(ctx: SettingsContext, input: S3Input): Promise<void> {
  const config = effectiveS3Config(ctx, input);
  try {
    await ctx.storageProbe(config);
  } catch (error) {
    const reason = error instanceof AppError ? error.details?.['reason'] : undefined;
    throw new AppError('STORAGE_TEST_FAILED', 'The storage connection test failed', {
      reason: isTestReason(reason) ? reason : 'NETWORK',
    });
  }
  ctx.storageVerification.remember(config);
}

const sameLockedFields = (a: S3Config, b: S3Config): boolean =>
  STORAGE_LOCKABLE_FIELDS.every((field) => a[field] === b[field]);

const sameConfig = (a: S3Config, b: S3Config): boolean =>
  sameLockedFields(a, b) &&
  a.region === b.region &&
  a.forcePathStyle === b.forcePathStyle &&
  a.accessKeyId === b.accessKeyId &&
  a.secretAccessKey === b.secretAccessKey;

/**
 * Saves the storage configuration (panel and wizard). The change applies at once to new files;
 * existing files stay where they are. Rules:
 * - `local` without S3 data only switches the driver (the saved S3 configuration is kept);
 * - any S3 data that is new, changed, or used to activate `s3` needs a matching fresh test
 *   (`STORAGE_NOT_VERIFIED`);
 * - endpoint, bucket and prefix cannot change while files live on S3 or a migration is active
 *   (`STORAGE_IN_USE`); access keys and region can always be rotated after a test.
 */
export function saveStorageSettings(
  ctx: SettingsContext,
  body: StorageUpdateRequest,
): StorageSettingsResponse {
  const saved = ctx.settings.get('storage')?.s3;
  const s3 = body.s3 ? effectiveS3Config(ctx, body.s3) : saved;
  if (body.driver === 's3' && !s3) {
    throw new AppError('STORAGE_NOT_VERIFIED', 'Test an S3 configuration first');
  }

  if (s3 && saved && !sameLockedFields(s3, saved) && (s3HasFiles(ctx) || migrationActive(ctx))) {
    throw new AppError(
      'STORAGE_IN_USE',
      'Files are stored on S3: move them to the local disk before changing endpoint, bucket or prefix',
      { fields: STORAGE_LOCKABLE_FIELDS.filter((field) => s3[field] !== saved[field]) },
    );
  }

  const changed = s3 !== undefined && (saved === undefined || !sameConfig(s3, saved));
  if (s3 && (body.driver === 's3' || changed) && !ctx.storageVerification.isVerified(s3)) {
    throw new AppError(
      'STORAGE_NOT_VERIFIED',
      'Run a successful connection test with these settings first',
    );
  }

  ctx.settings.set('storage', {
    driver: body.driver,
    ...(s3 ? { s3 } : {}),
    source: 'panel',
  });
  ctx.storageVerification.clear();
  return storageSettingsView(ctx);
}
