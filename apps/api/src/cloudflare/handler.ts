import type { RequestHandler } from 'express';
import type { CloudflareRequest } from '@easysend/shared';
import { auditRequest } from '../audit.js';
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
    auditRequest(ctx, req, 'tunnel.configured', {
      targetType: 'settings',
      metadata: { hostname: result.hostname, tunnelId: result.tunnelId },
    });
    sendJson(res, endpointId, 200, result);
  };
}
