import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { ConfigError, loadConfig } from '../config.js';
import { createManualBackup } from '../db/backup.js';
import { createLogger } from '../logger.js';

export const BACKUP_DB_USAGE = `Usage: node dist/cli/backup-db.js

Online consistent backup of the database (safe while the api is running) into the backup
directory as manual-<UTC timestamp>.sqlite. Prints only the file name on stdout. The newest 10
manual backups are kept.`;

/** `db:backup`: writes a manual backup and returns its file name. Logs go to stderr. */
export async function runBackupDb(env: Record<string, string | undefined>): Promise<string> {
  const config = loadConfig(env);
  // stdout carries only the file name (scripts parse it): logs go to stderr, never pretty.
  const logger = createLogger(
    { ...config, logPretty: false, nodeEnv: 'production' },
    {},
    process.stderr,
  );
  const sqlite = new Database(config.dbPath, { fileMustExist: true });
  try {
    return await createManualBackup(sqlite, config.dbBackupDir, logger);
  } finally {
    sqlite.close();
  }
}

// Entry point: skipped when the module is imported (tests call runBackupDb directly).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.includes('--help')) {
      console.log(BACKUP_DB_USAGE);
    } else {
      console.log(await runBackupDb(process.env));
    }
  } catch (error) {
    console.error(
      error instanceof ConfigError
        ? error.message
        : `Backup failed: ${error instanceof Error ? error.message : 'unexpected error'}`,
    );
    process.exitCode = 1;
  }
}
