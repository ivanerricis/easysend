import { Router } from 'express';
import type { AppContext } from '../context.js';

/**
 * Transfers API (phase 3, WP2): `/transfers...`, `/admin/transfers` and `/admin/storage`.
 * Mounted under `/api` by `app.ts`; empty until the endpoints are implemented.
 */
export function transfersRouter(_ctx: AppContext): Router {
  return Router();
}
