import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config.js';
import type { DbHandle } from './db/client.js';
import { createErrorHandler, notFoundHandler } from './http/error-handler.js';
import { requestId } from './http/request-id.js';
import type { Logger } from './logger.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  config: AppConfig;
  db: DbHandle;
  logger: Logger;
}

/** True for localhost, 127.0.0.1 and [::1] with any port (container healthchecks, local tools). */
export function isLoopbackHost(host: string): boolean {
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

/**
 * SPEC 11-bis: in local mode, report requests whose Host differs from PUBLIC_URL (once per host).
 * Health checks and loopback hosts are skipped so the container healthcheck stays quiet.
 */
function localHostWarning(config: AppConfig, logger: Logger): RequestHandler {
  const expected = config.publicUrl ? new URL(config.publicUrl).host : undefined;
  const seen = new Set<string>();
  return (req, _res, next) => {
    const host = req.headers.host;
    const skip = req.path === '/api/health' || (host !== undefined && isLoopbackHost(host));
    if (!skip && expected && host && host !== expected && !seen.has(host)) {
      seen.add(host);
      logger.warn(
        { host, expected },
        'request host differs from PUBLIC_URL: open the app only from the configured address',
      );
    }
    next();
  };
}

export function createApp({ config, db, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // Health checks run every few seconds and would drown the log.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(helmet());
  if (config.mode === 'local') app.use(localHostWarning(config, logger));

  // Phase 3: mount the tus handler here with app.use('/api/uploads', ...), BEFORE the body
  // parsers below, because tus must read the raw request stream.

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter(config, db.sqlite));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
