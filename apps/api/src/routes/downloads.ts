import { Router } from 'express';
import type { AppContext } from '../context.js';

/**
 * Public download API (phase 3, WP3): `/downloads/:token` (info, unlock, file, zip). These
 * endpoints are public and never need a session. Mounted under `/api` by `app.ts`; empty until
 * the endpoints are implemented.
 */
export function downloadsRouter(_ctx: AppContext): Router {
  return Router();
}
