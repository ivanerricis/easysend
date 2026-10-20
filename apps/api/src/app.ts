import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createContext, type AppContext, type AppDeps } from './context.js';
import { cookieParser } from './http/cookies.js';
import { createErrorHandler, notFoundHandler } from './http/error-handler.js';
import { createSetupGate } from './http/setup-gate.js';
import { maskLogUrl } from './http/log-url.js';
import { requestId } from './http/request-id.js';
import type { Logger } from './logger.js';
import { adminTunnelRouter } from './routes/admin-tunnel.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { authRouter } from './routes/auth.js';
import { downloadsRouter } from './routes/downloads.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { settingsRouter } from './routes/settings.js';
import { setupRouter } from './routes/setup.js';
import { transfersRouter } from './routes/transfers.js';
import { uploadsRouter } from './uploads/tus.js';

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
function localHostWarning(publicUrl: () => string | undefined, logger: Logger): RequestHandler {
  const seen = new Set<string>();
  return (req, _res, next) => {
    const host = req.headers.host;
    const skip = req.path === '/api/health' || !host || isLoopbackHost(host) || seen.has(host);
    if (skip) return next();
    const configured = publicUrl();
    const expected = configured ? new URL(configured).host : undefined;
    if (expected && host !== expected) {
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
      // Allow-list serializers: no headers (cookies, user agent, forwarded IPs), no socket
      // address, and the URL without download tokens or query string.
      serializers: {
        req: (req: { id?: unknown; method?: string; originalUrl?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: maskLogUrl(req.originalUrl ?? req.url ?? ''),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  if (config.mode === 'local') app.use(localHostWarning(() => ctx.publicUrl(), logger));

  // Until the wizard completes only health, setup, public settings and assets answer. Mounted
  // before tus so uploads are gated too.
  app.use(createSetupGate(ctx.settings));

  // tus must read the raw request stream, so it is mounted BEFORE the body parsers below. Its
  // router adds its own cookie parsing, cross-site check, session and CSRF handling.
  app.use(uploadsRouter(ctx));

  app.use(express.json({ limit: '1mb' }));

  // Health needs neither cookies nor a session: it stays cheap and always reachable.
  app.use('/api', healthRouter(config, ctx.dbHandle.sqlite));

  app.use(cookieParser);
  app.use('/api', ctx.csrf.rejectCrossSite);
  app.use(ctx.sessions.loadSession);

  app.use(
    '/api',
    authRouter(ctx),
    meRouter(ctx),
    adminUsersRouter(ctx),
    transfersRouter(ctx),
    downloadsRouter(ctx),
    setupRouter(ctx),
    settingsRouter(ctx),
    adminTunnelRouter(ctx),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return { app, ctx };
}
