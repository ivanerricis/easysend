import { Router } from 'express';
import type { AppContext } from '../context.js';

/** Public and admin settings endpoints (`settings.*`). Filled in by the phase 4 work packages. */
export function settingsRouter(_ctx: AppContext): Router {
  return Router();
}
