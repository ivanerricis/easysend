import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig } from '../config.js';
import { BackupError, restoreBackup, type RestoreResult } from '../db/backup.js';
import { createLogger } from '../logger.js';

export const RESTORE_DB_USAGE = `Usage: node dist/cli/restore-db.js <backup-file-name>

Replaces the database with a backup from the backup directory (a bare file name such as
manual-20260101T120000.sqlite). STOP THE API FIRST. The current database is saved as
app-pre-restore-<timestamp>.sqlite before it is replaced.`;

/** `db:restore`: restores `name` and returns what happened. */
export async function runRestoreDb(
  name: string | undefined,
  env: Record<string, string | undefined>,
): Promise<RestoreResult> {
  if (!name || name === '--help') throw new BackupError(RESTORE_DB_USAGE);
  const config = loadConfig(env);
  const logger = createLogger(
    { ...config, logPretty: false, nodeEnv: 'production' },
    {},
    process.stderr,
  );
  return restoreBackup(name, { dbPath: config.dbPath, backupDir: config.dbBackupDir, logger });
}

// Entry point: skipped when the module is imported (tests call runRestoreDb directly).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runRestoreDb(process.argv[2], process.env);
    console.log(`Restored ${result.restored}`);
    if (result.previousCopy) console.log(`Previous database saved as ${result.previousCopy}`);
  } catch (error) {
    console.error(
      error instanceof BackupError || error instanceof ConfigError
        ? error.message
        : `Restore failed: ${error instanceof Error ? error.message : 'unexpected error'}`,
    );
    process.exitCode = 1;
  }
}
