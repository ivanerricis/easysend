import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { resolveMigrationsFolder, runMigrations } from './db/migrate.js';
import { createLogger } from './logger.js';
import { resolveSecrets } from './secrets.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  logger.info({ version: config.version, mode: config.mode }, 'starting easysend api');

  for (const dir of [
    path.dirname(config.dbPath),
    config.dbBackupDir,
    config.storageDir,
    config.tmpUploadDir,
    config.brandingDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const secrets = resolveSecrets(config.secretsDir, process.env);

  const db = openDatabase(config.dbPath);
  await runMigrations(db.sqlite, {
    migrationsFolder: resolveMigrationsFolder(),
    backupDir: config.dbBackupDir,
    logger,
  });

  const app = createApp({ config, db, logger, secrets });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'listening');
  });
  // Uploads and downloads can run for a long time: do not cut them off.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.warn('forcing open connections closed');
      server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      db.sqlite.close();
      logger.info('shutdown complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  await main();
} catch (error) {
  // Config errors carry variable names only. Other errors never contain secrets by construction.
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}
