import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { pino } from 'pino';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase, type DbHandle } from '../src/db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../src/db/migrate.js';

export const silentLogger = pino({ level: 'silent' });

const tempDirs: string[] = [];
const openDbs: DbHandle[] = [];

/** Creates a temp dir removed after each test. DBs are closed first (Windows file locks). */
export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'easysend-api-'));
  tempDirs.push(dir);
  return dir;
}

/** Opens a DB that is closed automatically after the test. */
export function trackDb(handle: DbHandle): DbHandle {
  openDbs.push(handle);
  return handle;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', APP_MODE: 'local', ...overrides });
}

/** Migrated in-memory database. */
export async function migratedMemoryDb(): Promise<DbHandle> {
  const handle = trackDb(openDatabase(':memory:'));
  await runMigrations(handle.sqlite, {
    migrationsFolder: resolveMigrationsFolder(),
    backupDir: path.join(makeTempDir(), 'backups'),
    logger: silentLogger,
  });
  return handle;
}

afterEach(() => {
  for (const handle of openDbs.splice(0)) {
    if (handle.sqlite.open) handle.sqlite.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
