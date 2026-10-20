import { Router } from 'express';
import type { UpdateStatusQuery } from '@easysend/shared';
import type { AppContext } from '../context.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validQuery } from '../http/validate.js';

/** "Update available" notice of the admin panel (`admin.updates`). */
export function adminUpdatesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/admin/updates', ...endpointGuards(ctx.csrf, 'admin.updates'), async (req, res) => {
    const refresh = validQuery<UpdateStatusQuery>(req).refresh === 'true';
    const enabled = ctx.settings.get('general')?.updateCheck ?? true;
    // Only a forced check that can reach GitHub counts against the limit, so plain page loads
    // served from the cache never lock the admin out of "Check now".
    if (refresh && enabled) {
      assertNotLimited(res, await ctx.setupLimiters.updateCheck.consume('refresh'));
    }
    sendJson(res, 'admin.updates', 200, await ctx.updates.status({ enabled, refresh }));
  });

  return router;
}
