import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createAppWithContext } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { resolveMigrationsFolder, runMigrations } from './db/migrate.js';
import { scheduleCleanup } from './jobs/cleanup.js';
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

  const { app, ctx } = createAppWithContext({ config, db, logger, secrets });
  if (!ctx.settings.isSetupCompleted()) {
    // Required by the spec (also in local mode): the code proves the visitor can read the logs.
    logger.warn(
      `Setup code: ${ctx.setupCode.issue()} (valid ${config.setupCodeTtlMinutes} minutes). Open the app to start the setup wizard.`,
    );
  }
  // Uploads interrupted by a restart while being encrypted are queued again.
  await ctx.uploadWorker.recover();
  const cleanup = scheduleCleanup(ctx);
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
    cleanup.stop();
    // An encryption still running is redone at the next start (`recover`).
    ctx.uploadWorker.stop();
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
