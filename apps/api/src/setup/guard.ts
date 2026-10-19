import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';
import { getEndpoint, validate } from '../http/validate.js';
import { hasValidSetupCookie } from './cookie.js';

/** Setup already completed → `SETUP_ALREADY_COMPLETED`; no valid `es_setup` cookie → `UNAUTHENTICATED`. */
export function requireSetup(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    if (ctx.settings.isSetupCompleted()) {
      return next(new AppError('SETUP_ALREADY_COMPLETED', 'The setup is already completed'));
    }
    if (!hasValidSetupCookie(ctx, req)) {
      return next(new AppError('UNAUTHENTICATED', 'Enter the setup code first'));
    }
    next();
  };
}

/**
 * Middleware chain of a `setup`-level endpoint: setup cookie, CSRF (when the contract says so) and
 * validation. CSRF accepts the pre-login token, or the session-bound one once the admin exists.
 */
export function setupEndpointGuards(ctx: AppContext, id: string): RequestHandler[] {
  const endpoint = getEndpoint(id);
  const chain: RequestHandler[] = [requireSetup(ctx)];
  if (endpoint.csrf) chain.push(ctx.csrf.requireCsrf);
  if (endpoint.params || endpoint.query || endpoint.body) chain.push(validate(id));
  return chain;
}
