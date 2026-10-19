import { Router } from 'express';
import type { AppContext } from '../context.js';

// TODO(WP2: login, 2FA, recovery, logout, session, csrf and password reset)
export function authRouter(_ctx: AppContext): Router {
  const router = Router();
  return router;
}
