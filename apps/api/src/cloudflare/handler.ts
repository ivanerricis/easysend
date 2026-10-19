import type { RequestHandler } from 'express';
import type { CloudflareRequest } from '@easysend/shared';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody } from '../http/validate.js';
import { configureTunnel } from './configure.js';

/** Shared handler of `setup.cloudflare` and `admin.tunnelSet` (same logic, different guards). */
export function tunnelHandler(
  ctx: AppContext,
  endpointId: 'setup.cloudflare' | 'admin.tunnelSet',
): RequestHandler {
  return async (req, res) => {
    const body = validBody<CloudflareRequest>(req);
    assertNotLimited(res, await ctx.setupLimiters.cloudflare.consume('global'));
    const result = await configureTunnel(ctx, body);
    audit(ctx.db, {
      actorId: req.auth?.user.id ?? null,
      action: 'tunnel.configured',
      targetType: 'settings',
      metadata: { hostname: result.hostname, tunnelId: result.tunnelId },
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(ctx.clock),
    });
    sendJson(res, endpointId, 200, result);
  };
}
