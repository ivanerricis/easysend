import { Router } from 'express';
import { tunnelHandler } from '../cloudflare/handler.js';
import type { AppContext } from '../context.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { sendJson } from '../http/validate.js';

/** Cloudflare tunnel endpoints of the admin panel (`admin.tunnel*`). */
export function adminTunnelRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/admin/tunnel', ...endpointGuards(ctx.csrf, 'admin.tunnelGet'), (_req, res) => {
    // `configuredAt: 0` marks a tunnel that was created but whose setup did not finish.
    const stored = ctx.settings.get('tunnel');
    const tunnel = stored && stored.configuredAt > 0 ? stored : undefined;
    sendJson(res, 'admin.tunnelGet', 200, {
      appMode: ctx.config.mode,
      configured: tunnel !== undefined,
      hostname: tunnel?.hostname ?? null,
      publicUrl: tunnel ? (ctx.publicUrl() ?? null) : null,
      tunnelId: tunnel?.tunnelId ?? null,
      configuredAt: tunnel?.configuredAt ?? null,
    });
  });

  router.post(
    '/admin/tunnel',
    ...endpointGuards(ctx.csrf, 'admin.tunnelSet'),
    tunnelHandler(ctx, 'admin.tunnelSet'),
  );

  return router;
}
