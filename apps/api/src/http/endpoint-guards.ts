import type { RequestHandler } from 'express';
import { requireAuth, type GuardLevel } from '../auth/guards.js';
import type { CsrfService } from './csrf.js';
import { getEndpoint, validate } from './validate.js';

/** Endpoints whose contract level is `mfa-pending` but that accept a full session too. */
const PENDING_OR_FULL = new Set(['auth.logout']);

/**
 * The standard middleware chain of an endpoint, derived from the shared registry so a route can
 * never drift from the contract: authentication level, CSRF (when the contract says so) and
 * params/query/body validation, in this order.
 *
 * Usage: `router.post('/auth/login', ...endpointGuards(ctx.csrf, 'auth.login'), handler)`.
 * Rate limiting is added by the handler or with `rateLimit(...)` because keys differ per flow.
 * Level `setup` (phase 4) is not supported yet and throws when the chain is built.
 */
export function endpointGuards(csrf: CsrfService, id: string): RequestHandler[] {
  const endpoint = getEndpoint(id);
  const chain: RequestHandler[] = [];

  if (endpoint.auth === 'setup') {
    throw new Error(`Endpoint ${id}: the setup auth level is implemented in phase 4`);
  }
  if (endpoint.auth !== 'public') {
    const level: GuardLevel = PENDING_OR_FULL.has(id) ? 'any' : endpoint.auth;
    chain.push(requireAuth(level));
  }
  if (endpoint.csrf) chain.push(csrf.requireCsrf);
  if (endpoint.params || endpoint.query || endpoint.body) chain.push(validate(id));
  return chain;
}
