import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config.js';
import { createContext, type AppContext, type AppDeps } from './context.js';
import { cookieParser } from './http/cookies.js';
import { createErrorHandler, notFoundHandler } from './http/error-handler.js';
import { requestId } from './http/request-id.js';
import type { Logger } from './logger.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';

export type { AppDeps } from './context.js';

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

export function createApp(deps: AppDeps): Express {
  return createAppWithContext(deps).app;
}

/** Like `createApp`, also returning the context (tests use it to reach clock, keys, limiters...). */
export function createAppWithContext(deps: AppDeps): { app: Express; ctx: AppContext } {
  const ctx = createContext(deps);
  const { config, logger } = ctx;
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

  // Health needs neither cookies nor a session: it stays cheap and always reachable.
  app.use('/api', healthRouter(config, ctx.dbHandle.sqlite));

  app.use(cookieParser);
  app.use('/api', ctx.csrf.rejectCrossSite);
  app.use(ctx.sessions.loadSession);

  // Empty for now: WP2/WP3 fill these routers so this file stays untouched.
  app.use('/api', authRouter(ctx), meRouter(ctx), adminUsersRouter(ctx));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return { app, ctx };
}
