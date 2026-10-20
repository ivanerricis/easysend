import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from '../logger.js';
import type { SqliteDatabase } from './client.js';
import { backupTimestamp, pruneBackups } from './migrate.js';

export const MANUAL_BACKUPS_TO_KEEP = 10;
const MANUAL_BACKUP_FILE = /^manual-\d{8}T\d{6}(?:-\d+)?\.sqlite$/;
/** Backups that can be restored: manual ones and the ones taken before a migration or a restore. */
const RESTORABLE_BACKUP_FILE =
  /^(?:manual-\d{8}T\d{6}(?:-\d+)?|app-pre-[A-Za-z0-9][A-Za-z0-9_.-]*)\.sqlite$/;

export class BackupError extends Error {}

/**
 * Online, consistent backup (SQLite backup API; safe while the API is running in WAL mode) to
 * `manual-<UTC timestamp>.sqlite` in `backupDir`. Keeps the newest 10 manual backups; the
 * pre-migration backups (`app-pre-*`) have their own retention and are never touched here.
 * Returns the file name.
 */
export async function createManualBackup(
  sqlite: SqliteDatabase,
  backupDir: string,
  logger: Logger,
  now: Date = new Date(),
): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const stamp = backupTimestamp(now);
  let name = `manual-${stamp}.sqlite`;
  for (let n = 2; existsSync(path.join(backupDir, name)); n += 1) {
    name = `manual-${stamp}-${n}.sqlite`;
  }
  await sqlite.backup(path.join(backupDir, name));
  pruneBackups(backupDir, logger, MANUAL_BACKUP_FILE, MANUAL_BACKUPS_TO_KEEP);
  return name;
}

export interface RestoreResult {
  /** Backup the database was replaced with. */
  restored: string;
  /** Copy of the database that was replaced (undefined if there was none). */
  previousCopy: string | undefined;
}

/**
 * Replaces the database with a backup from `backupDir`. The API MUST be stopped: the check for
 * a running writer is best effort (`BEGIN IMMEDIATE` fails while another connection is writing,
 * but an idle open connection cannot be detected).
 *
 * Steps: validate the name (bare file name, no path), check the backup is a healthy SQLite
 * database (read-only `integrity_check`), save the current database as `app-pre-restore-*`,
 * copy the backup next to `dbPath` and rename it over the database, then drop `-wal` and `-shm`.
 */
export async function restoreBackup(
  name: string,
  options: { dbPath: string; backupDir: string; logger: Logger; now?: Date },
): Promise<RestoreResult> {
  const { dbPath, backupDir, logger } = options;
  if (!RESTORABLE_BACKUP_FILE.test(name) || name.includes('..')) {
    throw new BackupError(
      'Invalid backup name: use a bare file name such as manual-20260101T120000.sqlite',
    );
  }
  const source = path.join(backupDir, name);
  if (!existsSync(source)) throw new BackupError(`Backup not found: ${name}`);

  let backup: SqliteDatabase | undefined;
  try {
    backup = new Database(source, { readonly: true, fileMustExist: true });
    const check = backup.pragma('integrity_check') as { integrity_check: string }[];
    if (check.length !== 1 || check[0]?.integrity_check !== 'ok') {
      throw new BackupError(`The backup failed the integrity check: ${name}`);
    }
    const tables = backup.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
    if ((tables.get() as { n: number }).n === 0) throw new BackupError(`Empty database: ${name}`);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(`Not a valid SQLite database: ${name}`);
  } finally {
    backup?.close();
  }

  let previousCopy: string | undefined;
  if (existsSync(dbPath)) {
    const current = new Database(dbPath, { fileMustExist: true });
    try {
      current.pragma('busy_timeout = 0');
      try {
        current.exec('BEGIN IMMEDIATE; ROLLBACK;');
      } catch {
        throw new BackupError('The database is in use: stop the api before restoring');
      }
      previousCopy = `app-pre-restore-${backupTimestamp(options.now)}.sqlite`;
      mkdirSync(backupDir, { recursive: true });
      await current.backup(path.join(backupDir, previousCopy));
    } finally {
      current.close();
    }
    pruneBackups(backupDir, logger);
  }

  const temp = `${dbPath}.restore-${process.pid}.tmp`;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    copyFileSync(source, temp);
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    renameSync(temp, dbPath);
  } finally {
    rmSync(temp, { force: true });
  }
  return { restored: name, previousCopy };
}
