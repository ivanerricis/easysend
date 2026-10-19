import { Router } from 'express';
import type { AppContext } from '../context.js';

// TODO(WP3: profile, password change, 2FA management and client config)
export function meRouter(_ctx: AppContext): Router {
  const router = Router();
  return router;
}
