import { Router } from 'express';
import type { AppContext } from '../context.js';

/** First-run wizard endpoints (`setup.*`). Filled in by the phase 4 work packages. */
export function setupRouter(_ctx: AppContext): Router {
  return Router();
}
