import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { STORAGE_DRIVERS, type StorageDriverKind, type StorageMigration } from '@easysend/shared';
import { ConfigError, loadConfig } from '../config.js';
import { createContext, type AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../db/migrate.js';
import { AppError } from '../http/errors.js';
import { createLogger } from '../logger.js';
import { resolveSecrets } from '../secrets.js';
import {
  cancelMigration,
  estimateMigration,
  latestMigration,
  startMigration,
  waitForMigration,
} from '../storage/migrate.js';

export class CliError extends Error {}

export const STORAGE_MIGRATE_USAGE = `Usage: storage:migrate --to s3|local [--dry-run]

Moves the stored (encrypted) files to the given storage, one file at a time. The encrypted bytes
are copied as they are: keys do not change. Source objects are deleted after a 1 hour grace period
by the cleanup job (the API must run for that). Refuses to start while another migration is
running. --dry-run prints how many files and bytes would move and exits. Ctrl+C asks the job to
stop after the current file.`;

export interface StorageMigrateIo {
  log(message: string): void;
}

export interface StorageMigrateOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  io?: StorageMigrateIo;
  /** Milliseconds between progress lines. */
  progressIntervalMs?: number;
  /** Receives the context once built (tests share their own app instead, see `ctx`). */
  ctx?: AppContext;
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

const progressLine = (m: StorageMigration): string =>
  `${m.doneFiles}/${m.totalFiles} files, ${mb(m.doneBytes)}/${mb(m.totalBytes)}` +
  (m.failedFiles > 0 ? `, ${m.failedFiles} failed` : '');

/**
 * `storage:migrate`: runs the migration service in the foreground with terminal progress.
 * Returns the final migration state (null for a dry run). Throws `CliError` for any user-facing
 * problem. With `options.ctx` it uses that application context instead of opening the database.
 */
export async function runStorageMigrate(
  options: StorageMigrateOptions,
): Promise<StorageMigration | null> {
  const io: StorageMigrateIo = options.io ?? { log: (message) => console.log(message) };

  let values: { to?: string; 'dry-run'?: boolean };
  try {
    ({ values } = parseArgs({
      // pnpm forwards a lone "--" separator: ignore it.
      args: options.argv.filter((arg) => arg !== '--'),
      options: { to: { type: 'string' }, 'dry-run': { type: 'boolean' } },
      strict: true,
    }));
  } catch (error) {
    throw new CliError(`${(error as Error).message}. ${STORAGE_MIGRATE_USAGE}`);
  }
  const target = values.to as StorageDriverKind | undefined;
  if (!target || !STORAGE_DRIVERS.includes(target)) throw new CliError('Missing --to s3|local');

  if (options.ctx) return await run(options.ctx, target, values['dry-run'] === true, io, options);

  const config = loadConfig(options.env);
  const logger = createLogger(config);
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const handle = openDatabase(config.dbPath);
  try {
    await runMigrations(handle.sqlite, {
      migrationsFolder: resolveMigrationsFolder(),
      backupDir: config.dbBackupDir,
      logger,
    });
    const secrets = resolveSecrets(config.secretsDir, options.env);
    const ctx = createContext({ config, db: handle, logger, secrets });
    return await run(ctx, target, values['dry-run'] === true, io, options);
  } finally {
    handle.sqlite.close();
  }
}

async function run(
  ctx: AppContext,
  target: StorageDriverKind,
  dryRun: boolean,
  io: StorageMigrateIo,
  options: StorageMigrateOptions,
): Promise<StorageMigration | null> {
  if (dryRun) {
    const { files, bytes } = estimateMigration(ctx, target);
    io.log(`Would move ${files} file(s), ${mb(bytes)}, to ${target}.`);
    const capacity = await ctx.storage.forFile(target).capacity();
    if (capacity) io.log(`Free space on the target: ${mb(capacity.freeBytes)}.`);
    return null;
  }

  let handle;
  try {
    handle = await startMigration(ctx, { target, startedBy: null });
  } catch (error) {
    if (error instanceof AppError) throw new CliError(`${error.code}: ${error.message}`);
    throw error;
  }
  io.log(`Migration started: ${progressLine(handle.migration)} to move to ${target}.`);

  const onSigint = (): void => {
    io.log('Stopping after the current file...');
    try {
      cancelMigration(ctx, { actorId: null });
    } catch {
      // Already finished.
    }
  };
  process.once('SIGINT', onSigint);
  let last = '';
  const timer = setInterval(() => {
    const current = latestMigration(ctx);
    if (!current) return;
    const line = progressLine(current);
    if (line !== last) io.log(line);
    last = line;
  }, options.progressIntervalMs ?? 2000);
  try {
    await waitForMigration(ctx);
  } finally {
    clearInterval(timer);
    process.removeListener('SIGINT', onSigint);
  }

  const final = latestMigration(ctx)!;
  io.log(
    `Migration ${final.status}: ${progressLine(final)}.` +
      (final.errorCode ? ` Error: ${final.errorCode}.` : ''),
  );
  if (final.status !== 'done' || final.failedFiles > 0) {
    throw new CliError(
      final.status === 'done'
        ? `${final.failedFiles} file(s) could not be moved: run the command again to retry them.`
        : `The migration did not finish (${final.status}).`,
    );
  }
  return final;
}

// Entry point: skipped when the module is imported (tests call runStorageMigrate directly).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.includes('--help')) {
      console.log(STORAGE_MIGRATE_USAGE);
    } else {
      await runStorageMigrate({ argv: process.argv.slice(2), env: process.env });
    }
  } catch (error) {
    console.error(
      error instanceof CliError || error instanceof ConfigError
        ? error.message
        : 'storage:migrate failed unexpectedly',
    );
    process.exitCode = 1;
  }
}
