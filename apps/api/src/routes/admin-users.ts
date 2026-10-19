import { Router } from 'express';
import type { AppContext } from '../context.js';

// TODO(WP3: admin user management with quotas)
export function adminUsersRouter(_ctx: AppContext): Router {
  const router = Router();
  return router;
}
