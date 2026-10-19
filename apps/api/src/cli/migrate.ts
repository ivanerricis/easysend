import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../db/migrate.js';
import { createLogger } from '../logger.js';

/** `pnpm db:migrate`: applies pending migrations to the configured database and exits. */
const config = loadConfig(process.env);
const logger = createLogger(config);

mkdirSync(path.dirname(config.dbPath), { recursive: true });
const { sqlite } = openDatabase(config.dbPath);
try {
  await runMigrations(sqlite, {
    migrationsFolder: resolveMigrationsFolder(),
    backupDir: config.dbBackupDir,
    logger,
  });
} finally {
  sqlite.close();
}
