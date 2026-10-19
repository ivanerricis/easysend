import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Logger } from '../logger.js';
import type { SqliteDatabase } from './client.js';

export const BACKUPS_TO_KEEP = 5;
const BACKUP_FILE = /^app-pre-.+\.sqlite$/;

export interface MigrateOptions {
  migrationsFolder: string;
  backupDir: string;
  logger: Logger;
}

export interface MigrateResult {
  /** Tags of the migrations applied in this run. */
  applied: string[];
  /** Path of the pre-migration backup, if one was taken. */
  backupPath: string | undefined;
}

interface JournalEntry {
  tag: string;
  when: number;
}

/**
 * Finds the `drizzle/` folder next to the running code. It works from `src/db` (tsx, vitest)
 * and from `dist` (bundle with `drizzle/` copied beside it) by walking up the directory tree.
 */
export function resolveMigrationsFolder(startDir: string = import.meta.dirname): string {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Migrations folder not found');
    dir = parent;
  }
}

function readJournal(migrationsFolder: string): JournalEntry[] {
  const file = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries;
}

/** Returns the timestamp of the last applied migration, or undefined for a fresh database. */
function lastAppliedAt(sqlite: SqliteDatabase): number | undefined {
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!table) return undefined;
  const row = sqlite.prepare('SELECT MAX(created_at) AS last FROM __drizzle_migrations').get() as
    { last: number | null } | undefined;
  return row?.last ?? undefined;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
}

function pruneBackups(backupDir: string, logger: Logger): void {
  const files = readdirSync(backupDir)
    .filter((name) => BACKUP_FILE.test(name))
    .map((name) => ({ name, mtime: statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  for (const old of files.slice(BACKUPS_TO_KEEP)) {
    unlinkSync(path.join(backupDir, old.name));
    logger.info({ file: old.name }, 'removed old database backup');
  }
}

/**
 * Applies pending migrations. If the database already has applied migrations and more are
 * pending, an online backup is taken first (any pending migration, not only data-changing ones).
 * A fresh database is not backed up.
 */
export async function runMigrations(
  sqlite: SqliteDatabase,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const { migrationsFolder, backupDir, logger } = options;
  const journal = readJournal(migrationsFolder);
  const last = lastAppliedAt(sqlite);
  const pending = journal.filter((entry) => last === undefined || entry.when > last);

  if (pending.length === 0) {
    logger.info('database schema is up to date');
    return { applied: [], backupPath: undefined };
  }

  let backupPath: string | undefined;
  if (last !== undefined) {
    mkdirSync(backupDir, { recursive: true });
    const lastTag = pending[pending.length - 1]?.tag ?? 'unknown';
    backupPath = path.join(backupDir, `app-pre-${lastTag}-${timestamp()}.sqlite`);
    await sqlite.backup(backupPath);
    logger.info({ file: path.basename(backupPath) }, 'database backup created before migration');
    pruneBackups(backupDir, logger);
  }

  migrate(drizzle(sqlite), { migrationsFolder });
  const applied = pending.map((entry) => entry.tag);
  logger.info({ applied }, 'database migrations applied');
  return { applied, backupPath };
}
